use crate::{
    app::Shared,
    config::Config,
    error::{AppError, AppResult},
    media,
};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveRequest {
    path: String,
    #[serde(default)]
    absolute: bool,
}

fn resolve_path(config: &Config, request: ResolveRequest) -> AppResult<Value> {
    let logical = if request.absolute {
        let expanded =
            if config.desktop_mode && (request.path == "~" || request.path.starts_with("~/")) {
                let home = std::env::var_os("HOME")
                    .ok_or_else(|| AppError::bad("Home directory is unavailable"))?;
                PathBuf::from(home).join(request.path.strip_prefix("~/").unwrap_or(""))
            } else {
                PathBuf::from(&request.path)
            };
        let input = expanded.as_path();
        if !input.is_absolute() {
            return Err(AppError::bad("Expected an absolute filesystem path"));
        }
        absolute_to_logical(config, input)?
    } else {
        request.path
    };
    let resolved = media::resolve(config, &logical)?;
    let metadata = fs::metadata(&resolved.full).map_err(AppError::io)?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(AppError::bad(
            "Only regular files and directories can be opened",
        ));
    }
    Ok(json!({
        "path": logical,
        "absolutePath": resolved.full,
        "isDirectory": metadata.is_dir(),
        "editable": media::editable(config, &logical),
        "mediaType": if metadata.is_dir() { "folder" } else { media::path_media_type(&resolved.full) },
    }))
}

pub(super) fn absolute_to_logical(config: &Config, input: &Path) -> AppResult<String> {
    let canonical = fs::canonicalize(input).map_err(AppError::io)?;
    for root in &config.roots {
        let Ok(root_path) = fs::canonicalize(&root.path) else {
            continue;
        };
        if let Ok(relative) = canonical.strip_prefix(root_path) {
            let relative = relative.to_string_lossy().replace('\\', "/");
            return Ok(if config.named_roots() {
                if relative.is_empty() {
                    root.name.clone()
                } else {
                    format!("{}/{relative}", root.name)
                }
            } else {
                relative
            });
        }
    }
    Err(AppError::forbidden("Outside configured media directories"))
}

fn mount_paths(contents: &str) -> Vec<PathBuf> {
    contents
        .lines()
        .filter_map(|line| {
            let (fields, device) = line.split_once(" - ")?;
            let kind = device.split_whitespace().next()?;
            if !matches!(
                kind,
                "ext2"
                    | "ext3"
                    | "ext4"
                    | "btrfs"
                    | "xfs"
                    | "zfs"
                    | "vfat"
                    | "exfat"
                    | "ntfs"
                    | "ntfs3"
                    | "fuseblk"
                    | "iso9660"
                    | "udf"
                    | "nfs"
                    | "nfs4"
                    | "cifs"
                    | "fuse.sshfs"
            ) {
                return None;
            }
            let path = fields
                .split_whitespace()
                .nth(4)?
                .replace("\\040", " ")
                .replace("\\011", "\t")
                .replace("\\012", "\n")
                .replace("\\134", "\\");
            let path = PathBuf::from(path);
            if path == Path::new("/")
                || path == Path::new("/home")
                || [
                    "/boot", "/efi", "/etc", "/usr", "/var", "/opt", "/srv", "/root", "/tmp",
                    "/dev", "/proc", "/sys", "/snap", "/swap",
                ]
                .iter()
                .any(|system| path.starts_with(system))
                || (path.starts_with("/run") && !path.starts_with("/run/media"))
            {
                return None;
            }
            Some(path)
        })
        .collect()
}

fn desktop_places(config: &Config) -> Value {
    let mut places = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut add = |name: String, absolute: PathBuf, kind: &str| {
        if !absolute.is_dir() {
            return;
        }
        let Ok(path) = absolute_to_logical(config, &absolute) else {
            return;
        };
        if seen.insert(path.clone()) {
            places.push(json!({"name":name,"path":path,"kind":kind}));
        }
    };
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        add("Home".into(), home.clone(), "home");
        let config_home = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".config"));
        let user_dirs = fs::read_to_string(config_home.join("user-dirs.dirs")).unwrap_or_default();
        for (key, label) in [
            ("DESKTOP", "Desktop"),
            ("DOWNLOAD", "Downloads"),
            ("DOCUMENTS", "Documents"),
            ("PICTURES", "Pictures"),
            ("MUSIC", "Music"),
            ("VIDEOS", "Videos"),
        ] {
            let prefix = format!("XDG_{key}_DIR=");
            let configured = user_dirs.lines().find_map(|line| {
                let value = line
                    .trim()
                    .strip_prefix(&prefix)?
                    .trim()
                    .strip_prefix('"')?
                    .strip_suffix('"')?;
                if let Some(relative) = value.strip_prefix("$HOME/") {
                    Some(home.join(relative))
                } else if value == "$HOME" {
                    Some(home.clone())
                } else {
                    let path = PathBuf::from(value);
                    path.is_absolute().then_some(path)
                }
            });
            add(
                label.into(),
                configured.unwrap_or_else(|| home.join(label)),
                "folder",
            );
        }
    }
    for root in &config.roots {
        add(
            if root.path == Path::new("/") {
                "Files".into()
            } else {
                root.name.clone()
            },
            root.path.clone(),
            "root",
        );
    }
    if let Ok(contents) = fs::read_to_string("/proc/self/mountinfo") {
        for path in mount_paths(&contents) {
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            add(name, path, "mount");
        }
    }
    json!({"places":places})
}

