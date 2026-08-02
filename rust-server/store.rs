use crate::error::{AppError, AppResult};
use serde_json::{Value, json};
use std::{fs, path::Path};
pub fn read(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}
pub fn write(path: &Path, value: &Value) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppError::io)?
    }
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(value).map_err(|e| AppError::internal(e.to_string()))?,
    )
    .map_err(AppError::io)?;
    fs::rename(tmp, path).map_err(AppError::io)
}
pub fn section(path: &Path, key: &str, default: Value) -> Value {
    read(path).get(key).cloned().unwrap_or(default)
}
pub fn update_section(path: &Path, key: &str, value: Value) -> AppResult<()> {
    let mut all = read(path);
    if !all.is_object() {
        all = json!({})
    }
    all.as_object_mut().unwrap().insert(key.into(), value);
    write(path, &all)
}
