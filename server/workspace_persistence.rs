use chrono::{SecondsFormat, Utc};
use serde_json::{Map, Value};

fn has_dot_dot(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

fn valid_source(source: &Value) -> bool {
    source.get("kind").and_then(Value::as_str) == Some("local")
}

fn valid_content(content: &Value) -> bool {
    content.as_object().is_some_and(|object| {
        object.len() == 4
            && ["schemaVersion", "codec", "codecVersion", "payload"]
                .iter()
                .all(|key| object.contains_key(*key))
    }) && content.get("schemaVersion").and_then(Value::as_u64) == Some(1)
        && content
            .get("codec")
            .and_then(Value::as_str)
            .is_some_and(|codec| !codec.trim().is_empty())
        && content
            .get("codecVersion")
            .and_then(Value::as_u64)
            .is_some_and(|version| version > 0)
        && content.get("payload").is_some()
}

fn has_legacy_window_fields(window: &Value) -> bool {
    [
        "type",
        "source",
        "initialState",
        "hermes",
        "iconPath",
        "iconType",
        "iconIsVirtual",
    ]
    .iter()
    .any(|key| window.get(*key).is_some())
}

fn valid_pin(pin: &Value) -> bool {
    pin.get("id").and_then(Value::as_str).is_some()
        && pin.get("path").and_then(Value::as_str).is_some()
        && pin.get("isDirectory").and_then(Value::as_bool).is_some()
        && pin.get("title").and_then(Value::as_str).is_some()
        && pin.get("source").is_some_and(valid_source)
}

pub fn admin_pins(raw: &Value) -> Value {
    Value::Array(
        raw.as_array()
            .into_iter()
            .flatten()
            .filter(|pin| {
                valid_pin(pin)
                    && pin["path"]
                        .as_str()
                        .is_some_and(|path| !path.is_empty() && !has_dot_dot(path))
            })
            .cloned()
            .collect(),
    )
}

fn window_paths(window: &Value) -> Vec<&str> {
    let mut paths = Vec::new();
    if window["content"]["codec"].as_str() == Some("filesystem.content") {
        for key in ["address", "contextAddress"] {
            if let Some(path) = window["content"]["payload"][key]
                .get("path")
                .and_then(Value::as_str)
                .filter(|path| !path.is_empty())
            {
                paths.push(path);
            }
        }
    }
    paths
}

fn valid_snapshot(snapshot: &Value) -> bool {
    let Some(windows) = snapshot.get("windows").and_then(Value::as_array) else {
        return false;
    };
    if windows.is_empty() {
        return false;
    }
    for window in windows {
        if window
            .get("id")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
            || has_legacy_window_fields(window)
            || !window.get("content").is_some_and(valid_content)
        {
            return false;
        }
        for path in window_paths(window) {
            let path = path.replace('\\', "/");
            if has_dot_dot(&path) {
                return false;
            }
        }
    }
    let raw_pins = snapshot.get("pinnedTaskbarItems").unwrap_or(&Value::Null);
    let parsed_count = raw_pins
        .as_array()
        .into_iter()
        .flatten()
        .filter(|pin| valid_pin(pin))
        .count();
    let filtered = admin_pins(raw_pins);
    filtered
        .as_array()
        .is_some_and(|pins| pins.len() == parsed_count)
}

pub fn presets(raw: &Value) -> Value {
    let mut out = Vec::new();
    for item in raw.as_array().into_iter().flatten() {
        let (Some(id), Some(name), Some(scope), Some(snapshot)) = (
            item.get("id").and_then(Value::as_str),
            item.get("name").and_then(Value::as_str),
            item.get("scope").and_then(Value::as_str),
            item.get("snapshot"),
        ) else {
            continue;
        };
        let raw_name = name;
        let name = raw_name.trim();
        if name.is_empty() || raw_name.encode_utf16().count() > 120 {
            continue;
        }
        if scope != "admin" || !valid_snapshot(snapshot) {
            continue;
        }
        let mut value = Map::new();
        value.insert("id".into(), Value::String(id.into()));
        value.insert("name".into(), Value::String(name.into()));
        value.insert("scope".into(), Value::String(scope.into()));
        value.insert("snapshot".into(), snapshot.clone());
        value.insert(
            "createdAt".into(),
            item.get("createdAt")
                .and_then(Value::as_str)
                .map(|x| Value::String(x.into()))
                .unwrap_or_else(|| {
                    Value::String(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true))
                }),
        );
        if let Some(updated) = item.get("updatedAt").and_then(Value::as_str) {
            value.insert("updatedAt".into(), Value::String(updated.into()));
        }
        out.push(Value::Object(value));
        if out.len() == 32 {
            break;
        }
    }
    Value::Array(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_new_content_windows_and_rejects_unsafe_filesystem_paths() {
        let snapshot = json!({
            "windows":[{
                "id":"viewer-1",
                "title":"Chapter",
                "content":{
                    "schemaVersion":1,
                    "codec":"filesystem.content",
                    "codecVersion":1,
                    "payload":{
                        "kind":"resource",
                        "id":"viewer-1",
                        "address":{"rootId":"configured-default","path":"Books/chapter.pdf"},
                        "renderer":"pdf-reader"
                    }
                }
            }],
            "pinnedTaskbarItems":[]
        });
        assert!(valid_snapshot(&snapshot));

        let mut unsafe_snapshot = snapshot;
        unsafe_snapshot["windows"][0]["content"]["payload"]["address"]["path"] =
            json!("../outside");
        assert!(!valid_snapshot(&unsafe_snapshot));
    }

    #[test]
    fn accepts_unknown_versioned_content_for_recovery() {
        let snapshot = json!({
            "windows":[{
                "id":"future-1",
                "content":{
                    "schemaVersion":1,
                    "codec":"future.content",
                    "codecVersion":7,
                    "payload":{"opaque":true}
                }
            }],
            "pinnedTaskbarItems":[]
        });
        assert!(valid_snapshot(&snapshot));
    }

    #[test]
    fn rejects_legacy_and_dual_window_schemas() {
        let legacy = json!({
            "windows":[{
                "id":"browser-1",
                "type":"browser",
                "source":{"kind":"local"},
                "initialState":{"dir":"Books"}
            }],
            "pinnedTaskbarItems":[]
        });
        assert!(!valid_snapshot(&legacy));

        let dual = json!({
            "windows":[{
                "id":"browser-1",
                "type":"browser",
                "source":{"kind":"local"},
                "initialState":{"dir":"Books"},
                "content":{
                    "schemaVersion":1,
                    "codec":"filesystem.content",
                    "codecVersion":1,
                    "payload":{
                        "kind":"explorer",
                        "id":"browser-1",
                        "address":{"rootId":"configured-default","path":"Books"}
                    }
                }
            }],
            "pinnedTaskbarItems":[]
        });
        assert!(!valid_snapshot(&dual));
    }
}
