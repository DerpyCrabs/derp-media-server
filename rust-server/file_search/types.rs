use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub(super) struct Root {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResultEntry {
    pub name: String,
    pub path: String,
    pub parent_path: String,
    pub root_id: String,
    pub root_name: String,
    pub is_directory: bool,
    pub extension: String,
    #[serde(rename = "type")]
    pub media_type: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RootStatus {
    pub id: String,
    pub name: String,
    pub state: String,
    pub refresh_mode: String,
    pub indexed_entries: i64,
    pub scanned_directories: i64,
    pub last_complete_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Status {
    pub state: String,
    pub stale: bool,
    pub indexed_entries: i64,
    pub scanned_directories: i64,
    pub watcher_count: usize,
    pub roots: Vec<RootStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug)]
pub(super) struct RootRow {
    pub state: String,
    pub generation: i64,
    pub last_complete_at: Option<i64>,
    pub root_mtime: Option<f64>,
    pub root_birthtime: Option<f64>,
}

#[derive(Debug)]
pub(super) struct DirectoryRow {
    pub id: i64,
    pub relative_path: String,
    pub mtime: Option<f64>,
    pub birthtime: Option<f64>,
}

#[derive(Debug)]
pub(super) struct IndexedEntry {
    pub relative_path: String,
    pub parent_path: String,
    pub name: String,
    pub is_directory: bool,
    pub extension: String,
    pub media_type: String,
    pub generation: i64,
    pub seen_token: i64,
    pub queue_directory: bool,
}
