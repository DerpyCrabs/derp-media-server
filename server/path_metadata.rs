use crate::{
    app::{AppState, default_settings, settings_path},
    error::AppResult,
    reader_state, store,
};
use serde_json::Value;

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

pub async fn moved(state: &AppState, old_path: &str, new_path: &str) -> AppResult<()> {
    let _guard = state.store_lock.lock().await;
    let mut settings = store::section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
    );
    for key in ["viewModes", "customIcons", "autoSave"] {
        move_map(&mut settings[key], old_path, new_path);
    }
    for key in ["favorites", "knowledgeBases"] {
        move_list(&mut settings[key], old_path, new_path);
    }
    store::update_section(&settings_path(state), &state.config.library_key, settings)?;
    reader_state::move_prefix(
        &state.config.data_path.join("app.sqlite3"),
        old_path,
        new_path,
    )
}

pub async fn removed(state: &AppState, path: &str) -> AppResult<()> {
    let _guard = state.store_lock.lock().await;
    let mut settings = store::section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
    );
    for key in ["viewModes", "customIcons", "autoSave"] {
        remove_map(&mut settings[key], path);
    }
    for key in ["favorites", "knowledgeBases"] {
        remove_list(&mut settings[key], path);
    }
    store::update_section(&settings_path(state), &state.config.library_key, settings)?;
    reader_state::remove_prefix(&state.config.data_path.join("app.sqlite3"), None, path)
}

pub fn content_replaced(state: &AppState, path: &str) -> AppResult<()> {
    reader_state::remove_prefix(&state.config.data_path.join("app.sqlite3"), None, path)
}

pub fn cleanup_share(state: &AppState, token: &str) -> AppResult<()> {
    reader_state::remove_scope(
        &state.config.data_path.join("app.sqlite3"),
        &format!("share:{token}"),
    )
}
