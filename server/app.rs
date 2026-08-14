use crate::{
    config::Config, contracts::AppEvent, file_commands::FileCommandService, image_variants,
    integrations::registry::IntegrationRegistry, thumbnails,
};
use base64::Engine;
use serde_json::{Value, json};
use std::{sync::Arc, time::UNIX_EPOCH};
use tokio::sync::Mutex;

pub(crate) struct AppState {
    pub config: Config,
    pub file_commands: FileCommandService,
    pub dev: bool,
    pub vite_port: u16,
    pub client: reqwest::Client,
    pub application_events: tokio::sync::broadcast::Sender<AppEvent>,
    pub reader_state_db: Mutex<()>,
    pub thumbnails: thumbnails::Thumbnailer,
    pub image_variants: image_variants::ImageVariants,
    pub integrations: Arc<IntegrationRegistry>,
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
    let directory = parent_logical(path);
    let path = path.replace('\\', "/");
    state.integrations.changed("filesystem", &directory);
    let _ = state.application_events.send(AppEvent::FilesChanged {
        directory,
        path: Some(path),
        timestamp: timestamp_ms(),
    });
}

pub(crate) fn emit_application_event(state: &AppState, event: AppEvent) {
    let _ = state.application_events.send(event);
}

pub(crate) fn emit_path_removed(state: &AppState, path: &str) {
    let _ = state.application_events.send(AppEvent::PathRemoved {
        path: path.replace('\\', "/"),
        timestamp: timestamp_ms(),
    });
}

pub(crate) fn emit_path_moved(state: &AppState, old_path: &str, new_path: &str) {
    let _ = state.application_events.send(AppEvent::PathMoved {
        old_path: old_path.replace('\\', "/"),
        new_path: new_path.replace('\\', "/"),
        timestamp: timestamp_ms(),
    });
}

pub(crate) fn default_settings() -> Value {
    json!({"viewModes":{},"favorites":[],"knowledgeBases":[],"customIcons":{},"autoSave":{},"workspaceTaskbarPins":[],"workspaceLayoutPresets":[]})
}

pub(crate) fn parent_logical(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit_once('/')
        .map(|value| value.0.into())
        .unwrap_or_default()
}

pub(crate) fn timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

pub(crate) fn safe_upload_name(name: &str) -> String {
    name.replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string()
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