async fn sidebar_folder(
    State(state): State<Shared>,
    Json(request): Json<ResolveRequest>,
) -> AppResult<Json<Value>> {
    if !state.config.desktop_mode {
        return Err(AppError::not_found("Desktop mode is disabled"));
    }
    let candidate = crate::logical_path::normalize(&request.path);
    let pinned = !request.absolute
        && state.settings.read()?["sidebarFolders"]
            .as_array()
            .is_some_and(|paths| paths.iter().any(|path| path.as_str() == Some(&candidate)));
    let path = if pinned {
        candidate
    } else {
        let target = resolve_path(&state.config, request)?;
        if target["isDirectory"] != true {
            return Err(AppError::bad("Choose a folder"));
        }
        target["path"]
            .as_str()
            .ok_or_else(|| AppError::bad("Invalid folder"))?
            .to_owned()
    };
    let result = state
        .settings
        .execute(crate::settings_persistence::SettingsCommand::ToggleSidebarFolder { path })?;
    let _ = state
        .admin_events
        .send(json!({"type":"settings-changed","timestamp":crate::app::timestamp_ms()}));
    Ok(Json(result))
}

async fn places(State(state): State<Shared>) -> AppResult<Json<Value>> {
    if !state.config.desktop_mode {
        return Err(AppError::not_found("Desktop mode is disabled"));
    }
    tokio::task::spawn_blocking(move || desktop_places(&state.config))
        .await
        .map(Json)
        .map_err(|error| AppError::internal(error.to_string()))
}

async fn resolve(
    State(state): State<Shared>,
    Json(request): Json<ResolveRequest>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || resolve_path(&state.config, request))
        .await
        .map_err(|error| AppError::internal(error.to_string()))?
        .map(Json)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RestoreRequest {
    id: String,
}

async fn trash_list(State(state): State<Shared>) -> AppResult<Json<Value>> {
    crate::desktop_trash::require(&state.config)?;
    #[cfg(target_os = "linux")]
    return tokio::task::spawn_blocking(move || crate::desktop_trash::list(&state.config))
        .await
        .map_err(|error| AppError::internal(error.to_string()))?
        .map(Json);
    #[cfg(not(target_os = "linux"))]
    Ok(Json(json!({"entries": []})))
}

async fn trash_restore(
    State(state): State<Shared>,
    Json(request): Json<RestoreRequest>,
) -> AppResult<Json<Value>> {
    crate::desktop_trash::require(&state.config)?;
    #[cfg(target_os = "linux")]
    {
        let _guard = state.file_mutations.lock().await;
        let worker = state.clone();
        let path = tokio::task::spawn_blocking(move || {
            crate::desktop_trash::restore(&worker.config, &request.id)
        })
        .await
        .map_err(|error| AppError::internal(error.to_string()))??;
        crate::app::emit(&state, &path);
        return Ok(Json(json!({"path":path})));
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = request;
        Err(AppError::not_found("Desktop trash is unavailable"))
    }
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/desktop/resolve", post(resolve))
        .route("/api/desktop/places", get(places))
        .route("/api/desktop/sidebar", post(sidebar_folder))
        .route("/api/desktop/trash", get(trash_list))
        .route("/api/desktop/trash/restore", post(trash_restore))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mount_list_hides_system_mounts_but_keeps_user_storage() {
        let paths = [
            "/",
            "/home",
            "/var/cache/pacman/pkg",
            "/var/log",
            "/efi",
            "/boot/efi",
            "/usr",
            "/etc",
            "/opt",
            "/run/system/service",
            "/mnt/trash",
            "/mnt/backups",
            "/mnt/data",
            "/media/USB",
            "/run/media/user/Drive",
            "/home/user/Network",
            "/data",
        ];
        let mounts = paths
            .iter()
            .enumerate()
            .map(|(index, path)| format!("{index} 0 8:1 / {path} rw - ext4 /dev/sda1 rw"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            mount_paths(&mounts),
            [
                "/mnt/trash",
                "/mnt/backups",
                "/mnt/data",
                "/media/USB",
                "/run/media/user/Drive",
                "/home/user/Network",
                "/data",
            ]
            .map(PathBuf::from)
            .to_vec()
        );
    }

    #[test]
    fn mount_list_decodes_names_and_ignores_kernel_filesystems() {
        let mounts = "1 0 8:1 / / rw - ext4 /dev/sda1 rw\n2 1 0:1 / /proc rw - proc proc rw\n3 1 8:2 / /run/media/user/My\\040Drive rw - exfat /dev/sdb1 rw\n4 1 0:2 / /mnt/nas rw - cifs //nas/files rw";
        assert_eq!(
            mount_paths(mounts),
            vec![
                PathBuf::from("/run/media/user/My Drive"),
                PathBuf::from("/mnt/nas")
            ]
        );
    }
}
