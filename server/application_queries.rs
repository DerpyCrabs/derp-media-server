use crate::{
    app::{AppState, default_settings, list_directory, settings_path, stats_path},
    contracts::{
        FileItemDto, FileListResponse, MediaRootDto, QUERY_AUDIO_METADATA, QUERY_CONTENT,
        QUERY_FILES, QUERY_SERVER_CONFIG, QUERY_SETTINGS, QUERY_STATS, ServerConfigDto,
        SettingsDto, ViewModeDto, VirtualDirectoryDto,
    },
    error::{AppError, AppResult},
    media, store, workspace_persistence,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path};

pub(crate) fn files_query_key(path: &str, surface: Option<&str>, offset: usize) -> Value {
    if matches!(surface, None | Some("library")) && offset == 0 {
        json!([QUERY_FILES, path])
    } else {
        json!([QUERY_FILES, path, surface.unwrap_or("library"), offset])
    }
}

pub(crate) fn settings_query_key() -> Value {
    json!([QUERY_SETTINGS])
}

pub(crate) fn server_config_query_key() -> Value {
    json!([QUERY_SERVER_CONFIG])
}

pub(crate) fn stats_query_key() -> Value {
    json!([QUERY_STATS])
}

pub(crate) fn kb_recent_query_key(scope: &str) -> Value {
    json!([QUERY_CONTENT, "admin", "kb-recent", scope])
}

pub(crate) fn text_content_query_key(path: &str) -> Value {
    json!([QUERY_CONTENT, "admin", "text", path])
}

pub(crate) fn audio_metadata_query_key(path: &str) -> Value {
    json!([QUERY_AUDIO_METADATA, "v2", path])
}

pub(crate) fn server_config(state: &AppState) -> ServerConfigDto {
    let roots = &state.config.roots;
    let editable_folders = if roots.len() == 1 {
        roots[0].editable_folders.clone()
    } else {
        let mut values = roots[0].editable_folders.clone();
        values.extend(roots.iter().flat_map(|root| {
            root.editable_folders
                .iter()
                .map(move |folder| format!("{}/{}", root.name, folder.replace('\\', "/")))
        }));
        values
    };
    ServerConfigDto {
        editable_folders,
        media_roots: roots
            .iter()
            .map(|root| MediaRootDto {
                id: root.id.clone(),
                name: root.name.clone(),
                editable_folders: root.editable_folders.clone(),
            })
            .collect(),
    }
}

pub(crate) fn settings(state: &AppState) -> AppResult<SettingsDto> {
    let value = store::section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
    );
    let view_modes = value["viewModes"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(path, mode)| {
            let mode = match mode.as_str()? {
                "list" => ViewModeDto::List,
                "grid" => ViewModeDto::Grid,
                _ => return None,
            };
            Some((path.clone(), mode))
        })
        .collect();
    Ok(SettingsDto {
        view_modes,
        favorites: contract_value(
            value.get("favorites").cloned().unwrap_or_else(|| json!([])),
            "favorites settings",
        )?,
        knowledge_bases: contract_value(
            value
                .get("knowledgeBases")
                .cloned()
                .unwrap_or_else(|| json!([])),
            "knowledge base settings",
        )?,
        custom_icons: contract_value(
            value
                .get("customIcons")
                .cloned()
                .unwrap_or_else(|| json!({})),
            "custom icon settings",
        )?,
        auto_save: contract_value(
            value.get("autoSave").cloned().unwrap_or_else(|| json!({})),
            "auto-save settings",
        )?,
        workspace_taskbar_pins: contract_value(
            workspace_persistence::admin_pins(&value["workspaceTaskbarPins"]),
            "workspace taskbar pin settings",
        )?,
        workspace_layout_presets: contract_value(
            workspace_persistence::presets(&value["workspaceLayoutPresets"]),
            "workspace layout preset settings",
        )?,
    })
}

pub(crate) fn stats(state: &AppState) -> Value {
    let value = store::section(
        &stats_path(state),
        &state.config.library_key,
        json!({"views":{}}),
    );
    json!({"views": value["views"].as_object().cloned().unwrap_or_default()})
}

pub(crate) fn text_content(state: &AppState, path: &str) -> AppResult<String> {
    let resolved = media::resolve(&state.config, path)?;
    std::fs::read_to_string(resolved.full).map_err(AppError::io)
}

fn visible(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !name.starts_with('.')
        && ![
            "node_modules",
            "$RECYCLE.BIN",
            "System Volume Information",
            ".git",
            ".svn",
            ".hg",
            "__pycache__",
            ".DS_Store",
        ]
        .contains(&name.as_ref())
}

