mod create_path;
mod journal;
mod types;

pub(crate) use create_path::*;
pub(crate) use types::*;

use crate::{
    access::{AccessError, AccessErrorCode, AccessPolicy, Action, Principal, RequestContext},
    config::{Config, MediaRoot},
    file_search::FileSearch,
    media, path_metadata,
    resources::{ReadSurface, ResourceCatalog, ResourceDetail, ResourceKind, ResourceRef},
    shares::{self, GrantId},
    state_db,
};
use journal::{
    CommandJournal, JournalOperation, JournalRecord, JournalState, JournalWriteMode,
    NewJournalRecord,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    fs,
    io::AsyncWriteExt,
    sync::{Mutex, RwLock, broadcast},
};

pub(crate) fn initialize(config: &Config) -> Result<(), String> {
    journal::initialize(&state_db::database(config))
}

pub(crate) struct ContentCommands {
    config: Config,
    runtime_roots: Arc<RwLock<Vec<MediaRoot>>>,
    access: Arc<AccessPolicy>,
    resources: Arc<ResourceCatalog>,
    journal: CommandJournal,
    operations: Mutex<()>,
    admin_events: broadcast::Sender<Value>,
    command_events: broadcast::Sender<CommandEventEnvelope>,
    file_search: Arc<FileSearch>,
}

