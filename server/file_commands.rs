use crate::{
    config::Config,
    error::{AppError, AppResult},
    media, path_metadata,
};
use axum::http::StatusCode;
use futures_util::future::BoxFuture;
use std::{
    collections::BTreeMap,
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

enum OwnedCreateContent {
    Folder,
    File(Vec<u8>),
}

#[derive(Debug)]
pub(crate) struct DeleteOutcome {
    pub is_directory: bool,
}

async fn await_owned_mutation<T>(
    operation: &'static str,
    task: tokio::task::JoinHandle<AppResult<T>>,
) -> AppResult<T> {
    task.await
        .map_err(|error| AppError::internal(format!("{operation} task failed: {error}")))?
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

pub(crate) trait FileMutationEvents: Send + Sync {
    fn changed(&self, path: &str);
    fn moved(&self, old_path: &str, new_path: &str);
    fn removed(&self, path: &str);
}

#[cfg(test)]
struct NoopFileMutationEvents;

#[cfg(test)]
impl FileMutationEvents for NoopFileMutationEvents {
    fn changed(&self, _path: &str) {}
    fn moved(&self, _old_path: &str, _new_path: &str) {}
    fn removed(&self, _path: &str) {}
}

#[cfg(test)]
#[derive(Default)]
struct UploadTestGate {
    entered: tokio::sync::Notify,
    resume: tokio::sync::Notify,
}

#[cfg(test)]
impl UploadTestGate {
    async fn pause(&self) {
        self.entered.notify_one();
        self.resume.notified().await;
    }
}

#[cfg(test)]
#[derive(Clone, Default)]
struct UploadTestHooks {
    open: Option<Arc<UploadTestGate>>,
    write: Option<Arc<UploadTestGate>>,
}

#[derive(Clone)]
pub(crate) struct FileCommandService {
    config: Config,
    metadata: Arc<dyn FileMetadataRepair>,
    events: Arc<dyn FileMutationEvents>,
    max_upload_bytes: u64,
    operations: Arc<tokio::sync::Mutex<()>>,
    upload_slots: Arc<tokio::sync::Semaphore>,
    #[cfg(test)]
    upload_test_hooks: Option<Arc<UploadTestHooks>>,
}

impl FileCommandService {
    #[cfg(test)]
    pub fn new(config: Config) -> Self {
        Self::new_with_events(config, Arc::new(NoopFileMutationEvents))
    }

    pub fn new_with_events(config: Config, events: Arc<dyn FileMutationEvents>) -> Self {
        Self {
            config,
            metadata: Arc::new(PathMetadataRepair),
            events,
            max_upload_bytes: MAX_UPLOAD_BYTES,
            operations: Arc::new(tokio::sync::Mutex::new(())),
            upload_slots: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_UPLOADS)),
            #[cfg(test)]
            upload_test_hooks: None,
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
            events: Arc::new(NoopFileMutationEvents),
            max_upload_bytes,
            operations: Arc::new(tokio::sync::Mutex::new(())),
            upload_slots: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_UPLOADS)),
            upload_test_hooks: None,
        }
    }

    pub async fn create(&self, path: &str, content: CreateContent<'_>) -> AppResult<()> {
        let service = self.clone();
        let path = path.to_string();
        let content = match content {
            CreateContent::Folder => OwnedCreateContent::Folder,
            CreateContent::File(bytes) => OwnedCreateContent::File(bytes.to_vec()),
        };
        await_owned_mutation(
            "create",
            tokio::spawn(async move { service.create_owned(path, content).await }),
        )
        .await
    }

    async fn create_owned(&self, path: String, content: OwnedCreateContent) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        require_path(&path)?;
        if !media::editable(&self.config, &crate::app::parent_logical(&path))
            && !media::editable(&self.config, &path)
        {
            return Err(AppError::forbidden("Path is not in an editable folder"));
        }
        let destination = media::resolve(&self.config, &path)?.full;
        if metadata_optional(&destination).await?.is_some() {
            return Err(AppError::conflict(format!(
                "A {} with this name already exists",
                if matches!(content, OwnedCreateContent::Folder) {
                    "folder"
                } else {
                    "file"
                }
            )));
        }
        let result = match content {
            OwnedCreateContent::Folder => create_directory_atomically(&destination).await,
            OwnedCreateContent::File(bytes) => {
                let mut staged = self.stage(&path, u64::MAX, "create", None).await?;
                staged.write_chunk(&bytes).await?;
                self.finalize_new_file(staged, "create").await
            }
        };
        if result.is_ok() {
            self.events.changed(&path);
        }
        result
    }

    pub async fn edit(
        &self,
        path: &str,
        content: &[u8],
        expected_version: Option<f64>,
    ) -> AppResult<()> {
        let service = self.clone();
        let path = path.to_string();
        let content = content.to_vec();
        await_owned_mutation(
            "edit",
            tokio::spawn(async move { service.edit_owned(path, content, expected_version).await }),
        )
        .await
    }

    async fn edit_owned(
        &self,
        path: String,
        content: Vec<u8>,
        expected_version: Option<f64>,
    ) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        require_path(&path)?;
        require_editable(&self.config, &path, "Path is not in an editable folder")?;
        let destination = media::resolve(&self.config, &path)?.full;
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
        let mut staged = self.stage(&path, u64::MAX, "edit", None).await?;
        staged.write_chunk(&content).await?;
        let result = self.finalize_replacement(staged, "edit").await;
        if result.is_ok() {
            self.events.changed(&path);
        }
        result
    }

    pub async fn move_path(&self, old_path: &str, new_path: &str) -> AppResult<()> {
        let service = self.clone();
        let old_path = old_path.to_string();
        let new_path = new_path.to_string();
        await_owned_mutation(
            "move",
            tokio::spawn(async move { service.move_path_owned(old_path, new_path).await }),
        )
        .await
    }

    async fn move_path_owned(&self, old_path: String, new_path: String) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        if old_path.is_empty() || new_path.is_empty() {
            return Err(AppError::bad("Both oldPath and newPath are required"));
        }
        require_editable(
            &self.config,
            &old_path,
            "Cannot rename: Source path is not in an editable folder",
        )?;
        require_editable(
            &self.config,
            &new_path,
            "Cannot rename: Destination path is not in an editable folder",
        )?;
        let source = media::resolve(&self.config, &old_path)?.full;
        let destination = media::resolve(&self.config, &new_path)?.full;
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
        if let Err(error) = self
            .metadata
            .moved(&self.config, &old_path, &new_path)
            .await
        {
            let compensation = fs::rename(&destination, &source).await;
            return Err(reconciliation_error(
                "move",
                &old_path,
                error,
                compensation.err(),
            ));
        }
        self.events.moved(&old_path, &new_path);
        self.events.changed(&old_path);
        if logical_parent(&old_path) != logical_parent(&new_path) {
            self.events.changed(&new_path);
        }
        Ok(())
    }

    pub async fn copy_path(&self, source_path: &str, destination_dir: &str) -> AppResult<String> {
        let service = self.clone();
        let source_path = source_path.to_string();
        let destination_dir = destination_dir.to_string();
        await_owned_mutation(
            "copy",
            tokio::spawn(
                async move { service.copy_path_owned(source_path, destination_dir).await },
            ),
        )
        .await
    }

    async fn copy_path_owned(
        &self,
        source_path: String,
        destination_dir: String,
    ) -> AppResult<String> {
        let _operation = self.operations.lock().await;
        require_path(&source_path)?;
        let source = media::resolve(&self.config, &source_path)?.full;
        let source_metadata = fs::symlink_metadata(&source).await.map_err(AppError::io)?;
        reject_symlink(&source_metadata)?;
        let name = source
            .file_name()
            .ok_or_else(|| AppError::bad("Invalid source path"))?
            .to_owned();
        let logical = if destination_dir.is_empty() {
            name.to_string_lossy().into_owned()
        } else {
            format!("{destination_dir}/{}", name.to_string_lossy())
        };
        require_editable(
            &self.config,
            &logical,
            "Cannot copy: Destination is not in an editable folder",
        )?;
        let destination = media::resolve(&self.config, &logical)?.full;
        if metadata_optional(&destination).await?.is_some() {
            return Err(AppError::conflict(
                "Destination file or directory already exists",
            ));
        }
        if source_metadata.is_dir() && path_is_within(&source, &destination).await? {
            return Err(AppError::conflict(
                "A folder cannot be copied into itself or one of its descendants",
            ));
        }
        if let Err(error) = copy_recursive(&source, &destination).await {
            if let Err(cleanup_error) = remove_path_if_exists(&destination).await {
                return Err(AppError::needs_reconciliation(
                    "copy",
                    &logical,
                    format!(
                        "Copy failed: {}; partial destination cleanup also failed: {cleanup_error}",
                        error.1
                    ),
                ));
            }
            return Err(error);
        }
        self.events.changed(&logical);
        Ok(logical)
    }

    pub async fn delete(&self, path: &str) -> AppResult<DeleteOutcome> {
        let service = self.clone();
        let path = path.to_string();
        await_owned_mutation(
            "delete",
            tokio::spawn(async move { service.delete_owned(path).await }),
        )
        .await
    }

    async fn delete_owned(&self, path: String) -> AppResult<DeleteOutcome> {
        let _operation = self.operations.lock().await;
        require_path(&path)?;
        require_editable(&self.config, &path, "Path is not in an editable folder")?;
        let source = media::resolve(&self.config, &path)?.full;
        let metadata = fs::symlink_metadata(&source).await.map_err(AppError::io)?;
        reject_symlink(&metadata)?;
        let is_directory = metadata.is_dir();
        let tombstone = unique_sibling(&source, "delete")?;
        fs::rename(&source, &tombstone)
            .await
            .map_err(AppError::io)?;
        if let Err(error) = self.metadata.removed(&self.config, &path).await {
            let compensation = fs::rename(&tombstone, &source).await;
            return Err(reconciliation_error(
                "delete",
                &path,
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
                &path,
                format!(
                    "File metadata was repaired, but recoverable delete cleanup failed: {error}"
                ),
            ));
        }
        self.events.removed(&path);
        self.events.changed(&path);
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
        self.stage(path, self.max_upload_bytes, "upload", Some(permit))
            .await
    }

    pub async fn finalize_uploads(&self, staged: Vec<StagedUpload>) -> AppResult<()> {
        let service = self.clone();
        await_owned_mutation(
            "upload",
            tokio::spawn(async move { service.finalize_uploads_owned(staged).await }),
        )
        .await
    }

    async fn finalize_uploads_owned(&self, staged: Vec<StagedUpload>) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        let mut changes = BTreeMap::new();
        for item in &staged {
            changes.insert(logical_parent(&item.logical), item.logical.clone());
        }
        let result = self.finalize_replacements(staged, "upload").await;
        for logical in changes.values() {
            self.events.changed(logical);
        }
        result
    }

    async fn stage(
        &self,
        path: &str,
        limit: u64,
        label: &str,
        upload_permit: Option<tokio::sync::OwnedSemaphorePermit>,
    ) -> AppResult<StagedUpload> {
        let destination = media::resolve(&self.config, path)?.full;
        let parent = destination
            .parent()
            .ok_or_else(|| AppError::bad("Invalid destination path"))?
            .to_owned();
        let temporary = unique_sibling(&destination, label)?;
        let logical = path.to_string();
        #[cfg(test)]
        let test_hooks = self.upload_test_hooks.clone();
        await_owned_mutation(
            "stage",
            tokio::spawn(async move {
                fs::create_dir_all(parent).await.map_err(AppError::io)?;
                let file = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&temporary)
                    .await
                    .map_err(AppError::io)?;
                #[cfg(test)]
                if let Some(gate) = test_hooks.as_ref().and_then(|hooks| hooks.open.as_ref()) {
                    gate.pause().await;
                }
                Ok(StagedUpload {
                    logical,
                    destination,
                    temporary,
                    file: Some(file),
                    bytes_written: 0,
                    limit,
                    finished: false,
                    cleanup: true,
                    _upload_permit: upload_permit,
                    #[cfg(test)]
                    test_hooks,
                })
            }),
        )
        .await
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
                    prepared[index].staged.abort();
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

