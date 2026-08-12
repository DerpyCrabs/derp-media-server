use crate::{
    app::default_settings,
    config::Config,
    error::{AppError, AppResult},
    reader_state, state_db,
};
use serde_json::{Value, json};

const WORKSPACE_PATH_FIELDS: &[&str] = &[
    "path",
    "iconPath",
    "dir",
    "viewing",
    "legacyLocator",
    "sharePath",
    "rootPath",
];
const CANVAS_PATH_FIELDS: &[&str] = &["iconPath", "dir", "viewing", "legacyLocator"];

fn logical_path_eq(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn matching_suffix<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    if logical_path_eq(path, prefix) {
        return Some("");
    }
    let split = prefix.len();
    (path.as_bytes().get(split) == Some(&b'/') && logical_path_eq(path.get(..split)?, prefix))
        .then(|| &path[split..])
}

fn matches(path: &str, prefix: &str) -> bool {
    matching_suffix(path, prefix).is_some()
}

fn moved_path(path: &str, old_path: &str, new_path: &str) -> String {
    format!(
        "{new_path}{}",
        matching_suffix(path, old_path).expect("matched path has suffix")
    )
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

fn move_nested_paths(value: &mut Value, fields: &[&str], old_path: &str, new_path: &str) {
    match value {
        Value::Array(items) => {
            for item in items {
                move_nested_paths(item, fields, old_path, new_path);
            }
        }
        Value::Object(object) => {
            for (key, child) in object {
                if fields.contains(&key.as_str())
                    && let Some(path) = child.as_str().filter(|path| matches(path, old_path))
                {
                    *child = Value::String(moved_path(path, old_path, new_path));
                    continue;
                }
                move_nested_paths(child, fields, old_path, new_path);
            }
        }
        _ => {}
    }
}

fn nested_path_matches(value: &Value, fields: &[&str], path: &str) -> bool {
    match value {
        Value::Array(items) => items
            .iter()
            .any(|item| nested_path_matches(item, fields, path)),
        Value::Object(object) => object.iter().any(|(key, child)| {
            (fields.contains(&key.as_str())
                && child
                    .as_str()
                    .is_some_and(|candidate| matches(candidate, path)))
                || nested_path_matches(child, fields, path)
        }),
        _ => false,
    }
}

fn resource_target(value: &Value) -> Option<&Value> {
    value.get("resourceTarget").or_else(|| {
        value
            .get("definition")
            .and_then(|definition| definition.get("resourceTarget"))
    })
}

fn resource_target_mut(value: &mut Value) -> Option<&mut Value> {
    let object = value.as_object_mut()?;
    if object.contains_key("resourceTarget") {
        object.get_mut("resourceTarget")
    } else {
        object
            .get_mut("definition")
            .and_then(|definition| definition.get_mut("resourceTarget"))
    }
}

fn has_stable_resource_ref(value: &Value) -> bool {
    let Some(reference) = resource_target(value).and_then(|target| target.get("ref")) else {
        return false;
    };
    ["libraryId", "resourceId"].iter().all(|key| {
        reference
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
    })
}

fn mark_resource_missing(value: &mut Value) {
    if let Some(target) = resource_target_mut(value).and_then(Value::as_object_mut) {
        target.insert("availability".into(), Value::String("missing".into()));
    }
}

fn remove_resource_entries(value: &mut Value, fields: &[&str], path: &str) {
    let Some(items) = value.as_array_mut() else {
        return;
    };
    items.retain_mut(|item| {
        if nested_path_matches(item, fields, path) {
            if has_stable_resource_ref(item) {
                mark_resource_missing(item);
                true
            } else {
                false
            }
        } else {
            remove_resource_containers(item, fields, path);
            true
        }
    });
}

fn remove_resource_containers(value: &mut Value, fields: &[&str], path: &str) {
    match value {
        Value::Array(items) => {
            for item in items {
                remove_resource_containers(item, fields, path);
            }
        }
        Value::Object(object) => {
            for (key, child) in object {
                if matches!(
                    key.as_str(),
                    "windows" | "pinnedTaskbarItems" | "workspaceTaskbarPins"
                ) {
                    remove_resource_entries(child, fields, path);
                } else {
                    remove_resource_containers(child, fields, path);
                }
            }
        }
        _ => {}
    }
}

pub fn move_path(config: &Config, old_path: &str, new_path: &str) -> AppResult<()> {
    if old_path == new_path {
        return Ok(());
    }
    if matching_suffix(new_path, old_path).is_some_and(|suffix| !suffix.is_empty())
        || matching_suffix(old_path, new_path).is_some_and(|suffix| !suffix.is_empty())
    {
        return Err(AppError::bad(
            "Cannot move a path onto its ancestor or descendant",
        ));
    }
    let database = state_db::database(config);
    state_db::update_document(
        &database,
        "settings",
        &config.library_key,
        default_settings(),
        |settings| {
            for key in ["viewModes", "customIcons", "autoSave"] {
                move_map(&mut settings[key], old_path, new_path);
            }
            for key in ["favorites", "knowledgeBases"] {
                move_list(&mut settings[key], old_path, new_path);
            }
            for key in ["workspaceTaskbarPins", "workspaceLayoutPresets"] {
                move_nested_paths(
                    &mut settings[key],
                    WORKSPACE_PATH_FIELDS,
                    old_path,
                    new_path,
                );
            }
            Ok(())
        },
    )?;
    state_db::update_document(
        &database,
        "stats",
        &config.library_key,
        json!({"views":{},"shareViews":{}}),
        |stats| {
            for key in ["views", "shareViews"] {
                move_map(&mut stats[key], old_path, new_path);
            }
            Ok(())
        },
    )?;
    state_db::update_document(
        &database,
        "canvases",
        &config.library_key,
        json!([]),
        |canvases| {
            move_nested_paths(canvases, CANVAS_PATH_FIELDS, old_path, new_path);
            Ok(())
        },
    )?;
    crate::spaces::reconcile_move(config, old_path, new_path).map_err(AppError::internal)?;
    reader_state::move_prefix(&database, old_path, new_path)
}

pub fn remove_path(config: &Config, path: &str) -> AppResult<()> {
    let database = state_db::database(config);
    state_db::update_document(
        &database,
        "settings",
        &config.library_key,
        default_settings(),
        |settings| {
            for key in ["viewModes", "customIcons", "autoSave"] {
                remove_map(&mut settings[key], path);
            }
            for key in ["favorites", "knowledgeBases"] {
                remove_list(&mut settings[key], path);
            }
            for key in ["workspaceTaskbarPins", "workspaceLayoutPresets"] {
                if key == "workspaceTaskbarPins" {
                    remove_resource_entries(&mut settings[key], WORKSPACE_PATH_FIELDS, path);
                } else {
                    remove_resource_containers(&mut settings[key], WORKSPACE_PATH_FIELDS, path);
                }
            }
            Ok(())
        },
    )?;
    state_db::update_document(
        &database,
        "stats",
        &config.library_key,
        json!({"views":{},"shareViews":{}}),
        |stats| {
            for key in ["views", "shareViews"] {
                remove_map(&mut stats[key], path);
            }
            Ok(())
        },
    )?;
    state_db::update_document(
        &database,
        "canvases",
        &config.library_key,
        json!([]),
        |canvases| {
            remove_resource_containers(canvases, CANVAS_PATH_FIELDS, path);
            Ok(())
        },
    )?;
    crate::spaces::reconcile_remove(config, path).map_err(AppError::internal)?;
    reader_state::remove_prefix(&database, None, path)
}

pub fn replace_content(config: &Config, path: &str) -> AppResult<()> {
    reader_state::remove_prefix(&state_db::database(config), None, path)
}

pub fn cleanup_share_for_config(config: &Config, token: &str) -> AppResult<()> {
    reader_state::remove_scope(&state_db::database(config), &format!("share:{token}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig};
    use std::{fs, path::PathBuf};

    fn fixture(name: &str) -> (PathBuf, Config) {
        let base = std::env::temp_dir().join(format!(
            "derp-path-metadata-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        let data_path = base.join("data");
        fs::create_dir_all(&data_path).unwrap();
        let config = Config {
            port: 0,
            roots: Vec::new(),
            library_key: "library".into(),
            share_link_domain: None,
            auth: AuthConfig::default(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data_path.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            data_path,
            tls: None,
            hermes: None,
        };
        state_db::initialize(&config).unwrap();
        (base, config)
    }

    fn store_document(config: &Config, kind: &str, value: Value) {
        state_db::update_document(
            &state_db::database(config),
            kind,
            &config.library_key,
            Value::Null,
            |current| {
                *current = value;
                Ok(())
            },
        )
        .unwrap();
    }

    fn document(config: &Config, kind: &str) -> Value {
        state_db::document(
            &state_db::database(config),
            kind,
            &config.library_key,
            Value::Null,
        )
        .unwrap()
    }

    fn target(path: &str) -> Value {
        json!({
            "ref":{"libraryId":"library","resourceId":"resource-1"},
            "legacyLocator":path,
        })
    }

    #[cfg(windows)]
    #[test]
    fn logical_path_matching_ignores_windows_casing_and_preserves_suffix() {
        assert!(matches("Parent/Child.MD", "pArEnT"));
        assert!(!matches("Parentish/Child.MD", "pArEnT"));
        assert_eq!(
            moved_path("Parent/Sub/Child.MD", "pArEnT", "Requested"),
            "Requested/Sub/Child.MD"
        );
    }

    #[test]
    fn move_rewrites_all_path_metadata_and_replay_preserves_results() {
        let (base, config) = fixture("move-replay");
        store_document(
            &config,
            "settings",
            json!({
                "viewModes":{"Old":"grid","Old/item.md":"list","Oldish":"grid"},
                "customIcons":{"Old/item.md":"file","Other/item.md":"other"},
                "autoSave":{"Old/item.md":{"enabled":true}},
                "favorites":["Old/item.md","Other/item.md"],
                "knowledgeBases":["Old","Other"],
                "workspaceTaskbarPins":[{
                    "path":"Old/item.md",
                    "resourceTarget":target("Old/item.md"),
                    "source":{"kind":"local","rootPath":"Old","sharePath":"Old"}
                }],
                "workspaceLayoutPresets":[{"snapshot":{
                    "windows":[{
                        "iconPath":"Old/item.md",
                        "initialState":{"dir":"Old","viewing":"Old/item.md"},
                        "resourceTarget":target("Old/item.md"),
                        "source":{"kind":"local","rootPath":"Old"}
                    }],
                    "pinnedTaskbarItems":[{
                        "path":"Old/pinned.md",
                        "resourceTarget":target("Old/pinned.md"),
                        "source":{"kind":"local","rootPath":"Old"}
                    }]
                }}]
            }),
        );
        store_document(
            &config,
            "stats",
            json!({
                "views":{"Old/item.md":4,"Other/item.md":2},
                "shareViews":{"Old/child.md":3}
            }),
        );
        store_document(
            &config,
            "canvases",
            json!([{"state":{"windows":[{"definition":{
                "iconPath":"Old/item.md",
                "initialState":{"dir":"Old","viewing":"Old/item.md"},
                "resourceTarget":target("Old/item.md")
            }}]},"unrelated":"Oldish/item.md"}]),
        );
        let database = state_db::database(&config);
        reader_state::put(
            &database,
            "owner",
            "Old/item.md",
            &json!({"page":7}),
            "old",
            0,
            1,
        )
        .unwrap();
        reader_state::put(
            &database,
            "owner",
            "New/item.md",
            &json!({"page":99}),
            "collision",
            0,
            1,
        )
        .unwrap();
        reader_state::put(
            &database,
            "owner",
            "Other/item.md",
            &json!({"page":2}),
            "other",
            0,
            1,
        )
        .unwrap();

        let old_request = if cfg!(windows) { "oLd" } else { "Old" };
        let descendant = if cfg!(windows) {
            "OLD/child"
        } else {
            "Old/child"
        };
        assert!(move_path(&config, old_request, descendant).is_err());
        assert!(move_path(&config, "Old/item.md", "Old").is_err());
        assert_eq!(
            document(&config, "settings")["viewModes"]["Old/item.md"],
            "list"
        );
        move_path(&config, old_request, "New").unwrap();
        move_path(&config, old_request, "New").unwrap();

        let settings = document(&config, "settings");
        assert_eq!(settings["viewModes"]["New/item.md"], "list");
        assert_eq!(settings["viewModes"]["Oldish"], "grid");
        assert_eq!(settings["customIcons"]["New/item.md"], "file");
        assert_eq!(settings["customIcons"]["Other/item.md"], "other");
        assert_eq!(settings["autoSave"]["New/item.md"]["enabled"], true);
        assert_eq!(
            settings["favorites"],
            json!(["New/item.md", "Other/item.md"])
        );
        assert_eq!(settings["knowledgeBases"], json!(["New", "Other"]));
        assert_eq!(settings["workspaceTaskbarPins"][0]["path"], "New/item.md");
        assert_eq!(
            settings["workspaceTaskbarPins"][0]["resourceTarget"]["legacyLocator"],
            "New/item.md"
        );
        assert_eq!(
            settings["workspaceTaskbarPins"][0]["resourceTarget"]["ref"]["resourceId"],
            "resource-1"
        );
        assert_eq!(
            settings["workspaceTaskbarPins"][0]["source"]["sharePath"],
            "New"
        );
        assert_eq!(
            settings["workspaceLayoutPresets"][0]["snapshot"]["windows"][0]["initialState"]["viewing"],
            "New/item.md"
        );
        assert_eq!(
            settings["workspaceLayoutPresets"][0]["snapshot"]["windows"][0]["resourceTarget"]["legacyLocator"],
            "New/item.md"
        );
        assert_eq!(
            settings["workspaceLayoutPresets"][0]["snapshot"]["windows"][0]["source"]["rootPath"],
            "New"
        );
        assert_eq!(
            settings["workspaceLayoutPresets"][0]["snapshot"]["pinnedTaskbarItems"][0]["path"],
            "New/pinned.md"
        );
        assert_eq!(
            settings["workspaceLayoutPresets"][0]["snapshot"]["pinnedTaskbarItems"][0]["resourceTarget"]
                ["legacyLocator"],
            "New/pinned.md"
        );

        let stats = document(&config, "stats");
        assert_eq!(stats["views"]["New/item.md"], 4);
        assert_eq!(stats["views"]["Other/item.md"], 2);
        assert_eq!(stats["shareViews"]["New/child.md"], 3);

        let canvases = document(&config, "canvases");
        let definition = &canvases[0]["state"]["windows"][0]["definition"];
        assert_eq!(definition["iconPath"], "New/item.md");
        assert_eq!(definition["initialState"]["dir"], "New");
        assert_eq!(definition["initialState"]["viewing"], "New/item.md");
        assert_eq!(definition["resourceTarget"]["legacyLocator"], "New/item.md");
        assert_eq!(
            definition["resourceTarget"]["ref"]["resourceId"],
            "resource-1"
        );
        assert_eq!(canvases[0]["unrelated"], "Oldish/item.md");

        assert!(
            reader_state::get(&database, "owner", "Old/item.md")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            reader_state::get(&database, "owner", "New/item.md")
                .unwrap()
                .unwrap()
                .value,
            json!({"page":7})
        );
        assert_eq!(
            reader_state::get(&database, "owner", "Other/item.md")
                .unwrap()
                .unwrap()
                .value,
            json!({"page":2})
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn remove_prunes_legacy_entries_and_marks_durable_targets_missing_on_replay() {
        let (base, config) = fixture("remove-replay");
        store_document(
            &config,
            "settings",
            json!({
                "viewModes":{"Gone":"grid","Other":"list"},
                "customIcons":{"Gone/item.md":"file","Other/item.md":"other"},
                "autoSave":{"Gone/item.md":{"enabled":true}},
                "favorites":["Gone/item.md","Other/item.md"],
                "knowledgeBases":["Gone","Other"],
                "workspaceTaskbarPins":[{
                    "id":"durable",
                    "path":"Gone/item.md",
                    "resourceTarget":target("Gone/item.md"),
                    "source":{"kind":"local","rootPath":"Gone"}
                },{
                    "id":"legacy",
                    "path":"Gone/legacy.md",
                    "source":{"kind":"local","rootPath":"Gone"}
                },{
                    "id":"other",
                    "path":"Other/item.md",
                    "resourceTarget":target("Other/item.md"),
                    "source":{"kind":"local","rootPath":"Other"}
                }],
                "workspaceLayoutPresets":[{"snapshot":{
                    "windows":[{
                        "id":"durable",
                        "iconPath":"Gone/item.md",
                        "initialState":{"dir":"Gone","viewing":"Gone/item.md"},
                        "resourceTarget":target("Gone/item.md"),
                        "source":{"kind":"local","rootPath":"Gone"}
                    },{
                        "id":"legacy",
                        "iconPath":"Gone/legacy.md",
                        "initialState":{"dir":"Gone","viewing":"Gone/legacy.md"},
                        "source":{"kind":"local","rootPath":"Gone"}
                    },{
                        "id":"other",
                        "iconPath":"Other/item.md",
                        "initialState":{"dir":"Other","viewing":"Other/item.md"},
                        "resourceTarget":target("Other/item.md"),
                        "source":{"kind":"local","rootPath":"Other"}
                    }],
                    "pinnedTaskbarItems":[{
                        "id":"durable-pin",
                        "path":"Gone/pinned.md",
                        "resourceTarget":target("Gone/pinned.md"),
                        "source":{"kind":"local","rootPath":"Gone"}
                    },{
                        "id":"legacy-pin",
                        "path":"Gone/legacy-pinned.md",
                        "source":{"kind":"local","rootPath":"Gone"}
                    }]
                }}]
            }),
        );
        store_document(
            &config,
            "stats",
            json!({
                "views":{"Gone/item.md":4,"Other/item.md":2},
                "shareViews":{"Gone/child.md":3,"Other/child.md":1}
            }),
        );
        store_document(
            &config,
            "canvases",
            json!([{"state":{"windows":[{
                "id":"durable",
                "definition":{
                    "iconPath":"Gone/item.md",
                    "initialState":{"dir":"Gone","viewing":"Gone/item.md"},
                    "resourceTarget":target("Gone/item.md")
                }
            },{
                "id":"legacy",
                "definition":{
                    "iconPath":"Gone/legacy.md",
                    "initialState":{"dir":"Gone","viewing":"Gone/legacy.md"}
                }
            },{
                "id":"other",
                "definition":{
                    "iconPath":"Other/item.md",
                    "initialState":{"dir":"Other","viewing":"Other/item.md"},
                    "resourceTarget":target("Other/item.md")
                }
            }]},"unrelated":"keep"}]),
        );
        let database = state_db::database(&config);
        reader_state::put(
            &database,
            "owner",
            "Gone/item.md",
            &json!({"page":7}),
            "gone",
            0,
            1,
        )
        .unwrap();

        let removed_path = if cfg!(windows) { "gOnE" } else { "Gone" };
        remove_path(&config, removed_path).unwrap();
        remove_path(&config, removed_path).unwrap();

        let settings = document(&config, "settings");
        assert!(settings["viewModes"].get("Gone").is_none());
        assert_eq!(settings["viewModes"]["Other"], "list");
        assert!(settings["customIcons"].get("Gone/item.md").is_none());
        assert_eq!(settings["customIcons"]["Other/item.md"], "other");
        assert!(settings["autoSave"].get("Gone/item.md").is_none());
        assert_eq!(settings["favorites"], json!(["Other/item.md"]));
        assert_eq!(settings["knowledgeBases"], json!(["Other"]));

        let pins = settings["workspaceTaskbarPins"].as_array().unwrap();
        assert_eq!(pins.len(), 2);
        assert_eq!(pins[0]["id"], "durable");
        assert_eq!(pins[0]["path"], "Gone/item.md");
        assert_eq!(pins[0]["resourceTarget"]["legacyLocator"], "Gone/item.md");
        assert_eq!(pins[0]["resourceTarget"]["ref"]["resourceId"], "resource-1");
        assert_eq!(pins[0]["resourceTarget"]["availability"], "missing");
        assert_eq!(pins[0]["source"]["rootPath"], "Gone");
        assert_eq!(pins[1]["id"], "other");

        let preset = &settings["workspaceLayoutPresets"][0]["snapshot"];
        let windows = preset["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0]["id"], "durable");
        assert_eq!(windows[0]["initialState"]["viewing"], "Gone/item.md");
        assert_eq!(
            windows[0]["resourceTarget"]["ref"]["resourceId"],
            "resource-1"
        );
        assert_eq!(windows[0]["resourceTarget"]["availability"], "missing");
        assert_eq!(windows[1]["id"], "other");
        let preset_pins = preset["pinnedTaskbarItems"].as_array().unwrap();
        assert_eq!(preset_pins.len(), 1);
        assert_eq!(
            preset_pins[0]["resourceTarget"]["legacyLocator"],
            "Gone/pinned.md"
        );
        assert_eq!(preset_pins[0]["resourceTarget"]["availability"], "missing");

        let stats = document(&config, "stats");
        assert!(stats["views"].get("Gone/item.md").is_none());
        assert_eq!(stats["views"]["Other/item.md"], 2);
        assert!(stats["shareViews"].get("Gone/child.md").is_none());
        assert_eq!(stats["shareViews"]["Other/child.md"], 1);

        let canvases = document(&config, "canvases");
        let canvas_windows = canvases[0]["state"]["windows"].as_array().unwrap();
        assert_eq!(canvas_windows.len(), 2);
        let definition = &canvas_windows[0]["definition"];
        assert_eq!(definition["iconPath"], "Gone/item.md");
        assert_eq!(definition["initialState"]["dir"], "Gone");
        assert_eq!(
            definition["resourceTarget"]["legacyLocator"],
            "Gone/item.md"
        );
        assert_eq!(
            definition["resourceTarget"]["ref"]["resourceId"],
            "resource-1"
        );
        assert_eq!(definition["resourceTarget"]["availability"], "missing");
        assert_eq!(canvas_windows[1]["id"], "other");
        assert_eq!(canvases[0]["unrelated"], "keep");
        assert!(
            reader_state::get(&database, "owner", "Gone/item.md")
                .unwrap()
                .is_none()
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn content_path_hooks_reconcile_canonical_space_heads() {
        let (base, config) = fixture("canonical-spaces");
        let spaces = crate::spaces::initialize(&config).unwrap();
        let create = serde_json::from_value(json!({
            "spaceId":"space-path-hook",
            "expectedRevision":0,
            "command":{
                "type":"create",
                "name":"Path hook",
                "origin":"workspace",
                "panes":{
                    "pane":{
                        "kind":"viewer",
                        "state":{
                            "resourceTarget":{
                                "ref":{"libraryId":"library","resourceId":"resource-stable"},
                                "legacyLocator":"Before/file.md"
                            }
                        }
                    }
                },
                "arrangements":{}
            }
        }))
        .unwrap();
        spaces.apply(create).unwrap();

        move_path(&config, "Before", "After").unwrap();
        move_path(&config, "Before", "After").unwrap();
        let moved = spaces.load("space-path-hook").unwrap();
        assert_eq!(moved.revision, 2);
        assert_eq!(
            moved.panes["pane"].state["resourceTarget"]["legacyLocator"],
            "After/file.md"
        );
        assert_eq!(
            moved.panes["pane"].state["resourceTarget"]["ref"]["resourceId"],
            "resource-stable"
        );

        remove_path(&config, "After").unwrap();
        remove_path(&config, "After").unwrap();
        let missing = spaces.load("space-path-hook").unwrap();
        assert_eq!(missing.revision, 3);
        assert_eq!(
            missing.panes["pane"].state["resourceTarget"]["ref"]["resourceId"],
            "resource-stable"
        );
        assert_eq!(
            missing.panes["pane"].state["resourceTarget"]["availability"],
            "missing"
        );
        fs::remove_dir_all(base).unwrap();
    }
}
