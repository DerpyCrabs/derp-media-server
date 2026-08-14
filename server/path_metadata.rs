use crate::{
    app::{default_settings, timestamp_ms},
    canvas_persistence,
    config::Config,
    contracts::ResourceKeyDto,
    error::AppResult,
    integrations::filesystem,
    reader_state, state_db, store,
};
use serde_json::{Value, json};

fn canvas_content_mutation(
    mutation: filesystem::persisted_content::PathMutation,
) -> canvas_persistence::ContentMutation {
    match mutation {
        filesystem::persisted_content::PathMutation::Unchanged => {
            canvas_persistence::ContentMutation::Unchanged
        }
        filesystem::persisted_content::PathMutation::Changed => {
            canvas_persistence::ContentMutation::Changed
        }
        filesystem::persisted_content::PathMutation::RemoveHost => {
            canvas_persistence::ContentMutation::RemoveHost
        }
    }
}

fn matches(path: &str, prefix: &str) -> bool {
    path == prefix || path.starts_with(&format!("{prefix}/"))
}

fn moved_path(path: &str, old_path: &str, new_path: &str) -> String {
    format!("{new_path}{}", &path[old_path.len()..])
}

fn move_map(value: &mut Value, old_path: &str, new_path: &str) {
    let Some(map) = value.as_object_mut() else {
        return;
    };
    let updates = map
        .iter()
        .filter(|(path, _)| matches(path, old_path))
        .map(|(path, value)| {
            (
                path.clone(),
                moved_path(path, old_path, new_path),
                value.clone(),
            )
        })
        .collect::<Vec<_>>();
    for (old, new, value) in updates {
        map.remove(&old);
        map.insert(new, value);
    }
}

fn remove_map(value: &mut Value, path: &str) {
    let Some(map) = value.as_object_mut() else {
        return;
    };
    map.retain(|key, _| !matches(key, path));
}

fn move_list(value: &mut Value, old_path: &str, new_path: &str) {
    let Some(items) = value.as_array_mut() else {
        return;
    };
    for item in items {
        if let Some(path) = item.as_str().filter(|path| matches(path, old_path)) {
            *item = Value::String(moved_path(path, old_path, new_path));
        }
    }
}

fn remove_list(value: &mut Value, path: &str) {
    let Some(items) = value.as_array_mut() else {
        return;
    };
    items.retain(|item| !item.as_str().is_some_and(|item| matches(item, path)));
}

fn filesystem_resource_path(config: &Config, value: &Value) -> Option<(String, String, String)> {
    let key = serde_json::from_value::<ResourceKeyDto>(value.clone()).ok()?;
    let (root_id, address_path) = filesystem::decode_key(&key).ok()?;
    let logical_path = if root_id == "configured-default" || config.roots.len() == 1 {
        address_path.clone()
    } else {
        let root = config.roots.iter().find(|root| root.id == root_id)?;
        if address_path.is_empty() {
            root.name.clone()
        } else {
            format!("{}/{address_path}", root.name)
        }
    };
    Some((root_id, address_path, logical_path))
}

fn filesystem_address_path(config: &Config, root_id: &str, logical_path: &str) -> Option<String> {
    if root_id == "configured-default" || config.roots.len() == 1 {
        return Some(logical_path.into());
    }
    let root = config.roots.iter().find(|root| root.id == root_id)?;
    logical_path
        .strip_prefix(&format!("{}/", root.name))
        .or_else(|| (logical_path == root.name).then_some(""))
        .map(str::to_string)
}

fn move_resource_value(config: &Config, value: &mut Value, old_path: &str, new_path: &str) {
    let Some((root_id, _, logical_path)) = filesystem_resource_path(config, value) else {
        return;
    };
    if !matches(&logical_path, old_path) {
        return;
    }
    let moved = moved_path(&logical_path, old_path, new_path);
    let Some(address_path) = filesystem_address_path(config, &root_id, &moved) else {
        return;
    };
    *value = serde_json::to_value(filesystem::encode_key(&root_id, &address_path))
        .expect("filesystem resource key serializes");
}