fn copy_recursive<'a>(source: &'a Path, destination: &'a Path) -> BoxFuture<'a, AppResult<()>> {
    Box::pin(async move {
        let metadata = fs::symlink_metadata(source).await.map_err(AppError::io)?;
        reject_symlink(&metadata)?;
        if metadata.is_file() {
            fs::copy(source, destination).await.map_err(AppError::io)?;
            return Ok(());
        }
        fs::create_dir_all(destination)
            .await
            .map_err(AppError::io)?;
        let mut directory = fs::read_dir(source).await.map_err(AppError::io)?;
        while let Some(entry) = directory.next_entry().await.map_err(AppError::io)? {
            copy_recursive(&entry.path(), &destination.join(entry.file_name())).await?;
        }
        Ok(())
    })
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
    #[cfg(test)]
    test_hooks: Option<Arc<UploadTestHooks>>,
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
            self.abort();
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
        #[cfg(test)]
        if let Some(gate) = self
            .test_hooks
            .as_ref()
            .and_then(|hooks| hooks.write.as_ref())
        {
            gate.pause().await;
        }
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
        let file = self
            .file
            .as_mut()
            .ok_or_else(|| AppError::internal("Upload temporary file is closed"))?;
        file.flush().await.map_err(AppError::io)?;
        file.sync_all().await.map_err(AppError::io)?;
        self.file.take();
        let metadata = fs::metadata(&self.temporary).await.map_err(AppError::io)?;
        if !metadata.is_file() || metadata.len() != self.bytes_written {
            return Err(AppError::internal(
                "Upload temporary file failed validation",
            ));
        }
        self.finished = true;
        Ok(())
    }

    fn abort(&mut self) {
        self.start_cleanup();
    }

    fn start_cleanup(&mut self) {
        if !std::mem::replace(&mut self.cleanup, false) {
            return;
        }
        cleanup_temporary_file(self.file.take(), self.temporary.clone());
    }
}

