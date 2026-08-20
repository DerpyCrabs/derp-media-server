use crate::{
    app::AppState,
    error::{AppError, AppResult},
    media, path_metadata,
};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::{fs, io::AsyncWriteExt};

pub(crate) struct FileMutation<'a> {
    state: &'a AppState,
}

impl<'a> FileMutation<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    async fn begin(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.state.file_mutations.lock().await
    }

    pub async fn read_file(&self, path: &str) -> AppResult<Vec<u8>> {
        let _guard = self.begin().await;
        fs::read(resolve(self.state, path)?)
            .await
            .map_err(AppError::io)
    }

    pub async fn rename(&self, old_path: &str, new_path: &str) -> AppResult<()> {
        let _guard = self.begin().await;
        let old = resolve(self.state, old_path)?;
        let new = resolve(self.state, new_path)?;
        if fs::try_exists(&new).await.map_err(AppError::io)? {
            return Err(AppError::conflict(
                "Destination file or directory already exists",
            ));
        }
        fs::rename(&old, &new).await.map_err(AppError::io)?;
        if let Err(error) = self.state.database.transaction(|transaction| {
            path_metadata::moved_in_transaction(self.state, transaction, old_path, new_path)
        }) {
            let _ = fs::rename(&new, &old).await;
            return Err(error);
        }
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> AppResult<bool> {
        let _guard = self.begin().await;
        let target = resolve(self.state, path)?;
        let metadata = fs::symlink_metadata(&target).await.map_err(AppError::io)?;
        let staged = sibling_artifact(&target, "delete")?;
        fs::rename(&target, &staged).await.map_err(AppError::io)?;
        if let Err(error) = self.state.database.transaction(|transaction| {
            path_metadata::removed_in_transaction(self.state, transaction, path)
        }) {
            let _ = fs::rename(&staged, &target).await;
            return Err(error);
        }
        remove_path(&staged, metadata.is_dir()).await?;
        Ok(metadata.is_dir())
    }

    pub async fn create_directory(&self, path: &str) -> AppResult<()> {
        let _guard = self.begin().await;
        let target = resolve(self.state, path)?;
        if fs::try_exists(&target).await.map_err(AppError::io)? {
            return Err(AppError::conflict("A folder with this name already exists"));
        }
        fs::create_dir_all(target).await.map_err(AppError::io)
    }

    pub async fn create_file(&self, path: &str, data: &[u8]) -> AppResult<String> {
        let _guard = self.begin().await;
        self.create_file_unlocked(path, data).await
    }

    async fn create_file_unlocked(&self, path: &str, data: &[u8]) -> AppResult<String> {
        let target = resolve(self.state, path)?;
        prepare_parent(&target).await?;
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)
            .await
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    AppError::conflict("A file with this name already exists")
                } else {
                    AppError::io(error)
                }
            })?;
        file.write_all(data).await.map_err(AppError::io)?;
        if let Err(error) = self.state.database.transaction(|transaction| {
            path_metadata::content_replaced_in_transaction(transaction, path)
        }) {
            drop(file);
            let _ = fs::remove_file(&target).await;
            return Err(error);
        }
        Ok(content_hash(data))
    }

    pub async fn edit_file(
        &self,
        path: &str,
        data: &[u8],
        expected_hash: Option<&str>,
        expected_version: Option<f64>,
    ) -> AppResult<String> {
        let _guard = self.begin().await;
        self.edit_file_unlocked(path, data, expected_hash, expected_version)
            .await
    }

    async fn edit_file_unlocked(
        &self,
        path: &str,
        data: &[u8],
        expected_hash: Option<&str>,
        expected_version: Option<f64>,
    ) -> AppResult<String> {
        let target = resolve(self.state, path)?;
        let metadata = fs::metadata(&target).await.map_err(AppError::io)?;
        if metadata.is_dir() {
            return Err(AppError::conflict(
                "A folder cannot be replaced with a file",
            ));
        }
        let previous = fs::read(&target).await.map_err(AppError::io)?;
        if expected_hash.is_some_and(|expected| expected != content_hash(&previous)) {
            return Err(AppError::conflict("File changed since it was loaded"));
        }
        if let Some(expected) = expected_version {
            let current = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_secs_f64() * 1000.0)
                .unwrap_or(0.0);
            if (current - expected).abs() >= 1.0 {
                return Err(AppError::conflict(
                    "File changed since the replacement was prepared",
                ));
            }
        }
        write_file_with_rollback(&target, data, &previous, || {
            self.state.database.transaction(|transaction| {
                path_metadata::content_replaced_in_transaction(transaction, path)
            })
        })
        .await?;
        Ok(content_hash(data))
    }

    pub async fn upsert_file(&self, path: &str, data: &[u8]) -> AppResult<String> {
        let _guard = self.begin().await;
        if fs::try_exists(resolve(self.state, path)?)
            .await
            .map_err(AppError::io)?
        {
            self.edit_file_unlocked(path, data, None, None).await
        } else {
            self.create_file_unlocked(path, data).await
        }
    }

    pub async fn copy(&self, source_path: &str, destination_path: &str) -> AppResult<()> {
        let _guard = self.begin().await;
        let source = resolve(self.state, source_path)?;
        let destination = resolve(self.state, destination_path)?;
        let metadata = fs::symlink_metadata(&source).await.map_err(AppError::io)?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::forbidden(
                "Cannot copy symbolic links through a media directory",
            ));
        }
        if fs::try_exists(&destination).await.map_err(AppError::io)? {
            return Err(AppError::conflict(
                "Destination file or directory already exists",
            ));
        }
        if metadata.is_file() {
            let data = fs::read(source).await.map_err(AppError::io)?;
            self.create_file_unlocked(destination_path, &data).await?;
            return Ok(());
        }
        if crate::logical_path::matches(destination_path, source_path) {
            return Err(AppError::bad("Cannot copy a folder inside itself"));
        }
        if let Err(error) = copy_directory_tree(&source, &destination).await {
            let _ = fs::remove_dir_all(&destination).await;
            return Err(error);
        }
        Ok(())
    }
}