fn resource_matches(config: &Config, value: &Value, path: &str) -> bool {
    filesystem_resource_path(config, value)
        .is_some_and(|(_, _, logical_path)| matches(&logical_path, path))
}

fn move_workspace_snapshot(
    config: &Config,
    snapshot: &mut Value,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    if let Some(windows) = snapshot["windows"].as_array_mut() {
        for window in windows {
            filesystem::persisted_content::move_paths(
                config,
                &mut window["content"],
                old_path,
                new_path,
            )?;
        }
    }
    if let Some(pins) = snapshot["pinnedTaskbarItems"].as_array_mut() {
        for pin in pins {
            move_resource_value(config, &mut pin["resource"], old_path, new_path);
        }
    }
    Ok(())
}

fn repair_workspace_snapshot(snapshot: &mut Value) -> bool {
    let ids = snapshot["windows"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|window| window["id"].as_str().map(str::to_string))
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return false;
    }
    if !snapshot["activeWindowId"]
        .as_str()
        .is_some_and(|id| ids.iter().any(|candidate| candidate == id))
    {
        snapshot["activeWindowId"] = Value::String(ids.last().cloned().unwrap_or_default());
    }
    if let Some(map) = snapshot["activeTabMap"].as_object_mut() {
        map.retain(|_, id| {
            id.as_str()
                .is_some_and(|id| ids.iter().any(|candidate| candidate == id))
        });
    }
    if let Some(splits) = snapshot["tabGroupSplits"].as_object_mut() {
        splits.retain(|_, split| {
            split["leftTabId"]
                .as_str()
                .is_some_and(|id| ids.iter().any(|candidate| candidate == id))
        });
    }
    true
}

fn remove_workspace_snapshot(config: &Config, snapshot: &mut Value, path: &str) -> AppResult<bool> {
    if let Some(windows) = snapshot["windows"].as_array_mut() {
        let mut failure = None;
        windows.retain_mut(|window| {
            if failure.is_some() {
                return true;
            }
            match filesystem::persisted_content::remove_paths(config, &mut window["content"], path)
            {
                Ok(filesystem::persisted_content::PathMutation::RemoveHost) => false,
                Ok(_) => true,
                Err(error) => {
                    failure = Some(error);
                    true
                }
            }
        });
        if let Some(error) = failure {
            return Err(error);
        }
    }
    if let Some(pins) = snapshot["pinnedTaskbarItems"].as_array_mut() {
        pins.retain(|pin| !resource_matches(config, &pin["resource"], path));
    }
    Ok(repair_workspace_snapshot(snapshot))
}

fn move_workspace_metadata(
    config: &Config,
    settings: &mut Value,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    if let Some(pins) = settings["workspaceTaskbarPins"].as_array_mut() {
        for pin in pins {
            move_resource_value(config, &mut pin["resource"], old_path, new_path);
        }
    }
    if let Some(presets) = settings["workspaceLayoutPresets"].as_array_mut() {
        for preset in presets {
            move_workspace_snapshot(config, &mut preset["snapshot"], old_path, new_path)?;
        }
    }
    Ok(())
}

fn remove_workspace_metadata(config: &Config, settings: &mut Value, path: &str) -> AppResult<()> {
    if let Some(pins) = settings["workspaceTaskbarPins"].as_array_mut() {
        pins.retain(|pin| !resource_matches(config, &pin["resource"], path));
    }
    if let Some(presets) = settings["workspaceLayoutPresets"].as_array_mut() {
        let mut failure = None;
        presets.retain_mut(|preset| {
            if failure.is_some() {
                return true;
            }
            match remove_workspace_snapshot(config, &mut preset["snapshot"], path) {
                Ok(keep) => keep,
                Err(error) => {
                    failure = Some(error);
                    true
                }
            }
        });
        if let Some(error) = failure {
            return Err(error);
        }
    }
    Ok(())
}

fn empty_canvas_document() -> Value {
    json!({"schemaVersion":2,"revision":0,"activeId":null,"canvases":[]})
}

