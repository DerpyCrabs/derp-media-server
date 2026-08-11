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

fn valid_resource_target(target: &Value) -> bool {
    let Some(reference) = target.get("ref") else {
        return false;
    };
    ["libraryId", "resourceId"].iter().all(|key| {
        reference
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty() && value.len() <= 512)
    }) && target
        .get("legacyLocator")
        .and_then(Value::as_str)
        .is_some_and(|path| path.len() <= 4096 && !has_dot_dot(path))
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
            let resource_target = definition
                .get("resourceTarget")
                .is_none_or(valid_resource_target);
            let safe_paths = ["iconPath"]
                .into_iter()
                .filter_map(|key| definition.get(key).and_then(Value::as_str))
                .chain(
                    ["dir", "viewing"]
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
                && resource_target
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
    fn rejects_non_local_window_sources() {
        let mut invalid = record(1, "Canvas", false);
        invalid["state"]["windows"] = json!([{
            "id":"window-1",
            "bounds":{"x":0,"y":0,"width":320,"height":224},
            "definition":{"type":"viewer","source":{"kind":"share","token":"secret"}}
        }]);
        assert_eq!(merge(&json!([]), &json!([invalid])), json!([]));
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
    fn durable_resource_target_is_additive_but_must_keep_legacy_locator() {
        let with_target = |target: Value| {
            let mut value = record(1, "Canvas", false);
            value["state"]["windows"] = json!([{
                "id":"window-1",
                "bounds":{"x":0,"y":0,"width":320,"height":224},
                "definition":{
                    "type":"viewer",
                    "source":{"kind":"local"},
                    "resourceTarget":target
                }
            }]);
            value
        };
        let valid = with_target(json!({
            "ref":{"libraryId":"library","resourceId":"resource"},
            "legacyLocator":"Documents/file.md"
        }));
        assert_eq!(merge(&json!([]), &json!([valid]))[0]["id"], "canvas-1");

        let mut root = with_target(json!({
            "ref":{"libraryId":"library","resourceId":"root"},
            "legacyLocator":""
        }));
        root["state"]["windows"][0]["definition"]["type"] = json!("browser");
        root["state"]["windows"][0]["definition"]["iconPath"] = json!("");
        root["state"]["windows"][0]["definition"]["initialState"] = json!({"dir":""});
        assert_eq!(merge(&json!([]), &json!([root]))[0]["id"], "canvas-1");

        let traversal = with_target(json!({
            "ref":{"libraryId":"library","resourceId":"escape"},
            "legacyLocator":"../escape"
        }));
        assert_eq!(merge(&json!([]), &json!([traversal])), json!([]));

        let invalid = with_target(json!({
            "ref":{"libraryId":"library","resourceId":"resource"}
        }));
        assert_eq!(merge(&json!([]), &json!([invalid])), json!([]));
    }
}
