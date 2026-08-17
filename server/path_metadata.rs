use crate::{
    app::{AppState, canvases_path, default_settings, settings_path, stats_path, timestamp_ms},
    canvas_persistence,
    error::AppResult,
    reader_state, store,
};
use serde_json::{Value, json};

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

fn move_path_value(value: &mut Value, old_path: &str, new_path: &str) {
    if let Some(path) = value.as_str().filter(|path| matches(path, old_path)) {
        *value = Value::String(moved_path(path, old_path, new_path));
    }
}

fn move_workspace_window(window: &mut Value, old_path: &str, new_path: &str) {
    move_path_value(&mut window["iconPath"], old_path, new_path);
    for key in ["dir", "viewing", "playing"] {
        move_path_value(&mut window["initialState"][key], old_path, new_path);
    }
}

fn workspace_window_target(window: &Value) -> Option<&str> {
    window["initialState"]["viewing"]
        .as_str()
        .or_else(|| window["initialState"]["playing"].as_str())
        .or_else(|| window["initialState"]["dir"].as_str())
        .or_else(|| window["iconPath"].as_str())
}

fn move_workspace_snapshot(snapshot: &mut Value, old_path: &str, new_path: &str) {
    if let Some(windows) = snapshot["windows"].as_array_mut() {
        for window in windows {
            move_workspace_window(window, old_path, new_path);
        }
    }
    if let Some(pins) = snapshot["pinnedTaskbarItems"].as_array_mut() {
        for pin in pins {
            move_path_value(&mut pin["path"], old_path, new_path);
        }
    }
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

fn remove_workspace_snapshot(snapshot: &mut Value, path: &str) -> bool {
    if let Some(windows) = snapshot["windows"].as_array_mut() {
        windows.retain_mut(|window| {
            if workspace_window_target(window).is_some_and(|value| matches(value, path)) {
                return false;
            }
            if window["iconPath"]
                .as_str()
                .is_some_and(|value| matches(value, path))
            {
                window["iconPath"] = Value::Null;
            }
            true
        });
    }
    if let Some(pins) = snapshot["pinnedTaskbarItems"].as_array_mut() {
        pins.retain(|pin| {
            !pin["path"]
                .as_str()
                .is_some_and(|value| matches(value, path))
        });
    }
    repair_workspace_snapshot(snapshot)
}

fn move_workspace_metadata(settings: &mut Value, old_path: &str, new_path: &str) {
    if let Some(pins) = settings["workspaceTaskbarPins"].as_array_mut() {
        for pin in pins {
            move_path_value(&mut pin["path"], old_path, new_path);
        }
    }
    if let Some(presets) = settings["workspaceLayoutPresets"].as_array_mut() {
        for preset in presets {
            move_workspace_snapshot(&mut preset["snapshot"], old_path, new_path);
        }
    }
}

fn remove_workspace_metadata(settings: &mut Value, path: &str) {
    if let Some(pins) = settings["workspaceTaskbarPins"].as_array_mut() {
        pins.retain(|pin| {
            !pin["path"]
                .as_str()
                .is_some_and(|value| matches(value, path))
        });
    }
    if let Some(presets) = settings["workspaceLayoutPresets"].as_array_mut() {
        presets.retain_mut(|preset| remove_workspace_snapshot(&mut preset["snapshot"], path));
    }
}

pub async fn moved(state: &AppState, old_path: &str, new_path: &str) -> AppResult<()> {
    let mut failure = None;
    if let Err(error) = store::mutate_section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
        |settings| {
            for key in ["viewModes", "sortOrders", "customIcons", "autoSave"] {
                move_map(&mut settings[key], old_path, new_path);
            }
            for key in ["favorites", "knowledgeBases"] {
                move_list(&mut settings[key], old_path, new_path);
            }
            move_workspace_metadata(settings, old_path, new_path);
            Ok(())
        },
    ) {
        failure = Some(error);
    }
    if let Err(error) = store::mutate_section(
        &canvases_path(state),
        &state.config.library_key,
        json!([]),
        |canvases| {
            canvas_persistence::move_paths(canvases, old_path, new_path, timestamp_ms());
            Ok(())
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) = store::mutate_section(
        &stats_path(state),
        &state.config.library_key,
        json!({"views":{}}),
        |stats| {
            move_map(&mut stats["views"], old_path, new_path);
            Ok(())
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) = reader_state::move_prefix(
        &state.config.data_path.join("app.sqlite3"),
        old_path,
        new_path,
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    failure.map_or(Ok(()), Err)
}

pub async fn removed(state: &AppState, path: &str) -> AppResult<()> {
    let mut failure = None;
    if let Err(error) = store::mutate_section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
        |settings| {
            for key in ["viewModes", "sortOrders", "customIcons", "autoSave"] {
                remove_map(&mut settings[key], path);
            }
            for key in ["favorites", "knowledgeBases"] {
                remove_list(&mut settings[key], path);
            }
            remove_workspace_metadata(settings, path);
            Ok(())
        },
    ) {
        failure = Some(error);
    }
    if let Err(error) = store::mutate_section(
        &canvases_path(state),
        &state.config.library_key,
        json!([]),
        |canvases| {
            canvas_persistence::remove_paths(canvases, path, timestamp_ms());
            Ok(())
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) = store::mutate_section(
        &stats_path(state),
        &state.config.library_key,
        json!({"views":{}}),
        |stats| {
            remove_map(&mut stats["views"], path);
            Ok(())
        },
    ) && failure.is_none()
    {
        failure = Some(error);
    }
    if let Err(error) =
        reader_state::remove_prefix(&state.config.data_path.join("app.sqlite3"), None, path)
        && failure.is_none()
    {
        failure = Some(error);
    }
    failure.map_or(Ok(()), Err)
}

pub fn content_replaced(state: &AppState, path: &str) -> AppResult<()> {
    reader_state::remove_exact_all(&state.config.data_path.join("app.sqlite3"), path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn per_folder_sort_orders_follow_rename_and_delete() {
        let mut orders = json!({
            "Books/Old":{"field":"size","direction":"desc"},
            "Books/Old/Child":{"field":"createdDate","direction":"asc"},
            "Keep":{"field":"name","direction":"asc"}
        });

        move_map(&mut orders, "Books/Old", "Books/New");
        assert!(orders.get("Books/Old").is_none());
        assert_eq!(orders["Books/New"]["field"], "size");
        assert_eq!(orders["Books/New/Child"]["field"], "createdDate");

        remove_map(&mut orders, "Books/New");
        assert_eq!(
            orders,
            json!({"Keep":{"field":"name","direction":"asc"}})
        );
    }

    #[test]
    fn workspace_paths_follow_renames() {
        let mut settings = json!({
            "workspaceTaskbarPins":[{"path":"Books/Old/chapter.pdf"}],
            "workspaceLayoutPresets":[{"snapshot":{
                "windows":[{"id":"reader","iconPath":"Books/Old/chapter.pdf","initialState":{"dir":"Books/Old","viewing":"Books/Old/chapter.pdf"}}],
                "activeWindowId":"reader","activeTabMap":{"reader":"reader"},
                "pinnedTaskbarItems":[{"path":"Books/Old"}]
            }}]
        });

        move_workspace_metadata(&mut settings, "Books/Old", "Books/New");

        assert_eq!(
            settings["workspaceTaskbarPins"][0]["path"],
            "Books/New/chapter.pdf"
        );
        let snapshot = &settings["workspaceLayoutPresets"][0]["snapshot"];
        assert_eq!(snapshot["windows"][0]["initialState"]["dir"], "Books/New");
        assert_eq!(
            snapshot["windows"][0]["initialState"]["viewing"],
            "Books/New/chapter.pdf"
        );
        assert_eq!(snapshot["pinnedTaskbarItems"][0]["path"], "Books/New");
    }

    #[test]
    fn workspace_deletes_prune_references_and_repair_focus() {
        let mut settings = json!({
            "workspaceTaskbarPins":[{"path":"Books/Old/chapter.pdf"},{"path":"Keep"}],
            "workspaceLayoutPresets":[{"snapshot":{
                "windows":[
                    {"id":"removed","iconPath":"Books/Old/chapter.pdf","initialState":{}},
                    {"id":"kept","iconPath":"Keep/file.pdf","initialState":{}}
                ],
                "activeWindowId":"removed","activeTabMap":{"group":"removed"},
                "tabGroupSplits":{"group":{"leftTabId":"removed","leftPaneFraction":0.5}},
                "pinnedTaskbarItems":[{"path":"Books/Old"},{"path":"Keep"}]
            }}]
        });

        remove_workspace_metadata(&mut settings, "Books/Old");

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

    #[test]
    fn workspace_delete_keeps_viewer_that_navigated_away_from_stale_icon() {
        let mut settings = json!({
            "workspaceLayoutPresets":[{"snapshot":{
                "windows":[{
                    "id":"reader",
                    "iconPath":"Books/Old.pdf",
                    "initialState":{"viewing":"Books/Current.pdf"}
                }],
                "activeWindowId":"reader"
            }}]
        });

        remove_workspace_metadata(&mut settings, "Books/Old.pdf");

        let window = &settings["workspaceLayoutPresets"][0]["snapshot"]["windows"][0];
        assert_eq!(window["initialState"]["viewing"], "Books/Current.pdf");
        assert_eq!(window["iconPath"], Value::Null);
    }
}
