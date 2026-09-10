use crate::error::{AppError, AppResult};
use axum::http::StatusCode;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard, Semaphore};

#[derive(Clone)]
pub(crate) struct PlaybackCache(Arc<Inner>);

struct Inner {
    directory: PathBuf,
    limit: u64,
    entries: Mutex<HashMap<PathBuf, Entry>>,
    locks: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
    pub video: Arc<Semaphore>,
    pub extraction: Arc<Semaphore>,
}

struct Entry {
    bytes: u64,
    used: SystemTime,
    readers: usize,
    complete: bool,
}

pub(crate) struct CacheLease {
    cache: PlaybackCache,
    pub path: PathBuf,
}

pub(crate) struct CacheWriter {
    lease: CacheLease,
    destination: PathBuf,
    file: tokio::fs::File,
    complete: bool,
}

impl PlaybackCache {
    pub fn new(data_path: &Path, limit: u64) -> Self {
        let directory = data_path.join("playback-cache");
        let mut entries = HashMap::new();
        for root in [&directory, &data_path.join("audio-extracts")] {
            if let Ok(files) = fs::read_dir(root) {
                for file in files.flatten() {
                    let path = file.path();
                    let Ok(metadata) = file.metadata() else {
                        continue;
                    };
                    if !metadata.is_file() {
                        continue;
                    }
                    if path
                        .extension()
                        .is_some_and(|extension| extension == "part" || extension == "tmp")
                    {
                        let _ = fs::remove_file(path);
                        continue;
                    }
                    entries.insert(
                        path,
                        Entry {
                            bytes: metadata.len(),
                            used: metadata.modified().unwrap_or(UNIX_EPOCH),
                            readers: 0,
                            complete: true,
                        },
                    );
                }
            }
        }
        let cache = Self(Arc::new(Inner {
            directory,
            limit,
            entries: Mutex::new(entries),
            locks: Mutex::new(HashMap::new()),
            video: Arc::new(Semaphore::new(1)),
            extraction: Arc::new(Semaphore::new(2)),
        }));
        let _ = cache.make_room(0);
        cache
    }

    pub fn video_slots(&self) -> Arc<Semaphore> {
        self.0.video.clone()
    }
    pub fn extraction_slots(&self) -> Arc<Semaphore> {
        self.0.extraction.clone()
    }

    pub fn key(path: &Path, options: &str) -> AppResult<String> {
        let path = fs::canonicalize(path).map_err(AppError::io)?;
        let metadata = fs::metadata(&path).map_err(AppError::io)?;
        let modified = metadata
            .modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let value = format!(
            "playback-v1:{}:{modified}:{}:{options}",
            path.display(),
            metadata.len()
        );
        Ok(Sha256::digest(value.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    pub async fn lock(&self, key: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let mut locks = self.0.locks.lock().unwrap();
            locks.retain(|_, value| value.strong_count() > 0);
            let lock = locks
                .get(key)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| Arc::new(AsyncMutex::new(())));
            locks.insert(key.into(), Arc::downgrade(&lock));
            lock
        };
        lock.lock_owned().await
    }

    pub fn get(&self, key: &str) -> Option<CacheLease> {
        let path = self.0.directory.join(key);
        let mut entries = self.0.entries.lock().unwrap();
        let entry = entries.get_mut(&path)?;
        if !entry.complete || !path.is_file() {
            return None;
        }
        entry.readers += 1;
        entry.used = SystemTime::now();
        let _ = filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(entry.used));
        Some(CacheLease {
            cache: self.clone(),
            path,
        })
    }