impl ContentCommands {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        config: Config,
        runtime_roots: Arc<RwLock<Vec<MediaRoot>>>,
        access: Arc<AccessPolicy>,
        resources: Arc<ResourceCatalog>,
        admin_events: broadcast::Sender<Value>,
        command_events: broadcast::Sender<CommandEventEnvelope>,
        file_search: Arc<FileSearch>,
    ) -> Self {
        Self {
            journal: CommandJournal::new(state_db::database(&config), config.library_key.clone()),
            config,
            runtime_roots,
            access,
            resources,
            operations: Mutex::new(()),
            admin_events,
            command_events,
            file_search,
        }
    }

    pub(crate) async fn execute(
        &self,
        context: &RequestContext,
        command: ContentCommand,
    ) -> Result<CommandReceipt, CommandError> {
        let request_digest = command_digest(&command.operation)?;
        self.execute_with_digest(context, command, request_digest)
            .await
    }

    pub(crate) async fn execute_with_request_digest(
        &self,
        context: &RequestContext,
        command: ContentCommand,
        request_digest: String,
    ) -> Result<CommandReceipt, CommandError> {
        if request_digest.len() != 64
            || !request_digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(CommandError::new(
                CommandErrorCode::InvalidRequest,
                "Request digest must be a SHA-256 hex digest",
            ));
        }
        self.execute_with_digest(context, command, request_digest)
            .await
    }

    async fn execute_with_digest(
        &self,
        context: &RequestContext,
        command: ContentCommand,
        request_digest: String,
    ) -> Result<CommandReceipt, CommandError> {
        validate_idempotency_key(&command.idempotency_key)?;
        let _operation = self.operations.lock().await;
        let (principal_kind, principal_id) = principal_key(&context.principal);
        if let Some(record) =
            self.journal
                .find(principal_kind, &principal_id, &command.idempotency_key)?
        {
            if record.request_digest != request_digest {
                return Err(CommandError::new(
                    CommandErrorCode::IdempotencyConflict,
                    "Idempotency key was already used for a different command",
                ));
            }
            return self
                .resume(record, operation_payload(&command.operation))
                .await;
        }

        let command_id = format!("command-{}", uuid::Uuid::new_v4());
        let operation = self
            .prepare_operation(context, &command.operation, &command_id)
            .await?;
        let record = self.journal.insert(NewJournalRecord {
            command_id,
            principal_kind: principal_kind.into(),
            principal_id,
            idempotency_key: command.idempotency_key,
            request_digest,
            operation,
        })?;
        self.resume(record, operation_payload(&command.operation))
            .await
    }

    pub(crate) async fn retry(
        &self,
        context: &RequestContext,
        command_id: &str,
    ) -> Result<CommandReceipt, CommandError> {
        let _operation = self.operations.lock().await;
        let record = self
            .journal
            .by_id(command_id)?
            .ok_or_else(|| CommandError::new(CommandErrorCode::NotFound, "Command not found"))?;
        let (kind, id) = principal_key(&context.principal);
        if record.principal_kind != kind || record.principal_id != id {
            return Err(CommandError::new(
                CommandErrorCode::Forbidden,
                "Command belongs to a different Principal",
            ));
        }
        self.resume(record, None).await
    }

    pub(crate) async fn replay_request(
        &self,
        context: &RequestContext,
        idempotency_key: &str,
        request_digest: &str,
        payload: Option<&[u8]>,
    ) -> Result<Option<CommandReceipt>, CommandError> {
        validate_idempotency_key(idempotency_key)?;
        let _operation = self.operations.lock().await;
        let (kind, id) = principal_key(&context.principal);
        let Some(record) = self.journal.find(kind, &id, idempotency_key)? else {
            return Ok(None);
        };
        if record.request_digest != request_digest {
            return Err(CommandError::new(
                CommandErrorCode::IdempotencyConflict,
                "Idempotency key was already used for a different command",
            ));
        }
        self.resume(record, payload).await.map(Some)
    }

    pub(crate) async fn recover_pending(&self) -> Result<(), CommandError> {
        let _operation = self.operations.lock().await;
        for record in self.journal.recoverable()? {
            if let Err(error) = self.resume(record.clone(), None).await {
                let message = format!("Startup command recovery failed: {}", error.message);
                eprintln!("{message} ({})", record.command_id);
            }
        }
        Ok(())
    }

    async fn prepare_operation(
        &self,
        context: &RequestContext,
        operation: &ContentOperation,
        command_id: &str,
    ) -> Result<JournalOperation, CommandError> {
        match operation {
            ContentOperation::CreateFolder {
                destination_parent,
                child_name,
                expected_parent_version,
                attachment_anchor,
            } => {
                let action = attachment_anchor
                    .clone()
                    .map(|anchor| Action::CreateAttachmentDirectory { anchor })
                    .unwrap_or(Action::Create);
                let destination = self
                    .access
                    .authorize_child(context, action, destination_parent, child_name.as_str())
                    .await
                    .map_err(access_error)?;
                require_version(
                    &destination.parent.detail,
                    expected_parent_version.as_ref(),
                    "Destination parent changed",
                )?;
                if destination.resolved.full.exists() {
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Destination file or directory already exists",
                    ));
                }
                Ok(JournalOperation::CreateFolder {
                    destination_parent: destination_parent.clone(),
                    path: destination.logical_path,
                    expected_parent_version: expected_parent_version.clone(),
                    staging_path: Some(staging_path(&destination.resolved.full, command_id, true)),
                })
            }
            ContentOperation::CreateFile {
                destination_parent,
                child_name,
                expected_parent_version,
                content,
                accounted_bytes,
                attachment_anchor,
            }
            | ContentOperation::UploadFile {
                destination_parent,
                child_name,
                expected_parent_version,
                content,
                accounted_bytes,
                attachment_anchor,
            } => {
                let upload = matches!(operation, ContentOperation::UploadFile { .. });
                let action = attachment_anchor
                    .clone()
                    .map(|anchor| Action::UploadAttachment {
                        anchor,
                        bytes: *accounted_bytes,
                    })
                    .unwrap_or(Action::Upload {
                        bytes: *accounted_bytes,
                    });
                let destination = self
                    .access
                    .authorize_child(context, action, destination_parent, child_name.as_str())
                    .await
                    .map_err(access_error)?;
                require_version(
                    &destination.parent.detail,
                    expected_parent_version.as_ref(),
                    "Destination parent changed",
                )?;
                let existing = if destination.resolved.full.exists() {
                    Some(
                        self.resources
                            .compatibility()
                            .resolve_filesystem(&destination.logical_path, ReadSurface::Library)
                            .await?,
                    )
                } else {
                    None
                };
                if !upload && existing.is_some() {
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Destination file or directory already exists",
                    ));
                }
                if existing
                    .as_ref()
                    .is_some_and(|summary| summary.kind != ResourceKind::File)
                {
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "A folder cannot be replaced with a file",
                    ));
                }
                Ok(JournalOperation::WriteFile {
                    mode: if upload {
                        JournalWriteMode::Upload
                    } else {
                        JournalWriteMode::Create
                    },
                    destination_parent: Some(destination_parent.clone()),
                    target: existing.as_ref().map(|summary| summary.reference.clone()),
                    path: destination.logical_path,
                    staging_path: staging_path(&destination.resolved.full, command_id, false),
                    payload_digest: digest_bytes(content),
                    payload_len: content.len() as u64,
                    accounted_bytes: *accounted_bytes,
                    expected_parent_version: expected_parent_version.clone(),
                    expected_target_version: existing.and_then(|summary| summary.version),
                })
            }
            ContentOperation::ReplaceFile {
                target,
                expected_version,
                content,
                accounted_bytes,
            } => {
                let authorized = self
                    .access
                    .authorize(
                        context,
                        Action::Replace {
                            bytes: *accounted_bytes,
                        },
                        target,
                    )
                    .await
                    .map_err(access_error)?;
                if authorized.detail.summary.kind != ResourceKind::File {
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "A folder cannot be replaced with a file",
                    ));
                }
                require_version(
                    &authorized.detail,
                    Some(expected_version),
                    "File changed since replacement was prepared",
                )?;
                Ok(JournalOperation::WriteFile {
                    mode: JournalWriteMode::Replace,
                    destination_parent: None,
                    target: Some(target.clone()),
                    path: authorized.logical_path,
                    staging_path: staging_path(&authorized.resolved.full, command_id, false),
                    payload_digest: digest_bytes(content),
                    payload_len: content.len() as u64,
                    accounted_bytes: *accounted_bytes,
                    expected_parent_version: None,
                    expected_target_version: Some(expected_version.clone()),
                })
            }
            ContentOperation::Copy {
                source,
                destination_parent,
                target_name,
                expected_source_version,
                expected_destination_parent_version,
            } => {
                let source_authorized = self
                    .access
                    .authorize(context, Action::Read, source)
                    .await
                    .map_err(access_error)?;
                require_version(
                    &source_authorized.detail,
                    expected_source_version.as_ref(),
                    "Source changed before copy",
                )?;
                let source_snapshot = path_snapshot(&source_authorized.resolved.full).await?;
                let accounted_bytes = source_snapshot.bytes;
                let source_digest = source_snapshot.digest;
                let destination = self
                    .access
                    .authorize_child(
                        context,
                        Action::Copy {
                            bytes: accounted_bytes,
                        },
                        destination_parent,
                        target_name.as_str(),
                    )
                    .await
                    .map_err(access_error)?;
                require_version(
                    &destination.parent.detail,
                    expected_destination_parent_version.as_ref(),
                    "Destination parent changed before copy",
                )?;
                if destination.resolved.full.exists() {
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Destination file or directory already exists",
                    ));
                }
                let source_is_directory = matches!(
                    source_authorized.detail.summary.kind,
                    ResourceKind::Folder | ResourceKind::Source
                );
                if source_is_directory
                    && path_is_same_or_descendant(
                        &destination.resolved.full,
                        &source_authorized.resolved.full,
                    )
                {
                    return Err(CommandError::new(
                        CommandErrorCode::InvalidRequest,
                        "Cannot copy a folder inside itself",
                    ));
                }
                Ok(JournalOperation::Copy {
                    source: source.clone(),
                    destination_parent: destination_parent.clone(),
                    source_path: source_authorized.logical_path,
                    destination_path: destination.logical_path,
                    staging_path: staging_path(
                        &destination.resolved.full,
                        command_id,
                        source_is_directory,
                    ),
                    source_is_directory,
                    source_digest: Some(source_digest),
                    expected_source_version: expected_source_version
                        .clone()
                        .or(source_authorized.detail.summary.version),
                    expected_parent_version: expected_destination_parent_version.clone(),
                    accounted_bytes,
                })
            }
            ContentOperation::Move {
                source,
                destination_parent,
                target_name,
                expected_source_version,
                expected_destination_parent_version,
            } => {
                let source_authorized = self
                    .access
                    .authorize(context, Action::Move, source)
                    .await
                    .map_err(access_error)?;
                if source_authorized.detail.summary.kind == ResourceKind::Source {
                    return Err(CommandError::new(
                        CommandErrorCode::InvalidRequest,
                        "Configured Source roots cannot be moved",
                    ));
                }
                require_version(
                    &source_authorized.detail,
                    expected_source_version.as_ref(),
                    "Source changed before move",
                )?;
                let source_digest = path_digest(&source_authorized.resolved.full).await?;
                let destination = self
                    .access
                    .authorize_child(
                        context,
                        Action::Move,
                        destination_parent,
                        target_name.as_str(),
                    )
                    .await
                    .map_err(access_error)?;
                require_version(
                    &destination.parent.detail,
                    expected_destination_parent_version.as_ref(),
                    "Destination parent changed before move",
                )?;
                if destination.resolved.full.exists() {
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Destination file or directory already exists",
                    ));
                }
                if source_authorized.detail.summary.kind == ResourceKind::Folder
                    && path_is_same_or_descendant(
                        &destination.resolved.full,
                        &source_authorized.resolved.full,
                    )
                {
                    return Err(CommandError::new(
                        CommandErrorCode::InvalidRequest,
                        "Cannot move a folder inside itself",
                    ));
                }
                Ok(JournalOperation::Move {
                    source: source.clone(),
                    destination_parent: destination_parent.clone(),
                    source_path: source_authorized.logical_path,
                    destination_path: destination.logical_path,
                    staging_path: staging_path(&destination.resolved.full, command_id, true),
                    source_is_directory: source_authorized.detail.summary.kind
                        == ResourceKind::Folder,
                    source_digest: Some(source_digest),
                    expected_source_version: expected_source_version
                        .clone()
                        .or(source_authorized.detail.summary.version),
                    expected_parent_version: expected_destination_parent_version.clone(),
                })
            }
            ContentOperation::Delete {
                target,
                expected_version,
                attachment_anchor,
                quota_refund,
            } => {
                let action = attachment_anchor
                    .clone()
                    .map(|anchor| Action::DeleteAttachment { anchor })
                    .unwrap_or(Action::Delete);
                let authorized = self
                    .access
                    .authorize(context, action, target)
                    .await
                    .map_err(access_error)?;
                if authorized.detail.summary.kind == ResourceKind::Source {
                    return Err(CommandError::new(
                        CommandErrorCode::InvalidRequest,
                        "Configured Source roots cannot be deleted",
                    ));
                }
                require_version(
                    &authorized.detail,
                    expected_version.as_ref(),
                    "Resource changed before deletion",
                )?;
                let target_digest = path_digest(&authorized.resolved.full).await?;
                Ok(JournalOperation::Delete {
                    target: target.clone(),
                    path: authorized.logical_path,
                    target_is_directory: authorized.detail.summary.kind == ResourceKind::Folder,
                    target_digest: Some(target_digest),
                    expected_version: expected_version
                        .clone()
                        .or(authorized.detail.summary.version),
                    quota_refund: *quota_refund,
                })
            }
        }
    }

    async fn resume(
        &self,
        mut record: JournalRecord,
        payload: Option<&[u8]>,
    ) -> Result<CommandReceipt, CommandError> {
        if record.state == JournalState::Completed {
            let _ = self.cleanup_staging(&record.operation).await;
            return record.receipt.ok_or_else(|| {
                CommandError::new(
                    CommandErrorCode::Internal,
                    "Completed command is missing its receipt",
                )
            });
        }
        if record.state == JournalState::Failed {
            let mut error = CommandError::new(
                CommandErrorCode::Conflict,
                record.error.unwrap_or_else(|| "Command failed".into()),
            );
            error.command_id = Some(record.command_id);
            return Err(error);
        }

        let result: Result<CommandReceipt, CommandError> = async {
            if record.state != JournalState::FilesystemApplied {
                self.apply_filesystem(&mut record, payload).await?;
                self.journal
                    .mark_state(&record.command_id, JournalState::FilesystemApplied)?;
                record.state = JournalState::FilesystemApplied;
            } else {
                self.verify_filesystem_applied(&record).await?;
            }
            let receipt = self.finalize(&record).await?;
            self.cleanup_staging(&record.operation).await?;
            self.publish(&receipt.event);
            self.journal.mark_completed(&record.command_id, &receipt)?;
            Ok(receipt)
        }
        .await;

        match result {
            Ok(receipt) => Ok(receipt),
            Err(error) => {
                let message = error.message.clone();
                if matches!(
                    record.state,
                    JournalState::Prepared | JournalState::NeedsReconciliation
                ) {
                    self.journal
                        .mark_needs_reconciliation(&record.command_id, &message)?;
                } else {
                    self.journal
                        .record_reconciliation_error(&record.command_id, &message)?;
                }
                Err(CommandError::reconciliation(record.command_id, message))
            }
        }
    }

    async fn apply_filesystem(
        &self,
        record: &mut JournalRecord,
        payload: Option<&[u8]>,
    ) -> Result<(), CommandError> {
        self.ensure_create_folder_staging_path(record).await?;
        match &record.operation {
            JournalOperation::CreateFolder {
                destination_parent,
                path,
                expected_parent_version,
                staging_path,
            } => {
                let resolved = self.resolve_command_path(destination_parent, path).await?;
                let destination = resolved.full;
                let staging = PathBuf::from(staging_path.as_deref().ok_or_else(|| {
                    CommandError::new(
                        CommandErrorCode::Internal,
                        "Folder command is missing its staging path",
                    )
                })?);
                let destination_exists = path_exists(&destination).await?;
                let staging_exists = path_exists(&staging).await?;
                if matches!(
                    record.state,
                    JournalState::Prepared | JournalState::NeedsReconciliation
                ) && !destination_exists
                    && !staging_exists
                {
                    self.verify_current_version(
                        destination_parent,
                        expected_parent_version.as_ref(),
                        "Destination parent changed during recovery",
                    )
                    .await?;
                }
                validate_staging_path(&resolved.root.path, &staging).await?;
                let marker = completion_marker(&staging);
                let marker_exists = path_exists(&marker).await?;
                let marker_valid = marker_exists && folder_stage_marker_matches(&marker).await?;
                if marker_exists && !marker_valid {
                    return Err(CommandError::new(
                        CommandErrorCode::NeedsReconciliation,
                        "Folder staging evidence was modified",
                    ));
                }
                match (destination_exists, staging_exists) {
                    (true, true) => Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Folder destination was created outside this command",
                    )),
                    (true, false) if record.state == JournalState::Staged && marker_valid => {
                        let metadata = fs::symlink_metadata(&destination)
                            .await
                            .map_err(filesystem_error)?;
                        if metadata.is_dir() && !metadata.file_type().is_symlink() {
                            Ok(())
                        } else {
                            Err(CommandError::new(
                                CommandErrorCode::Conflict,
                                "Folder destination changed kind during recovery",
                            ))
                        }
                    }
                    (true, false) => Err(CommandError::new(
                        CommandErrorCode::NeedsReconciliation,
                        "Existing folder destination has no command-owned evidence",
                    )),
                    (false, false) if record.state == JournalState::Staged => {
                        Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Staged folder and destination are both missing",
                        ))
                    }
                    (false, false) => {
                        fs::create_dir(&staging).await.map_err(filesystem_error)?;
                        mark_stage_complete(&staging).await?;
                        self.journal
                            .mark_state(&record.command_id, JournalState::Staged)?;
                        record.state = JournalState::Staged;
                        fs::rename(&staging, &destination)
                            .await
                            .map_err(filesystem_error)
                    }
                    (false, true) if !marker_valid => Err(CommandError::new(
                        CommandErrorCode::NeedsReconciliation,
                        "Staged folder has no command-owned evidence",
                    )),
                    (false, true) if !directory_is_empty(&staging).await? => {
                        Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Staged folder contains unexpected content",
                        ))
                    }
                    (false, true) => {
                        self.journal
                            .mark_state(&record.command_id, JournalState::Staged)?;
                        record.state = JournalState::Staged;
                        fs::rename(&staging, &destination)
                            .await
                            .map_err(filesystem_error)
                    }
                }
            }
            JournalOperation::WriteFile {
                target,
                path,
                staging_path,
                payload_digest,
                payload_len,
                expected_target_version,
                destination_parent,
                expected_parent_version,
                ..
            } => {
                let anchor = target
                    .as_ref()
                    .or(destination_parent.as_ref())
                    .ok_or_else(|| {
                        CommandError::new(
                            CommandErrorCode::Internal,
                            "Write command is missing a durable path anchor",
                        )
                    })?;
                let resolved = self.resolve_command_path(anchor, path).await?;
                let destination = resolved.full;
                let staging = PathBuf::from(staging_path);
                let backup = replacement_backup(&staging);
                if target.is_none() && path_exists(&destination).await? {
                    if record.state == JournalState::Staged
                        && !path_exists(&staging).await?
                        && file_matches(&destination, payload_digest, *payload_len).await?
                    {
                        return Ok(());
                    }
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Destination was created by another operation",
                    ));
                }
                if let Some(target) = target
                    && file_matches(&destination, payload_digest, *payload_len).await?
                {
                    if path_exists(&backup).await? && record.state == JournalState::Staged {
                        return Ok(());
                    }
                    self.verify_current_version(
                        target,
                        expected_target_version.as_ref(),
                        "Replacement target changed during recovery",
                    )
                    .await?;
                    return Ok(());
                }
                let staging_exists = path_exists(&staging).await?;
                if matches!(
                    record.state,
                    JournalState::Prepared | JournalState::NeedsReconciliation
                ) && !staging_exists
                    && let Some(parent) = destination_parent
                {
                    self.verify_current_version(
                        parent,
                        expected_parent_version.as_ref(),
                        "Destination parent changed during recovery",
                    )
                    .await?;
                }
                let staging_matches = file_matches(&staging, payload_digest, *payload_len).await?;
                let bytes_to_stage = if staging_matches {
                    None
                } else {
                    let bytes = payload.ok_or_else(|| {
                        CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Upload payload was not fully staged before interruption; resend original request",
                        )
                    })?;
                    if digest_bytes(bytes) != *payload_digest || bytes.len() as u64 != *payload_len
                    {
                        return Err(CommandError::new(
                            CommandErrorCode::IdempotencyConflict,
                            "Retried payload differs from prepared command",
                        ));
                    }
                    Some(bytes)
                };
                validate_staging_path(&resolved.root.path, &staging).await?;
                if let Some(bytes) = bytes_to_stage {
                    write_stage(&staging, bytes).await?;
                }
                if let Some(target) = target {
                    let backup_exists = path_exists(&backup).await?;
                    if backup_exists && record.state != JournalState::Staged {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Replacement backup exists without staged journal evidence",
                        ));
                    }
                    if !backup_exists {
                        self.verify_current_version(
                            target,
                            expected_target_version.as_ref(),
                            "Replacement target changed during recovery",
                        )
                        .await?;
                    }
                }
                self.journal
                    .mark_state(&record.command_id, JournalState::Staged)?;
                record.state = JournalState::Staged;
                if target.is_some() {
                    replace_staged(&staging, &destination, &backup).await?;
                } else {
                    rename_staged(&staging, &destination).await?;
                }
                if !file_matches(&destination, payload_digest, *payload_len).await? {
                    return Err(CommandError::new(
                        CommandErrorCode::NeedsReconciliation,
                        "Written file does not match staged content",
                    ));
                }
                Ok(())
            }
            JournalOperation::Copy {
                source: source_reference,
                source_path,
                destination_path,
                staging_path,
                source_is_directory,
                source_digest,
                expected_source_version,
                destination_parent,
                expected_parent_version,
                accounted_bytes,
            } => {
                let source = self
                    .resolve_command_path(source_reference, source_path)
                    .await?
                    .full;
                let resolved_destination = self
                    .resolve_command_path(destination_parent, destination_path)
                    .await?;
                let destination = resolved_destination.full;
                let staging = PathBuf::from(staging_path);
                if path_exists(&destination).await? {
                    let owned = record.state == JournalState::Staged
                        && source_digest.is_some()
                        && path_matches_digest(&destination, source_digest.as_deref()).await?;
                    if owned {
                        return Ok(());
                    }
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Copy destination was created by another operation",
                    ));
                }
                let staging_exists = path_exists(&staging).await?;
                if matches!(
                    record.state,
                    JournalState::Prepared | JournalState::NeedsReconciliation
                ) && !staging_exists
                {
                    self.verify_current_version(
                        destination_parent,
                        expected_parent_version.as_ref(),
                        "Copy destination parent changed during recovery",
                    )
                    .await?;
                }
                validate_staging_path(&resolved_destination.root.path, &staging).await?;
                let marker = completion_marker(&staging);
                if path_exists(&staging).await? && !path_exists(&marker).await? {
                    remove_path(&staging).await?;
                }
                if !path_exists(&staging).await? {
                    self.verify_current_version(
                        source_reference,
                        expected_source_version.as_ref(),
                        "Copy source changed during recovery",
                    )
                    .await?;
                    copy_path(&source, &staging, *source_is_directory).await?;
                    mark_stage_complete(&staging).await?;
                }
                let staged_snapshot = path_snapshot(&staging).await?;
                if staged_snapshot.bytes != *accounted_bytes {
                    return Err(CommandError::new(
                        CommandErrorCode::NeedsReconciliation,
                        "Staged copy byte count differs from its authorized quota snapshot",
                    ));
                }
                if let Some(expected_digest) = source_digest {
                    if staged_snapshot.digest != *expected_digest {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Staged copy differs from its prepared source snapshot",
                        ));
                    }
                } else if !paths_match(&source, &staging).await? {
                    return Err(CommandError::new(
                        CommandErrorCode::NeedsReconciliation,
                        "Staged copy does not match its source",
                    ));
                }
                self.verify_current_version(
                    source_reference,
                    expected_source_version.as_ref(),
                    "Copy source changed while it was staged",
                )
                .await?;
                self.journal
                    .mark_state(&record.command_id, JournalState::Staged)?;
                record.state = JournalState::Staged;
                rename_staged(&staging, &destination).await?;
                Ok(())
            }
            JournalOperation::Move {
                source: source_reference,
                source_path,
                destination_path,
                staging_path,
                source_is_directory,
                source_digest,
                expected_source_version,
                destination_parent,
                expected_parent_version,
            } => {
                let source = self
                    .resolve_command_path(source_reference, source_path)
                    .await?
                    .full;
                let resolved_destination = self
                    .resolve_command_path(destination_parent, destination_path)
                    .await?;
                let destination = resolved_destination.full;
                let staging = PathBuf::from(staging_path);
                let marker = completion_marker(&staging);
                let source_exists = path_exists(&source).await?;
                let destination_exists = path_exists(&destination).await?;
                match (source_exists, destination_exists) {
                    (false, true) => {
                        let digest_matches = source_digest.is_some()
                            && path_matches_digest(&destination, source_digest.as_deref()).await?;
                        let owned = if record.state == JournalState::Staged {
                            digest_matches
                        } else if matches!(
                            record.state,
                            JournalState::Prepared | JournalState::NeedsReconciliation
                        ) {
                            digest_matches
                                && self
                                    .resources
                                    .command_destination_matches(source_reference, destination_path)
                                    .await?
                        } else {
                            false
                        };
                        if owned {
                            return Ok(());
                        }
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Move destination cannot be proven to belong to this command",
                        ));
                    }
                    (false, false) => {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Move source and destination are both missing",
                        ));
                    }
                    (true, true) => {
                        if record.state != JournalState::Staged
                            || !paths_match(&source, &destination).await?
                            || !path_matches_digest(&destination, source_digest.as_deref()).await?
                        {
                            return Err(CommandError::new(
                                CommandErrorCode::Conflict,
                                "Move destination conflicts with source",
                            ));
                        }
                        remove_path(&source).await?;
                        return Ok(());
                    }
                    (true, false) => {}
                }

                let staging_exists = path_exists(&staging).await?;
                if matches!(
                    record.state,
                    JournalState::Prepared | JournalState::NeedsReconciliation
                ) && !staging_exists
                {
                    self.verify_current_version(
                        destination_parent,
                        expected_parent_version.as_ref(),
                        "Move destination parent changed during recovery",
                    )
                    .await?;
                }
                validate_staging_path(&resolved_destination.root.path, &staging).await?;
                if path_exists(&staging).await? {
                    if !path_exists(&marker).await? {
                        remove_path(&staging).await?;
                    }
                }
                if path_exists(&staging).await? {
                    rename_staged(&staging, &destination).await?;
                    if !paths_match(&source, &destination).await?
                        || !path_matches_digest(&destination, source_digest.as_deref()).await?
                    {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Cross-volume move copy does not match source",
                        ));
                    }
                    remove_path(&source).await?;
                    return Ok(());
                }

                self.verify_current_version(
                    source_reference,
                    expected_source_version.as_ref(),
                    "Move source changed during recovery",
                )
                .await?;
                if !path_matches_digest(&source, source_digest.as_deref()).await? {
                    return Err(CommandError::new(
                        CommandErrorCode::NeedsReconciliation,
                        "Move source differs from its prepared content snapshot",
                    ));
                }

                match fs::rename(&source, &destination).await {
                    Ok(()) => {
                        if !path_matches_digest(&destination, source_digest.as_deref()).await? {
                            return Err(CommandError::new(
                                CommandErrorCode::NeedsReconciliation,
                                "Moved destination differs from its prepared source snapshot",
                            ));
                        }
                        Ok(())
                    }
                    Err(error) if is_cross_device(&error) => {
                        copy_path(&source, &staging, *source_is_directory).await?;
                        mark_stage_complete(&staging).await?;
                        if !path_matches_digest(&staging, source_digest.as_deref()).await? {
                            return Err(CommandError::new(
                                CommandErrorCode::NeedsReconciliation,
                                "Cross-volume move stage differs from its prepared source snapshot",
                            ));
                        }
                        self.journal
                            .mark_state(&record.command_id, JournalState::Staged)?;
                        record.state = JournalState::Staged;
                        rename_staged(&staging, &destination).await?;
                        if !paths_match(&source, &destination).await?
                            || !path_matches_digest(&destination, source_digest.as_deref()).await?
                        {
                            return Err(CommandError::new(
                                CommandErrorCode::NeedsReconciliation,
                                "Cross-volume move copy does not match source",
                            ));
                        }
                        remove_path(&source).await
                    }
                    Err(error) => Err(filesystem_error(error)),
                }
            }
            JournalOperation::Delete {
                target,
                path,
                target_is_directory,
                target_digest,
                expected_version,
                ..
            } => {
                let resolved = self.resolve_command_path(target, path).await?;
                let target_path = resolved.full;
                let staged_delete = PathBuf::from(staging_path(
                    &target_path,
                    &record.command_id,
                    *target_is_directory,
                ));
                validate_staging_path(&resolved.root.path, &staged_delete).await?;
                let target_exists = path_exists(&target_path).await?;
                let staged_exists = path_exists(&staged_delete).await?;
                match (target_exists, staged_exists) {
                    (true, true) => {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Deletion target was recreated after staging",
                        ));
                    }
                    (false, true) if record.state != JournalState::Staged => {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Deletion staging exists without journal evidence",
                        ));
                    }
                    (false, true) => {
                        remove_path(&staged_delete).await?;
                        return Ok(());
                    }
                    (false, false) if record.state == JournalState::Staged => return Ok(()),
                    (false, false) => {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Deletion target disappeared before command application",
                        ));
                    }
                    (true, false) => {}
                }
                if path_exists(&target_path).await? {
                    self.verify_current_version(
                        target,
                        expected_version.as_ref(),
                        "Resource changed during deletion recovery",
                    )
                    .await?;
                    if !path_matches_digest(&target_path, target_digest.as_deref()).await? {
                        return Err(CommandError::new(
                            CommandErrorCode::NeedsReconciliation,
                            "Deletion target differs from its prepared content snapshot",
                        ));
                    }
                }
                self.journal
                    .mark_state(&record.command_id, JournalState::Staged)?;
                record.state = JournalState::Staged;
                fs::rename(&target_path, &staged_delete)
                    .await
                    .map_err(filesystem_error)?;
                remove_path(&staged_delete).await?;
                Ok(())
            }
        }
    }

    async fn finalize(&self, record: &JournalRecord) -> Result<CommandReceipt, CommandError> {
        let mut affected_refs = Vec::new();
        let mut resulting_versions = Vec::new();
        let mut old_paths = Vec::new();
        let mut new_paths = Vec::new();
        let mut relocated_grants = Vec::new();
        let (kind, quota_delta) = match &record.operation {
            JournalOperation::CreateFolder { path, .. } => {
                let summary = self.observe(path).await?;
                affected_refs.push(summary.reference.clone());
                resulting_versions.push(ResultingResourceVersion {
                    reference: summary.reference,
                    version: summary.version,
                });
                new_paths.push(path.clone());
                (ContentEventKind::FolderCreated, 0)
            }
            JournalOperation::WriteFile {
                mode,
                target,
                path,
                accounted_bytes,
                ..
            } => {
                let summary = if let Some(target) = target {
                    self.resources.refresh_after_write(target).await?.summary
                } else {
                    self.observe(path).await?
                };
                path_metadata::replace_content(&self.config, path)?;
                affected_refs.push(summary.reference.clone());
                resulting_versions.push(ResultingResourceVersion {
                    reference: summary.reference,
                    version: summary.version,
                });
                new_paths.push(path.clone());
                let kind = match mode {
                    JournalWriteMode::Create => ContentEventKind::FileCreated,
                    JournalWriteMode::Upload => ContentEventKind::FileUploaded,
                    JournalWriteMode::Replace => ContentEventKind::FileReplaced,
                };
                (kind, *accounted_bytes as i64)
            }
            JournalOperation::Copy {
                destination_path,
                accounted_bytes,
                ..
            } => {
                let summary = self.observe(destination_path).await?;
                affected_refs.push(summary.reference.clone());
                resulting_versions.push(ResultingResourceVersion {
                    reference: summary.reference,
                    version: summary.version,
                });
                new_paths.push(destination_path.clone());
                (ContentEventKind::ResourceCopied, *accounted_bytes as i64)
            }
            JournalOperation::Move {
                source,
                source_path,
                destination_path,
                ..
            } => {
                affected_refs.extend(
                    self.resources
                        .record_move(source_path, destination_path)
                        .await?,
                );
                affected_refs.push(source.clone());
                path_metadata::move_path(&self.config, source_path, destination_path)?;
                let runtime = self.runtime_roots.read().await.clone();
                relocated_grants = shares::relocate_content(
                    &self.config,
                    &runtime,
                    source_path,
                    destination_path,
                )?;
                let detail = self
                    .resources
                    .inspect(
                        &crate::resources::ReadContext::owner(ReadSurface::Library),
                        source,
                    )
                    .await?;
                resulting_versions.push(ResultingResourceVersion {
                    reference: detail.summary.reference,
                    version: detail.summary.version,
                });
                old_paths.push(source_path.clone());
                new_paths.push(destination_path.clone());
                (ContentEventKind::ResourceMoved, 0)
            }
            JournalOperation::Delete {
                target,
                path,
                quota_refund,
                ..
            } => {
                affected_refs.extend(self.resources.record_delete(target).await?);
                path_metadata::remove_path(&self.config, path)?;
                old_paths.push(path.clone());
                (ContentEventKind::ResourceDeleted, -(*quota_refund as i64))
            }
        };

        deduplicate_refs(&mut affected_refs);
        if let Principal::Grant(grant_id) = principal_from_record(record)? {
            self.journal
                .apply_quota_once(&record.command_id, &grant_id, quota_delta)?;
        }
        let mut visible_grants = self.visible_grants(record, &old_paths, &new_paths).await?;
        visible_grants.extend(relocated_grants);
        visible_grants.sort_by(|first, second| first.as_str().cmp(second.as_str()));
        visible_grants.dedup();
        let event = CommandEventEnvelope {
            schema_version: 1,
            event_id: format!("event-{}", record.command_id),
            command_id: record.command_id.clone(),
            occurred_at: timestamp_ms(),
            kind,
            scope: CommandEventScope {
                owner: true,
                grant_ids: visible_grants,
            },
            affected_refs: affected_refs.clone(),
            old_paths,
            new_paths,
        };
        Ok(CommandReceipt {
            schema_version: 1,
            command_id: record.command_id.clone(),
            idempotency_key: record.idempotency_key.clone(),
            status: CommandStatus::Completed,
            resulting_versions,
            affected_refs,
            event,
        })
    }

    async fn verify_filesystem_applied(&self, record: &JournalRecord) -> Result<(), CommandError> {
        let valid = match &record.operation {
            JournalOperation::CreateFolder {
                destination_parent,
                path,
                ..
            } => {
                let target = self
                    .resolve_command_path(destination_parent, path)
                    .await?
                    .full;
                fs::metadata(target)
                    .await
                    .map(|metadata| metadata.is_dir())
                    .unwrap_or(false)
            }
            JournalOperation::WriteFile {
                target,
                destination_parent,
                path,
                payload_digest,
                payload_len,
                ..
            } => {
                let anchor = target
                    .as_ref()
                    .or(destination_parent.as_ref())
                    .ok_or_else(|| {
                        CommandError::new(
                            CommandErrorCode::Internal,
                            "Write command is missing a durable path anchor",
                        )
                    })?;
                let target = self.resolve_command_path(anchor, path).await?.full;
                file_matches(&target, payload_digest, *payload_len).await?
            }
            JournalOperation::Copy {
                source,
                destination_parent,
                source_path,
                destination_path,
                source_digest,
                expected_source_version,
                ..
            } => {
                let destination = self
                    .resolve_command_path(destination_parent, destination_path)
                    .await?
                    .full;
                if source_digest.is_some() {
                    path_matches_digest(&destination, source_digest.as_deref()).await?
                } else {
                    self.verify_current_version(
                        source,
                        expected_source_version.as_ref(),
                        "Copy source changed before completion",
                    )
                    .await?;
                    let source = self.resolve_command_path(source, source_path).await?.full;
                    paths_match(&source, &destination).await?
                }
            }
            JournalOperation::Move {
                source,
                destination_parent,
                destination_path,
                source_digest,
                ..
            } => {
                let destination = self
                    .resolve_command_path(destination_parent, destination_path)
                    .await?
                    .full;
                if source_digest.is_some() {
                    path_matches_digest(&destination, source_digest.as_deref()).await?
                } else {
                    self.resources
                        .command_destination_matches(source, destination_path)
                        .await?
                }
            }
            JournalOperation::Delete { target, path, .. } => {
                let target = self.resolve_command_path(target, path).await?.full;
                !path_exists(&target).await?
            }
        };
        if valid {
            Ok(())
        } else {
            Err(CommandError::new(
                CommandErrorCode::NeedsReconciliation,
                "Filesystem result changed before command finalization",
            ))
        }
    }

    async fn observe(
        &self,
        logical_path: &str,
    ) -> Result<crate::resources::ResourceSummary, CommandError> {
        self.resources
            .compatibility()
            .resolve_filesystem(logical_path, ReadSurface::Library)
            .await
            .map_err(Into::into)
    }

    async fn verify_current_version(
        &self,
        reference: &ResourceRef,
        expected: Option<&crate::resources::ResourceVersion>,
        message: &str,
    ) -> Result<(), CommandError> {
        let detail = self
            .resources
            .inspect(
                &crate::resources::ReadContext::owner(ReadSurface::Library),
                reference,
            )
            .await?;
        require_version(&detail, expected, message)
    }

    async fn ensure_create_folder_staging_path(
        &self,
        record: &mut JournalRecord,
    ) -> Result<(), CommandError> {
        let (destination_parent, path) = match &record.operation {
            JournalOperation::CreateFolder {
                destination_parent,
                path,
                staging_path: None,
                ..
            } => (destination_parent.clone(), path.clone()),
            _ => return Ok(()),
        };
        let destination = self
            .resolve_command_path(&destination_parent, &path)
            .await?
            .full;
        let mut operation = record.operation.clone();
        let JournalOperation::CreateFolder { staging_path, .. } = &mut operation else {
            unreachable!();
        };
        *staging_path = Some(staging_path_for_folder(&destination, &record.command_id));
        self.journal
            .update_operation(&record.command_id, &operation)?;
        record.operation = operation;
        Ok(())
    }

    async fn resolve_command_path(
        &self,
        anchor: &ResourceRef,
        logical_path: &str,
    ) -> Result<media::ResolvedPath, CommandError> {
        let anchored = self
            .resources
            .resolve_command_path(anchor, logical_path)
            .await?;
        let runtime = self.runtime_roots.read().await.clone();
        let resolved = media_resolve(&self.config, &runtime, logical_path)?;
        if resolved.full != anchored {
            return Err(CommandError::new(
                CommandErrorCode::NeedsReconciliation,
                "Command path changed source during recovery",
            ));
        }
        Ok(resolved)
    }

    async fn visible_grants(
        &self,
        record: &JournalRecord,
        old_paths: &[String],
        new_paths: &[String],
    ) -> Result<Vec<GrantId>, CommandError> {
        let runtime = self.runtime_roots.read().await.clone();
        let mut visible = shares::read(&self.config, &runtime)?
            .into_iter()
            .filter(|share| {
                old_paths
                    .iter()
                    .chain(new_paths)
                    .any(|path| paths_overlap(&share.path, path))
            })
            .filter_map(|share| share.grant_id)
            .collect::<Vec<_>>();
        if let Principal::Grant(grant_id) = principal_from_record(record)? {
            visible.push(grant_id);
        }
        visible.sort_by(|first, second| first.as_str().cmp(second.as_str()));
        visible.dedup();
        Ok(visible)
    }

    fn publish(&self, event: &CommandEventEnvelope) {
        let _ = self.command_events.send(event.clone());
        let mut paths = event
            .old_paths
            .iter()
            .chain(&event.new_paths)
            .cloned()
            .collect::<Vec<_>>();
        paths.sort();
        paths.dedup();
        for path in paths {
            let directory = crate::app::parent_logical(&path);
            let _ = self.admin_events.send(json!({
                "type":"files-changed",
                "directory":directory,
                "path":path,
                "timestamp":timestamp_ms(),
                "commandId":event.command_id,
            }));
            self.file_search.changed(&directory);
        }
    }

    async fn cleanup_staging(&self, operation: &JournalOperation) -> Result<(), CommandError> {
        let Some(path) = operation.staging_path() else {
            return Ok(());
        };
        let path = PathBuf::from(path);
        let resolved = match operation {
            JournalOperation::CreateFolder {
                destination_parent,
                path,
                ..
            } => self.resolve_command_path(destination_parent, path).await,
            JournalOperation::WriteFile {
                destination_parent,
                target,
                path,
                ..
            } => {
                let Some(anchor) = target.as_ref().or(destination_parent.as_ref()) else {
                    return Ok(());
                };
                self.resolve_command_path(anchor, path).await
            }
            JournalOperation::Copy {
                destination_parent,
                destination_path,
                ..
            }
            | JournalOperation::Move {
                destination_parent,
                destination_path,
                ..
            } => {
                self.resolve_command_path(destination_parent, destination_path)
                    .await
            }
            JournalOperation::Delete { .. } => return Ok(()),
        };
        let resolved = resolved?;
        validate_staging_path(&resolved.root.path, &path).await?;
        if path_exists(&path).await? {
            remove_path(&path).await?;
        }
        for evidence in [completion_marker(&path), replacement_backup(&path)] {
            if path_exists(&evidence).await? {
                remove_path(&evidence).await?;
            }
        }
        Ok(())
    }
}

