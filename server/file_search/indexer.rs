use super::{db::IndexDb, normalize_relative, parent_relative, types::*};
use crate::{config::FileSearchConfig, media};
use rusqlite::params;
use std::{
    fs,
    path::Path,
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const ENTRY_BATCH_SIZE: usize = 2_000;

pub(super) fn full_scan(db: &mut IndexDb, root: &Root) -> Result<(), String> {
    let existing = db.root_row(&root.id)?;
    let generation = existing.as_ref().map_or(1, |row| row.generation + 1);
    db.execute("DELETE FROM crawl_queue WHERE root_id=?", [&root.id])?;
    db.execute("UPDATE roots SET state='building',generation=?,scanned_directories=0,error=NULL,refresh_mode='polling' WHERE root_id=?", params![generation,root.id])?;
    let result = (|| {
        let metadata = fs::metadata(&root.path).map_err(io_err)?;
        if !metadata.is_dir() {
            return Err("Media root is not a directory".into());
        }
        db.enqueue_crawl(&root.id, "", generation)?;
        let complete = drain_crawl(db, root, generation)?;
        if complete {
            db.execute(
                "DELETE FROM entries WHERE root_id=? AND generation<>?",
                params![root.id, generation],
            )?;
        }
        let count = db.count(&root.id)?;
        db.execute(
            "UPDATE roots SET state=?,indexed_entries=?,last_complete_at=?,error=? WHERE root_id=?",
            params![
                if complete { "ready" } else { "partial" },
                count,
                if complete {
                    Some(now_ms())
                } else {
                    existing.as_ref().and_then(|row| row.last_complete_at)
                },
                if complete {
                    None::<String>
                } else {
                    Some("Some directories could not be read".to_string())
                },
                root.id
            ],
        )?;
        if complete {
            db.checkpoint(true);
        }
        Ok(())
    })();
    if let Err(error) = &result {
        db.execute(
            "UPDATE roots SET state='error',error=?,refresh_mode='degraded' WHERE root_id=?",
            params![error, root.id],
        )?;
    }
    result
}

fn drain_crawl(db: &mut IndexDb, root: &Root, generation: i64) -> Result<bool, String> {
    let mut complete = true;
    while let Some(path) = db.next_crawl(&root.id, generation)? {
        if let Err(error) = process_directory(db, root, &path, generation) {
            complete = false;
            db.execute(
                "UPDATE roots SET state='partial',error=? WHERE root_id=?",
                params![error, root.id],
            )?;
        }
        db.execute(
            "DELETE FROM crawl_queue WHERE root_id=? AND relative_path=?",
            params![root.id, path],
        )?;
    }
    Ok(complete)
}

fn process_directory(
    db: &mut IndexDb,
    root: &Root,
    relative: &str,
    generation: i64,
) -> Result<(), String> {
    let absolute = root.path.join(native(relative));
    let metadata = fs::metadata(&absolute).map_err(io_err)?;
    if !metadata.is_dir() {
        return Err("Path is not a directory".into());
    }
    write_directory_times(db, root, relative, &metadata)?;
    let mut batch = Vec::with_capacity(ENTRY_BATCH_SIZE);
    for item in fs::read_dir(&absolute).map_err(io_err)? {
        let item = item.map_err(io_err)?;
        let file_type = item.file_type().map_err(io_err)?;
        if file_type.is_symlink() {
            continue;
        }
        let (is_directory, is_file) = if file_type.is_dir() {
            (true, false)
        } else if file_type.is_file() {
            (false, true)
        } else {
            let metadata = item.metadata().map_err(io_err)?;
            (metadata.is_dir(), metadata.is_file())
        };
        if !is_directory && !is_file {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        let child = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        if excluded(&child, is_directory) {
            continue;
        }
        batch.push(make_entry(
            child,
            relative.into(),
            name,
            is_directory,
            generation,
            0,
            true,
        ));
        if batch.len() == ENTRY_BATCH_SIZE {
            db.write_entries(&root.id, &batch)?;
            batch.clear();
        }
    }
    db.write_entries(&root.id, &batch)?;
    db.execute(
        "UPDATE roots SET scanned_directories=scanned_directories+1 WHERE root_id=?",
        [&root.id],
    )?;
    Ok(())
}

pub(super) fn rescan_directory(
    db: &mut IndexDb,
    root: &Root,
    relative_raw: &str,
    token: i64,
) -> Result<(), String> {
    let relative = normalize_relative(relative_raw);
    let row = match db.root_row(&root.id)? {
        Some(row) => row,
        None => return Ok(()),
    };
    let generation = row.generation.max(1);
    let absolute = root.path.join(native(&relative));
    let scan = (|| {
        let metadata = fs::metadata(&absolute).map_err(io_err)?;
        if !metadata.is_dir() {
            return Err("Path is not a directory".into());
        }
        write_directory_times(db, root, &relative, &metadata)?;
        let mut batch = Vec::with_capacity(ENTRY_BATCH_SIZE);
        for item in fs::read_dir(&absolute).map_err(io_err)? {
            let item = item.map_err(io_err)?;
            let file_type = item.file_type().map_err(io_err)?;
            if file_type.is_symlink() {
                continue;
            }
            let (is_directory, is_file) = if file_type.is_dir() {
                (true, false)
            } else if file_type.is_file() {
                (false, true)
            } else {
                let metadata = item.metadata().map_err(io_err)?;
                (metadata.is_dir(), metadata.is_file())
            };
            if !is_directory && !is_file {
                continue;
            }
            let name = item.file_name().to_string_lossy().into_owned();
            let child = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if excluded(&child, is_directory) {
                continue;
            }
            let queue = is_directory && !db.directory_exists(&root.id, &child)?;
            batch.push(make_entry(
                child,
                relative.clone(),
                name,
                is_directory,
                generation,
                token,
                queue,
            ));
            if batch.len() == ENTRY_BATCH_SIZE {
                db.write_entries(&root.id, &batch)?;
                batch.clear();
            }
        }
        db.write_entries(&root.id, &batch)?;
        loop {
            let stale = db.stale_child_directories(&root.id, &relative, token)?;
            if stale.is_empty() {
                break;
            }
            for path in stale {
                delete_subtree(db, &root.id, &path)?;
            }
        }
        db.execute("DELETE FROM entries WHERE root_id=? AND parent_path=? AND seen_token<>? AND is_directory=0",params![root.id,relative,token])?;
        let complete = drain_crawl(db, root, generation)?;
        let count = db.count(&root.id)?;
        db.execute(
            "UPDATE roots SET state=?,indexed_entries=?,error=? WHERE root_id=?",
            params![
                if complete { "ready" } else { "partial" },
                count,
                if complete {
                    None::<String>
                } else {
                    Some("Some directories could not be read".to_string())
                },
                root.id
            ],
        )?;
        Ok(())
    })();
    if let Err(error) = &scan {
        if !absolute.exists() {
            if relative.is_empty() {
                db.execute("UPDATE roots SET state='error',refresh_mode='degraded',error=? WHERE root_id=?",params![error,root.id])?;
            } else {
                delete_subtree(db, &root.id, &relative)?;
            }
        } else {
            db.execute(
                "UPDATE roots SET state='partial',error=? WHERE root_id=?",
                params![error, root.id],
            )?;
        }
    }
    scan
}

pub(super) fn reconcile(
    db: &mut IndexDb,
    root: &Root,
    config: &FileSearchConfig,
    token: &mut i64,
) -> Result<(), String> {
    let Some(row) = db.root_row(&root.id)? else {
        return Ok(());
    };
    db.execute(
        "UPDATE roots SET state='refreshing' WHERE root_id=?",
        [&root.id],
    )?;
    let metadata = match fs::metadata(&root.path) {
        Ok(value) => value,
        Err(error) => {
            let error = error.to_string();
            db.execute(
                "UPDATE roots SET state='error',refresh_mode='degraded',error=? WHERE root_id=?",
                params![error, root.id],
            )?;
            return Err(error);
        }
    };
    let root_birth = birth_ms(&metadata);
    if row.root_birthtime.is_none() || root_birth != row.root_birthtime {
        return full_scan(db, root);
    }
    if row.root_mtime.is_none() || Some(modified_ms(&metadata)) != row.root_mtime {
        *token += 1;
        let _ = rescan_directory(db, root, "", *token);
    }
    let mut cursor = 0;
    loop {
        let dirs = db.directory_page(&root.id, cursor, config.reconcile_directories_per_second)?;
        if dirs.is_empty() {
            break;
        }
        cursor = dirs.last().unwrap().id;
        let (sender, receiver) = mpsc::channel();
        let next = std::sync::atomic::AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..config.max_fs_concurrency.min(dirs.len() as u32) {
                let sender = sender.clone();
                let next = &next;
                let base = &root.path;
                let dirs = &dirs;
                scope.spawn(move || {
                    loop {
                        let index = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(directory) = dirs.get(index) else {
                            break;
                        };
                        let changed =
                            match fs::metadata(base.join(native(&directory.relative_path))) {
                                Ok(info) => {
                                    directory.mtime != Some(modified_ms(&info))
                                        || directory.birthtime != birth_ms(&info)
                                }
                                Err(_) => true,
                            };
                        let _ = sender.send((directory.relative_path.clone(), changed));
                    }
                });
            }
        });
        drop(sender);
        for (path, changed) in receiver {
            if changed {
                *token += 1;
                let target = if root.path.join(native(&path)).exists() {
                    path
                } else {
                    parent_relative(&path)
                };
                let _ = rescan_directory(db, root, &target, *token);
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    if db
        .root_row(&root.id)?
        .is_some_and(|latest| latest.state == "refreshing")
    {
        db.execute(
            "UPDATE roots SET state='ready',error=NULL WHERE root_id=?",
            [&root.id],
        )?;
    }
    Ok(())
}

fn write_directory_times(
    db: &IndexDb,
    root: &Root,
    relative: &str,
    metadata: &fs::Metadata,
) -> Result<(), String> {
    if relative.is_empty() {
        db.execute(
            "UPDATE roots SET root_mtime=?,root_birthtime=? WHERE root_id=?",
            params![modified_ms(metadata), birth_ms(metadata), root.id],
        )?;
    } else {
        db.execute("UPDATE entries SET directory_mtime=?,directory_birthtime=? WHERE root_id=? AND relative_path=?",params![modified_ms(metadata),birth_ms(metadata),root.id,relative])?;
    }
    Ok(())
}
fn delete_subtree(db: &IndexDb, root_id: &str, path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Ok(());
    }
    let pattern = format!("{}/%", escape_like(path));
    db.execute("DELETE FROM entries WHERE root_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\')",params![root_id,path,pattern])?;
    Ok(())
}
fn make_entry(
    relative_path: String,
    parent_path: String,
    name: String,
    is_directory: bool,
    generation: i64,
    seen_token: i64,
    queue_directory: bool,
) -> IndexedEntry {
    let extension = if is_directory {
        String::new()
    } else {
        Path::new(&name)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase()
    };
    let media_type = if is_directory {
        "folder".into()
    } else {
        media::media_type(&extension).into()
    };
    IndexedEntry {
        relative_path,
        parent_path,
        name,
        is_directory,
        extension,
        media_type,
        generation,
        seen_token,
        queue_directory,
    }
}
fn excluded(relative: &str, directory: bool) -> bool {
    let parts = relative
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        if excluded_folder(part) {
            return true;
        }
    }
    let name = parts.last().copied().unwrap_or("");
    if directory {
        excluded_folder(name)
    } else {
        [
            "pagefile.sys",
            "swapfile.sys",
            "hiberfil.sys",
            "DumpStack.log",
            "DumpStack.log.tmp",
            "desktop.ini",
            "Thumbs.db",
            ".DS_Store",
        ]
        .contains(&name)
    }
}
fn excluded_folder(name: &str) -> bool {
    name.starts_with('.')
        || [
            "node_modules",
            "$RECYCLE.BIN",
            "System Volume Information",
            ".git",
            ".svn",
            ".hg",
            "__pycache__",
            ".DS_Store",
        ]
        .contains(&name)
}
fn native(relative: &str) -> std::path::PathBuf {
    relative
        .split('/')
        .filter(|part| !part.is_empty())
        .collect()
}
fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}
fn modified_ms(metadata: &fs::Metadata) -> f64 {
    system_ms(metadata.modified().unwrap_or(UNIX_EPOCH))
}
fn birth_ms(metadata: &fs::Metadata) -> Option<f64> {
    metadata
        .created()
        .ok()
        .map(system_ms)
        .or_else(|| platform_birth_ms(metadata))
}

