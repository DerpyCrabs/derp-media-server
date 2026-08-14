use crate::{
    config::Config,
    error::{AppError, AppResult},
    media, path_metadata,
};
use axum::http::StatusCode;
use futures_util::future::BoxFuture;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::UNIX_EPOCH,
};
use tokio::{fs, io::AsyncWriteExt};

pub(crate) const MAX_UPLOAD_BYTES: u64 = 10_000_000_000;
pub(crate) const MAX_UPLOAD_FILES: usize = 10_000;
pub(crate) const MAX_CONCURRENT_UPLOADS: usize = 4;
const TEMP_PREFIX: &str = ".derp-";

pub(crate) enum CreateContent<'a> {
    Folder,
    File(&'a [u8]),
}

#[derive(Debug)]
pub(crate) struct DeleteOutcome {
    pub is_directory: bool,
}

trait FileMetadataRepair: Send + Sync {
    fn content_replaced(&self, config: &Config, path: &str) -> AppResult<()>;

    fn moved<'a>(
        &'a self,
        config: &'a Config,
        old_path: &'a str,
        new_path: &'a str,
    ) -> BoxFuture<'a, AppResult<()>>;

    fn removed<'a>(&'a self, config: &'a Config, path: &'a str) -> BoxFuture<'a, AppResult<()>>;
}

struct PathMetadataRepair;

impl FileMetadataRepair for PathMetadataRepair {
    fn content_replaced(&self, config: &Config, path: &str) -> AppResult<()> {
        path_metadata::content_replaced(config, path)
    }

    fn moved<'a>(
        &'a self,
        config: &'a Config,
        old_path: &'a str,
        new_path: &'a str,
    ) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(path_metadata::moved(config, old_path, new_path))
    }

    fn removed<'a>(&'a self, config: &'a Config, path: &'a str) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(path_metadata::removed(config, path))
    }
}

pub(crate) struct FileCommandService {
    config: Config,
    metadata: Arc<dyn FileMetadataRepair>,
    max_upload_bytes: u64,
    operations: tokio::sync::Mutex<()>,
    upload_slots: Arc<tokio::sync::Semaphore>,
}