pub(crate) fn kb_recent(state: &AppState, root: &str) -> AppResult<Value> {
    let resolved = media::resolve(&state.config, root)?;
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(&resolved.full)
        .into_iter()
        .filter_entry(visible)
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file()
            || entry
                .path()
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase()
                != "md"
        {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|value| value.modified().ok())
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        let relative = entry
            .path()
            .strip_prefix(&resolved.root.path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        let path = if state.config.roots.len() > 1 {
            format!("{}/{}", resolved.root.name, relative)
        } else {
            relative
        };
        files.push((modified, path));
    }
    files.sort_by_key(|item| std::cmp::Reverse(item.0));
    files.truncate(10);
    Ok(
        json!({"results": files.into_iter().map(|(modified, path)| json!({
        "name": media::name(&path),
        "path": path,
        "modifiedAt": chrono::DateTime::from_timestamp_millis(modified as i64)
            .map(|date| date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
    })).collect::<Vec<_>>() }),
    )
}

pub(crate) async fn file_listing(
    state: &AppState,
    dir: &str,
    offset: usize,
) -> AppResult<FileListResponse> {
    if dir == crate::virtual_directory::HERMES_ROOT
        || dir.starts_with(&format!("{}/", crate::virtual_directory::HERMES_ROOT))
    {
        let listing = crate::virtual_directory::list_hermes(state, dir, offset).await?;
        return Ok(FileListResponse {
            files: listing.files.into_iter().map(FileItemDto::from).collect(),
            virtual_entries: listing
                .virtual_entries
                .into_iter()
                .map(|(path, value)| Ok((path, contract_value(value, "virtual entry")?)))
                .collect::<AppResult<HashMap<_, _>>>()?,
            virtual_directory: listing
                .virtual_directory
                .map(|value| contract_value(value, "virtual directory"))
                .transpose()?,
        });
    }

    let mut files = list_items(state, dir)?;
    let mut virtual_entries = HashMap::new();
    if dir.is_empty() && state.hermes.is_some() {
        let path = crate::virtual_directory::HERMES_ROOT.to_string();
        files.push(media::FileItem {
            name: path.clone(),
            path: path.clone(),
            media_type: "folder".into(),
            size: 0,
            extension: String::new(),
            is_directory: true,
            is_virtual: Some(true),
            view_count: None,
            thumbnail_generated: None,
            version: None,
        });
        virtual_entries.insert(
            path,
            contract_value(
                json!({"provider":"hermes","kind":"root","capabilities":["open"],
                    "appearance":{"icon":"agent-directory","tone":"violet"}}),
                "virtual entry",
            )?,
        );
    }
    let virtual_directory = crate::virtual_directory::is_builtin_path(dir)
        .then(|| {
            contract_value::<VirtualDirectoryDto>(
                json!({"provider":"builtin","kind":"collection","path":dir,"capabilities":[],
                    "offset":0,"pageSize":files.len(),"total":files.len()}),
                "virtual directory",
            )
        })
        .transpose()?;
    Ok(FileListResponse {
        files: files.into_iter().map(FileItemDto::from).collect(),
        virtual_entries,
        virtual_directory,
    })
}

fn contract_value<T: DeserializeOwned>(value: Value, name: &str) -> AppResult<T> {
    serde_json::from_value(value)
        .map_err(|error| AppError::internal(format!("Invalid {name} response: {error}")))
}

pub(crate) fn list_items(state: &AppState, dir: &str) -> AppResult<Vec<media::FileItem>> {
    if let Some(result) = crate::virtual_directory::list_builtin(state, dir) {
        return result;
    }
    list_directory(state, dir)
}

pub(crate) fn legacy_virtual_items(
    state: &AppState,
    dir: &str,
) -> Option<AppResult<Vec<media::FileItem>>> {
    if dir != "Favorites" && dir != "Most Played" {
        return None;
    }
    let section = if dir == "Favorites" {
        store::section(
            &settings_path(state),
            &state.config.library_key,
            crate::app::default_settings(),
        )
    } else {
        store::section(
            &stats_path(state),
            &state.config.library_key,
            json!({"views":{}}),
        )
    };
    let paths: Vec<(String, Option<u64>)> = if dir == "Favorites" {
        section["favorites"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str().map(|path| (path.into(), None)))
            .collect()
    } else {
        let mut values = section["views"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(path, value)| (path.clone(), value.as_u64()))
            .collect::<Vec<_>>();
        values.sort_by_key(|item| std::cmp::Reverse(item.1));
        values.truncate(50);
        values
    };
    let mut items = Vec::new();
    for (path, view_count) in paths {
        let Ok(resolved) = media::resolve(&state.config, &path) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&resolved.full) else {
            continue;
        };
        if dir == "Most Played" && metadata.is_dir() {
            continue;
        }
        let name = media::name(&path);
        let extension = Path::new(&name)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        let thumbnail_generated =
            if !metadata.is_dir() && matches!(media::media_type(&extension), "image" | "video") {
                metadata
                    .modified()
                    .ok()
                    .map(|modified| state.thumbnails.cached(&resolved.full, modified))
            } else {
                None
            };
        items.push(media::FileItem {
            name,
            path,
            media_type: if metadata.is_dir() {
                "folder".into()
            } else {
                media::media_type(&extension).into()
            },
            size: if metadata.is_dir() { 0 } else { metadata.len() },
            extension,
            is_directory: metadata.is_dir(),
            is_virtual: None,
            view_count,
            thumbnail_generated,
            version: None,
        });
    }
    Some(Ok(items))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_keys_match_client_contract() {
        assert_eq!(files_query_key("Music", None, 0), json!(["files", "Music"]));
        assert_eq!(
            files_query_key("Hermes Sessions", Some("workspace"), 200),
            json!(["files", "Hermes Sessions", "workspace", 200])
        );
        assert_eq!(
            files_query_key("Hermes Sessions", Some("library"), 200),
            json!(["files", "Hermes Sessions", "library", 200])
        );
        assert_eq!(
            files_query_key("Music", Some("library"), 0),
            json!(["files", "Music"])
        );
        assert_eq!(settings_query_key(), json!(["settings"]));
        assert_eq!(server_config_query_key(), json!(["server-config"]));
        assert_eq!(stats_query_key(), json!(["stats"]));
        assert_eq!(
            kb_recent_query_key("Notes"),
            json!(["content", "admin", "kb-recent", "Notes"])
        );
        assert_eq!(
            text_content_query_key("Notes/one.md"),
            json!(["content", "admin", "text", "Notes/one.md"])
        );
        assert_eq!(
            audio_metadata_query_key("Music/one.mp3"),
            json!(["audio-metadata", "v2", "Music/one.mp3"])
        );
    }
}
