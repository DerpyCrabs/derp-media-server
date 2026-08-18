use serde_json::{Map, Value};

fn has_dot_dot(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

fn valid_source(source: &Value) -> bool {
    source.get("kind").and_then(Value::as_str) == Some("local")
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

fn valid_snapshot(snapshot: &Value) -> bool {
    let Some(windows) = snapshot.get("windows").and_then(Value::as_array) else {
        return false;
    };
    for window in windows {
        let Some(source) = window.get("source") else {
            return false;
        };
        if !valid_source(source) {
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

pub fn persistent_snapshot(snapshot: &Value) -> Option<Value> {
    if !valid_snapshot(snapshot) {
        return None;
    }
    let windows = snapshot.get("windows")?.as_array()?;
    let windows = windows
        .iter()
        .filter_map(|window| {
            let is_hermes = window.get("type").and_then(Value::as_str) == Some("hermes");
            if is_hermes
                && window
                    .get("hermes")
                    .and_then(Value::as_object)
                    .and_then(|hermes| hermes.get("sessionId"))
                    .and_then(Value::as_str)
                    .is_none()
            {
                return None;
            }
            let mut window = window.clone();
            if is_hermes {
                window
                    .get_mut("hermes")
                    .and_then(Value::as_object_mut)
                    .map(|hermes| hermes.remove("draftId"));
            }
            Some(window)
        })
        .collect();
    let mut result = snapshot.clone();
    result["windows"] = Value::Array(windows);
    result["pinnedTaskbarItems"] =
        admin_pins(snapshot.get("pinnedTaskbarItems").unwrap_or(&Value::Null));
    Some(result)
}

pub fn required_id<'a>(body: &'a Value, key: &str) -> crate::error::AppResult<&'a str> {
    body.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or_else(|| crate::error::AppError::bad(format!("{key} is required")))
}

pub fn registry(mut raw: Value) -> Value {
    if !raw.is_object() {
        raw = serde_json::json!({});
    }
    let records = raw
        .get("records")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(id, mut record)| {
            if id.is_empty()
                || id.len() > 128
                || record.get("id").and_then(Value::as_str) != Some(id.as_str())
            {
                return None;
            }
            let snapshot = record.get("snapshot")?.clone();
            record["snapshot"] = persistent_snapshot(&snapshot)?;
            if !record.get("revision").is_some_and(Value::is_u64) {
                record["revision"] = Value::from(0);
            }
            if !record.get("updatedAt").is_some_and(Value::is_u64) {
                record["updatedAt"] = Value::from(0);
            }
            if !record.get("lastOpenedAt").is_some_and(Value::is_u64) {
                record["lastOpenedAt"] = Value::from(0);
            }
            Some((id, record))
        })
        .collect::<Map<String, Value>>();
    let mut seen = std::collections::HashSet::new();
    let mut order = raw
        .get("order")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|id| records.contains_key(*id) && seen.insert((*id).to_string()))
        .map(|id| Value::String(id.to_string()))
        .collect::<Vec<_>>();
    for id in records.keys() {
        if seen.insert(id.clone()) {
            order.push(Value::String(id.clone()));
        }
    }
    serde_json::json!({"version":1,"order":order,"records":records})
}

pub fn require_lease(record: &Value, client_id: &str, now: u128) -> crate::error::AppResult<()> {
    let owned = record.get("leaseClientId").and_then(Value::as_str) == Some(client_id);
    let alive = record
        .get("leaseExpiresAt")
        .and_then(Value::as_u64)
        .is_some_and(|expires| expires as u128 > now);
    if !owned || !alive {
        return Err(crate::error::AppError::conflict(
            "Workspace is open elsewhere",
        ));
    }
    Ok(())
}

pub fn require_lease_or_available(
    record: &Value,
    client_id: &str,
    now: u128,
) -> crate::error::AppResult<()> {
    let owned = record.get("leaseClientId").and_then(Value::as_str) == Some(client_id);
    let alive = record
        .get("leaseExpiresAt")
        .and_then(Value::as_u64)
        .is_some_and(|expires| expires as u128 > now);
    if alive && !owned {
        return Err(crate::error::AppError::conflict(
            "Workspace is open elsewhere",
        ));
    }
    Ok(())
}

pub fn apply_metadata(record: &mut Value, body: &Value) -> crate::error::AppResult<()> {
    if let Some(name) = body.get("name") {
        let name = name
            .as_str()
            .ok_or_else(|| crate::error::AppError::bad("Invalid workspace name"))?
            .trim();
        if name.encode_utf16().count() > 120 {
            return Err(crate::error::AppError::bad("Workspace name is too long"));
        }
        if name.is_empty() {
            record.as_object_mut().map(|object| object.remove("name"));
        } else {
            record["name"] = Value::String(name.to_string());
        }
    }
    if let Some(icon) = body.get("icon") {
        let icon = icon.as_str().unwrap_or("").trim();
        if icon.is_empty() {
            record.as_object_mut().map(|object| object.remove("icon"));
        } else if icon.len() <= 64 && icon.chars().all(|ch| ch.is_ascii_alphanumeric()) {
            record["icon"] = Value::String(icon.to_string());
        } else {
            return Err(crate::error::AppError::bad("Invalid workspace icon"));
        }
    }
    if let Some(color) = body.get("iconColor") {
        let color = color.as_str().unwrap_or("").trim();
        if color.is_empty() {
            record
                .as_object_mut()
                .map(|object| object.remove("iconColor"));
        } else if color.len() <= 32
            && color
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        {
            record["iconColor"] = Value::String(color.to_string());
        } else {
            return Err(crate::error::AppError::bad("Invalid workspace icon color"));
        }
    }
    Ok(())
}