impl FileCommandService {
    pub fn new(config: Config) -> Self {
        Self {
            config,
            metadata: Arc::new(PathMetadataRepair),
            max_upload_bytes: MAX_UPLOAD_BYTES,
            operations: tokio::sync::Mutex::new(()),
            upload_slots: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_UPLOADS)),
        }
    }

    #[cfg(test)]
    fn with_metadata(
        config: Config,
        metadata: Arc<dyn FileMetadataRepair>,
        max_upload_bytes: u64,
    ) -> Self {
        Self {
            config,
            metadata,
            max_upload_bytes,
            operations: tokio::sync::Mutex::new(()),
            upload_slots: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_UPLOADS)),
        }
    }

    pub async fn create(&self, path: &str, content: CreateContent<'_>) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        require_path(path)?;
        if !media::editable(&self.config, &crate::app::parent_logical(path))
            && !media::editable(&self.config, path)
        {
            return Err(AppError::forbidden("Path is not in an editable folder"));
        }
        let destination = media::resolve(&self.config, path)?.full;
        if metadata_optional(&destination).await?.is_some() {
            return Err(AppError::conflict(format!(
                "A {} with this name already exists",
                if matches!(content, CreateContent::Folder) {
                    "folder"
                } else {
                    "file"
                }
            )));
        }
        match content {
            CreateContent::Folder => create_directory_atomically(&destination).await,
            CreateContent::File(bytes) => {
                let mut staged = self.stage(path, u64::MAX, "create").await?;
                staged.write_chunk(bytes).await?;
                self.finalize_new_file(staged, "create").await
            }
        }
    }

    pub async fn edit(
        &self,
        path: &str,
        content: &[u8],
        expected_version: Option<f64>,
    ) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        require_path(path)?;
        require_editable(&self.config, path, "Path is not in an editable folder")?;
        let destination = media::resolve(&self.config, path)?.full;
        let metadata = fs::symlink_metadata(&destination).await.map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AppError::not_found("File not found")
            } else {
                AppError::io(error)
            }
        })?;
        reject_symlink(&metadata)?;
        if metadata.is_dir() {
            return Err(AppError::conflict(
                "A folder cannot be replaced with a file",
            ));
        }
        if let Some(expected) = expected_version {
            let current = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            if (current - expected).abs() >= 1.0 {
                return Err(AppError::conflict(
                    "File changed since the replacement was prepared",
                ));
            }
        }
        let mut staged = self.stage(path, u64::MAX, "edit").await?;
        staged.write_chunk(content).await?;
        self.finalize_replacement(staged, "edit").await
    }

    pub async fn move_path(&self, old_path: &str, new_path: &str) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        if old_path.is_empty() || new_path.is_empty() {
            return Err(AppError::bad("Both oldPath and newPath are required"));
        }
        require_editable(
            &self.config,
            old_path,
            "Cannot rename: Source path is not in an editable folder",
        )?;
        require_editable(
            &self.config,
            new_path,
            "Cannot rename: Destination path is not in an editable folder",
        )?;
        let source = media::resolve(&self.config, old_path)?.full;
        let destination = media::resolve(&self.config, new_path)?.full;
        if metadata_optional(&destination).await?.is_some() {
            return Err(AppError::conflict(
                "Destination file or directory already exists",
            ));
        }
        let source_metadata = fs::symlink_metadata(&source).await.map_err(AppError::io)?;
        reject_symlink(&source_metadata)?;
        fs::rename(&source, &destination)
            .await
            .map_err(AppError::io)?;
        if let Err(error) = self.metadata.moved(&self.config, old_path, new_path).await {
            let compensation = fs::rename(&destination, &source).await;
            return Err(reconciliation_error(
                "move",
                old_path,
                error,
                compensation.err(),
            ));
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> AppResult<DeleteOutcome> {
        let _operation = self.operations.lock().await;
        require_path(path)?;
        require_editable(&self.config, path, "Path is not in an editable folder")?;
        let source = media::resolve(&self.config, path)?.full;
        let metadata = fs::symlink_metadata(&source).await.map_err(AppError::io)?;
        reject_symlink(&metadata)?;
        let is_directory = metadata.is_dir();
        let tombstone = unique_sibling(&source, "delete")?;
        fs::rename(&source, &tombstone)
            .await
            .map_err(AppError::io)?;
        if let Err(error) = self.metadata.removed(&self.config, path).await {
            let compensation = fs::rename(&tombstone, &source).await;
            return Err(reconciliation_error(
                "delete",
                path,
                error,
                compensation.err(),
            ));
        }
        let cleanup = if is_directory {
            fs::remove_dir_all(&tombstone).await
        } else {
            fs::remove_file(&tombstone).await
        };
        if let Err(error) = cleanup {
            return Err(AppError::needs_reconciliation(
                "delete",
                path,
                format!(
                    "File metadata was repaired, but recoverable delete cleanup failed: {error}"
                ),
            ));
        }
        Ok(DeleteOutcome { is_directory })
    }

    pub async fn begin_upload(&self, path: &str) -> AppResult<StagedUpload> {
        require_path(path)?;
        if !media::editable(&self.config, path)
            && !media::editable(&self.config, &crate::app::parent_logical(path))
        {
            return Err(AppError::forbidden(
                "Target path is not in an editable folder",
            ));
        }
        let permit = self
            .upload_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| AppError::internal("Upload staging is unavailable"))?;
        let mut staged = self.stage(path, self.max_upload_bytes, "upload").await?;
        staged._upload_permit = Some(permit);
        Ok(staged)
    }

    pub async fn finalize_uploads(&self, staged: Vec<StagedUpload>) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        self.finalize_replacements(staged, "upload").await
    }

    async fn stage(&self, path: &str, limit: u64, label: &str) -> AppResult<StagedUpload> {
        let destination = media::resolve(&self.config, path)?.full;
        let parent = destination
            .parent()
            .ok_or_else(|| AppError::bad("Invalid destination path"))?;
        fs::create_dir_all(parent).await.map_err(AppError::io)?;
        let temporary = unique_sibling(&destination, label)?;
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await
            .map_err(AppError::io)?;
        Ok(StagedUpload {
            logical: path.to_string(),
            destination,
            temporary,
            file: Some(file),
            bytes_written: 0,
            limit,
            finished: false,
            cleanup: true,
            _upload_permit: None,
        })
    }

    async fn finalize_new_file(
        &self,
        mut staged: StagedUpload,
        operation: &'static str,
    ) -> AppResult<()> {
        staged.finish().await?;
        if metadata_optional(&staged.destination).await?.is_some() {
            return Err(AppError::conflict(
                "Destination file or directory already exists",
            ));
        }
        fs::rename(&staged.temporary, &staged.destination)
            .await
            .map_err(AppError::io)?;
        staged.cleanup = false;
        if let Err(error) = self
            .metadata
            .content_replaced(&self.config, &staged.logical)
        {
            let compensation = fs::remove_file(&staged.destination).await;
            return Err(reconciliation_error(
                operation,
                &staged.logical,
                error,
                compensation.err(),
            ));
        }
        Ok(())
    }

    async fn finalize_replacement(
        &self,
        staged: StagedUpload,
        operation: &'static str,
    ) -> AppResult<()> {
        self.finalize_replacements(vec![staged], operation).await
    }

    async fn prepare_replacement(
        &self,
        mut staged: StagedUpload,
    ) -> AppResult<PreparedReplacement> {
        staged.finish().await?;
        let existing = metadata_optional(&staged.destination).await?;
        if existing.as_ref().is_some_and(|metadata| metadata.is_dir()) {
            return Err(AppError::conflict(
                "A folder cannot be replaced with a file",
            ));
        }
        if let Some(metadata) = &existing {
            reject_symlink(metadata)?;
            fs::set_permissions(&staged.temporary, metadata.permissions())
                .await
                .map_err(AppError::io)?;
        }
        let backup = if existing.is_some() {
            let backup = unique_sibling(&staged.destination, "backup")?;
            #[cfg(not(windows))]
            if let Err(error) = snapshot_existing_file(&staged.destination, &backup).await {
                let _ = remove_file_if_exists(&backup).await;
                return Err(AppError::io(error));
            }
            Some(backup)
        } else {
            None
        };
        Ok(PreparedReplacement {
            staged,
            backup,
            existed: existing.is_some(),
            installed: false,
        })
    }

    async fn finalize_replacements(
        &self,
        staged: Vec<StagedUpload>,
        operation: &'static str,
    ) -> AppResult<()> {
        if staged.is_empty() {
            return Err(AppError::bad("No files provided"));
        }
        let mut prepared = Vec::with_capacity(staged.len());
        for item in staged {
            match self.prepare_replacement(item).await {
                Ok(item) => prepared.push(item),
                Err(error) => {
                    for item in &mut prepared {
                        discard_prepared(item).await;
                    }
                    return Err(error);
                }
            }
        }

        for index in 0..prepared.len() {
            if let Err(error) = install_prepared(&mut prepared[index]).await {
                let logical = prepared[index].staged.logical.clone();
                let uncertain_current = cfg!(windows) && prepared[index].existed;
                let mut recovery_errors = Vec::new();
                for item in prepared[..index].iter_mut().rev() {
                    if let Err(rollback) = rollback_prepared(item).await {
                        recovery_errors.push(format!(
                            "{} rollback failed: {rollback}",
                            item.staged.logical
                        ));
                    }
                }
                if uncertain_current {
                    prepared[index].staged.abort().await;
                } else {
                    discard_prepared(&mut prepared[index]).await;
                }
                for item in &mut prepared[index + 1..] {
                    discard_prepared(item).await;
                }
                if uncertain_current || !recovery_errors.is_empty() {
                    let recovery = if recovery_errors.is_empty() {
                        String::new()
                    } else {
                        format!("; {}", recovery_errors.join("; "))
                    };
                    return Err(AppError::needs_reconciliation(
                        operation,
                        &logical,
                        format!("Atomic file replacement failed: {error}{recovery}"),
                    ));
                }
                return Err(AppError::io(error));
            }
        }

        for index in 0..prepared.len() {
            if let Err(error) = self
                .metadata
                .content_replaced(&self.config, &prepared[index].staged.logical)
            {
                let logical = prepared[index].staged.logical.clone();
                let mut recovery_errors = Vec::new();
                for item in prepared.iter_mut().rev() {
                    if let Err(rollback) = rollback_prepared(item).await {
                        recovery_errors.push(format!(
                            "{} rollback failed: {rollback}",
                            item.staged.logical
                        ));
                    }
                }
                let recovery = if recovery_errors.is_empty() {
                    String::new()
                } else {
                    format!(
                        "; filesystem compensation also failed: {}",
                        recovery_errors.join("; ")
                    )
                };
                return Err(AppError::needs_reconciliation(
                    operation,
                    &logical,
                    format!("Required metadata repair failed: {}{recovery}", error.1),
                ));
            }
        }

        for item in &mut prepared {
            if let Some(backup) = item.backup.take()
                && let Err(error) = remove_file_if_exists(&backup).await
            {
                return Err(AppError::needs_reconciliation(
                    operation,
                    &item.staged.logical,
                    format!("File was replaced, but recoverable backup cleanup failed: {error}"),
                ));
            }
        }
        Ok(())
    }
}

