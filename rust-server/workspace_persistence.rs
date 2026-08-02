use chrono::{SecondsFormat, Utc};
use serde_json::{Map, Value};

fn has_dot_dot(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

fn valid_source(source: &Value, kind: &str, token: Option<&str>) -> bool {
    source.get("kind").and_then(Value::as_str) == Some(kind)
        && token
            .is_none_or(|expected| source.get("token").and_then(Value::as_str) == Some(expected))
}

fn valid_pin(pin: &Value) -> bool {
    pin.get("id").and_then(Value::as_str).is_some()
        && pin.get("path").and_then(Value::as_str).is_some()
        && pin.get("isDirectory").and_then(Value::as_bool).is_some()
        && pin.get("title").and_then(Value::as_str).is_some()
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
                    !has_dot_dot(&path) && (path == root || path.starts_with(&(root.clone() + "/")))
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