pub(crate) fn request_digest(value: &Value) -> Result<String, CommandError> {
    serde_json::to_vec(value)
        .map(|bytes| digest_bytes(&bytes))
        .map_err(|error| CommandError::new(CommandErrorCode::Internal, error.to_string()))
}

fn validate_idempotency_key(value: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 200
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Idempotency key must be 1-200 visible non-whitespace characters",
        ));
    }
    Ok(())
}

fn principal_key(principal: &Principal) -> (&'static str, String) {
    match principal {
        Principal::Owner => ("owner", "owner".into()),
        Principal::Grant(grant_id) => ("grant", grant_id.as_str().into()),
    }
}

fn principal_from_record(record: &JournalRecord) -> Result<Principal, CommandError> {
    match record.principal_kind.as_str() {
        "owner" if record.principal_id == "owner" => Ok(Principal::Owner),
        "grant" if !record.principal_id.is_empty() => Ok(Principal::Grant(GrantId::from_stored(
            record.principal_id.clone(),
        ))),
        _ => Err(CommandError::new(
            CommandErrorCode::Internal,
            "Command journal contains an invalid Principal",
        )),
    }
}

fn command_digest(operation: &ContentOperation) -> Result<String, CommandError> {
    let value = match operation {
        ContentOperation::CreateFolder {
            destination_parent,
            child_name,
            expected_parent_version,
            attachment_anchor,
        } => json!({
            "type":"createFolder","destinationParent":destination_parent,
            "childName":child_name.as_str(),"expectedParentVersion":expected_parent_version,
            "attachmentAnchor":attachment_anchor,
        }),
        ContentOperation::CreateFile {
            destination_parent,
            child_name,
            content,
            accounted_bytes,
            expected_parent_version,
            attachment_anchor,
        } => json!({
            "type":"createFile","destinationParent":destination_parent,
            "childName":child_name.as_str(),
            "payloadDigest":digest_bytes(content),"payloadLength":content.len(),
            "accountedBytes":accounted_bytes,"expectedParentVersion":expected_parent_version,
            "attachmentAnchor":attachment_anchor,
        }),
        ContentOperation::UploadFile {
            destination_parent,
            child_name,
            content,
            accounted_bytes,
            expected_parent_version,
            attachment_anchor,
        } => json!({
            "type":"uploadFile","destinationParent":destination_parent,
            "childName":child_name.as_str(),
            "payloadDigest":digest_bytes(content),"payloadLength":content.len(),
            "accountedBytes":accounted_bytes,"expectedParentVersion":expected_parent_version,
            "attachmentAnchor":attachment_anchor,
        }),
        ContentOperation::ReplaceFile {
            target,
            expected_version,
            content,
            accounted_bytes,
        } => json!({
            "type":"replaceFile","target":target,
            "expectedVersion":expected_version,
            "payloadDigest":digest_bytes(content),"payloadLength":content.len(),
            "accountedBytes":accounted_bytes,
        }),
        ContentOperation::Copy {
            source,
            destination_parent,
            target_name,
            expected_source_version,
            expected_destination_parent_version,
        } => json!({
            "type":"copy","source":source,"destinationParent":destination_parent,
            "targetName":target_name.as_str(),"expectedSourceVersion":expected_source_version,
            "expectedDestinationParentVersion":expected_destination_parent_version,
        }),
        ContentOperation::Move {
            source,
            destination_parent,
            target_name,
            expected_source_version,
            expected_destination_parent_version,
        } => json!({
            "type":"move","source":source,"destinationParent":destination_parent,
            "targetName":target_name.as_str(),"expectedSourceVersion":expected_source_version,
            "expectedDestinationParentVersion":expected_destination_parent_version,
        }),
        ContentOperation::Delete {
            target,
            expected_version,
            attachment_anchor,
            quota_refund,
        } => json!({
            "type":"delete","target":target,"expectedVersion":expected_version,
            "attachmentAnchor":attachment_anchor,"quotaRefund":quota_refund,
        }),
    };
    serde_json::to_vec(&value)
        .map(|bytes| digest_bytes(&bytes))
        .map_err(|error| CommandError::new(CommandErrorCode::Internal, error.to_string()))
}

