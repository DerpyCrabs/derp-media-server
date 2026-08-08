use crate::{
    config::{Config, MediaRoot},
    error::AppResult,
    file_search::FileSearch,
    image_variants, media, shares, store, thumbnails,
};
use axum::http::{HeaderMap, header};
use base64::Engine;
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, atomic::AtomicU64},
    time::UNIX_EPOCH,
};
use tokio::sync::{Mutex, RwLock};

pub(crate) struct AppState {
    pub config: Config,
    pub runtime_roots: RwLock<Vec<MediaRoot>>,
    pub store_lock: Mutex<()>,
    pub dev: bool,
    pub vite_port: u16,
    pub client: reqwest::Client,
    pub events: tokio::sync::broadcast::Sender<FileEvent>,
    pub admin_events: tokio::sync::broadcast::Sender<Value>,
    pub image_grants: Mutex<HashMap<String, ImageGrant>>,
    pub share_images: Mutex<HashMap<(String, String, String), ImagePreview>>,
    pub image_operations: Mutex<()>,
    pub preview_sequence: AtomicU64,
    pub login_attempts: Mutex<HashMap<String, (u32, u128)>>,
    pub share_verify_attempts: Mutex<HashMap<String, (u32, u128)>>,
    pub thumbnails: thumbnails::Thumbnailer,
    pub image_variants: image_variants::ImageVariants,
    pub file_search: Arc<FileSearch>,
}

#[derive(Clone)]
pub(crate) struct ImageGrant {
    pub token: String,
    pub share_path: String,
    pub image_path: String,
    pub accounted_bytes: u64,
    pub expires_at: u128,
    pub recorded_at: u64,
}

pub(crate) struct ImagePreview {
    pub expires_at: u128,
    pub finalized_at: Option<u64>,
    pub recorded_at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct FileEvent {
    pub directory: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

pub(crate) type Shared = Arc<AppState>;

pub(crate) fn decode_node_base64(value: &str) -> Vec<u8> {
    let mut normalized = value
        .bytes()
        .filter_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'+' | b'/' | b'=' => Some(byte),
            b'-' => Some(b'+'),
            b'_' => Some(b'/'),
            _ => None,
        })
        .collect::<Vec<_>>();
    if normalized.len() % 4 == 1 {
        normalized.pop();
    }
    base64::engine::general_purpose::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::general_purpose::GeneralPurposeConfig::new()
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    )
    .decode(normalized)
    .unwrap_or_default()
}

pub(crate) fn emit(state: &AppState, path: &str) {
    let event = FileEvent {
        directory: parent_logical(path),
        path: Some(path.replace('\\', "/")),
    };
    let _ = state.events.send(event.clone());
    let _ = state.admin_events.send(json!({
        "type":"files-changed",
        "directory":event.directory,
        "path":event.path,
        "timestamp":timestamp_ms(),
    }));
    state.file_search.changed(&event.directory);
}

pub(crate) fn emit_admin(state: &AppState, kind: &str) {
    let _ = state
        .admin_events
        .send(json!({"type":kind,"timestamp":timestamp_ms()}));
}

pub(crate) fn roots(state: &AppState) -> Vec<MediaRoot> {
    state
        .runtime_roots
        .try_read()
        .map(|roots| roots.clone())
        .unwrap_or_default()
}

pub(crate) fn all_roots(state: &AppState) -> Vec<MediaRoot> {
    let mut result = state.config.roots.clone();
    result.extend(roots(state));
    result
}

pub(crate) fn list_directory(state: &AppState, path: &str) -> AppResult<Vec<media::FileItem>> {
    let runtime = roots(state);
    let mut files = media::list(&state.config, &runtime, path)?;
    for file in &mut files {
        if !matches!(file.media_type.as_str(), "image" | "video") {
            continue;
        }
        if let Ok(resolved) = media::resolve(&state.config, &runtime, &file.path)
            && let Ok(metadata) = std::fs::metadata(&resolved.full)
        {
            file.thumbnail_generated = metadata
                .modified()
                .ok()
                .map(|modified| state.thumbnails.cached(&resolved.full, modified));
        }
    }
    Ok(files)
}

pub(crate) fn settings_path(state: &AppState) -> PathBuf {
    state.config.data_path.join("settings.json")
}

pub(crate) fn canvases_path(state: &AppState) -> PathBuf {
    state.config.data_path.join("canvases.json")
}

pub(crate) fn stats_path(state: &AppState) -> PathBuf {
    state.config.data_path.join("stats.json")
}

pub(crate) fn default_settings() -> Value {
    json!({"viewModes":{},"favorites":[],"knowledgeBases":[],"customIcons":{},"autoSave":{},"workspaceTaskbarPins":[],"workspaceLayoutPresets":[]})
}

pub(crate) fn cookies(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .filter_map(|part| {
                    part.trim()
                        .split_once('=')
                        .map(|(key, value)| (key.into(), value.into()))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn parent_logical(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit_once('/')
        .map(|value| value.0.into())
        .unwrap_or_default()
}

pub(crate) fn timestamp_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(crate) fn knowledge_bases(state: &AppState) -> Vec<String> {
    store::section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
    )["knowledgeBases"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str().map(str::to_string))
        .collect()
}

pub(crate) fn knowledge_base_root(state: &AppState, path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    knowledge_bases(state)
        .into_iter()
        .map(|root| root.replace('\\', "/"))
        .find(|root| normalized == *root || normalized.starts_with(&format!("{root}/")))
}

pub(crate) fn find_share(state: &AppState, token: &str) -> AppResult<shares::Share> {
    shares::read(&state.config, &roots(state))
        .into_iter()
        .find(|share| share.token == token)
        .ok_or_else(|| crate::error::AppError::not_found("Share not found"))
}

pub(crate) fn safe_upload_name(name: &str) -> String {
    name.replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
}

pub(crate) async fn rate_limit(
    attempts: &Mutex<HashMap<String, (u32, u128)>>,
    key: String,
) -> bool {
    let now = timestamp_ms();
    let mut attempts = attempts.lock().await;
    let entry = attempts.entry(key).or_insert((0, now + 15 * 60 * 1000));
    if now > entry.1 {
        *entry = (1, now + 15 * 60 * 1000);
        return true;
    }
    if entry.0 >= 10 {
        return false;
    }
    entry.0 += 1;
    true
}

pub(crate) fn search_snippet(content: &str, query: &str) -> String {
    const MAX: usize = 220;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return String::new();
    }
    let lines = content
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect::<Vec<_>>();
    let Some(index) = lines
        .iter()
        .position(|line| line.to_lowercase().contains(&needle))
    else {
        return String::new();
    };
    let combined = lines[index.saturating_sub(1)..(index + 2).min(lines.len())]
        .join("\n")
        .trim()
        .to_string();
    if combined.encode_utf16().count() <= MAX {
        return combined;
    }
    let line = lines[index];
    let line_utf16 = line.encode_utf16().collect::<Vec<_>>();
    if line_utf16.len() <= MAX {
        return line.to_string();
    }
    let lower = line.to_lowercase();
    let match_byte = lower.find(&needle).unwrap_or(0);
    let match_unit = lower[..match_byte].encode_utf16().count();
    let start = match_unit
        .saturating_sub(MAX / 2)
        .min(line_utf16.len().saturating_sub(MAX));
    let end = (start + MAX).min(line_utf16.len());
    format!(
        "{}{}{}",
        if start > 0 { "..." } else { "" },
        String::from_utf16_lossy(&line_utf16[start..end]),
        if end < line_utf16.len() { "..." } else { "" }
    )
}