struct PreparedReplacement {
    staged: StagedUpload,
    backup: Option<PathBuf>,
    existed: bool,
    installed: bool,
}

pub(crate) struct StagedUpload {
    logical: String,
    destination: PathBuf,
    temporary: PathBuf,
    file: Option<fs::File>,
    bytes_written: u64,
    limit: u64,
    finished: bool,
    cleanup: bool,
    _upload_permit: Option<tokio::sync::OwnedSemaphorePermit>,
}

impl StagedUpload {
    pub async fn write_chunk(&mut self, chunk: &[u8]) -> AppResult<()> {
        let chunk_len = u64::try_from(chunk.len()).map_err(|_| {
            AppError::with_status(StatusCode::PAYLOAD_TOO_LARGE, "Upload is too large")
        })?;
        let next = self.bytes_written.checked_add(chunk_len).ok_or_else(|| {
            AppError::with_status(StatusCode::PAYLOAD_TOO_LARGE, "Upload is too large")
        })?;
        if next > self.limit {
            self.abort().await;
            return Err(AppError::with_status(
                StatusCode::PAYLOAD_TOO_LARGE,
                format!("Upload exceeds {} byte limit", self.limit),
            ));
        }
        self.file
            .as_mut()
            .ok_or_else(|| AppError::internal("Upload temporary file is closed"))?
            .write_all(chunk)
            .await
            .map_err(AppError::io)?;
        self.bytes_written = next;
        Ok(())
    }