fn operation_payload(operation: &ContentOperation) -> Option<&[u8]> {
    match operation {
        ContentOperation::CreateFile { content, .. }
        | ContentOperation::UploadFile { content, .. }
        | ContentOperation::ReplaceFile { content, .. } => Some(content),
        _ => None,
    }
}

fn require_version(
    detail: &ResourceDetail,
    expected: Option<&crate::resources::ResourceVersion>,
    message: &str,
) -> Result<(), CommandError> {
    if expected.is_some() && detail.summary.version.as_ref() != expected {
        return Err(CommandError::new(
            CommandErrorCode::VersionMismatch,
            message,
        ));
    }
    Ok(())
}

fn staging_path(destination: &Path, command_id: &str, directory: bool) -> String {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let suffix = if directory { ".dir" } else { ".tmp" };
    parent
        .join(".derp-command-staging")
        .join(format!("{command_id}{suffix}"))
        .to_string_lossy()
        .into_owned()
}

fn staging_path_for_folder(destination: &Path, command_id: &str) -> String {
    staging_path(destination, command_id, true)
}

fn completion_marker(staging: &Path) -> PathBuf {
    let mut marker = staging.as_os_str().to_os_string();
    marker.push(".complete");
    PathBuf::from(marker)
}

fn replacement_backup(staging: &Path) -> PathBuf {
    let mut backup = staging.as_os_str().to_os_string();
    backup.push(".backup");
    PathBuf::from(backup)
}

async fn validate_staging_path(media_root: &Path, staging: &Path) -> Result<(), CommandError> {
    let media_root = media_root.to_path_buf();
    let staging = staging.to_path_buf();
    tokio::task::spawn_blocking(move || validate_staging_path_blocking(&media_root, &staging))
        .await
        .map_err(|error| CommandError::new(CommandErrorCode::Internal, error.to_string()))?
}

fn validate_staging_path_blocking(media_root: &Path, staging: &Path) -> Result<(), CommandError> {
    let staging_parent = staging.parent().ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::Forbidden,
            "Command staging path has no parent",
        )
    })?;
    let content_parent = staging_parent.parent().ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::Forbidden,
            "Command staging directory has no content parent",
        )
    })?;
    if staging_parent.file_name().and_then(|name| name.to_str()) != Some(media::COMMAND_STAGING_DIR)
        || staging.file_name().is_none()
        || !content_parent.starts_with(media_root)
    {
        return Err(CommandError::new(
            CommandErrorCode::Forbidden,
            "Command staging path is outside its media root",
        ));
    }
    let root_metadata = std::fs::symlink_metadata(media_root).map_err(filesystem_error)?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            CommandErrorCode::Forbidden,
            "Command staging media root is not a regular directory",
        ));
    }
    let relative_parent = content_parent.strip_prefix(media_root).map_err(|_| {
        CommandError::new(
            CommandErrorCode::Forbidden,
            "Command staging parent is outside its media root",
        )
    })?;
    let mut current = media_root.to_path_buf();
    for component in relative_parent.components() {
        current.push(component.as_os_str());
        let metadata = std::fs::symlink_metadata(&current).map_err(filesystem_error)?;
        if metadata.file_type().is_symlink() {
            return Err(CommandError::new(
                CommandErrorCode::Forbidden,
                "Command staging content path contains a symbolic link",
            ));
        }
        if !metadata.is_dir() {
            return Err(CommandError::new(
                CommandErrorCode::Conflict,
                "Command staging content parent is not a directory",
            ));
        }
    }
    match std::fs::symlink_metadata(staging_parent) {
        Ok(metadata)
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && media::command_staging_owned(staging_parent) => {}
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            return Err(CommandError::new(
                CommandErrorCode::Forbidden,
                "Existing command staging directory is not app-owned",
            ));
        }
        Ok(_) => {
            return Err(CommandError::new(
                CommandErrorCode::Forbidden,
                "Command staging directory is not a regular directory",
            ));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            std::fs::create_dir(staging_parent).map_err(filesystem_error)?;
            if let Err(error) = create_staging_sentinel(staging_parent) {
                let _ = std::fs::remove_dir(staging_parent);
                return Err(error);
            }
        }
        Err(error) => return Err(filesystem_error(error)),
    }
    let canonical_root = std::fs::canonicalize(media_root).map_err(filesystem_error)?;
    let canonical_content_parent =
        std::fs::canonicalize(content_parent).map_err(filesystem_error)?;
    let canonical_staging_parent =
        std::fs::canonicalize(staging_parent).map_err(filesystem_error)?;
    if !canonical_content_parent.starts_with(&canonical_root)
        || canonical_staging_parent.parent() != Some(canonical_content_parent.as_path())
    {
        return Err(CommandError::new(
            CommandErrorCode::Forbidden,
            "Command staging directory escaped its media root",
        ));
    }
    for evidence in [
        staging.to_path_buf(),
        completion_marker(staging),
        replacement_backup(staging),
    ] {
        match std::fs::symlink_metadata(&evidence) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(CommandError::new(
                    CommandErrorCode::Forbidden,
                    "Command staging evidence cannot be a symbolic link",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(filesystem_error(error)),
        }
    }
    Ok(())
}

fn create_staging_sentinel(staging_parent: &Path) -> Result<(), CommandError> {
    let sentinel = staging_parent.join(media::COMMAND_STAGING_SENTINEL);
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&sentinel)
        .map_err(filesystem_error)?;
    if let Err(error) =
        std::io::Write::write_all(&mut file, media::COMMAND_STAGING_SENTINEL_CONTENT)
            .and_then(|_| file.sync_all())
    {
        let _ = std::fs::remove_file(sentinel);
        return Err(filesystem_error(error));
    }
    Ok(())
}

async fn mark_stage_complete(staging: &Path) -> Result<(), CommandError> {
    write_stage(&completion_marker(staging), b"complete").await
}

async fn folder_stage_marker_matches(marker: &Path) -> Result<bool, CommandError> {
    file_matches(marker, &digest_bytes(b"complete"), 8).await
}

async fn directory_is_empty(path: &Path) -> Result<bool, CommandError> {
    let mut entries = fs::read_dir(path).await.map_err(filesystem_error)?;
    entries
        .next_entry()
        .await
        .map(|entry| entry.is_none())
        .map_err(filesystem_error)
}

fn digest_bytes(bytes: &[u8]) -> String {
    hex_digest(&Sha256::digest(bytes))
}

fn access_error(error: AccessError) -> CommandError {
    let code = match error.code {
        AccessErrorCode::Unauthorized => CommandErrorCode::Unauthorized,
        AccessErrorCode::Forbidden => CommandErrorCode::Forbidden,
        AccessErrorCode::ResourceNotFound => CommandErrorCode::NotFound,
        AccessErrorCode::GrantUnavailable => CommandErrorCode::Conflict,
        AccessErrorCode::QuotaExceeded => CommandErrorCode::QuotaExceeded,
        AccessErrorCode::Internal => CommandErrorCode::Internal,
    };
    CommandError::new(code, error.message)
}

fn filesystem_error(error: io::Error) -> CommandError {
    let code = match error.kind() {
        io::ErrorKind::NotFound => CommandErrorCode::NotFound,
        io::ErrorKind::AlreadyExists => CommandErrorCode::Conflict,
        io::ErrorKind::PermissionDenied => CommandErrorCode::Forbidden,
        _ => CommandErrorCode::Internal,
    };
    CommandError::new(code, error.to_string())
}

fn media_resolve(
    config: &Config,
    runtime: &[MediaRoot],
    logical_path: &str,
) -> Result<media::ResolvedPath, CommandError> {
    media::resolve(config, runtime, logical_path).map_err(CommandError::from)
}

async fn path_exists(path: &Path) -> Result<bool, CommandError> {
    fs::try_exists(path).await.map_err(filesystem_error)
}