impl Drop for StagedUpload {
    fn drop(&mut self) {
        self.start_cleanup();
    }
}

fn cleanup_temporary_file(file: Option<fs::File>, temporary: PathBuf) {
    match std::fs::remove_file(&temporary) {
        Ok(()) => {
            drop(file);
            return;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            drop(file);
            return;
        }
        Err(_) => {}
    }
    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        runtime.spawn(async move {
            if let Some(mut file) = file {
                let _ = file.flush().await;
                drop(file);
            }
            let _ = fs::remove_file(temporary).await;
        });
    } else {
        drop(file);
        let _ = std::fs::remove_file(temporary);
    }
}

fn require_path(path: &str) -> AppResult<()> {
    if path.is_empty() {
        Err(AppError::bad("Path is required"))
    } else {
        Ok(())
    }
}

fn logical_parent(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit_once('/')
        .map(|value| value.0.into())
        .unwrap_or_default()
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

async fn path_is_within(source: &Path, destination: &Path) -> AppResult<bool> {
    let source = fs::canonicalize(source).await.map_err(AppError::io)?;
    let mut existing = destination;
    loop {
        match fs::canonicalize(existing).await {
            Ok(existing) => return Ok(existing.starts_with(&source)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                existing = existing
                    .parent()
                    .ok_or_else(|| AppError::bad("Invalid destination path"))?;
            }
            Err(error) => return Err(AppError::io(error)),
        }
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
    item.staged.abort();
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

async fn remove_path_if_exists(path: &Path) -> std::io::Result<()> {
    let metadata = match fs::symlink_metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).await
    } else {
        fs::remove_file(path).await
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
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex as StdMutex},
    };

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

    #[derive(Default)]
    struct RecordingEvents {
        values: StdMutex<Vec<String>>,
    }

    impl FileMutationEvents for RecordingEvents {
        fn changed(&self, path: &str) {
            self.values.lock().unwrap().push(format!("changed:{path}"));
        }

        fn moved(&self, old_path: &str, new_path: &str) {
            self.values
                .lock()
                .unwrap()
                .push(format!("moved:{old_path}:{new_path}"));
        }

        fn removed(&self, path: &str) {
            self.values.lock().unwrap().push(format!("removed:{path}"));
        }
    }

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

    async fn wait_for_owned_mutation(commands: &FileCommandService) {
        tokio::time::timeout(std::time::Duration::from_millis(500), async {
            while Arc::strong_count(&commands.operations) < 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("mutation did not enter its owned task");
    }

    async fn wait_for_path(path: &Path, exists: bool) {
        tokio::time::timeout(std::time::Duration::from_millis(500), async {
            while path.exists() != exists {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("owned mutation did not finish after its waiter was aborted");
    }

    async fn wait_for_owned_mutations_idle(commands: &FileCommandService) {
        tokio::time::timeout(std::time::Duration::from_millis(500), async {
            while Arc::strong_count(&commands.operations) != 1 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("owned mutation task did not exit");
    }

    async fn wait_for_no_temporary_entries(directory: &Path) {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !temporary_entries(directory).is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("temporary upload cleanup did not finish");
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
    async fn canceled_upload_open_handoff_removes_the_created_temporary_file() {
        let fixture = Fixture::new("upload-cancel-open");
        let gate = Arc::new(UploadTestGate::default());
        let mut command_service = service(&fixture, Arc::new(NoopMetadata));
        command_service.upload_slots = Arc::new(tokio::sync::Semaphore::new(1));
        command_service.upload_test_hooks = Some(Arc::new(UploadTestHooks {
            open: Some(gate.clone()),
            write: None,
        }));
        let commands = Arc::new(command_service);
        let waiter = tokio::spawn({
            let commands = commands.clone();
            async move { commands.begin_upload("Editable/note.txt").await }
        });

        tokio::time::timeout(std::time::Duration::from_secs(1), gate.entered.notified())
            .await
            .expect("upload open did not reach the handoff gate");
        assert_eq!(temporary_entries(&fixture.path("Editable")).len(), 1);
        waiter.abort();
        assert!(matches!(waiter.await, Err(error) if error.is_cancelled()));

        let next = tokio::spawn({
            let commands = commands.clone();
            async move { commands.begin_upload("Editable/next.txt").await }
        });
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(20),
                gate.entered.notified()
            )
            .await
            .is_err(),
            "a second upload bypassed the staging concurrency limit"
        );

        gate.resume.notify_one();
        tokio::time::timeout(std::time::Duration::from_secs(1), gate.entered.notified())
            .await
            .expect("next upload did not start after the canceled stage released its permit");
        next.abort();
        assert!(matches!(next.await, Err(error) if error.is_cancelled()));
        gate.resume.notify_one();

        wait_for_no_temporary_entries(&fixture.path("Editable")).await;
        assert_eq!(commands.upload_slots.available_permits(), 1);
        assert!(!fixture.path("Editable/note.txt").exists());
        assert!(!fixture.path("Editable/next.txt").exists());
    }

    #[tokio::test]
    async fn canceled_upload_write_closes_the_handle_before_removing_the_temporary_file() {
        let fixture = Fixture::new("upload-cancel-write");
        let gate = Arc::new(UploadTestGate::default());
        let mut command_service = service(&fixture, Arc::new(NoopMetadata));
        command_service.upload_test_hooks = Some(Arc::new(UploadTestHooks {
            open: None,
            write: Some(gate.clone()),
        }));
        let commands = Arc::new(command_service);
        let upload = commands.begin_upload("Editable/note.txt").await.unwrap();
        let writer = tokio::spawn(async move {
            let mut upload = upload;
            upload.write_chunk(&vec![b'x'; 512]).await
        });

        tokio::time::timeout(std::time::Duration::from_secs(1), gate.entered.notified())
            .await
            .expect("upload write did not reach the cancellation gate");
        assert_eq!(temporary_entries(&fixture.path("Editable")).len(), 1);
        writer.abort();
        assert!(matches!(writer.await, Err(error) if error.is_cancelled()));

        wait_for_no_temporary_entries(&fixture.path("Editable")).await;
        assert_eq!(
            commands.upload_slots.available_permits(),
            MAX_CONCURRENT_UPLOADS
        );
        assert!(!fixture.path("Editable/note.txt").exists());
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
    async fn directory_copy_rejects_itself_and_descendants_without_mutation() {
        let fixture = Fixture::new("copy-self");
        let source = fixture.path("Editable/source");
        std::fs::create_dir_all(source.join("child")).unwrap();
        std::fs::write(source.join("note.txt"), "content").unwrap();
        let commands = service(&fixture, Arc::new(NoopMetadata));

        for destination in ["Editable/source", "Editable/source/child"] {
            let error = commands
                .copy_path("Editable/source", destination)
                .await
                .unwrap_err();
            assert_eq!(error.0, axum::http::StatusCode::CONFLICT);
            assert!(error.1.contains("cannot be copied into itself"));
        }

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                fixture.path("Editable"),
                fixture.path("Editable/alias-parent"),
            )
            .unwrap();
            let error = commands
                .copy_path("Editable/alias-parent/source", "Editable/source/child")
                .await
                .unwrap_err();
            assert_eq!(error.0, axum::http::StatusCode::CONFLICT);
        }

        assert!(!source.join("source").exists());
        assert!(!source.join("child/source").exists());
        assert_eq!(
            std::fs::read_to_string(source.join("note.txt")).unwrap(),
            "content"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_recursive_copy_removes_partial_destination() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("copy-cleanup");
        let source = fixture.path("Editable/source");
        let target = fixture.path("Editable/target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join("regular.txt"), "content").unwrap();
        symlink(source.join("regular.txt"), source.join("unsupported-link")).unwrap();
        let commands = service(&fixture, Arc::new(NoopMetadata));

        let error = commands
            .copy_path("Editable/source", "Editable/target")
            .await
            .unwrap_err();

        assert_eq!(error.0, axum::http::StatusCode::FORBIDDEN);
        assert!(!target.join("source").exists());
    }

    #[tokio::test]
    async fn committed_mutations_finish_after_request_waiters_are_aborted() {
        let fixture = Fixture::new("cancelled-waiters");
        std::fs::create_dir_all(fixture.path("Editable/source")).unwrap();
        std::fs::create_dir_all(fixture.path("Editable/target")).unwrap();
        std::fs::write(fixture.path("Editable/source/note.txt"), "copy me").unwrap();
        std::fs::write(fixture.path("Editable/delete.txt"), "delete me").unwrap();
        let events = Arc::new(RecordingEvents::default());
        let mut command_service = service(&fixture, Arc::new(NoopMetadata));
        command_service.events = events.clone();
        let commands = Arc::new(command_service);

        let operation = commands.operations.lock().await;
        let waiter = tokio::spawn({
            let commands = commands.clone();
            async move {
                commands
                    .copy_path("Editable/source", "Editable/target")
                    .await
            }
        });
        wait_for_owned_mutation(&commands).await;
        waiter.abort();
        drop(operation);
        wait_for_path(&fixture.path("Editable/target/source/note.txt"), true).await;
        wait_for_owned_mutations_idle(&commands).await;

        let operation = commands.operations.lock().await;
        let waiter = tokio::spawn({
            let commands = commands.clone();
            async move { commands.delete("Editable/delete.txt").await }
        });
        wait_for_owned_mutation(&commands).await;
        waiter.abort();
        drop(operation);
        wait_for_path(&fixture.path("Editable/delete.txt"), false).await;
        wait_for_owned_mutations_idle(&commands).await;

        let mut staged = commands.begin_upload("Editable/upload.txt").await.unwrap();
        staged.write_chunk(b"uploaded").await.unwrap();
        staged.finish_staging().await.unwrap();
        let operation = commands.operations.lock().await;
        let waiter = tokio::spawn({
            let commands = commands.clone();
            async move { commands.finalize_uploads(vec![staged]).await }
        });
        wait_for_owned_mutation(&commands).await;
        waiter.abort();
        drop(operation);
        wait_for_path(&fixture.path("Editable/upload.txt"), true).await;
        wait_for_owned_mutations_idle(&commands).await;

        assert!(temporary_entries(&fixture.path("Editable")).is_empty());
        assert_eq!(
            events.values.lock().unwrap().as_slice(),
            [
                "changed:Editable/target/source",
                "removed:Editable/delete.txt",
                "changed:Editable/delete.txt",
                "changed:Editable/upload.txt",
            ]
        );
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