    fn make_room_locked(
        &self,
        entries: &mut HashMap<PathBuf, Entry>,
        additional: u64,
    ) -> AppResult<()> {
        let mut total = entries.values().map(|entry| entry.bytes).sum::<u64>();
        if total.saturating_add(additional) <= self.0.limit {
            return Ok(());
        }
        let mut candidates = entries
            .iter()
            .filter(|(_, entry)| entry.readers == 0 && entry.complete)
            .map(|(path, entry)| (path.clone(), entry.used))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|(_, used)| *used);
        for (path, _) in candidates {
            match fs::remove_file(&path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => continue,
            }
            if let Some(entry) = entries.remove(&path) {
                total = total.saturating_sub(entry.bytes);
            }
            if total.saturating_add(additional) <= self.0.limit {
                return Ok(());
            }
        }
        Err(AppError(StatusCode::INSUFFICIENT_STORAGE, "Playback cache limit reached. Close another playback or increase playback.maxCacheSize in config.jsonc.".into()))
    }

    fn make_room(&self, additional: u64) -> AppResult<()> {
        self.make_room_locked(&mut self.0.entries.lock().unwrap(), additional)
    }

    pub async fn begin(&self, key: &str) -> AppResult<CacheWriter> {
        fs::create_dir_all(&self.0.directory).map_err(AppError::io)?;
        self.make_room(1)?;
        let path = self
            .0
            .directory
            .join(format!("{}.part", uuid::Uuid::new_v4()));
        let file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
            .map_err(AppError::io)?;
        self.0.entries.lock().unwrap().insert(
            path.clone(),
            Entry {
                bytes: 0,
                used: SystemTime::now(),
                readers: 1,
                complete: false,
            },
        );
        Ok(CacheWriter {
            lease: CacheLease {
                cache: self.clone(),
                path,
            },
            destination: self.0.directory.join(key),
            file,
            complete: false,
        })
    }

    #[cfg(test)]
    fn bytes(&self) -> u64 {
        self.0
            .entries
            .lock()
            .unwrap()
            .values()
            .map(|entry| entry.bytes)
            .sum()
    }
}

impl CacheWriter {
    pub async fn write(&mut self, bytes: &[u8]) -> AppResult<()> {
        {
            let cache = &self.lease.cache;
            let mut entries = cache.0.entries.lock().unwrap();
            cache.make_room_locked(&mut entries, bytes.len() as u64)?;
            entries.get_mut(&self.lease.path).unwrap().bytes += bytes.len() as u64;
        }
        self.file.write_all(bytes).await.map_err(AppError::io)
    }

    pub async fn finish(mut self) -> AppResult<CacheLease> {
        self.file.flush().await.map_err(AppError::io)?;
        let mut entries = self.lease.cache.0.entries.lock().unwrap();
        if entries
            .get(&self.lease.path)
            .is_none_or(|entry| entry.bytes == 0)
        {
            return Err(AppError::internal("Media processing produced no output"));
        }
        fs::rename(&self.lease.path, &self.destination).map_err(AppError::io)?;
        let mut entry = entries.remove(&self.lease.path).unwrap();
        entry.complete = true;
        entries.insert(self.destination.clone(), entry);
        self.complete = true;
        Ok(CacheLease {
            cache: self.lease.cache.clone(),
            path: self.destination.clone(),
        })
    }
}

impl Drop for CacheWriter {
    fn drop(&mut self) {
        if !self.complete {
            let _ = fs::remove_file(&self.lease.path);
            self.lease
                .cache
                .0
                .entries
                .lock()
                .unwrap()
                .remove(&self.lease.path);
        }
    }
}

impl Drop for CacheLease {
    fn drop(&mut self) {
        if let Some(entry) = self.cache.0.entries.lock().unwrap().get_mut(&self.path) {
            entry.readers = entry.readers.saturating_sub(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn quota_counts_temporary_output_and_protects_readers() {
        let directory =
            std::env::temp_dir().join(format!("playback-cache-{}", uuid::Uuid::new_v4()));
        let cache = PlaybackCache::new(&directory, 12);
        let mut first = cache.begin("first").await.unwrap();
        first.write(b"12345678").await.unwrap();
        let lease = first.finish().await.unwrap();
        let mut second = cache.begin("second").await.unwrap();
        second.write(b"abcd").await.unwrap();
        assert!(second.write(b"e").await.is_err());
        assert_eq!(cache.bytes(), 12);
        drop(lease);
        second.write(b"efgh").await.unwrap();
        assert_eq!(cache.bytes(), 8);
        assert!(cache.get("first").is_none());
        drop(second);
        assert_eq!(cache.bytes(), 0);
        assert!(
            fs::read_dir(directory.join("playback-cache"))
                .unwrap()
                .next()
                .is_none()
        );
        let _ = fs::remove_dir_all(directory);
    }
}