pub(super) fn metadata_birth_ms(metadata: &fs::Metadata) -> Option<f64> {
    birth_ms(metadata)
}
#[cfg(unix)]
fn platform_birth_ms(metadata: &fs::Metadata) -> Option<f64> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.ctime() as f64 * 1_000.0 + metadata.ctime_nsec() as f64 / 1_000_000.0)
}
#[cfg(not(unix))]
fn platform_birth_ms(_metadata: &fs::Metadata) -> Option<f64> {
    None
}
fn system_ms(value: SystemTime) -> f64 {
    value
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1_000.0
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn io_err(error: std::io::Error) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::FileSearchConfig;
    #[test]
    fn exclusions_match_backend_policy() {
        assert!(excluded("node_modules/a.js", false));
        assert!(excluded(".hidden", true));
        assert!(excluded("Thumbs.db", false));
        assert!(!excluded("notes/.draft.md", false));
    }

    #[test]
    fn full_and_targeted_scans_persist_searchable_state() {
        let base = std::env::temp_dir().join(format!("derp-rust-search-{}", uuid::Uuid::new_v4()));
        let root_path = base.join("media");
        std::fs::create_dir_all(root_path.join("nested")).unwrap();
        std::fs::write(root_path.join("Needle One.md"), "one").unwrap();
        std::fs::write(root_path.join("nested").join("Needle Two.txt"), "two").unwrap();
        let config = FileSearchConfig {
            enabled: true,
            index_path: base.join("index.sqlite"),
            watch_mode: "off".into(),
            max_recursive_watchers: 0,
            max_fs_concurrency: 2,
            reconcile_directories_per_second: 64,
        };
        let root = Root {
            id: "root".into(),
            name: "Media".into(),
            path: root_path.clone(),
            source: "config".into(),
        };
        {
            let mut db = IndexDb::open_or_recover(&config).unwrap();
            assert_eq!(
                db.sync_roots(std::slice::from_ref(&root)).unwrap(),
                ["root"]
            );
            full_scan(&mut db, &root).unwrap();
            assert_eq!(db.status(0).unwrap().state, "ready");
            assert_eq!(db.search_rows("\"needle\"").unwrap().len(), 2);

            std::fs::write(root_path.join("Fresh Target.md"), "fresh").unwrap();
            rescan_directory(&mut db, &root, "", 10).unwrap();
            assert_eq!(db.search_rows("\"fresh\"").unwrap().len(), 1);

            std::fs::remove_file(root_path.join("nested").join("Needle Two.txt")).unwrap();
            rescan_directory(&mut db, &root, "nested", 11).unwrap();
            assert_eq!(db.search_rows("\"needle\"").unwrap().len(), 1);
        }
        {
            let db = IndexDb::open_or_recover(&config).unwrap();
            assert_eq!(db.search_rows("\"fresh\"").unwrap().len(), 1);
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn corrupt_database_is_rebuilt_and_reindexed() {
        let base = std::env::temp_dir().join(format!(
            "derp-rust-search-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        let root_path = base.join("media");
        std::fs::create_dir_all(&root_path).unwrap();
        std::fs::write(root_path.join("Persistent Note.txt"), "note").unwrap();
        let config = FileSearchConfig {
            enabled: true,
            index_path: base.join("index").join("files.sqlite"),
            watch_mode: "off".into(),
            max_recursive_watchers: 0,
            max_fs_concurrency: 2,
            reconcile_directories_per_second: 32,
        };
        let root = Root {
            id: "root".into(),
            name: "Media".into(),
            path: root_path,
            source: "config".into(),
        };
        {
            let mut db = IndexDb::open_or_recover(&config).unwrap();
            db.sync_roots(std::slice::from_ref(&root)).unwrap();
            full_scan(&mut db, &root).unwrap();
        }
        std::fs::write(&config.index_path, "not a sqlite database").unwrap();
        let mut recovered = IndexDb::open_or_recover(&config).unwrap();
        assert_eq!(
            recovered.sync_roots(std::slice::from_ref(&root)).unwrap(),
            ["root"]
        );
        full_scan(&mut recovered, &root).unwrap();
        assert_eq!(recovered.search_rows("\"persistent\"").unwrap().len(), 1);
        drop(recovered);
        std::fs::remove_dir_all(base).unwrap();
    }
}