async fn write_stage(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let parent = path.parent().ok_or_else(|| {
        CommandError::new(CommandErrorCode::Internal, "Staging path has no parent")
    })?;
    let parent_metadata = fs::symlink_metadata(parent)
        .await
        .map_err(filesystem_error)?;
    if !parent_metadata.is_dir() || parent_metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            CommandErrorCode::Forbidden,
            "Command staging parent is not a regular directory",
        ));
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .await
        .map_err(filesystem_error)?;
    file.write_all(bytes).await.map_err(filesystem_error)?;
    file.sync_all().await.map_err(filesystem_error)
}

async fn rename_staged(source: &Path, target: &Path) -> Result<(), CommandError> {
    if path_exists(target).await? {
        return Err(CommandError::new(
            CommandErrorCode::Conflict,
            "Destination already exists",
        ));
    }
    fs::rename(source, target).await.map_err(filesystem_error)
}

async fn replace_staged(staging: &Path, target: &Path, backup: &Path) -> Result<(), CommandError> {
    if path_exists(backup).await? {
        if path_exists(target).await? {
            return Err(CommandError::new(
                CommandErrorCode::Conflict,
                "Replacement target and recovery backup both exist",
            ));
        }
        return fs::rename(staging, target).await.map_err(filesystem_error);
    }
    if !path_exists(target).await? {
        return Err(CommandError::new(
            CommandErrorCode::NeedsReconciliation,
            "Replacement target disappeared before atomic swap",
        ));
    }
    fs::rename(target, backup).await.map_err(filesystem_error)?;
    fs::rename(staging, target).await.map_err(filesystem_error)
}

async fn file_matches(
    path: &Path,
    expected_digest: &str,
    expected_len: u64,
) -> Result<bool, CommandError> {
    let metadata = match fs::metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(filesystem_error(error)),
    };
    if !metadata.is_file() || metadata.len() != expected_len {
        return Ok(false);
    }
    Ok(digest_file(path).await? == expected_digest)
}

async fn digest_file(path: &Path) -> Result<String, CommandError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || digest_file_blocking(&path))
        .await
        .map_err(|error| CommandError::new(CommandErrorCode::Internal, error.to_string()))?
}

fn digest_file_blocking(path: &Path) -> Result<String, CommandError> {
    let mut file = std::fs::File::open(path).map_err(filesystem_error)?;
    let mut digest = Sha256::new();
    let _ = append_file_digest(&mut file, &mut digest)?;
    Ok(hex_digest(&digest.finalize()))
}

fn append_file_digest(file: &mut std::fs::File, digest: &mut Sha256) -> Result<u64, CommandError> {
    let mut buffer = [0_u8; 128 * 1024];
    let mut total = 0_u64;
    loop {
        let read = file.read(&mut buffer).map_err(filesystem_error)?;
        if read == 0 {
            return Ok(total);
        }
        digest.update(&buffer[..read]);
        total = total.saturating_add(read as u64);
    }
}

#[derive(Debug, Eq, PartialEq)]
struct PathSnapshot {
    bytes: u64,
    digest: String,
}

async fn path_snapshot(path: &Path) -> Result<PathSnapshot, CommandError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || path_snapshot_blocking(&path))
        .await
        .map_err(|error| CommandError::new(CommandErrorCode::Internal, error.to_string()))?
}

async fn copy_path(source: &Path, target: &Path, directory: bool) -> Result<(), CommandError> {
    let source = source.to_path_buf();
    let target = target.to_path_buf();
    tokio::task::spawn_blocking(move || copy_path_blocking(&source, &target, directory))
        .await
        .map_err(|error| CommandError::new(CommandErrorCode::Internal, error.to_string()))?
}

fn copy_path_blocking(source: &Path, target: &Path, directory: bool) -> Result<(), CommandError> {
    let metadata = std::fs::symlink_metadata(source).map_err(filesystem_error)?;
    if metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            CommandErrorCode::Forbidden,
            "Symbolic links cannot be copied",
        ));
    }
    if directory {
        if !metadata.is_dir() {
            return Err(CommandError::new(
                CommandErrorCode::Conflict,
                "Copy source changed kind",
            ));
        }
        std::fs::create_dir(target).map_err(filesystem_error)?;
        let mut entries = std::fs::read_dir(source)
            .map_err(filesystem_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(filesystem_error)?;
        entries.retain(|entry| !media::command_staging_owned(&entry.path()));
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let child_source = entry.path();
            let child_target = target.join(entry.file_name());
            let child_directory = entry.file_type().map_err(filesystem_error)?.is_dir();
            copy_path_blocking(&child_source, &child_target, child_directory)?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(CommandError::new(
            CommandErrorCode::Conflict,
            "Copy source changed kind",
        ));
    }
    std::fs::copy(source, target).map_err(filesystem_error)?;
    std::fs::OpenOptions::new()
        .write(true)
        .open(target)
        .and_then(|file| file.sync_all())
        .map_err(filesystem_error)
}

async fn paths_match(first: &Path, second: &Path) -> Result<bool, CommandError> {
    Ok(path_digest(first).await? == path_digest(second).await?)
}

async fn path_matches_digest(path: &Path, expected: Option<&str>) -> Result<bool, CommandError> {
    match expected {
        Some(expected) => Ok(path_digest(path).await? == expected),
        None => Ok(true),
    }
}

async fn path_digest(path: &Path) -> Result<String, CommandError> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || path_digest_blocking(&path))
        .await
        .map_err(|error| CommandError::new(CommandErrorCode::Internal, error.to_string()))?
}

fn path_digest_blocking(path: &Path) -> Result<String, CommandError> {
    path_snapshot_blocking(path).map(|snapshot| snapshot.digest)
}

fn path_snapshot_blocking(path: &Path) -> Result<PathSnapshot, CommandError> {
    fn frame(digest: &mut Sha256, value: &[u8]) {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value);
    }

    fn append(
        path: &Path,
        root: &Path,
        digest: &mut Sha256,
        bytes: &mut u64,
    ) -> Result<(), CommandError> {
        let metadata = std::fs::symlink_metadata(path).map_err(filesystem_error)?;
        if metadata.file_type().is_symlink() {
            return Err(CommandError::new(
                CommandErrorCode::Forbidden,
                "Symbolic links cannot be moved or copied",
            ));
        }
        let relative = path.strip_prefix(root).unwrap_or(path);
        if metadata.is_file() {
            digest.update([0]);
            frame(digest, relative.as_os_str().as_encoded_bytes());
            let mut file = std::fs::File::open(path).map_err(filesystem_error)?;
            let mut leaf_digest = Sha256::new();
            let leaf_bytes = append_file_digest(&mut file, &mut leaf_digest)?;
            digest.update(leaf_bytes.to_be_bytes());
            digest.update(leaf_digest.finalize());
            *bytes = bytes.saturating_add(leaf_bytes);
        } else if metadata.is_dir() {
            digest.update([1]);
            frame(digest, relative.as_os_str().as_encoded_bytes());
            let mut entries = std::fs::read_dir(path)
                .map_err(filesystem_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(filesystem_error)?;
            entries.retain(|entry| !media::command_staging_owned(&entry.path()));
            entries.sort_by_key(|entry| entry.file_name());
            digest.update((entries.len() as u64).to_be_bytes());
            for entry in entries {
                append(&entry.path(), root, digest, bytes)?;
            }
        } else {
            return Err(CommandError::new(
                CommandErrorCode::InvalidRequest,
                "Unsupported filesystem resource",
            ));
        }
        Ok(())
    }

    let mut digest = Sha256::new();
    digest.update(b"derp-content-tree-v1\0");
    let mut bytes = 0_u64;
    append(path, path, &mut digest, &mut bytes)?;
    Ok(PathSnapshot {
        bytes,
        digest: hex_digest(&digest.finalize()),
    })
}

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

async fn remove_path(path: &Path) -> Result<(), CommandError> {
    let metadata = fs::symlink_metadata(path).await.map_err(filesystem_error)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).await.map_err(filesystem_error)
    } else {
        fs::remove_file(path).await.map_err(filesystem_error)
    }
}

fn is_cross_device(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(17 | 18))
}

fn deduplicate_refs(references: &mut Vec<ResourceRef>) {
    let mut seen = HashSet::new();
    references.retain(|reference| seen.insert(reference.clone()));
}

fn paths_overlap(first: &str, second: &str) -> bool {
    let first = first.replace('\\', "/");
    let second = second.replace('\\', "/");
    first == second
        || first.starts_with(&format!("{second}/"))
        || second.starts_with(&format!("{first}/"))
}

#[cfg(windows)]
fn path_is_same_or_descendant(candidate: &Path, ancestor: &Path) -> bool {
    let candidate = candidate
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase();
    let ancestor = ancestor
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase();
    candidate == ancestor || candidate.starts_with(&format!("{ancestor}\\"))
}