    pub async fn finish_staging(&mut self) -> AppResult<()> {
        self.finish().await?;
        self._upload_permit.take();
        Ok(())
    }

    async fn finish(&mut self) -> AppResult<()> {
        if self.finished {
            return Ok(());
        }
        let mut file = self
            .file
            .take()
            .ok_or_else(|| AppError::internal("Upload temporary file is closed"))?;
        file.flush().await.map_err(AppError::io)?;
        file.sync_all().await.map_err(AppError::io)?;
        drop(file);
        let metadata = fs::metadata(&self.temporary).await.map_err(AppError::io)?;
        if !metadata.is_file() || metadata.len() != self.bytes_written {
            return Err(AppError::internal(
                "Upload temporary file failed validation",
            ));
        }
        self.finished = true;
        Ok(())
    }

    async fn abort(&mut self) {
        self.file.take();
        self.cleanup = fs::remove_file(&self.temporary).await.is_err();
    }
}

impl Drop for StagedUpload {
    fn drop(&mut self) {
        self.file.take();
        if self.cleanup {
            let _ = std::fs::remove_file(&self.temporary);
        }
    }
}

fn require_path(path: &str) -> AppResult<()> {
    if path.is_empty() {
        Err(AppError::bad("Path is required"))
    } else {
        Ok(())
    }
}

fn require_editable(config: &Config, path: &str, message: &'static str) -> AppResult<()> {
    if media::editable(config, path) {
        Ok(())
    } else {
        Err(AppError::forbidden(message))
    }
}

fn reject_symlink(metadata: &std::fs::Metadata) -> AppResult<()> {
    if metadata.file_type().is_symlink() {
        Err(AppError::forbidden(
            "Cannot mutate symbolic links through a media directory",
        ))
    } else {
        Ok(())
    }
}

