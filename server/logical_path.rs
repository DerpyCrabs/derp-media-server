use serde_json::{Map, Value};

pub fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

pub fn matches(path: &str, prefix: &str) -> bool {
    let path = normalize(path);
    let prefix = normalize(prefix);
    path == prefix
        || (!prefix.is_empty()
            && path
                .strip_prefix(&prefix)
                .is_some_and(|suffix| suffix.starts_with('/')))
}

pub fn move_under(path: &str, old_path: &str, new_path: &str) -> Option<String> {
    let path = normalize(path);
    let old_path = normalize(old_path);
    let new_path = normalize(new_path);
    if path == old_path {
        return Some(new_path);
    }
    if old_path.is_empty() {
        return None;
    }
    let suffix = path.strip_prefix(&old_path)?.strip_prefix('/')?;
    Some(if new_path.is_empty() {
        suffix.to_string()
    } else {
        format!("{new_path}/{suffix}")
    })
}

pub fn rewrite_value(value: &mut Value, old_path: &str, new_path: &str) -> bool {
    let Some(path) = value.as_str() else {
        return false;
    };
    let Some(moved) = move_under(path, old_path, new_path) else {
        return false;
    };
    if moved == path {
        return false;
    }
    *value = Value::String(moved);
    true
}

pub fn move_map_keys(map: &mut Map<String, Value>, old_path: &str, new_path: &str) {
    let updates = map
        .iter()
        .filter_map(|(path, value)| {
            move_under(path, old_path, new_path).map(|moved| (path.clone(), moved, value.clone()))
        })
        .collect::<Vec<_>>();
    for (old, new, value) in updates {
        map.remove(&old);
        map.insert(new, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn logical_path_operations_share_normalized_prefix_semantics() {
        assert!(matches("Books\\Old\\Child", "Books/Old/"));
        assert!(!matches("Books/Older", "Books/Old"));
        assert_eq!(
            move_under("Books\\Old\\Child", "Books/Old/", "Books/New/"),
            Some("Books/New/Child".into())
        );
        assert_eq!(move_under("Keep/file.pdf", "Books/Old", "Books/New"), None);

        let mut value = json!("Books/Old/file.pdf");
        assert!(rewrite_value(&mut value, "Books/Old", "Books/New"));
        assert_eq!(value, "Books/New/file.pdf");
        assert!(!rewrite_value(&mut value, "Missing", "Elsewhere"));
    }
}
