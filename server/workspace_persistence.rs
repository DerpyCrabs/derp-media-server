use chrono::{SecondsFormat, Utc};
use serde_json::{Map, Value};

fn has_dot_dot(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

fn is_private_virtual_path(path: &str) -> bool {
    let path = path.replace('\\', "/");
    path == crate::virtual_directory::HERMES_ROOT
        || path.starts_with(&format!("{}/", crate::virtual_directory::HERMES_ROOT))
}

fn valid_source(source: &Value, kind: &str, token: Option<&str>) -> bool {
    source.get("kind").and_then(Value::as_str) == Some(kind)
        && token
            .is_none_or(|expected| source.get("token").and_then(Value::as_str) == Some(expected))
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
        .is_some_and(|value| !value.is_empty() && value.len() <= 4096)
}

fn optional_resource_target(value: &Value) -> bool {
    value
        .get("resourceTarget")
        .is_none_or(valid_resource_target)
}

fn valid_pin(pin: &Value) -> bool {
    pin.get("id").and_then(Value::as_str).is_some()
        && pin.get("path").and_then(Value::as_str).is_some()
        && pin.get("isDirectory").and_then(Value::as_bool).is_some()
        && pin.get("title").and_then(Value::as_str).is_some()
        && optional_resource_target(pin)
        && pin.get("source").is_some_and(|source| {
            valid_source(source, "local", None)
                || source
                    .get("token")
                    .and_then(Value::as_str)
                    .is_some_and(|token| valid_source(source, "share", Some(token)))
        })
}

pub fn admin_pins(raw: &Value) -> Value {
    Value::Array(
        raw.as_array()
            .into_iter()
            .flatten()
            .filter(|pin| {
                valid_pin(pin)
                    && valid_source(&pin["source"], "local", None)
                    && pin["path"]
                        .as_str()
                        .is_some_and(|path| !path.is_empty() && !has_dot_dot(path))
                    && pin
                        .get("resourceTarget")
                        .and_then(|target| target.get("legacyLocator"))
                        .and_then(Value::as_str)
                        .is_none_or(|path| !has_dot_dot(path))
            })
            .cloned()
            .collect(),
    )
}

pub fn share_pins(raw: &Value, share_path: &str, token: &str) -> Value {
    let root = share_path.replace('\\', "/");
    Value::Array(
        raw.as_array()
            .into_iter()
            .flatten()
            .filter(|pin| {
                if !valid_pin(pin) || !valid_source(&pin["source"], "share", Some(token)) {
                    return false;
                }
                pin["path"].as_str().is_some_and(|path| {
                    let path = path.replace('\\', "/");
                    !has_dot_dot(&path)
                        && !is_private_virtual_path(&path)
                        && (path == root || path.starts_with(&(root.clone() + "/")))
                }) && pin
                    .get("resourceTarget")
                    .and_then(|target| target.get("legacyLocator"))
                    .and_then(Value::as_str)
                    .is_none_or(|path| {
                        let path = path.replace('\\', "/");
                        !has_dot_dot(&path)
                            && !is_private_virtual_path(&path)
                            && (path == root || path.starts_with(&(root.clone() + "/")))
                    })
            })
            .cloned()
            .collect(),
    )
}

fn window_paths(window: &Value) -> Vec<&str> {
    let mut paths = Vec::new();
    if let Some(path) = window
        .get("iconPath")
        .and_then(Value::as_str)
        .filter(|x| !x.is_empty())
    {
        paths.push(path);
    }
    if let Some(path) = window
        .get("resourceTarget")
        .and_then(|target| target.get("legacyLocator"))
        .and_then(Value::as_str)
    {
        paths.push(path);
    }
    if let Some(initial) = window.get("initialState") {
        for key in ["dir", "viewing"] {
            if let Some(path) = initial
                .get(key)
                .and_then(Value::as_str)
                .filter(|x| !x.is_empty())
            {
                paths.push(path);
            }
        }
    }
    paths
}

fn valid_snapshot(snapshot: &Value, share: Option<(&str, &str)>) -> bool {
    let Some(windows) = snapshot.get("windows").and_then(Value::as_array) else {
        return false;
    };
    if windows.is_empty() {
        return false;
    }
    let root = share.map(|(path, _)| path.replace('\\', "/"));
    for window in windows {
        if !optional_resource_target(window) {
            return false;
        }
        let Some(source) = window.get("source") else {
            return false;
        };
        let valid = match share {
            Some((_, token)) => valid_source(source, "share", Some(token)),
            None => valid_source(source, "local", None),
        };
        if !valid {
            return false;
        }
        for path in window_paths(window) {
            let path = path.replace('\\', "/");
            if has_dot_dot(&path)
                || (share.is_some() && is_private_virtual_path(&path))
                || root.as_ref().is_some_and(|root| {
                    !path.is_empty() && path != *root && !path.starts_with(&(root.clone() + "/"))
                })
            {
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
    let filtered = match share {
        Some((path, token)) => share_pins(raw_pins, path, token),
        None => admin_pins(raw_pins),
    };
    filtered
        .as_array()
        .is_some_and(|pins| pins.len() == parsed_count)
}

pub fn presets(raw: &Value, share: Option<(&str, &str)>) -> Value {
    let wanted_scope = share.map(|(_, token)| format!("share:{token}"));
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
        let scope_ok = wanted_scope
            .as_deref()
            .map_or(scope == "admin", |wanted| scope == wanted);
        if !scope_ok || !valid_snapshot(snapshot, share) {
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
    fn share_presets_strip_private_virtual_paths_even_for_matching_share_root() {
        let raw = json!([{
            "id":"preset", "name":"Unsafe", "scope":"share:token",
            "snapshot":{
                "windows":[{
                    "source":{"kind":"share","token":"token"},
                    "initialState":{"dir":"Hermes Sessions/session/secret"}
                }],
                "pinnedTaskbarItems":[]
            }
        }]);
        let filtered = presets(&raw, Some(("Hermes Sessions", "token")));
        assert_eq!(filtered, json!([]));
    }

    #[test]
    fn resource_targets_require_legacy_locator_and_stay_inside_share() {
        let snapshot = |legacy_locator: Option<&str>| {
            json!([{
                "id":"preset", "name":"Target", "scope":"share:token",
                "snapshot":{
                    "windows":[{
                        "source":{"kind":"share","token":"token"},
                        "initialState":{"viewing":"Shared/file.md"},
                        "resourceTarget":{
                            "ref":{"libraryId":"library","resourceId":"resource"},
                            "legacyLocator":legacy_locator
                        }
                    }],
                    "pinnedTaskbarItems":[]
                }
            }])
        };

        assert_eq!(
            presets(&snapshot(Some("Shared/file.md")), Some(("Shared", "token")))[0]["snapshot"]["windows"]
                [0]["resourceTarget"]["legacyLocator"],
            "Shared/file.md"
        );
        assert_eq!(
            presets(
                &snapshot(Some("Private/file.md")),
                Some(("Shared", "token"))
            ),
            json!([])
        );
        assert_eq!(
            presets(&snapshot(None), Some(("Shared", "token"))),
            json!([])
        );
    }
}
