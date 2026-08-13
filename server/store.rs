use crate::{error::AppResult, state_db};
use serde_json::Value;
use std::path::Path;

fn kind(path: &Path) -> &str {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
}

pub fn section(path: &Path, key: &str, default: Value) -> Value {
    let database = path.with_file_name("app.sqlite3");
    state_db::document(&database, kind(path), key, default.clone()).unwrap_or(default)
}
pub fn mutate_section<T>(
    path: &Path,
    key: &str,
    default: Value,
    update: impl FnOnce(&mut Value) -> AppResult<T>,
) -> AppResult<T> {
    let database = path.with_file_name("app.sqlite3");
    state_db::update_document(&database, kind(path), key, default, update)
}
