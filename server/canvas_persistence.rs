use serde_json::Value;
use std::collections::HashMap;

fn has_dot_dot(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

fn valid_rect(value: &Value) -> bool {
    ["x", "y", "width", "height"].iter().all(|key| {
        value
            .get(key)
            .and_then(Value::as_f64)
            .is_some_and(f64::is_finite)
    }) && value
        .get("width")
        .and_then(Value::as_f64)
        .is_some_and(|x| x > 0.0)
        && value
            .get("height")
            .and_then(Value::as_f64)
            .is_some_and(|x| x > 0.0)
}

fn valid_state(state: &Value) -> bool {
    if state.get("version").and_then(Value::as_u64) != Some(1)
        || !state.get("windows").is_some_and(Value::is_array)
        || !state.get("camera").is_some_and(Value::is_object)
    {
        return false;
    }
    state["windows"].as_array().is_some_and(|windows| {
        windows.iter().all(|window| {
            let Some(definition) = window.get("definition") else {
                return false;
            };
            let local = definition
                .get("source")
                .is_some_and(|source| source.get("kind").and_then(Value::as_str) == Some("local"));
            let safe_paths = ["iconPath"]
                .into_iter()
                .filter_map(|key| definition.get(key).and_then(Value::as_str))
                .chain(
                    ["dir", "viewing", "playing"]
                        .into_iter()
                        .filter_map(|key| definition.get("initialState")?.get(key)?.as_str()),
                )
                .all(|path| !has_dot_dot(path));
            window.get("id").and_then(Value::as_str).is_some()
                && window.get("bounds").is_some_and(valid_rect)
                && matches!(
                    definition.get("type").and_then(Value::as_str),
                    Some("browser" | "viewer" | "hermes")
                )
                && (definition.get("type").and_then(Value::as_str) != Some("hermes")
                    || definition
                        .get("hermes")
                        .and_then(|h| h.get("sessionId"))
                        .and_then(Value::as_str)
                        .is_some())
                && local
                && safe_paths
        })
    })
}

fn valid_record(value: &Value) -> bool {
    let valid_text = |key: &str, max: usize| {
        value
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty() && text.encode_utf16().count() <= max)
    };
    if !valid_text("id", 128)
        || !valid_text("writerId", 128)
        || !valid_text("name", 120)
        || value.get("updatedAt").and_then(Value::as_u64).is_none()
    {
        return false;
    }
    match value.get("deleted").and_then(Value::as_bool) {
        Some(true) => value.get("state").is_none_or(Value::is_null),
        Some(false) => value.get("state").is_some_and(valid_state),
        None => false,
    }
}

fn is_newer(candidate: &Value, current: &Value) -> bool {
    let candidate_time = candidate["updatedAt"].as_u64().unwrap_or_default();
    let current_time = current["updatedAt"].as_u64().unwrap_or_default();
    candidate_time > current_time
        || (candidate_time == current_time
            && candidate["writerId"].as_str().unwrap_or_default()
                > current["writerId"].as_str().unwrap_or_default())
}

fn matches_path(path: &str, prefix: &str) -> bool {
    path == prefix || path.starts_with(&format!("{prefix}/"))
}

fn moved_path(path: &str, old_path: &str, new_path: &str) -> String {
    format!("{new_path}{}", &path[old_path.len()..])
}

fn definition_paths_mut(definition: &mut Value, mut update: impl FnMut(&mut Value)) {
    if let Some(value) = definition.get_mut("iconPath") {
        update(value);
    }
    if let Some(initial) = definition
        .get_mut("initialState")
        .and_then(Value::as_object_mut)
    {
        for key in ["dir", "viewing"] {
            if let Some(value) = initial.get_mut(key) {
                update(value);
            }
        }
    }
}

fn bump_record(record: &mut Value, updated_at: u128) {
    let current = record
        .get("updatedAt")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    record["updatedAt"] = Value::from(current.saturating_add(1).max(updated_at as u64));
    record["writerId"] = Value::String("server-path-metadata".into());
}

pub fn move_paths(records: &mut Value, old_path: &str, new_path: &str, updated_at: u128) {
    let Some(records) = records.as_array_mut() else {
        return;
    };
    for record in records {
        let mut changed = false;
        let Some(windows) = record
            .get_mut("state")
            .and_then(|state| state.get_mut("windows"))
            .and_then(Value::as_array_mut)
        else {
            continue;
        };
        for window in windows {
            let Some(definition) = window.get_mut("definition") else {
                continue;
            };
            definition_paths_mut(definition, |value| {
                let Some(path) = value.as_str().filter(|path| matches_path(path, old_path)) else {
                    return;
                };
                *value = Value::String(moved_path(path, old_path, new_path));
                changed = true;
            });
        }
        if changed {
            bump_record(record, updated_at);
        }
    }
}