pub async fn moved(config: &Config, old_path: &str, new_path: &str) -> AppResult<()> {
    let mut failure = None;
    if let Err(error) = store::update(
        config,
        store::StateDocument::SettingsV1,
        default_settings(),
        |settings| {
            for key in ["viewModes", "customIcons", "autoSave"] {
                move_map(&mut settings[key], old_path, new_path);
            }
            for key in ["favorites", "knowledgeBases"] {
                move_list(&mut settings[key], old_path, new_path);
            }
            move_workspace_metadata(config, settings, old_path, new_path)
        },
    ) {
        failure = Some(error);
    }
    if let Err(error) = store::update(
        config,
        store::StateDocument::CanvasV2,
        empty_canvas_document(),
        |canvases| {
            canvas_persistence::mutate_contents(canvases, timestamp_ms().into(), |content| {
                filesystem::persisted_content::move_paths(config, content, old_path, new_path)
                    .map(canvas_content_mutation)
            })
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) = store::update(
        config,
        store::StateDocument::PlaybackStatsV1,
        json!({"views":{}}),
        |stats| {
            move_map(&mut stats["views"], old_path, new_path);
            Ok(())
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) = reader_state::move_prefix(&state_db::database(config), old_path, new_path)
        && failure.is_none()
    {
        failure = Some(error);
    }
    failure.map_or(Ok(()), Err)
}

pub async fn removed(config: &Config, path: &str) -> AppResult<()> {
    let mut failure = None;
    if let Err(error) = store::update(
        config,
        store::StateDocument::SettingsV1,
        default_settings(),
        |settings| {
            for key in ["viewModes", "customIcons", "autoSave"] {
                remove_map(&mut settings[key], path);
            }
            for key in ["favorites", "knowledgeBases"] {
                remove_list(&mut settings[key], path);
            }
            remove_workspace_metadata(config, settings, path)
        },
    ) {
        failure = Some(error);
    }
    if let Err(error) = store::update(
        config,
        store::StateDocument::CanvasV2,
        empty_canvas_document(),
        |canvases| {
            canvas_persistence::mutate_contents(canvases, timestamp_ms().into(), |content| {
                filesystem::persisted_content::remove_paths(config, content, path)
                    .map(canvas_content_mutation)
            })
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) = store::update(
        config,
        store::StateDocument::PlaybackStatsV1,
        json!({"views":{}}),
        |stats| {
            remove_map(&mut stats["views"], path);
            Ok(())
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) = reader_state::remove_prefix(&state_db::database(config), path)
        && failure.is_none()
    {
        failure = Some(error);
    }
    failure.map_or(Ok(()), Err)
}

pub fn content_replaced(config: &Config, path: &str) -> AppResult<()> {
    reader_state::remove_exact(&state_db::database(config), path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        Config {
            port: 3000,
            roots: vec![crate::config::MediaRoot {
                id: "media".into(),
                name: "Media".into(),
                path: std::env::temp_dir(),
                editable_folders: Vec::new(),
            }],
            library_key: "library".into(),
            data_path: std::env::temp_dir(),
            file_search: crate::config::FileSearchConfig {
                enabled: false,
                index_path: std::env::temp_dir().join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: crate::config::ImageOptimizationConfig::default(),
            hermes: None,
        }
    }

    #[test]
    fn workspace_paths_follow_renames() {
        let config = config();
        let mut settings = json!({
            "workspaceTaskbarPins":[{"resource":{"provider":"filesystem","id":"v1:18:configured-defaultBooks/Old/chapter.pdf"}}],
            "workspaceLayoutPresets":[{"snapshot":{
                "windows":[{"id":"reader","content":{
                    "schemaVersion":1,"codec":"filesystem.content","codecVersion":1,
                    "payload":{"kind":"resource","id":"reader",
                        "address":{"rootId":"configured-default","path":"Books/Old/chapter.pdf"},
                        "contextAddress":{"rootId":"configured-default","path":"Books/Old"},
                        "renderer":"pdf-reader"}
                }}],
                "activeWindowId":"reader","activeTabMap":{"reader":"reader"},
                "pinnedTaskbarItems":[{"resource":{"provider":"filesystem","id":"v1:18:configured-defaultBooks/Old"}}]
            }}]
        });

        move_workspace_metadata(&config, &mut settings, "Books/Old", "Books/New").unwrap();

        assert_eq!(
            settings["workspaceTaskbarPins"][0]["resource"]["id"],
            "v1:18:configured-defaultBooks/New/chapter.pdf"
        );
        let snapshot = &settings["workspaceLayoutPresets"][0]["snapshot"];
        assert_eq!(
            snapshot["windows"][0]["content"]["payload"]["address"]["path"],
            "Books/New/chapter.pdf"
        );
        assert_eq!(
            snapshot["pinnedTaskbarItems"][0]["resource"]["id"],
            "v1:18:configured-defaultBooks/New"
        );
    }

    #[test]
    fn new_workspace_content_paths_follow_renames_and_deletes() {
        let config = config();
        let mut settings = json!({
            "workspaceLayoutPresets":[{"snapshot":{
                "windows":[{
                    "id":"reader",
                    "content":{
                        "schemaVersion":1,
                        "codec":"filesystem.content",
                        "codecVersion":1,
                        "payload":{
                            "kind":"resource",
                            "id":"reader",
                            "address":{"rootId":"configured-default","path":"Books/Old/chapter.pdf"},
                            "contextAddress":{"rootId":"configured-default","path":"Books/Old"},
                            "renderer":"pdf-reader"
                        }
                    }
                }],
                "activeWindowId":"reader",
                "activeTabMap":{"reader":"reader"},
                "pinnedTaskbarItems":[]
            }}]
        });

        move_workspace_metadata(&config, &mut settings, "Books/Old", "Books/New").unwrap();
        let window = &settings["workspaceLayoutPresets"][0]["snapshot"]["windows"][0];
        assert_eq!(
            window["content"]["payload"]["address"]["path"],
            "Books/New/chapter.pdf"
        );
        assert_eq!(
            window["content"]["payload"]["contextAddress"]["path"],
            "Books/New"
        );

        remove_workspace_metadata(&config, &mut settings, "Books/New").unwrap();
        assert!(
            settings["workspaceLayoutPresets"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn workspace_deletes_prune_references_and_repair_focus() {
        let config = config();
        let mut settings = json!({
            "workspaceTaskbarPins":[
                {"resource":{"provider":"filesystem","id":"v1:18:configured-defaultBooks/Old/chapter.pdf"}},
                {"resource":{"provider":"filesystem","id":"v1:18:configured-defaultKeep"}}
            ],
            "workspaceLayoutPresets":[{"snapshot":{
                "windows":[
                    {"id":"removed","content":{
                        "schemaVersion":1,"codec":"filesystem.content","codecVersion":1,
                        "payload":{"kind":"resource","id":"removed",
                            "address":{"rootId":"configured-default","path":"Books/Old/chapter.pdf"},
                            "renderer":"pdf-reader"}
                    }},
                    {"id":"kept","content":{
                        "schemaVersion":1,"codec":"filesystem.content","codecVersion":1,
                        "payload":{"kind":"resource","id":"kept",
                            "address":{"rootId":"configured-default","path":"Keep/file.pdf"},
                            "renderer":"pdf-reader"}
                    }}
                ],
                "activeWindowId":"removed","activeTabMap":{"group":"removed"},
                "tabGroupSplits":{"group":{"leftTabId":"removed","leftPaneFraction":0.5}},
                "pinnedTaskbarItems":[
                    {"resource":{"provider":"filesystem","id":"v1:18:configured-defaultBooks/Old"}},
                    {"resource":{"provider":"filesystem","id":"v1:18:configured-defaultKeep"}}
                ]
            }}]
        });

        remove_workspace_metadata(&config, &mut settings, "Books/Old").unwrap();

        assert_eq!(
            settings["workspaceTaskbarPins"].as_array().unwrap().len(),
            1
        );
        let snapshot = &settings["workspaceLayoutPresets"][0]["snapshot"];
        assert_eq!(snapshot["windows"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["activeWindowId"], "kept");
        assert_eq!(snapshot["activeTabMap"], json!({}));
        assert_eq!(snapshot["tabGroupSplits"], json!({}));
        assert_eq!(snapshot["pinnedTaskbarItems"].as_array().unwrap().len(), 1);
    }
}
