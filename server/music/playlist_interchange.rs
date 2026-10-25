use crate::{
    app::Shared,
    config::Config,
    error::{AppError, AppResult},
    media,
};
use axum::{
    Json,
    extract::{Path as RoutePath, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ResolveRequest {
    base_directory: String,
    entries: Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    value: String,
    #[serde(default)]
    logical: bool,
}
fn logical_path(config: &Config, full: &Path) -> Option<String> {
    let canonical = full.canonicalize().ok()?;
    let mut matches = Vec::new();
    for root in &config.roots {
        let Ok(root_path) = root.path.canonicalize() else {
            continue;
        };
        if let Ok(relative) = canonical.strip_prefix(&root_path) {
            let relative = relative.to_str()?.replace('\\', "/");
            let logical = if config.roots.len() > 1 {
                format!("{}/{relative}", root.name)
            } else {
                relative
            };
            matches.push((root_path.components().count(), logical));
        }
    }
    matches.sort_by_key(|(depth, _)| std::cmp::Reverse(*depth));
    matches.into_iter().next().map(|(_, logical)| logical)
}
fn normalize(path: &Path) -> Option<PathBuf> {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::RootDir => result.push(std::path::MAIN_SEPARATOR.to_string()),
            Component::Normal(value) => result.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                if !result.pop() {
                    return None;
                }
            }
            Component::Prefix(value) => result.push(value.as_os_str()),
        }
    }
    Some(result)
}
fn resolve_entry(config: &Config, base: &Path, entry: &Entry) -> Result<String, &'static str> {
    let value = entry.value.trim();
    if value.is_empty() || value.contains('\0') {
        return Err("Invalid path");
    }
    let logical = if entry.logical {
        value.to_owned()
    } else {
        let full = if value.to_ascii_lowercase().starts_with("file:") {
            let uri = url::Url::parse(value).map_err(|_| "Invalid file URL")?;
            if uri.host_str().is_some_and(|host| host != "localhost") {
                return Err("File belongs to another computer");
            }
            uri.to_file_path().map_err(|_| "Invalid file URL")?
        } else {
            if value.contains("://") || value.starts_with("//") || value.starts_with("\\\\") {
                return Err("External streams are not imported");
            }
            if value.as_bytes().get(1) == Some(&b':') {
                return Err("File belongs to another computer");
            }
            let path = PathBuf::from(value.replace('\\', "/"));
            normalize(&if path.is_absolute() {
                path
            } else {
                base.join(path)
            })
            .ok_or("Unavailable or outside the library")?
        };
        logical_path(config, &full).ok_or("Unavailable or outside the library")?
    };
    let resolved =
        media::resolve(config, &logical).map_err(|_| "Unavailable or outside the library")?;
    if !resolved.full.is_file() {
        return Err("File not found");
    }
    if media::media_type(&media::extension(&resolved.full)) != "audio" {
        return Err("Not an audio file");
    }
    Ok(if config.roots.len() > 1 {
        format!("{}/{}", resolved.root.name, resolved.relative)
    } else {
        resolved.relative
    })
}
pub(super) async fn resolve(
    State(state): State<Shared>,
    Json(request): Json<ResolveRequest>,
) -> AppResult<Json<Value>> {
    if request.entries.len() > 10_000
        || request
            .entries
            .iter()
            .map(|entry| entry.value.len())
            .sum::<usize>()
            > 2 * 1024 * 1024
        || request.entries.iter().any(|entry| entry.value.len() > 8192)
    {
        return Err(AppError::bad(
            "Playlists are limited to 10,000 entries and 2 MiB",
        ));
    }
    tokio::task::spawn_blocking(move || {
        let base = media::resolve(&state.config, &request.base_directory)?.full;
        if !base.is_dir() {
            return Err(AppError::bad(
                "Choose an existing library folder for relative paths",
            ));
        }
        let mut seen = HashSet::new();
        let mut paths = Vec::new();
        let mut issues = Vec::new();
        let mut duplicates = 0;
        for (index, entry) in request.entries.iter().enumerate() {
            match resolve_entry(&state.config, &base, entry) {
                Ok(path) => {
                    if seen.insert(path.clone()) {
                        paths.push(path);
                    } else {
                        duplicates += 1;
                    }
                }
                Err(reason) => {
                    issues.push(json!({"index":index,"value":entry.value,"reason":reason}))
                }
            }
        }
        Ok(Json(
            json!({"paths":paths,"issues":issues,"duplicates":duplicates}),
        ))
    })
    .await
    .map_err(crate::activity::sql_error)?
}
pub(super) async fn local_export(
    State(state): State<Shared>,
    RoutePath(id): RoutePath<String>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        let c = state.database.connection()?;
        let playlist = super::playlists::document(&state, &c, &id, &super::catalog::tracks(&c, true)?)?;
        let mut entries = Vec::new();
        for item in playlist["items"].as_array().into_iter().flatten() {
            let path = item["path"].as_str().unwrap_or_default();
            let resolved = media::resolve(&state.config, path)?;
            let url = url::Url::from_file_path(&resolved.full).map_err(|_| AppError::bad("Could not export this file path"))?;
            entries.push(json!({"path":path,"url":url.as_str(),"title":item["title"],"duration":item["duration"]}));
        }
        Ok(Json(json!({"name":playlist["name"],"entries":entries})))
    }).await.map_err(crate::activity::sql_error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lexical_paths_preserve_root_and_reject_escape() {
        assert_eq!(
            normalize(Path::new("/music/playlists/../song.mp3")),
            Some(PathBuf::from("/music/song.mp3"))
        );
        assert_eq!(normalize(Path::new("/../../outside")), None);
    }
    #[tokio::test]
    async fn paths_map_to_configured_roots_without_importing_outside_files() {
        let app = crate::test_support::TestApp::new();
        app.write("Music/Вечер #1.mp3", b"audio");
        app.write("nested/song.flac", b"audio");
        std::fs::create_dir_all(app.media.join("Playlists")).unwrap();
        let outside = app.directory.join("outside.mp3");
        std::fs::write(&outside, b"outside").unwrap();
        let base = app.media.join("Playlists");
        let entry = |value: String| Entry { value, logical: false };
        assert_eq!(resolve_entry(&app.state.config, &base, &entry("../Music/Вечер #1.mp3".into())).unwrap(), "Music/Вечер #1.mp3");
        assert_eq!(resolve_entry(&app.state.config, &base, &entry(url::Url::from_file_path(app.media.join("Music/Вечер #1.mp3")).unwrap().to_string())).unwrap(), "Music/Вечер #1.mp3");
        assert!(resolve_entry(&app.state.config, &base, &entry(outside.to_string_lossy().into())).is_err());
        assert!(resolve_entry(&app.state.config, &base, &Entry { value: "../outside.mp3".into(), logical: true }).is_err());
        let mut config = app.state.config.clone();
        config.roots.insert(0, crate::config::MediaRoot { id: "missing".into(), name: "Missing".into(), path: app.directory.join("missing"), editable_folders: vec![] });
        config.roots.push(crate::config::MediaRoot { id: "nested".into(), name: "Nested".into(), path: app.media.join("nested"), editable_folders: vec![] });
        assert_eq!(resolve_entry(&config, &base, &entry("../nested/song.flac".into())).unwrap(), "Nested/song.flac");
        assert_eq!(resolve_entry(&config, &base, &entry("../Music/Вечер #1.mp3".into())).unwrap(), "Media/Music/Вечер #1.mp3");
        #[cfg(unix)] {
            std::os::unix::fs::symlink(&outside, app.media.join("escape.mp3")).unwrap();
            assert!(resolve_entry(&config, &base, &entry("../escape.mp3".into())).is_err());
        }
    }

}
