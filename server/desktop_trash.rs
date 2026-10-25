use crate::{
    config::Config,
    error::{AppError, AppResult},
};

pub fn available(config: &Config) -> bool {
    config.desktop_mode && cfg!(target_os = "linux")
}

pub fn require(config: &Config) -> AppResult<()> {
    if available(config) {
        Ok(())
    } else {
        Err(AppError::not_found("Desktop trash is unavailable"))
    }
}

#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use crate::{file_mutation::content_hash, media};
    use serde_json::{Value, json};
    use std::{
        fs,
        path::{Path, PathBuf},
    };
    use trash::TrashItem;

    fn error(error: trash::Error) -> AppError {
        AppError::bad(format!("Trash operation failed: {error}"))
    }

    fn key(item: &TrashItem) -> String {
        let mut identity = item.id.as_encoded_bytes().to_vec();
        identity.extend_from_slice(&item.time_deleted.to_le_bytes());
        if let Ok(metadata) = fs::symlink_metadata(&item.id) {
            use std::os::unix::fs::MetadataExt;
            identity.extend_from_slice(&metadata.ino().to_le_bytes());
            identity.extend_from_slice(&metadata.mtime_nsec().to_le_bytes());
        }
        content_hash(&identity)
    }

    fn stored_path(item: &TrashItem) -> AppResult<PathBuf> {
        let info = Path::new(&item.id);
        let name = info
            .file_stem()
            .ok_or_else(|| AppError::bad("Invalid trash entry"))?;
        if name == "." || name == ".." {
            return Err(AppError::bad("Invalid trash entry"));
        }
        let root = info
            .parent()
            .and_then(Path::parent)
            .ok_or_else(|| AppError::bad("Invalid trash entry"))?;
        Ok(root.join("files").join(name))
    }

    fn logical_path(config: &Config, original: &Path) -> AppResult<String> {
        for root in &config.roots {
            let Ok(canonical_root) = fs::canonicalize(&root.path) else {
                continue;
            };
            let Ok(relative) = original.strip_prefix(&canonical_root) else {
                continue;
            };
            let Some(relative) = relative.to_str() else {
                continue;
            };
            if relative.is_empty() {
                continue;
            }
            let path = if config.roots.len() > 1 {
                format!("{}/{relative}", root.name)
            } else {
                relative.to_string()
            };
            let resolved = media::resolve(config, &path)?;
            if resolved.relative.is_empty() {
                continue;
            }
            return Ok(path);
        }
        Err(AppError::forbidden("Outside configured media directories"))
    }

    fn trash_items(paths: &[PathBuf]) -> AppResult<Vec<TrashItem>> {
        let home_bin = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
            .ok_or_else(|| AppError::bad("Home trash directory is unavailable"))?
            .join("Trash");
        let home_bin = fs::canonicalize(&home_bin).unwrap_or(home_bin);
        let uid = rustix::process::getuid().as_raw();
        let mut bins = vec![(home_bin, PathBuf::from("/"))];
        let mounts = fs::read_to_string("/proc/self/mountinfo").map_err(AppError::io)?;
        for line in mounts.lines() {
            let Some((fields, filesystem)) = line.split_once(" - ") else {
                continue;
            };
            let kind = filesystem.split_whitespace().next().unwrap_or("");
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
                    | "tmpfs"
            ) {
                continue;
            }
            let Some(mount) = fields.split_whitespace().nth(4) else {
                continue;
            };
            let mount = PathBuf::from(
                mount
                    .replace("\\040", " ")
                    .replace("\\011", "\t")
                    .replace("\\012", "\n")
                    .replace("\\134", "\\"),
            );
            if !paths
                .iter()
                .any(|path| path.starts_with(&mount) || mount.starts_with(path))
            {
                continue;
            }
            bins.push((mount.join(format!(".Trash-{uid}")), mount.clone()));
            bins.push((mount.join(".Trash").join(uid.to_string()), mount));
        }
        let mut seen = std::collections::HashSet::new();
        let mut items = Vec::new();
        for (bin, mount) in bins {
            if !seen.insert(bin.clone()) {
                continue;
            }
            use std::os::unix::fs::MetadataExt;
            let Ok(metadata) = fs::symlink_metadata(&bin) else {
                continue;
            };
            if !metadata.is_dir() || metadata.uid() != uid {
                continue;
            }
            let Ok(entries) = fs::read_dir(bin.join("info")) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_none_or(|ext| ext != "trashinfo") {
                    continue;
                }
                let Ok(metadata) = fs::symlink_metadata(&path) else {
                    continue;
                };
                if !metadata.is_file() || metadata.len() > 65536 {
                    continue;
                }
                let Ok(info) = fs::read_to_string(&path) else {
                    continue;
                };
                if !info.lines().any(|line| line.trim() == "[Trash Info]") {
                    continue;
                }
                let Some(encoded) = info.lines().find_map(|line| line.strip_prefix("Path=")) else {
                    continue;
                };
                let Ok(decoded) = percent_encoding::percent_decode_str(encoded).decode_utf8()
                else {
                    continue;
                };
                let original = mount.join(decoded.as_ref());
                let (Some(name), Some(parent)) = (original.file_name(), original.parent()) else {
                    continue;
                };
                let deleted = info
                    .lines()
                    .find_map(|line| line.strip_prefix("DeletionDate="))
                    .and_then(|value| {
                        chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S").ok()
                    })
                    .and_then(|value| value.and_local_timezone(chrono::Local).earliest())
                    .map(|value| value.timestamp())
                    .unwrap_or(0);
                items.push(TrashItem {
                    id: path.into_os_string(),
                    name: name.to_os_string(),
                    original_parent: parent.to_path_buf(),
                    time_deleted: deleted,
                });
            }
        }
        Ok(items)
    }

    pub fn list(config: &Config) -> AppResult<Value> {
        require(config)?;
        let mut entries = Vec::new();
        for item in trash_items(
            &config
                .roots
                .iter()
                .map(|root| fs::canonicalize(&root.path).unwrap_or_else(|_| root.path.clone()))
                .collect::<Vec<_>>(),
        )? {
            let Ok(path) = logical_path(config, &item.original_path()) else {
                continue;
            };
            let Ok(stored) = stored_path(&item) else {
                continue;
            };
            let Ok(metadata) = fs::symlink_metadata(stored) else {
                continue;
            };
            entries.push(json!({
                "id": key(&item), "name": item.name.to_string_lossy(), "path": path,
                "deletedAt": item.time_deleted, "directory": metadata.is_dir(),
                "editable": media::editable(config, &path),
            }));
        }
        entries.sort_by(|a, b| b["deletedAt"].as_i64().cmp(&a["deletedAt"].as_i64()));
        Ok(json!({"entries": entries}))
    }

    pub fn move_to_trash(target: &Path) -> AppResult<TrashItem> {
        let parent = target
            .parent()
            .ok_or_else(|| AppError::bad("Cannot trash a root"))?;
        let original = fs::canonicalize(parent)
            .map_err(AppError::io)?
            .join(target.file_name().unwrap());
        let before: std::collections::HashSet<_> = trash_items(&[original.clone()])?
            .into_iter()
            .filter(|item| item.original_path() == original)
            .map(|item| item.id)
            .collect();
        trash::delete(target).map_err(error)?;
        trash_items(&[original.clone()])?.into_iter()
            .find(|item| item.original_path() == original && !before.contains(&item.id))
            .ok_or_else(|| AppError::internal("File was moved to the system trash, but its entry could not be located. Open the system trash to recover it."))
    }

    pub fn restore_item(item: &TrashItem) -> AppResult<()> {
        let source = stored_path(item)?;
        let target = item.original_path();
        if !item.original_parent.is_dir() {
            return Err(AppError::bad(
                "The original folder no longer exists. Recreate it before restoring this item.",
            ));
        }
        rustix::fs::renameat_with(rustix::fs::CWD, &source, rustix::fs::CWD, &target, rustix::fs::RenameFlags::NOREPLACE)
            .map_err(|error| if error == rustix::io::Errno::EXIST {
                AppError::conflict("An item with this name already exists in the original folder. Rename or move it before restoring.")
            } else { AppError::io(error.into()) })?;
        if let Err(error) = fs::remove_file(&item.id) {
            eprintln!("Restored trash item but could not remove its info file: {error}");
        }
        Ok(())
    }

    pub fn restore(config: &Config, id: &str) -> AppResult<String> {
        require(config)?;
        let item = trash_items(
            &config
                .roots
                .iter()
                .map(|root| fs::canonicalize(&root.path).unwrap_or_else(|_| root.path.clone()))
                .collect::<Vec<_>>(),
        )?
        .into_iter()
        .find(|item| key(item) == id)
        .ok_or_else(|| AppError::not_found("This trash item is no longer available"))?;
        let path = logical_path(config, &item.original_path())?;
        if !media::editable(config, &path) {
            return Err(AppError::forbidden("The original folder is read-only"));
        }
        restore_item(&item)?;
        Ok(path)
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use crate::test_support::TestApp;
    use std::fs;

    fn entry(app: &TestApp, name: &str) -> trash::TrashItem {
        let bin = app.directory.join("Trash");
        fs::create_dir_all(bin.join("info")).unwrap();
        fs::create_dir_all(bin.join("files")).unwrap();
        let info = bin.join("info").join(format!("{name}.trashinfo"));
        fs::write(&info, "test").unwrap();
        trash::TrashItem {
            id: info.into_os_string(),
            name: name.into(),
            original_parent: app.media.clone(),
            time_deleted: 1,
        }
    }

    #[tokio::test]
    async fn restoration_never_overwrites_an_existing_file_or_dangling_symlink() {
        let app = TestApp::new();
        let item = entry(&app, "note.txt");
        let stored = app.directory.join("Trash/files/note.txt");
        fs::write(&stored, "original").unwrap();
        let target = app.media.join("note.txt");
        fs::write(&target, "new").unwrap();
        assert_eq!(
            restore_item(&item).unwrap_err().0,
            axum::http::StatusCode::CONFLICT
        );
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        fs::remove_file(&target).unwrap();
        std::os::unix::fs::symlink(app.media.join("missing"), &target).unwrap();
        assert_eq!(
            restore_item(&item).unwrap_err().0,
            axum::http::StatusCode::CONFLICT
        );
        fs::remove_file(&target).unwrap();
        restore_item(&item).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        assert!(!stored.exists());
        assert!(!std::path::Path::new(&item.id).exists());
    }

    #[tokio::test]
    async fn restoring_directory_symlink_preserves_the_link_and_its_target() {
        let app = TestApp::new();
        let item = entry(&app, "linked-folder");
        let target = app.media.join("actual");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep.txt"), "keep").unwrap();
        std::os::unix::fs::symlink(&target, app.directory.join("Trash/files/linked-folder"))
            .unwrap();
        restore_item(&item).unwrap();
        assert!(
            fs::symlink_metadata(app.media.join("linked-folder"))
                .unwrap()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(target.join("keep.txt")).unwrap(), "keep");
    }
}