pub(crate) fn content_hash(content: &[u8]) -> String {
    Sha256::digest(content)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn resolve(state: &AppState, logical: &str) -> AppResult<PathBuf> {
    Ok(media::resolve(&state.config, logical)?.full)
}

async fn write_file_with_rollback(
    target: &Path,
    data: &[u8],
    previous: &[u8],
    update_metadata: impl FnOnce() -> AppResult<()>,
) -> AppResult<()> {
    fs::write(target, data).await.map_err(AppError::io)?;
    if let Err(error) = update_metadata() {
        fs::write(target, previous).await.map_err(|restore_error| {
            AppError::internal(format!(
                "{}; failed to restore previous file content: {restore_error}",
                error.1
            ))
        })?;
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_metadata_update_restores_previous_file_content() {
        let path =
            std::env::temp_dir().join(format!("derp-edit-rollback-{}.txt", uuid::Uuid::new_v4()));
        fs::write(&path, b"before").await.unwrap();

        let result = write_file_with_rollback(&path, b"after", b"before", || {
            Err(AppError::internal("metadata failed"))
        })
        .await;

        assert!(result.is_err());
        assert_eq!(fs::read(&path).await.unwrap(), b"before");
        fs::remove_file(path).await.unwrap();
    }
}

fn sibling_artifact(target: &Path, operation: &str) -> AppResult<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::internal("Cannot stage a path without a parent"))?;
    Ok(parent.join(format!(".derp-{operation}-{}", uuid::Uuid::new_v4())))
}

async fn prepare_parent(target: &Path) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).await.map_err(AppError::io)?;
    }
    Ok(())
}

async fn remove_path(path: &Path, is_directory: bool) -> AppResult<()> {
    if is_directory {
        fs::remove_dir_all(path).await.map_err(AppError::io)
    } else {
        fs::remove_file(path).await.map_err(AppError::io)
    }
}

async fn copy_directory_tree(source: &Path, destination: &Path) -> AppResult<()> {
    fs::create_dir(destination).await.map_err(AppError::io)?;
    let mut directory = fs::read_dir(source).await.map_err(AppError::io)?;
    while let Some(entry) = directory.next_entry().await.map_err(AppError::io)? {
        let source = entry.path();
        let destination = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source).await.map_err(AppError::io)?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::forbidden(
                "Cannot copy symbolic links through a media directory",
            ));
        }
        if metadata.is_dir() {
            Box::pin(copy_directory_tree(&source, &destination)).await?;
        } else if metadata.is_file() {
            fs::copy(&source, &destination)
                .await
                .map_err(AppError::io)?;
        } else {
            return Err(AppError::bad("Unsupported file type in copied directory"));
        }
    }
    Ok(())
}