async fn metadata_optional(path: &Path) -> AppResult<Option<std::fs::Metadata>> {
    match fs::symlink_metadata(path).await {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::io(error)),
    }
}

fn unique_sibling(destination: &Path, label: &str) -> AppResult<PathBuf> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::bad("Invalid destination path"))?;
    Ok(parent.join(format!("{TEMP_PREFIX}{label}-{}.tmp", uuid::Uuid::new_v4())))
}

async fn create_directory_atomically(destination: &Path) -> AppResult<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::bad("Invalid destination path"))?;
    fs::create_dir_all(parent).await.map_err(AppError::io)?;
    let temporary = unique_sibling(destination, "create-directory")?;
    fs::create_dir(&temporary).await.map_err(AppError::io)?;
    if let Err(error) = fs::rename(&temporary, destination).await {
        let _ = fs::remove_dir(&temporary).await;
        return Err(AppError::io(error));
    }
    Ok(())
}

#[cfg(not(windows))]
async fn snapshot_existing_file(destination: &Path, backup: &Path) -> std::io::Result<()> {
    if fs::hard_link(destination, backup).await.is_ok() {
        return Ok(());
    }
    fs::copy(destination, backup).await?;
    fs::File::open(backup).await?.sync_all().await
}

async fn install_prepared(item: &mut PreparedReplacement) -> std::io::Result<()> {
    if item.existed {
        let backup = item
            .backup
            .as_deref()
            .ok_or_else(|| std::io::Error::other("Replacement backup path was not prepared"))?;
        atomic_replace_existing(&item.staged.destination, &item.staged.temporary, backup).await?;
    } else {
        fs::rename(&item.staged.temporary, &item.staged.destination).await?;
    }
    item.staged.cleanup = false;
    item.installed = true;
    Ok(())
}

async fn rollback_prepared(item: &mut PreparedReplacement) -> std::io::Result<()> {
    if !item.installed {
        return Ok(());
    }
    if item.existed {
        let backup = item.backup.as_deref().ok_or_else(|| {
            std::io::Error::other("Replacement backup is unavailable for rollback")
        })?;
        atomic_restore_existing(&item.staged.destination, backup).await?;
        item.backup = None;
    } else {
        remove_file_if_exists(&item.staged.destination).await?;
    }
    item.installed = false;
    Ok(())
}

async fn discard_prepared(item: &mut PreparedReplacement) {
    item.staged.abort().await;
    if let Some(backup) = item.backup.take() {
        let _ = remove_file_if_exists(&backup).await;
    }
}

async fn remove_file_if_exists(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(not(windows))]
async fn atomic_replace_existing(
    destination: &Path,
    replacement: &Path,
    _backup: &Path,
) -> std::io::Result<()> {
    fs::rename(replacement, destination).await
}

#[cfg(not(windows))]
async fn atomic_restore_existing(destination: &Path, backup: &Path) -> std::io::Result<()> {
    fs::rename(backup, destination).await
}

#[cfg(windows)]
async fn atomic_replace_existing(
    destination: &Path,
    replacement: &Path,
    backup: &Path,
) -> std::io::Result<()> {
    replace_file_windows(destination, replacement, Some(backup))
}

#[cfg(windows)]
async fn atomic_restore_existing(destination: &Path, backup: &Path) -> std::io::Result<()> {
    replace_file_windows(destination, backup, None)
}