pub fn remove_paths(records: &mut Value, path: &str, updated_at: u128) {
    let Some(records) = records.as_array_mut() else {
        return;
    };
    for record in records {
        let Some(state) = record.get_mut("state") else {
            continue;
        };
        let Some(windows) = state.get_mut("windows").and_then(Value::as_array_mut) else {
            continue;
        };
        let mut changed = false;
        windows.retain_mut(|window| {
            let Some(definition) = window.get("definition") else {
                return true;
            };
            let target = definition
                .get("initialState")
                .and_then(|initial| initial.get("viewing"))
                .and_then(Value::as_str)
                .or_else(|| {
                    definition
                        .get("initialState")
                        .and_then(|initial| initial.get("playing"))
                        .and_then(Value::as_str)
                })
                .or_else(|| {
                    definition
                        .get("initialState")
                        .and_then(|initial| initial.get("dir"))
                        .and_then(Value::as_str)
                })
                .or_else(|| definition.get("iconPath").and_then(Value::as_str));
            if target.is_some_and(|value| matches_path(value, path)) {
                changed = true;
                return false;
            }
            if definition
                .get("iconPath")
                .and_then(Value::as_str)
                .is_some_and(|value| matches_path(value, path))
            {
                window["definition"]["iconPath"] = Value::Null;
                changed = true;
            }
            true
        });
        if !changed {
            continue;
        }
        let remaining_ids = windows
            .iter()
            .filter_map(|window| window.get("id").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        let maximized_exists = state
            .get("maximizedWindowId")
            .and_then(Value::as_str)
            .is_none_or(|id| remaining_ids.iter().any(|window_id| window_id == id));
        if !maximized_exists {
            state["maximizedWindowId"] = Value::Null;
        }
        bump_record(record, updated_at);
    }
}

pub fn merge(existing: &Value, incoming: &Value) -> Value {
    let mut records: HashMap<String, Value> = HashMap::new();
    for record in existing
        .as_array()
        .into_iter()
        .flatten()
        .chain(incoming.as_array().into_iter().flatten())
    {
        if !valid_record(record) {
            continue;
        }
        let id = record["id"].as_str().unwrap().to_string();
        if records
            .get(&id)
            .is_none_or(|current| is_newer(record, current))
        {
            records.insert(id, record.clone());
        }
    }
    let mut records = records.into_values().collect::<Vec<_>>();
    records.sort_by(|a, b| {
        b["updatedAt"]
            .as_u64()
            .cmp(&a["updatedAt"].as_u64())
            .then_with(|| b["writerId"].as_str().cmp(&a["writerId"].as_str()))
    });
    Value::Array(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn record(updated_at: u64, name: &str, deleted: bool) -> Value {
        json!({
            "id":"canvas-1",
            "name":name,
            "updatedAt":updated_at,
            "writerId":"browser-1",
            "deleted":deleted,
            "state":if deleted { Value::Null } else { json!({
                "version":1,
                "windows":[],
                "camera":{"x":0,"y":0,"zoom":1},
                "windowSizeByType":{},
                "nextItemId":1,
                "nextZIndex":1
            }) }
        })
    }

    #[test]
    fn newer_record_wins_and_tombstone_survives() {
        let merged = merge(
            &json!([record(1, "Old", false)]),
            &json!([record(2, "Gone", true)]),
        );
        assert_eq!(merged[0]["name"], "Gone");
        assert_eq!(merged[0]["deleted"], true);
    }

    #[test]
    fn accepts_persisted_canvas_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/persisted-state/reference/canvas-collection.json"
        ))
        .unwrap();

        let merged = merge(&json!([]), &fixture["canvases"]);

        assert_eq!(merged.as_array().unwrap().len(), 1);
        assert_eq!(
            merged[0]["state"]["windows"][2]["definition"]["hermes"]["sessionId"],
            "reference-session"
        );
        assert_eq!(
            merged[0]["state"]["windows"][1]["definition"]["initialState"]["readerKind"],
            "folder"
        );
    }

    #[test]
    fn tie_breaks_same_timestamp_by_writer() {
        let first = record(1, "First", false);
        let mut second = record(1, "Second", false);
        second["writerId"] = json!("browser-2");
        assert_eq!(
            merge(&json!([first]), &json!([second]))[0]["name"],
            "Second"
        );
    }

    #[test]
    fn path_changes_rewrite_and_remove_canvas_windows() {
        let mut records = json!([record(1, "Canvas", false)]);
        records[0]["state"]["maximizedWindowId"] = json!("window-1");
        records[0]["state"]["windows"] = json!([{
            "id":"window-1",
            "bounds":{"x":0,"y":0,"width":320,"height":224},
            "definition":{
                "type":"viewer",
                "source":{"kind":"local"},
                "iconPath":"Books/Old/chapter.pdf",
                "initialState":{"dir":"Books/Old","viewing":"Books/Old/chapter.pdf"}
            }
        }]);

        move_paths(&mut records, "Books/Old", "Books/New", 10);
        assert_eq!(
            records[0]["state"]["windows"][0]["definition"]["iconPath"],
            "Books/New/chapter.pdf"
        );
        assert_eq!(records[0]["updatedAt"], 10);

        remove_paths(&mut records, "Books/New", 20);
        assert_eq!(records[0]["state"]["windows"], json!([]));
        assert_eq!(records[0]["state"]["maximizedWindowId"], Value::Null);
        assert_eq!(records[0]["updatedAt"], 20);
    }

    #[test]
    fn remove_keeps_viewer_that_navigated_away_from_stale_icon() {
        let mut records = json!([record(1, "Canvas", false)]);
        records[0]["state"]["windows"] = json!([{
            "id":"window-1",
            "bounds":{"x":0,"y":0,"width":320,"height":224},
            "definition":{
                "type":"viewer",
                "source":{"kind":"local"},
                "iconPath":"Books/Old.pdf",
                "initialState":{"viewing":"Books/Current.pdf"}
            }
        }]);

        remove_paths(&mut records, "Books/Old.pdf", 20);

        assert_eq!(records[0]["state"]["windows"].as_array().unwrap().len(), 1);
        assert_eq!(
            records[0]["state"]["windows"][0]["definition"]["iconPath"],
            Value::Null
        );
        assert_eq!(records[0]["updatedAt"], 20);
    }
}