#[cfg(not(windows))]
fn path_is_same_or_descendant(candidate: &Path, ancestor: &Path) -> bool {
    candidate.starts_with(ancestor)
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig},
        resources::ResourceVersion,
        shares::Restrictions,
        thumbnails::Thumbnailer,
    };
    use serde_json::json;

    struct Fixture {
        base: PathBuf,
        media: PathBuf,
        config: Config,
        resources: Arc<ResourceCatalog>,
        access: Arc<AccessPolicy>,
        commands: Arc<ContentCommands>,
        command_events: broadcast::Sender<CommandEventEnvelope>,
    }

    impl Fixture {
        async fn new(name: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "derp-content-commands-{name}-{}",
                uuid::Uuid::new_v4()
            ));
            let media = base.join("media");
            std::fs::create_dir_all(media.join("Editable")).unwrap();
            std::fs::create_dir_all(media.join("ReadOnly")).unwrap();
            let data_path = base.join("data");
            let mut config = Config {
                port: 0,
                roots: vec![MediaRoot {
                    id: "config:primary".into(),
                    name: "Media".into(),
                    path: media.clone(),
                    editable_folders: vec!["Editable".into()],
                    read_only: false,
                    source: "config".into(),
                    created_at: None,
                }],
                library_key: media.to_string_lossy().into_owned(),
                share_link_domain: None,
                auth: AuthConfig::default(),
                file_search: FileSearchConfig {
                    enabled: false,
                    index_path: data_path.join("search.sqlite"),
                    watch_mode: "off".into(),
                    max_recursive_watchers: 0,
                    max_fs_concurrency: 1,
                    reconcile_directories_per_second: 1,
                },
                image_optimization: ImageOptimizationConfig::default(),
                data_path,
                tls: None,
                hermes: None,
            };
            state_db::initialize(&config).unwrap();
            let identity = crate::resources::initialize_identity(&mut config).unwrap();
            shares::initialize(&config).unwrap();
            initialize(&config).unwrap();
            let runtime = Arc::new(RwLock::new(Vec::new()));
            let resources = Arc::new(ResourceCatalog::new(
                config.clone(),
                runtime.clone(),
                identity,
                Arc::new(Thumbnailer::new(data_path_for(&config).join("thumbs"))),
                None,
            ));
            let access = Arc::new(AccessPolicy::new(
                config.clone(),
                runtime.clone(),
                resources.clone(),
            ));
            let file_search = FileSearch::new(config.file_search.clone(), config.roots.clone());
            let (admin_events, _) = broadcast::channel(32);
            let (command_events, _) = broadcast::channel(32);
            let commands = Arc::new(ContentCommands::new(
                config.clone(),
                runtime,
                access.clone(),
                resources.clone(),
                admin_events,
                command_events.clone(),
                file_search,
            ));
            Self {
                base,
                media,
                config,
                resources,
                access,
                commands,
                command_events,
            }
        }

        async fn summary(&self, path: &str) -> crate::resources::ResourceSummary {
            self.resources
                .compatibility()
                .resolve_filesystem(path, ReadSurface::Library)
                .await
                .unwrap()
        }

        async fn parent(&self) -> crate::resources::ResourceSummary {
            self.summary("Editable").await
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    fn data_path_for(config: &Config) -> PathBuf {
        config.data_path.clone()
    }

    fn create_file_command(
        parent: &crate::resources::ResourceSummary,
        key: &str,
        name: &str,
        content: &[u8],
    ) -> ContentCommand {
        ContentCommand {
            idempotency_key: key.into(),
            operation: ContentOperation::CreateFile {
                destination_parent: parent.reference.clone(),
                child_name: ChildName::parse(name).unwrap(),
                expected_parent_version: parent.version.clone(),
                content: content.to_vec(),
                accounted_bytes: content.len() as u64,
                attachment_anchor: None,
            },
        }
    }

    #[tokio::test]
    async fn idempotency_returns_stored_receipt_and_rejects_changed_digest() {
        let fixture = Fixture::new("idempotency").await;
        let parent = fixture.parent().await;
        let context = RequestContext::owner();
        let mut events = fixture.command_events.subscribe();
        let command = create_file_command(&parent, "owner-create-1", "note.txt", b"alpha");
        let first = fixture
            .commands
            .execute(&context, command.clone())
            .await
            .unwrap();
        let repeated = fixture.commands.execute(&context, command).await.unwrap();
        assert_eq!(first, repeated);
        assert_eq!(
            std::fs::read(fixture.media.join("Editable/note.txt")).unwrap(),
            b"alpha"
        );
        assert_eq!(events.try_recv().unwrap().command_id, first.command_id);
        assert!(matches!(
            events.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));

        let changed = create_file_command(&parent, "owner-create-1", "note.txt", b"beta");
        let error = fixture
            .commands
            .execute(&context, changed)
            .await
            .unwrap_err();
        assert_eq!(error.code, CommandErrorCode::IdempotencyConflict);
    }

    #[tokio::test]
    async fn access_policy_is_shared_while_grant_capabilities_enforce_restrictions_and_quota() {
        let fixture = Fixture::new("grant-policy").await;
        std::fs::create_dir_all(fixture.media.join("Editable/Shared")).unwrap();
        let share = shares::create(
            &fixture.config,
            &[],
            "Editable/Shared".into(),
            true,
            true,
            Some(Restrictions {
                allow_delete: Some(false),
                allow_upload: Some(false),
                allow_edit: Some(false),
                max_upload_bytes: Some(3.0),
            }),
        )
        .unwrap();
        let authenticated = fixture
            .access
            .authenticate_grant(&share.token, &std::collections::HashMap::new())
            .await
            .unwrap();
        let parent = fixture.summary("Editable/Shared").await;
        let denied = fixture
            .commands
            .execute(
                &authenticated.context,
                create_file_command(&parent, "grant-denied", "denied.txt", b"x"),
            )
            .await
            .unwrap_err();
        assert_eq!(denied.code, CommandErrorCode::Forbidden);

        shares::update(
            &fixture.config,
            &[],
            &share.token,
            Some(true),
            Some(Restrictions {
                allow_delete: Some(false),
                allow_upload: Some(true),
                allow_edit: Some(false),
                max_upload_bytes: Some(3.0),
            }),
        )
        .unwrap();
        let over_quota = fixture
            .commands
            .execute(
                &authenticated.context,
                create_file_command(&parent, "grant-quota", "large.txt", b"four"),
            )
            .await
            .unwrap_err();
        assert_eq!(over_quota.code, CommandErrorCode::QuotaExceeded);

        shares::update(
            &fixture.config,
            &[],
            &share.token,
            Some(true),
            Some(Restrictions {
                allow_delete: Some(false),
                allow_upload: Some(true),
                allow_edit: Some(false),
                max_upload_bytes: Some(100.0),
            }),
        )
        .unwrap();
        let receipt = fixture
            .commands
            .execute(
                &authenticated.context,
                create_file_command(&parent, "grant-allowed", "allowed.txt", b"four"),
            )
            .await
            .unwrap();
        assert_eq!(receipt.status, CommandStatus::Completed);
        let stored = shares::find(&fixture.config, &[], &share.token)
            .unwrap()
            .unwrap();
        assert_eq!(stored.used_bytes, Some(4));

        let target = fixture.summary("Editable/Shared/allowed.txt").await;
        let denied_edit = fixture
            .commands
            .execute(
                &authenticated.context,
                ContentCommand {
                    idempotency_key: "grant-edit-denied".into(),
                    operation: ContentOperation::ReplaceFile {
                        target: target.reference.clone(),
                        expected_version: target.version.clone().unwrap(),
                        content: b"owner".to_vec(),
                        accounted_bytes: 5,
                    },
                },
            )
            .await
            .unwrap_err();
        assert_eq!(denied_edit.code, CommandErrorCode::Forbidden);
        fixture
            .commands
            .execute(
                &RequestContext::owner(),
                ContentCommand {
                    idempotency_key: "owner-edit-allowed".into(),
                    operation: ContentOperation::ReplaceFile {
                        target: target.reference,
                        expected_version: target.version.unwrap(),
                        content: b"owner".to_vec(),
                        accounted_bytes: 0,
                    },
                },
            )
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(fixture.media.join("Editable/Shared/allowed.txt")).unwrap(),
            b"owner"
        );
    }

    #[tokio::test]
    async fn version_conflict_and_overwrite_have_typed_results_and_stable_identity() {
        let fixture = Fixture::new("replace").await;
        std::fs::write(fixture.media.join("Editable/existing.txt"), b"old").unwrap();
        let original = fixture.summary("Editable/existing.txt").await;
        let mismatch = fixture
            .commands
            .execute(
                &RequestContext::owner(),
                ContentCommand {
                    idempotency_key: "replace-mismatch".into(),
                    operation: ContentOperation::ReplaceFile {
                        target: original.reference.clone(),
                        expected_version: ResourceVersion::new("not-current"),
                        content: b"new".to_vec(),
                        accounted_bytes: 0,
                    },
                },
            )
            .await
            .unwrap_err();
        assert_eq!(mismatch.code, CommandErrorCode::VersionMismatch);
        assert_eq!(
            std::fs::read(fixture.media.join("Editable/existing.txt")).unwrap(),
            b"old"
        );

        let receipt = fixture
            .commands
            .execute(
                &RequestContext::owner(),
                ContentCommand {
                    idempotency_key: "replace-current".into(),
                    operation: ContentOperation::ReplaceFile {
                        target: original.reference.clone(),
                        expected_version: original.version.unwrap(),
                        content: b"new".to_vec(),
                        accounted_bytes: 0,
                    },
                },
            )
            .await
            .unwrap();
        assert_eq!(receipt.affected_refs, vec![original.reference.clone()]);
        let replaced = fixture.summary("Editable/existing.txt").await;
        assert_eq!(replaced.reference, original.reference);
        assert_eq!(
            std::fs::read(fixture.media.join("Editable/existing.txt")).unwrap(),
            b"new"
        );
    }

    #[tokio::test]
    async fn delete_recovery_revalidates_saved_version_before_removing_target() {
        let fixture = Fixture::new("delete-version-recovery").await;
        let target_path = fixture.media.join("Editable/delete-me.txt");
        std::fs::write(&target_path, b"original").unwrap();
        let target = fixture.summary("Editable/delete-me.txt").await;
        let command_id = "command-delete-version";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-delete-version".into(),
                request_digest: "prepared-delete".into(),
                operation: JournalOperation::Delete {
                    target: target.reference,
                    path: "Editable/delete-me.txt".into(),
                    target_is_directory: false,
                    target_digest: Some(path_digest_blocking(&target_path).unwrap()),
                    expected_version: target.version,
                    quota_refund: 0,
                },
            })
            .unwrap();
        std::fs::write(&target_path, b"externally changed content").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert_eq!(
            std::fs::read(&target_path).unwrap(),
            b"externally changed content"
        );
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::NeedsReconciliation
        );
    }

    #[tokio::test]
    async fn interrupted_recursive_delete_finishes_from_owned_staging() {
        let fixture = Fixture::new("delete-staged-recovery").await;
        let target_path = fixture.media.join("Editable/delete-tree");
        std::fs::create_dir(&target_path).unwrap();
        std::fs::write(target_path.join("one.txt"), b"one").unwrap();
        std::fs::write(target_path.join("two.txt"), b"two").unwrap();
        let target = fixture.summary("Editable/delete-tree").await;
        let command_id = "command-delete-tree";
        let staged_delete = PathBuf::from(staging_path(&target_path, command_id, true));
        validate_staging_path(&fixture.media, &staged_delete)
            .await
            .unwrap();
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-delete-tree".into(),
                request_digest: "prepared-delete-tree".into(),
                operation: JournalOperation::Delete {
                    target: target.reference,
                    path: "Editable/delete-tree".into(),
                    target_is_directory: true,
                    target_digest: None,
                    expected_version: target.version,
                    quota_refund: 0,
                },
            })
            .unwrap();
        fixture
            .commands
            .journal
            .mark_state(command_id, JournalState::Staged)
            .unwrap();
        std::fs::rename(&target_path, &staged_delete).unwrap();
        std::fs::remove_file(staged_delete.join("one.txt")).unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(!target_path.exists());
        assert!(!staged_delete.exists());
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::Completed
        );
    }

    #[tokio::test]
    async fn staged_replace_does_not_skip_version_check_without_backup_evidence() {
        let fixture = Fixture::new("replace-staged-version").await;
        let target_path = fixture.media.join("Editable/replace-me.txt");
        std::fs::write(&target_path, b"original").unwrap();
        let target = fixture.summary("Editable/replace-me.txt").await;
        let command_id = "command-staged-replace";
        let stage = PathBuf::from(staging_path(&target_path, command_id, false));
        validate_staging_path(&fixture.media, &stage).await.unwrap();
        write_stage(&stage, b"replacement").await.unwrap();
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-staged-replace".into(),
                request_digest: "prepared-replace".into(),
                operation: JournalOperation::WriteFile {
                    mode: JournalWriteMode::Replace,
                    destination_parent: None,
                    target: Some(target.reference),
                    path: "Editable/replace-me.txt".into(),
                    staging_path: stage.to_string_lossy().into_owned(),
                    payload_digest: digest_bytes(b"replacement"),
                    payload_len: 11,
                    accounted_bytes: 0,
                    expected_parent_version: None,
                    expected_target_version: target.version,
                },
            })
            .unwrap();
        fixture
            .commands
            .journal
            .mark_state(command_id, JournalState::Staged)
            .unwrap();
        std::fs::write(&target_path, b"external content").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"external content");
        assert!(stage.exists());
        assert!(!replacement_backup(&stage).exists());
        let record = fixture.commands.journal.by_id(command_id).unwrap().unwrap();
        assert_eq!(record.state, JournalState::Staged);
        assert!(
            record
                .error
                .as_deref()
                .is_some_and(|message| message.contains("Replacement target changed"))
        );
    }

    #[tokio::test]
    async fn replace_recovery_finishes_atomic_swap_and_cleans_backup() {
        let fixture = Fixture::new("replace-atomic-recovery").await;
        let target_path = fixture.media.join("Editable/atomic.txt");
        std::fs::write(&target_path, b"original").unwrap();
        let target = fixture.summary("Editable/atomic.txt").await;
        let original_ref = target.reference.clone();
        let command_id = "command-atomic-replace";
        let stage = PathBuf::from(staging_path(&target_path, command_id, false));
        validate_staging_path(&fixture.media, &stage).await.unwrap();
        write_stage(&stage, b"replacement").await.unwrap();
        let backup = replacement_backup(&stage);
        std::fs::rename(&target_path, &backup).unwrap();
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-atomic-replace".into(),
                request_digest: "prepared-replace".into(),
                operation: JournalOperation::WriteFile {
                    mode: JournalWriteMode::Replace,
                    destination_parent: None,
                    target: Some(target.reference),
                    path: "Editable/atomic.txt".into(),
                    staging_path: stage.to_string_lossy().into_owned(),
                    payload_digest: digest_bytes(b"replacement"),
                    payload_len: 11,
                    accounted_bytes: 0,
                    expected_parent_version: None,
                    expected_target_version: target.version,
                },
            })
            .unwrap();
        fixture
            .commands
            .journal
            .mark_state(command_id, JournalState::Staged)
            .unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert_eq!(std::fs::read(&target_path).unwrap(), b"replacement");
        assert!(!stage.exists());
        assert!(!backup.exists());
        assert_eq!(
            fixture.summary("Editable/atomic.txt").await.reference,
            original_ref
        );
    }

    #[tokio::test]
    async fn staging_refuses_non_directory_evidence_root() {
        let fixture = Fixture::new("staging-root").await;
        std::fs::write(
            fixture.media.join("Editable/.derp-command-staging"),
            b"not a directory",
        )
        .unwrap();
        let parent = fixture.parent().await;
        let error = fixture
            .commands
            .execute(
                &RequestContext::owner(),
                create_file_command(&parent, "bad-staging-root", "blocked.txt", b"blocked"),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, CommandErrorCode::NeedsReconciliation);
        assert!(!fixture.media.join("Editable/blocked.txt").exists());
    }

    #[tokio::test]
    async fn staging_refuses_unowned_directory_and_creates_owned_sentinel() {
        let fixture = Fixture::new("staging-ownership").await;
        let staging = fixture
            .media
            .join("Editable")
            .join(media::COMMAND_STAGING_DIR);
        std::fs::create_dir(&staging).unwrap();
        std::fs::write(staging.join("user.txt"), b"preserve me").unwrap();
        let parent = fixture.parent().await;

        let error = fixture
            .commands
            .execute(
                &RequestContext::owner(),
                create_file_command(
                    &parent,
                    "unowned-staging",
                    "blocked-unowned.txt",
                    b"blocked",
                ),
            )
            .await
            .unwrap_err();

        assert_eq!(error.code, CommandErrorCode::NeedsReconciliation);
        assert_eq!(
            std::fs::read(staging.join("user.txt")).unwrap(),
            b"preserve me"
        );
        assert!(!staging.join(media::COMMAND_STAGING_SENTINEL).exists());

        let owned_fixture = Fixture::new("staging-owned-sentinel").await;
        let owned_parent = owned_fixture.parent().await;
        owned_fixture
            .commands
            .execute(
                &RequestContext::owner(),
                create_file_command(&owned_parent, "owned-staging", "created.txt", b"created"),
            )
            .await
            .unwrap();
        let owned_staging = owned_fixture
            .media
            .join("Editable")
            .join(media::COMMAND_STAGING_DIR);
        assert!(media::command_staging_owned(&owned_staging));
        assert_eq!(
            std::fs::read(owned_staging.join(media::COMMAND_STAGING_SENTINEL)).unwrap(),
            media::COMMAND_STAGING_SENTINEL_CONTENT
        );
    }

    #[tokio::test]
    async fn copy_and_snapshot_preserve_unowned_staging_but_exclude_owned_staging() {
        let base = std::env::temp_dir().join(format!(
            "derp-command-copy-staging-{}",
            uuid::Uuid::new_v4()
        ));
        let source = base.join("source");
        let unowned = source.join(media::COMMAND_STAGING_DIR);
        std::fs::create_dir_all(&unowned).unwrap();
        std::fs::write(source.join("visible.txt"), b"visible").unwrap();
        std::fs::write(unowned.join("user.txt"), b"user data").unwrap();

        let unowned_snapshot = path_snapshot(&source).await.unwrap();
        assert_eq!(unowned_snapshot.bytes, 16);
        assert!(crate::routes::files::zip_path_visible(&unowned));
        let unowned_copy = base.join("unowned-copy");
        copy_path(&source, &unowned_copy, true).await.unwrap();
        assert_eq!(
            std::fs::read(
                unowned_copy
                    .join(media::COMMAND_STAGING_DIR)
                    .join("user.txt")
            )
            .unwrap(),
            b"user data"
        );

        std::fs::write(
            unowned.join(media::COMMAND_STAGING_SENTINEL),
            media::COMMAND_STAGING_SENTINEL_CONTENT,
        )
        .unwrap();
        assert!(media::command_staging_owned(&unowned));
        assert!(!crate::routes::files::zip_path_visible(&unowned));
        let owned_snapshot = path_snapshot(&source).await.unwrap();
        assert_eq!(owned_snapshot.bytes, 7);
        let owned_copy = base.join("owned-copy");
        copy_path(&source, &owned_copy, true).await.unwrap();
        assert!(!owned_copy.join(media::COMMAND_STAGING_DIR).exists());
        assert_eq!(
            std::fs::read(owned_copy.join("visible.txt")).unwrap(),
            b"visible"
        );

        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn file_digest_streams_multiple_buffers_without_changing_digest() {
        let base =
            std::env::temp_dir().join(format!("derp-content-digest-{}", uuid::Uuid::new_v4()));
        let bytes = vec![0x5a; 300_000];
        std::fs::write(&base, &bytes).unwrap();
        assert_eq!(digest_file_blocking(&base).unwrap(), digest_bytes(&bytes));
        std::fs::remove_file(base).unwrap();
    }

    #[test]
    fn framed_tree_digest_distinguishes_path_content_boundaries() {
        let base =
            std::env::temp_dir().join(format!("derp-content-tree-digest-{}", uuid::Uuid::new_v4()));
        let first = base.join("first");
        let second = base.join("second");
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        std::fs::write(first.join("a"), b"b\0x").unwrap();
        std::fs::write(second.join("a"), b"").unwrap();
        std::fs::write(second.join("b"), b"x").unwrap();

        assert_ne!(
            path_digest_blocking(&first).unwrap(),
            path_digest_blocking(&second).unwrap()
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn descendant_guard_is_case_insensitive_on_windows() {
        assert!(path_is_same_or_descendant(
            Path::new(r"C:\Media\Folder\Child"),
            Path::new(r"c:\media\folder"),
        ));
        assert!(!path_is_same_or_descendant(
            Path::new(r"C:\Media\Folder-Sibling"),
            Path::new(r"c:\media\folder"),
        ));
    }

    #[tokio::test]
    async fn create_folder_recovers_renamed_stage_and_rejects_unproven_destination() {
        let fixture = Fixture::new("folder-stage-recovery").await;
        let parent = fixture.parent().await;

        let recovered_id = "command-folder-renamed";
        let recovered_path = fixture.media.join("Editable/recovered-folder");
        let recovered_stage = PathBuf::from(staging_path(&recovered_path, recovered_id, true));
        validate_staging_path(&fixture.media, &recovered_stage)
            .await
            .unwrap();
        std::fs::create_dir(&recovered_stage).unwrap();
        mark_stage_complete(&recovered_stage).await.unwrap();
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: recovered_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-folder-renamed".into(),
                request_digest: "prepared-folder".into(),
                operation: JournalOperation::CreateFolder {
                    destination_parent: parent.reference.clone(),
                    path: "Editable/recovered-folder".into(),
                    expected_parent_version: None,
                    staging_path: Some(recovered_stage.to_string_lossy().into_owned()),
                },
            })
            .unwrap();
        fixture
            .commands
            .journal
            .mark_state(recovered_id, JournalState::Staged)
            .unwrap();
        std::fs::rename(&recovered_stage, &recovered_path).unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(recovered_path.is_dir());
        assert!(!completion_marker(&recovered_stage).exists());
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(recovered_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::Completed
        );

        let tampered_id = "command-folder-tampered";
        let tampered_path = fixture.media.join("Editable/tampered-folder");
        let tampered_stage = PathBuf::from(staging_path(&tampered_path, tampered_id, true));
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: tampered_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-folder-tampered".into(),
                request_digest: "prepared-folder".into(),
                operation: JournalOperation::CreateFolder {
                    destination_parent: parent.reference,
                    path: "Editable/tampered-folder".into(),
                    expected_parent_version: None,
                    staging_path: Some(tampered_stage.to_string_lossy().into_owned()),
                },
            })
            .unwrap();
        fixture
            .commands
            .journal
            .mark_state(tampered_id, JournalState::Staged)
            .unwrap();
        std::fs::create_dir(&tampered_path).unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(tampered_path.is_dir());
        assert_ne!(
            fixture
                .commands
                .journal
                .by_id(tampered_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::Completed
        );
    }

    #[tokio::test]
    async fn legacy_folder_journal_without_staging_field_is_upgraded_in_place() {
        let fixture = Fixture::new("folder-legacy-journal").await;
        let parent = fixture.parent().await;
        let command_id = "command-folder-legacy";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-folder-legacy".into(),
                request_digest: "prepared-folder".into(),
                operation: JournalOperation::CreateFolder {
                    destination_parent: parent.reference,
                    path: "Editable/legacy-folder".into(),
                    expected_parent_version: None,
                    staging_path: None,
                },
            })
            .unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(fixture.media.join("Editable/legacy-folder").is_dir());
        let record = fixture.commands.journal.by_id(command_id).unwrap().unwrap();
        assert_eq!(record.state, JournalState::Completed);
        assert!(matches!(
            record.operation,
            JournalOperation::CreateFolder {
                staging_path: Some(_),
                ..
            }
        ));
    }

    #[tokio::test]
    async fn folder_recovery_checks_parent_before_staging_and_detects_parent_replacement() {
        let fixture = Fixture::new("folder-parent-recovery").await;

        let versioned_parent_path = fixture.media.join("Editable/versioned-parent");
        std::fs::create_dir(&versioned_parent_path).unwrap();
        let versioned_parent = fixture.summary("Editable/versioned-parent").await;
        let versioned_destination = versioned_parent_path.join("child");
        let versioned_id = "command-folder-parent-version";
        let versioned_stage = staging_path(&versioned_destination, versioned_id, true);
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: versioned_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-folder-parent-version".into(),
                request_digest: "prepared-folder".into(),
                operation: JournalOperation::CreateFolder {
                    destination_parent: versioned_parent.reference,
                    path: "Editable/versioned-parent/child".into(),
                    expected_parent_version: versioned_parent.version,
                    staging_path: Some(versioned_stage),
                },
            })
            .unwrap();
        std::fs::write(versioned_parent_path.join("external.txt"), b"changed").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(!versioned_destination.exists());
        assert!(!versioned_parent_path.join(".derp-command-staging").exists());

        let replaced_parent_path = fixture.media.join("Editable/replaced-parent");
        std::fs::create_dir(&replaced_parent_path).unwrap();
        let replaced_parent = fixture.summary("Editable/replaced-parent").await;
        let replaced_id = "command-folder-parent-identity";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: replaced_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-folder-parent-identity".into(),
                request_digest: "prepared-folder".into(),
                operation: JournalOperation::CreateFolder {
                    destination_parent: replaced_parent.reference,
                    path: "Editable/replaced-parent/child".into(),
                    expected_parent_version: None,
                    staging_path: Some(staging_path(
                        &replaced_parent_path.join("child"),
                        replaced_id,
                        true,
                    )),
                },
            })
            .unwrap();
        std::fs::remove_dir(&replaced_parent_path).unwrap();
        std::fs::create_dir(&replaced_parent_path).unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(!replaced_parent_path.join("child").exists());
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(replaced_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::NeedsReconciliation
        );
    }

    #[tokio::test]
    async fn startup_recovers_staged_upload_and_prepared_move() {
        let fixture = Fixture::new("recovery").await;
        let parent = fixture.parent().await;
        let destination = fixture.media.join("Editable/recovered.txt");
        let command_id = "command-staged-upload";
        let stage = staging_path(&destination, command_id, false);
        validate_staging_path(&fixture.media, Path::new(&stage))
            .await
            .unwrap();
        write_stage(Path::new(&stage), b"recovered").await.unwrap();
        let upload_operation = JournalOperation::WriteFile {
            mode: JournalWriteMode::Upload,
            destination_parent: Some(parent.reference.clone()),
            target: None,
            path: "Editable/recovered.txt".into(),
            staging_path: stage,
            payload_digest: digest_bytes(b"recovered"),
            payload_len: 9,
            accounted_bytes: 0,
            expected_parent_version: None,
            expected_target_version: None,
        };
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-upload".into(),
                request_digest: "prepared-upload".into(),
                operation: upload_operation,
            })
            .unwrap();
        fixture
            .commands
            .journal
            .mark_state(command_id, JournalState::Staged)
            .unwrap();

        std::fs::write(fixture.media.join("Editable/move-me.txt"), b"move").unwrap();
        let source = fixture.summary("Editable/move-me.txt").await;
        let move_id = "command-prepared-move";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: move_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-move".into(),
                request_digest: "prepared-move".into(),
                operation: JournalOperation::Move {
                    source: source.reference.clone(),
                    destination_parent: parent.reference,
                    source_path: "Editable/move-me.txt".into(),
                    destination_path: "Editable/moved.txt".into(),
                    staging_path: staging_path(
                        &fixture.media.join("Editable/moved.txt"),
                        move_id,
                        false,
                    ),
                    source_is_directory: false,
                    source_digest: Some(
                        path_digest_blocking(&fixture.media.join("Editable/move-me.txt")).unwrap(),
                    ),
                    expected_source_version: source.version,
                    expected_parent_version: None,
                },
            })
            .unwrap();

        fixture.commands.recover_pending().await.unwrap();
        assert_eq!(
            std::fs::read(fixture.media.join("Editable/recovered.txt")).unwrap(),
            b"recovered"
        );
        assert_eq!(
            std::fs::read(fixture.media.join("Editable/moved.txt")).unwrap(),
            b"move"
        );
        let moved = fixture.summary("Editable/moved.txt").await;
        assert_eq!(moved.reference, source.reference);
        for id in [command_id, move_id] {
            let record = fixture.commands.journal.by_id(id).unwrap().unwrap();
            assert_eq!(record.state, JournalState::Completed);
            assert_eq!(record.receipt.unwrap().status, CommandStatus::Completed);
        }
    }

    #[tokio::test]
    async fn payload_resend_keeps_prepared_parent_version_check() {
        let fixture = Fixture::new("payload-resend-parent-version").await;
        let parent = fixture.parent().await;
        let destination = fixture.media.join("Editable/resend.txt");
        let command_id = "command-payload-resend";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-payload-resend".into(),
                request_digest: "prepared-upload".into(),
                operation: JournalOperation::WriteFile {
                    mode: JournalWriteMode::Upload,
                    destination_parent: Some(parent.reference),
                    target: None,
                    path: "Editable/resend.txt".into(),
                    staging_path: staging_path(&destination, command_id, false),
                    payload_digest: digest_bytes(b"payload"),
                    payload_len: 7,
                    accounted_bytes: 0,
                    expected_parent_version: parent.version,
                    expected_target_version: None,
                },
            })
            .unwrap();
        fixture.commands.recover_pending().await.unwrap();
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::NeedsReconciliation
        );
        std::fs::write(fixture.media.join("Editable/external.txt"), b"changed").unwrap();
        let record = fixture.commands.journal.by_id(command_id).unwrap().unwrap();

        let error = fixture
            .commands
            .resume(record, Some(b"payload"))
            .await
            .unwrap_err();

        assert!(error.message.contains("Destination parent changed"));
        assert!(!destination.exists());
    }

    #[tokio::test]
    async fn recovery_discards_partial_copy_stage_before_publishing_destination() {
        let fixture = Fixture::new("partial-copy").await;
        let source_path = fixture.media.join("Editable/source");
        std::fs::create_dir_all(&source_path).unwrap();
        std::fs::write(source_path.join("one.txt"), b"one").unwrap();
        std::fs::write(source_path.join("two.txt"), b"two").unwrap();
        let source = fixture.summary("Editable/source").await;
        let parent = fixture.parent().await;
        let destination = fixture.media.join("Editable/copied");
        let command_id = "command-partial-copy";
        let stage = PathBuf::from(staging_path(&destination, command_id, true));
        validate_staging_path(&fixture.media, &stage).await.unwrap();
        std::fs::create_dir(&stage).unwrap();
        std::fs::write(stage.join("one.txt"), b"partial").unwrap();
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-partial-copy".into(),
                request_digest: "prepared-copy".into(),
                operation: JournalOperation::Copy {
                    source: source.reference,
                    destination_parent: parent.reference,
                    source_path: "Editable/source".into(),
                    destination_path: "Editable/copied".into(),
                    staging_path: stage.to_string_lossy().into_owned(),
                    source_is_directory: true,
                    source_digest: Some(path_digest_blocking(&source_path).unwrap()),
                    expected_source_version: source.version,
                    expected_parent_version: None,
                    accounted_bytes: 6,
                },
            })
            .unwrap();

        fixture.commands.recover_pending().await.unwrap();
        assert_eq!(std::fs::read(destination.join("one.txt")).unwrap(), b"one");
        assert_eq!(std::fs::read(destination.join("two.txt")).unwrap(), b"two");
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::Completed
        );
    }

    #[tokio::test]
    async fn copy_rejects_stage_whose_bytes_exceed_authorized_snapshot() {
        let fixture = Fixture::new("copy-accounting-snapshot").await;
        let source_path = fixture.media.join("Editable/quota-source.txt");
        std::fs::write(&source_path, b"sixsix").unwrap();
        let source = fixture.summary("Editable/quota-source.txt").await;
        let parent = fixture.parent().await;
        let destination = fixture.media.join("Editable/quota-copy.txt");
        let command_id = "command-copy-stale-accounting";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-copy-stale-accounting".into(),
                request_digest: "prepared-copy".into(),
                operation: JournalOperation::Copy {
                    source: source.reference,
                    destination_parent: parent.reference,
                    source_path: "Editable/quota-source.txt".into(),
                    destination_path: "Editable/quota-copy.txt".into(),
                    staging_path: staging_path(&destination, command_id, false),
                    source_is_directory: false,
                    source_digest: Some(path_digest_blocking(&source_path).unwrap()),
                    expected_source_version: source.version,
                    expected_parent_version: None,
                    accounted_bytes: 1,
                },
            })
            .unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(!destination.exists());
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::NeedsReconciliation
        );
    }

    #[tokio::test]
    async fn copy_recovery_uses_destination_snapshot_after_source_changes() {
        let fixture = Fixture::new("copy-destination-snapshot").await;
        let source_path = fixture.media.join("Editable/source-before.txt");
        let destination = fixture.media.join("Editable/copied-before.txt");
        std::fs::write(&source_path, b"before").unwrap();
        let source = fixture.summary("Editable/source-before.txt").await;
        let parent = fixture.parent().await;
        let command_id = "command-copy-destination-snapshot";
        let digest = path_digest_blocking(&source_path).unwrap();
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-copy-destination-snapshot".into(),
                request_digest: "prepared-copy".into(),
                operation: JournalOperation::Copy {
                    source: source.reference,
                    destination_parent: parent.reference,
                    source_path: "Editable/source-before.txt".into(),
                    destination_path: "Editable/copied-before.txt".into(),
                    staging_path: staging_path(&destination, command_id, false),
                    source_is_directory: false,
                    source_digest: Some(digest),
                    expected_source_version: source.version,
                    expected_parent_version: None,
                    accounted_bytes: 6,
                },
            })
            .unwrap();
        fixture
            .commands
            .journal
            .mark_state(command_id, JournalState::Staged)
            .unwrap();
        std::fs::copy(&source_path, &destination).unwrap();
        std::fs::write(&source_path, b"source changed later").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"before");
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::Completed
        );
    }

    #[tokio::test]
    async fn prepared_copy_rejects_existing_destination_even_with_matching_digest() {
        let fixture = Fixture::new("copy-prepared-destination").await;
        let source_path = fixture.media.join("Editable/prepared-source.txt");
        let destination = fixture.media.join("Editable/prepared-copy.txt");
        std::fs::write(&source_path, b"same bytes").unwrap();
        std::fs::write(&destination, b"same bytes").unwrap();
        let source = fixture.summary("Editable/prepared-source.txt").await;
        let parent = fixture.parent().await;
        let command_id = "command-copy-prepared-destination";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-copy-prepared-destination".into(),
                request_digest: "prepared-copy".into(),
                operation: JournalOperation::Copy {
                    source: source.reference,
                    destination_parent: parent.reference,
                    source_path: "Editable/prepared-source.txt".into(),
                    destination_path: "Editable/prepared-copy.txt".into(),
                    staging_path: staging_path(&destination, command_id, false),
                    source_is_directory: false,
                    source_digest: Some(path_digest_blocking(&source_path).unwrap()),
                    expected_source_version: source.version,
                    expected_parent_version: None,
                    accounted_bytes: 10,
                },
            })
            .unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"same bytes");
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::NeedsReconciliation
        );
    }

    #[tokio::test]
    async fn move_and_delete_reject_nested_content_changes_hidden_from_folder_version() {
        let fixture = Fixture::new("folder-content-snapshots").await;
        let parent = fixture.parent().await;

        let move_path = fixture.media.join("Editable/move-tree");
        std::fs::create_dir(&move_path).unwrap();
        std::fs::write(move_path.join("child.txt"), b"old").unwrap();
        let move_source = fixture.summary("Editable/move-tree").await;
        let move_digest = path_digest_blocking(&move_path).unwrap();
        let move_id = "command-move-tree-snapshot";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: move_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-move-tree-snapshot".into(),
                request_digest: "prepared-move".into(),
                operation: JournalOperation::Move {
                    source: move_source.reference,
                    destination_parent: parent.reference.clone(),
                    source_path: "Editable/move-tree".into(),
                    destination_path: "Editable/moved-tree".into(),
                    staging_path: staging_path(
                        &fixture.media.join("Editable/moved-tree"),
                        move_id,
                        true,
                    ),
                    source_is_directory: true,
                    source_digest: Some(move_digest),
                    expected_source_version: move_source.version,
                    expected_parent_version: None,
                },
            })
            .unwrap();
        std::fs::write(move_path.join("child.txt"), b"new").unwrap();

        let delete_path = fixture.media.join("Editable/delete-tree-snapshot");
        std::fs::create_dir(&delete_path).unwrap();
        std::fs::write(delete_path.join("child.txt"), b"old").unwrap();
        let delete_target = fixture.summary("Editable/delete-tree-snapshot").await;
        let delete_digest = path_digest_blocking(&delete_path).unwrap();
        let delete_id = "command-delete-tree-snapshot";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: delete_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-delete-tree-snapshot".into(),
                request_digest: "prepared-delete".into(),
                operation: JournalOperation::Delete {
                    target: delete_target.reference,
                    path: "Editable/delete-tree-snapshot".into(),
                    target_is_directory: true,
                    target_digest: Some(delete_digest),
                    expected_version: delete_target.version,
                    quota_refund: 0,
                },
            })
            .unwrap();
        std::fs::write(delete_path.join("child.txt"), b"new").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(move_path.is_dir());
        assert!(!fixture.media.join("Editable/moved-tree").exists());
        assert!(delete_path.is_dir());
        for command_id in [move_id, delete_id] {
            assert_eq!(
                fixture
                    .commands
                    .journal
                    .by_id(command_id)
                    .unwrap()
                    .unwrap()
                    .state,
                JournalState::NeedsReconciliation
            );
        }
    }

    #[tokio::test]
    async fn prepared_move_requires_physical_identity_and_digest_at_destination() {
        let fixture = Fixture::new("move-prepared-identity").await;
        let parent = fixture.parent().await;

        let owned_source_path = fixture.media.join("Editable/owned-source.txt");
        let owned_destination = fixture.media.join("Editable/owned-destination.txt");
        std::fs::write(&owned_source_path, b"owned").unwrap();
        let owned_source = fixture.summary("Editable/owned-source.txt").await;
        let owned_id = "command-move-owned-destination";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: owned_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-move-owned-destination".into(),
                request_digest: "prepared-move".into(),
                operation: JournalOperation::Move {
                    source: owned_source.reference,
                    destination_parent: parent.reference.clone(),
                    source_path: "Editable/owned-source.txt".into(),
                    destination_path: "Editable/owned-destination.txt".into(),
                    staging_path: staging_path(&owned_destination, owned_id, false),
                    source_is_directory: false,
                    source_digest: Some(path_digest_blocking(&owned_source_path).unwrap()),
                    expected_source_version: owned_source.version,
                    expected_parent_version: None,
                },
            })
            .unwrap();
        std::fs::rename(&owned_source_path, &owned_destination).unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(owned_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::Completed
        );

        let foreign_source_path = fixture.media.join("Editable/foreign-source.txt");
        let foreign_destination = fixture.media.join("Editable/foreign-destination.txt");
        std::fs::write(&foreign_source_path, b"same").unwrap();
        let foreign_source = fixture.summary("Editable/foreign-source.txt").await;
        let foreign_id = "command-move-foreign-destination";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: foreign_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-move-foreign-destination".into(),
                request_digest: "prepared-move".into(),
                operation: JournalOperation::Move {
                    source: foreign_source.reference,
                    destination_parent: parent.reference,
                    source_path: "Editable/foreign-source.txt".into(),
                    destination_path: "Editable/foreign-destination.txt".into(),
                    staging_path: staging_path(&foreign_destination, foreign_id, false),
                    source_is_directory: false,
                    source_digest: Some(path_digest_blocking(&foreign_source_path).unwrap()),
                    expected_source_version: foreign_source.version,
                    expected_parent_version: None,
                },
            })
            .unwrap();
        std::fs::remove_file(&foreign_source_path).unwrap();
        std::fs::write(&foreign_destination, b"same").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert_eq!(std::fs::read(&foreign_destination).unwrap(), b"same");
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(foreign_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::NeedsReconciliation
        );
    }

    #[tokio::test]
    async fn move_ignores_unrelated_parent_churn_unless_caller_supplies_parent_version() {
        let fixture = Fixture::new("move-parent-churn").await;
        let shared = fixture.media.join("Editable/SharedContent");
        let source_path = shared.join("unique-root");
        std::fs::create_dir_all(&source_path).unwrap();
        std::fs::write(source_path.join("note.txt"), b"note").unwrap();
        let parent = fixture.summary("Editable/SharedContent").await;
        let source = fixture.summary("Editable/SharedContent/unique-root").await;
        let destination = shared.join("renamed-root");
        let command_id = "command-move-parent-churn";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: command_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-move-parent-churn".into(),
                request_digest: "prepared-move".into(),
                operation: JournalOperation::Move {
                    source: source.reference,
                    destination_parent: parent.reference,
                    source_path: "Editable/SharedContent/unique-root".into(),
                    destination_path: "Editable/SharedContent/renamed-root".into(),
                    staging_path: staging_path(&destination, command_id, true),
                    source_is_directory: true,
                    source_digest: Some(path_digest_blocking(&source_path).unwrap()),
                    expected_source_version: source.version,
                    expected_parent_version: None,
                },
            })
            .unwrap();
        std::fs::write(shared.join("parallel-sibling.txt"), b"parallel").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(destination.is_dir());
        assert!(!source_path.exists());
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(command_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::Completed
        );

        let guarded_source_path = shared.join("guarded-root");
        std::fs::create_dir(&guarded_source_path).unwrap();
        std::fs::write(guarded_source_path.join("note.txt"), b"guarded").unwrap();
        let guarded_parent = fixture.summary("Editable/SharedContent").await;
        let guarded_source = fixture.summary("Editable/SharedContent/guarded-root").await;
        let guarded_destination = shared.join("guarded-renamed");
        let guarded_id = "command-move-parent-guard";
        fixture
            .commands
            .journal
            .insert(NewJournalRecord {
                command_id: guarded_id.into(),
                principal_kind: "owner".into(),
                principal_id: "owner".into(),
                idempotency_key: "recover-move-parent-guard".into(),
                request_digest: "prepared-move".into(),
                operation: JournalOperation::Move {
                    source: guarded_source.reference,
                    destination_parent: guarded_parent.reference,
                    source_path: "Editable/SharedContent/guarded-root".into(),
                    destination_path: "Editable/SharedContent/guarded-renamed".into(),
                    staging_path: staging_path(&guarded_destination, guarded_id, true),
                    source_is_directory: true,
                    source_digest: Some(path_digest_blocking(&guarded_source_path).unwrap()),
                    expected_source_version: guarded_source.version,
                    expected_parent_version: guarded_parent.version,
                },
            })
            .unwrap();
        std::fs::write(shared.join("caller-visible-churn.txt"), b"changed").unwrap();

        fixture.commands.recover_pending().await.unwrap();

        assert!(guarded_source_path.is_dir());
        assert!(!guarded_destination.exists());
        assert_eq!(
            fixture
                .commands
                .journal
                .by_id(guarded_id)
                .unwrap()
                .unwrap()
                .state,
            JournalState::NeedsReconciliation
        );
    }

    #[tokio::test]
    async fn move_preserves_resource_metadata_and_grant_root() {
        let fixture = Fixture::new("move-metadata").await;
        let old = fixture.media.join("Editable/Shared");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("note.md"), b"note").unwrap();
        let source = fixture.summary("Editable/Shared").await;
        let destination_parent = fixture.parent().await;
        let share = shares::create(
            &fixture.config,
            &[],
            "Editable/Shared".into(),
            true,
            true,
            Some(Restrictions::default()),
        )
        .unwrap();
        state_db::update_document(
            &state_db::database(&fixture.config),
            "settings",
            &fixture.config.library_key,
            json!({}),
            |settings| {
                *settings = json!({
                    "favorites":["Editable/Shared/note.md"],
                    "viewModes":{},"customIcons":{},"autoSave":{},"knowledgeBases":[],
                    "workspaceTaskbarPins":[],"workspaceLayoutPresets":[],
                });
                Ok(())
            },
        )
        .unwrap();
        crate::reader_state::put(
            &state_db::database(&fixture.config),
            "owner",
            "Editable/Shared/note.md",
            &json!({"page":4}),
            "fingerprint",
            0,
            1,
        )
        .unwrap();

        fixture
            .commands
            .execute(
                &RequestContext::owner(),
                ContentCommand {
                    idempotency_key: "move-shared-root".into(),
                    operation: ContentOperation::Move {
                        source: source.reference.clone(),
                        destination_parent: destination_parent.reference,
                        target_name: ChildName::parse("Renamed").unwrap(),
                        expected_source_version: source.version,
                        expected_destination_parent_version: destination_parent.version,
                    },
                },
            )
            .await
            .unwrap();
        let moved = fixture.summary("Editable/Renamed").await;
        assert_eq!(moved.reference, source.reference);
        let relocated = shares::find(&fixture.config, &[], &share.token)
            .unwrap()
            .unwrap();
        assert_eq!(relocated.path, "Editable/Renamed");
        let settings = state_db::document(
            &state_db::database(&fixture.config),
            "settings",
            &fixture.config.library_key,
            json!({}),
        )
        .unwrap();
        assert_eq!(settings["favorites"], json!(["Editable/Renamed/note.md"]));
        assert!(
            crate::reader_state::get(
                &state_db::database(&fixture.config),
                "owner",
                "Editable/Renamed/note.md",
            )
            .unwrap()
            .is_some()
        );
    }

    #[test]
    fn route_handlers_do_not_mutate_filesystem_content_directly() {
        for (name, source) in [
            ("files", include_str!("../routes/files.rs")),
            ("share_access", include_str!("../routes/share_access.rs")),
            ("share_media", include_str!("../routes/share_media.rs")),
        ] {
            for forbidden in [
                "fs::write(",
                "fs::rename(",
                "fs::copy(",
                "fs::create_dir(",
                "fs::create_dir_all(",
                "fs::remove_file(",
                "fs::remove_dir(",
                "fs::remove_dir_all(",
            ] {
                assert!(
                    !source.contains(forbidden),
                    "{name} contains direct filesystem mutation {forbidden}"
                );
            }
        }
    }
}