#[cfg(windows)]
fn replace_file_windows(
    destination: &Path,
    replacement: &Path,
    backup: Option<&Path>,
) -> std::io::Result<()> {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let destination = wide(destination);
    let replacement = wide(replacement);
    let backup = backup.map(wide);
    let backup = backup.as_ref().map_or(ptr::null(), |path| path.as_ptr());
    let replaced = unsafe {
        ReplaceFileW(
            destination.as_ptr(),
            replacement.as_ptr(),
            backup,
            0,
            ptr::null(),
            ptr::null(),
        )
    };
    if replaced == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn reconciliation_error(
    operation: &str,
    path: &str,
    metadata_error: AppError,
    compensation_error: Option<std::io::Error>,
) -> AppError {
    let message = match compensation_error {
        Some(error) => format!(
            "Required metadata repair failed: {}; filesystem compensation also failed: {error}",
            metadata_error.1
        ),
        None => format!("Required metadata repair failed: {}", metadata_error.1),
    };
    AppError::needs_reconciliation(operation, path, message)
}

#[cfg(test)]
fn temporary_entries(directory: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(directory)
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(TEMP_PREFIX))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{Config, FileSearchConfig, ImageOptimizationConfig, MediaRoot},
        error::{AppError, AppResult},
    };
    use futures_util::future::BoxFuture;
    use std::{path::PathBuf, sync::Arc};

    struct Fixture {
        base: PathBuf,
        media: PathBuf,
        config: Config,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "derp-file-commands-{name}-{}",
                uuid::Uuid::new_v4()
            ));
            let media = base.join("media");
            let data = base.join("data");
            std::fs::create_dir_all(media.join("Editable")).unwrap();
            std::fs::create_dir_all(&data).unwrap();
            let config = Config {
                port: 3000,
                roots: vec![MediaRoot {
                    id: "media".into(),
                    name: "Media".into(),
                    path: media.clone(),
                    editable_folders: vec!["Editable".into()],
                }],
                library_key: "library".into(),
                data_path: data.clone(),
                file_search: FileSearchConfig {
                    enabled: false,
                    index_path: data.join("search.sqlite"),
                    watch_mode: "off".into(),
                    max_recursive_watchers: 0,
                    max_fs_concurrency: 1,
                    reconcile_directories_per_second: 1,
                },
                image_optimization: ImageOptimizationConfig::default(),
                hermes: None,
            };
            Self {
                base,
                media,
                config,
            }
        }

        fn path(&self, relative: &str) -> PathBuf {
            self.media.join(relative)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    struct NoopMetadata;

    impl FileMetadataRepair for NoopMetadata {
        fn content_replaced(&self, _config: &Config, _path: &str) -> AppResult<()> {
            Ok(())
        }

        fn moved<'a>(
            &'a self,
            _config: &'a Config,
            _old_path: &'a str,
            _new_path: &'a str,
        ) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Ok(()) })
        }

        fn removed<'a>(
            &'a self,
            _config: &'a Config,
            _path: &'a str,
        ) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Ok(()) })
        }
    }

    struct FailingMetadata;

    impl FileMetadataRepair for FailingMetadata {
        fn content_replaced(&self, _config: &Config, _path: &str) -> AppResult<()> {
            Err(AppError::internal("metadata unavailable"))
        }

        fn moved<'a>(
            &'a self,
            _config: &'a Config,
            _old_path: &'a str,
            _new_path: &'a str,
        ) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Err(AppError::internal("metadata unavailable")) })
        }

        fn removed<'a>(
            &'a self,
            _config: &'a Config,
            _path: &'a str,
        ) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Err(AppError::internal("metadata unavailable")) })
        }
    }

    fn service(fixture: &Fixture, metadata: Arc<dyn FileMetadataRepair>) -> FileCommandService {
        FileCommandService::with_metadata(fixture.config.clone(), metadata, 1024)
    }

    fn assert_reconciliation(error: AppError, operation: &str, path: &str) {
        let details = error.2.expect("missing reconciliation details");
        assert_eq!(details.operation, operation);
        assert_eq!(details.path, path);
    }

    #[tokio::test]
    async fn edit_metadata_failure_restores_old_file_and_requires_reconciliation() {
        let fixture = Fixture::new("edit-repair");
        let path = fixture.path("Editable/note.txt");
        std::fs::write(&path, "old").unwrap();
        let commands = service(&fixture, Arc::new(FailingMetadata));

        let error = commands
            .edit("Editable/note.txt", b"new", None)
            .await
            .unwrap_err();

        assert_eq!(std::fs::read_to_string(path).unwrap(), "old");
        assert_reconciliation(error, "edit", "Editable/note.txt");
    }

    #[tokio::test]
    async fn create_metadata_failure_removes_new_file_and_requires_reconciliation() {
        let fixture = Fixture::new("create-repair");
        let commands = service(&fixture, Arc::new(FailingMetadata));

        let error = commands
            .create("Editable/note.txt", CreateContent::File(b"new"))
            .await
            .unwrap_err();

        assert!(!fixture.path("Editable/note.txt").exists());
        assert_reconciliation(error, "create", "Editable/note.txt");
    }

    #[tokio::test]
    async fn move_metadata_failure_restores_old_path_and_requires_reconciliation() {
        let fixture = Fixture::new("move-repair");
        std::fs::write(fixture.path("Editable/old.txt"), "old").unwrap();
        let commands = service(&fixture, Arc::new(FailingMetadata));

        let error = commands
            .move_path("Editable/old.txt", "Editable/new.txt")
            .await
            .unwrap_err();

        assert!(fixture.path("Editable/old.txt").exists());
        assert!(!fixture.path("Editable/new.txt").exists());
        assert_reconciliation(error, "move", "Editable/old.txt");
    }

    #[tokio::test]
    async fn delete_metadata_failure_restores_file_and_requires_reconciliation() {
        let fixture = Fixture::new("delete-repair");
        std::fs::write(fixture.path("Editable/note.txt"), "old").unwrap();
        let commands = service(&fixture, Arc::new(FailingMetadata));

        let error = commands.delete("Editable/note.txt").await.unwrap_err();

        assert_eq!(
            std::fs::read_to_string(fixture.path("Editable/note.txt")).unwrap(),
            "old"
        );
        assert_reconciliation(error, "delete", "Editable/note.txt");
    }

    #[tokio::test]
    async fn upload_stream_stays_temporary_until_atomic_finalize() {
        let fixture = Fixture::new("upload-finalize");
        let path = fixture.path("Editable/note.txt");
        std::fs::write(&path, "old").unwrap();
        let commands = service(&fixture, Arc::new(NoopMetadata));
        let mut upload = commands.begin_upload("Editable/note.txt").await.unwrap();

        upload.write_chunk(b"ne").await.unwrap();
        upload.write_chunk(b"w").await.unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        assert_eq!(temporary_entries(path.parent().unwrap()).len(), 1);

        commands.finalize_uploads(vec![upload]).await.unwrap();

        assert_eq!(std::fs::read_to_string(path).unwrap(), "new");
        assert!(temporary_entries(fixture.path("Editable").as_path()).is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn upload_overwrite_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new("upload-permissions");
        let path = fixture.path("Editable/private.sh");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o750)).unwrap();
        let commands = service(&fixture, Arc::new(NoopMetadata));
        let mut upload = commands.begin_upload("Editable/private.sh").await.unwrap();
        upload.write_chunk(b"new").await.unwrap();

        commands.finalize_uploads(vec![upload]).await.unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o750
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn edit_overwrite_preserves_existing_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new("edit-permissions");
        let path = fixture.path("Editable/private.txt");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let commands = service(&fixture, Arc::new(NoopMetadata));

        commands
            .edit("Editable/private.txt", b"new", None)
            .await
            .unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[tokio::test]
    async fn replacement_preparation_keeps_the_live_destination_present() {
        let fixture = Fixture::new("replacement-preparation");
        let path = fixture.path("Editable/note.txt");
        std::fs::write(&path, "old").unwrap();
        let commands = service(&fixture, Arc::new(NoopMetadata));
        let mut upload = commands.begin_upload("Editable/note.txt").await.unwrap();
        upload.write_chunk(b"new").await.unwrap();

        let mut prepared = commands.prepare_replacement(upload).await.unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        #[cfg(not(windows))]
        assert_eq!(
            std::fs::read_to_string(prepared.backup.as_ref().unwrap()).unwrap(),
            "old"
        );
        discard_prepared(&mut prepared).await;
        assert_eq!(std::fs::read_to_string(path).unwrap(), "old");
        assert!(temporary_entries(fixture.path("Editable").as_path()).is_empty());
    }

    #[tokio::test]
    async fn oversized_upload_removes_bounded_temporary_file() {
        let fixture = Fixture::new("upload-limit");
        let commands =
            FileCommandService::with_metadata(fixture.config.clone(), Arc::new(NoopMetadata), 3);
        let mut upload = commands.begin_upload("Editable/large.bin").await.unwrap();

        let error = upload.write_chunk(b"four").await.unwrap_err();
        drop(upload);

        assert_eq!(error.0, axum::http::StatusCode::PAYLOAD_TOO_LARGE);
        assert!(!fixture.path("Editable/large.bin").exists());
        assert!(temporary_entries(fixture.path("Editable").as_path()).is_empty());
    }

    #[tokio::test]
    async fn temporary_upload_count_is_bounded() {
        let fixture = Fixture::new("upload-slots");
        let commands = service(&fixture, Arc::new(NoopMetadata));
        let mut uploads = Vec::new();
        for index in 0..MAX_CONCURRENT_UPLOADS {
            uploads.push(
                commands
                    .begin_upload(&format!("Editable/{index}.bin"))
                    .await
                    .unwrap(),
            );
        }

        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(20),
                commands.begin_upload("Editable/waiting.bin")
            )
            .await
            .is_err()
        );

        drop(uploads.pop());
        let waiting = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            commands.begin_upload("Editable/waiting.bin"),
        )
        .await
        .unwrap()
        .unwrap();
        drop(waiting);
        drop(uploads);
        assert!(temporary_entries(fixture.path("Editable").as_path()).is_empty());
    }

    #[tokio::test]
    async fn upload_metadata_failure_restores_previous_file() {
        let fixture = Fixture::new("upload-repair");
        let path = fixture.path("Editable/note.txt");
        std::fs::write(&path, "old").unwrap();
        let commands = service(&fixture, Arc::new(FailingMetadata));
        let mut upload = commands.begin_upload("Editable/note.txt").await.unwrap();
        upload.write_chunk(b"new").await.unwrap();

        let error = commands.finalize_uploads(vec![upload]).await.unwrap_err();

        assert_eq!(std::fs::read_to_string(path).unwrap(), "old");
        assert_reconciliation(error, "upload", "Editable/note.txt");
        assert!(temporary_entries(fixture.path("Editable").as_path()).is_empty());
    }

    #[tokio::test]
    async fn upload_batch_metadata_failure_rolls_back_every_file() {
        let fixture = Fixture::new("upload-batch-repair");
        let existing = fixture.path("Editable/existing.txt");
        let created = fixture.path("Editable/created.txt");
        std::fs::write(&existing, "old").unwrap();
        let commands = service(&fixture, Arc::new(FailingMetadata));
        let mut first = commands
            .begin_upload("Editable/existing.txt")
            .await
            .unwrap();
        first.write_chunk(b"new existing").await.unwrap();
        first.finish_staging().await.unwrap();
        let mut second = commands.begin_upload("Editable/created.txt").await.unwrap();
        second.write_chunk(b"new created").await.unwrap();
        second.finish_staging().await.unwrap();

        let error = commands
            .finalize_uploads(vec![first, second])
            .await
            .unwrap_err();

        assert_eq!(std::fs::read_to_string(existing).unwrap(), "old");
        assert!(!created.exists());
        assert_reconciliation(error, "upload", "Editable/existing.txt");
        assert!(temporary_entries(fixture.path("Editable").as_path()).is_empty());
    }

    #[tokio::test]
    async fn production_service_runs_complete_file_command_lifecycle() {
        let fixture = Fixture::new("lifecycle");
        crate::state_db::initialize(&fixture.config).unwrap();
        let commands = FileCommandService::new(fixture.config.clone());

        commands
            .create("Editable/note.txt", CreateContent::File(b"one"))
            .await
            .unwrap();
        commands
            .edit("Editable/note.txt", b"two", None)
            .await
            .unwrap();
        commands
            .move_path("Editable/note.txt", "Editable/moved.txt")
            .await
            .unwrap();
        commands
            .create("Editable/folder", CreateContent::Folder)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(fixture.path("Editable/moved.txt")).unwrap(),
            "two"
        );
        assert!(fixture.path("Editable/folder").is_dir());

        commands.delete("Editable/moved.txt").await.unwrap();
        commands.delete("Editable/folder").await.unwrap();

        assert!(!fixture.path("Editable/moved.txt").exists());
        assert!(!fixture.path("Editable/folder").exists());
        assert!(temporary_entries(fixture.path("Editable").as_path()).is_empty());
    }
}
