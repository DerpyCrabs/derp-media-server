use crate::contracts::{WorkspaceLayoutPresetDto, WorkspaceTaskbarPinDto};
use chrono::DateTime;
use serde_json::Value;

fn has_dot_dot(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
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

fn has_only_keys(value: &Value, allowed: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| allowed.contains(&key.as_str())))
}

fn canonical_pin(pin: &Value) -> Option<Value> {
    let parsed = serde_json::from_value::<WorkspaceTaskbarPinDto>(pin.clone()).ok()?;
    if parsed.id.trim().is_empty()
        || parsed.title.trim().is_empty()
        || parsed.resource.provider.trim().is_empty()
        || parsed.resource.id.trim().is_empty()
        || parsed.resource.provider.contains(['\0', '\n', '\r', '\\'])
        || parsed.resource.id.contains(['\0', '\n', '\r', '\\'])
    {
        return None;
    }
    serde_json::to_value(parsed).ok()
}

pub fn workspace_pins(raw: &Value) -> Value {
    Value::Array(
        raw.as_array()
            .into_iter()
            .flatten()
            .filter_map(canonical_pin)
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
            || !has_only_keys(
                window,
                &[
                    "id",
                    "title",
                    "iconName",
                    "content",
                    "tabGroupId",
                    "openedFromWindowId",
                    "tabPinned",
                    "layout",
                    "fileOpenTargetWindowId",
                ],
            )
            || window.get("title").and_then(Value::as_str).is_none()
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
    let raw_count = raw_pins.as_array().map_or(0, Vec::len);
    let filtered = workspace_pins(raw_pins);
    filtered
        .as_array()
        .is_some_and(|pins| pins.len() == raw_count)
}

pub fn presets(raw: &Value) -> Value {
    let mut out = Vec::new();
    for item in raw.as_array().into_iter().flatten() {
        let Ok(mut preset) = serde_json::from_value::<WorkspaceLayoutPresetDto>(item.clone())
        else {
            continue;
        };
        let name = preset.name.trim();
        if preset.id.trim().is_empty()
            || name.is_empty()
            || preset.name.encode_utf16().count() > 120
            || DateTime::parse_from_rfc3339(&preset.created_at).is_err()
            || preset
                .updated_at
                .as_deref()
                .is_some_and(|value| DateTime::parse_from_rfc3339(value).is_err())
            || !valid_snapshot(&preset.snapshot)
        {
            continue;
        }
        preset.name = name.to_string();
        let Ok(value) = serde_json::to_value(preset) else {
            continue;
        };
        out.push(value);
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
    fn accepts_current_content_windows_and_rejects_nondurable_or_unsafe_fields() {
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

        let mut nondurable_snapshot = snapshot.clone();
        nondurable_snapshot["windows"][0]["contentInstance"] =
            json!({"id":"viewer-1","type":"resource"});
        assert!(!valid_snapshot(&nondurable_snapshot));

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
                "title":"Future",
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
    fn taskbar_pins_require_valid_resource_keys() {
        let pins = json!([
            {
                "id":"filesystem",
                "resource":{"provider":"filesystem","id":"v1:18:configured-defaultBooks/chapter.pdf"},
                "title":"Chapter"
            },
            {
                "id":"provider",
                "resource":{"provider":"hermes","id":"v1:7:sessionabc"},
                "title":"Session"
            },
            {
                "id":"bad-resource",
                "resource":{"provider":"","id":"opaque"},
                "title":"Bad"
            }
        ]);

        let parsed = workspace_pins(&pins);
        assert_eq!(parsed.as_array().unwrap().len(), 2);
        assert_eq!(parsed[1]["resource"]["provider"], "hermes");
    }

    #[test]
    fn presets_store_current_schema() {
        let snapshot = json!({
            "windows":[{
                "id":"future-1",
                "title":"Future",
                "content":{
                    "schemaVersion":1,
                    "codec":"future.content",
                    "codecVersion":1,
                    "payload":{}
                }
            }],
            "pinnedTaskbarItems":[]
        });
        let parsed = presets(&json!([
            {"id":"current","name":"Current","snapshot":snapshot,"createdAt":"2026-08-14T00:00:00Z"}
        ]));

        let parsed = parsed.as_array().unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["id"], "current");
        assert!(parsed.iter().all(|preset| preset.get("scope").is_none()));
    }
}
