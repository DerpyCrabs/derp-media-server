use super::{CommandError, CommandErrorCode, CommandReceipt};
use crate::{
    resources::{ResourceRef, ResourceVersion},
    shares::GrantId,
    state_db,
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum JournalState {
    Prepared,
    Staged,
    FilesystemApplied,
    Completed,
    Failed,
    NeedsReconciliation,
}

impl JournalState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Prepared => "prepared",
            Self::Staged => "staged",
            Self::FilesystemApplied => "filesystem_applied",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::NeedsReconciliation => "needs_reconciliation",
        }
    }

    fn parse(value: &str) -> Result<Self, CommandError> {
        match value {
            "prepared" => Ok(Self::Prepared),
            "staged" => Ok(Self::Staged),
            "filesystem_applied" => Ok(Self::FilesystemApplied),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "needs_reconciliation" => Ok(Self::NeedsReconciliation),
            _ => Err(CommandError::new(
                CommandErrorCode::Internal,
                format!("Unknown command journal state: {value}"),
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum JournalWriteMode {
    Create,
    Upload,
    Replace,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum JournalOperation {
    CreateFolder {
        destination_parent: ResourceRef,
        path: String,
        expected_parent_version: Option<ResourceVersion>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        staging_path: Option<String>,
    },
    WriteFile {
        mode: JournalWriteMode,
        destination_parent: Option<ResourceRef>,
        target: Option<ResourceRef>,
        path: String,
        staging_path: String,
        payload_digest: String,
        payload_len: u64,
        accounted_bytes: u64,
        expected_parent_version: Option<ResourceVersion>,
        expected_target_version: Option<ResourceVersion>,
    },
    Copy {
        source: ResourceRef,
        destination_parent: ResourceRef,
        source_path: String,
        destination_path: String,
        staging_path: String,
        source_is_directory: bool,
        #[serde(default)]
        source_digest: Option<String>,
        expected_source_version: Option<ResourceVersion>,
        expected_parent_version: Option<ResourceVersion>,
        accounted_bytes: u64,
    },
    Move {
        source: ResourceRef,
        destination_parent: ResourceRef,
        source_path: String,
        destination_path: String,
        staging_path: String,
        source_is_directory: bool,
        #[serde(default)]
        source_digest: Option<String>,
        expected_source_version: Option<ResourceVersion>,
        expected_parent_version: Option<ResourceVersion>,
    },
    Delete {
        target: ResourceRef,
        path: String,
        target_is_directory: bool,
        #[serde(default)]
        target_digest: Option<String>,
        expected_version: Option<ResourceVersion>,
        quota_refund: u64,
    },
}

impl JournalOperation {
    pub(super) fn kind(&self) -> &'static str {
        match self {
            Self::CreateFolder { .. } => "create_folder",
            Self::WriteFile { mode, .. } => match mode {
                JournalWriteMode::Create => "create_file",
                JournalWriteMode::Upload => "upload_file",
                JournalWriteMode::Replace => "replace_file",
            },
            Self::Copy { .. } => "copy",
            Self::Move { .. } => "move",
            Self::Delete { .. } => "delete",
        }
    }

    pub(super) fn staging_path(&self) -> Option<&str> {
        match self {
            Self::CreateFolder { staging_path, .. } => staging_path.as_deref(),
            Self::WriteFile { staging_path, .. }
            | Self::Copy { staging_path, .. }
            | Self::Move { staging_path, .. } => Some(staging_path),
            Self::Delete { .. } => None,
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct NewJournalRecord {
    pub(super) command_id: String,
    pub(super) principal_kind: String,
    pub(super) principal_id: String,
    pub(super) idempotency_key: String,
    pub(super) request_digest: String,
    pub(super) operation: JournalOperation,
}

#[derive(Clone, Debug)]
pub(super) struct JournalRecord {
    pub(super) command_id: String,
    pub(super) principal_kind: String,
    pub(super) principal_id: String,
    pub(super) idempotency_key: String,
    pub(super) request_digest: String,
    pub(super) state: JournalState,
    pub(super) operation: JournalOperation,
    pub(super) receipt: Option<CommandReceipt>,
    pub(super) error: Option<String>,
}

#[derive(Clone)]
pub(super) struct CommandJournal {
    database: PathBuf,
    library_id: String,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn database_error(error: impl std::fmt::Display) -> CommandError {
    CommandError::new(CommandErrorCode::Internal, error.to_string())
}

pub(super) fn initialize(database: &Path) -> Result<(), String> {
    let connection = state_db::connection(database).map_err(|error| error.1)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS command_journal (
               command_id TEXT PRIMARY KEY,
               library_id TEXT NOT NULL,
               principal_kind TEXT NOT NULL,
               principal_id TEXT NOT NULL,
               idempotency_key TEXT NOT NULL,
               request_digest TEXT NOT NULL,
               command_kind TEXT NOT NULL,
               descriptor_json TEXT NOT NULL,
               state TEXT NOT NULL,
               receipt_json TEXT,
               reconciliation_error TEXT,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               UNIQUE(library_id, principal_kind, principal_id, idempotency_key)
             );
             CREATE INDEX IF NOT EXISTS command_journal_recovery
               ON command_journal(library_id, state, created_at);
             CREATE TABLE IF NOT EXISTS command_quota_ledger (
               command_id TEXT NOT NULL REFERENCES command_journal(command_id),
               grant_id TEXT NOT NULL,
               delta INTEGER NOT NULL,
               applied_at INTEGER NOT NULL,
               PRIMARY KEY(command_id, grant_id)
             );",
        )
        .map_err(|error| error.to_string())
}

impl CommandJournal {
    pub(super) fn new(database: PathBuf, library_id: impl Into<String>) -> Self {
        Self {
            database,
            library_id: library_id.into(),
        }
    }

    pub(super) fn find(
        &self,
        principal_kind: &str,
        principal_id: &str,
        idempotency_key: &str,
    ) -> Result<Option<JournalRecord>, CommandError> {
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        connection
            .query_row(
                "SELECT command_id,principal_kind,principal_id,idempotency_key,request_digest,
                        state,descriptor_json,receipt_json,reconciliation_error
                 FROM command_journal
                 WHERE library_id=?1 AND principal_kind=?2 AND principal_id=?3
                   AND idempotency_key=?4",
                params![
                    self.library_id,
                    principal_kind,
                    principal_id,
                    idempotency_key
                ],
                parse_record,
            )
            .optional()
            .map_err(database_error)?
            .map(parse_serialized_record)
            .transpose()
    }

    pub(super) fn by_id(&self, command_id: &str) -> Result<Option<JournalRecord>, CommandError> {
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        connection
            .query_row(
                "SELECT command_id,principal_kind,principal_id,idempotency_key,request_digest,
                        state,descriptor_json,receipt_json,reconciliation_error
                 FROM command_journal WHERE library_id=?1 AND command_id=?2",
                params![self.library_id, command_id],
                parse_record,
            )
            .optional()
            .map_err(database_error)?
            .map(parse_serialized_record)
            .transpose()
    }

    pub(super) fn insert(&self, record: NewJournalRecord) -> Result<JournalRecord, CommandError> {
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        let descriptor = serde_json::to_string(&record.operation).map_err(database_error)?;
        connection
            .execute(
                "INSERT INTO command_journal(
                   command_id,library_id,principal_kind,principal_id,idempotency_key,
                   request_digest,command_kind,descriptor_json,state,created_at,updated_at
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'prepared',?9,?9)",
                params![
                    record.command_id,
                    self.library_id,
                    record.principal_kind,
                    record.principal_id,
                    record.idempotency_key,
                    record.request_digest,
                    record.operation.kind(),
                    descriptor,
                    now_ms()
                ],
            )
            .map_err(database_error)?;
        self.by_id(&record.command_id)?.ok_or_else(|| {
            CommandError::new(
                CommandErrorCode::Internal,
                "Command journal insert was not readable",
            )
        })
    }

    pub(super) fn mark_state(
        &self,
        command_id: &str,
        state: JournalState,
    ) -> Result<(), CommandError> {
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        require_updated(
            connection
                .execute(
                    "UPDATE command_journal SET state=?3,reconciliation_error=NULL,updated_at=?4
                     WHERE command_id=?1 AND library_id=?2",
                    params![command_id, self.library_id, state.as_str(), now_ms()],
                )
                .map_err(database_error)?,
        )
    }

    pub(super) fn update_operation(
        &self,
        command_id: &str,
        operation: &JournalOperation,
    ) -> Result<(), CommandError> {
        let descriptor = serde_json::to_string(operation).map_err(database_error)?;
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        require_updated(
            connection
                .execute(
                    "UPDATE command_journal SET descriptor_json=?3,updated_at=?4
                     WHERE command_id=?1 AND library_id=?2",
                    params![command_id, self.library_id, descriptor, now_ms()],
                )
                .map_err(database_error)?,
        )
    }

    pub(super) fn mark_completed(
        &self,
        command_id: &str,
        receipt: &CommandReceipt,
    ) -> Result<(), CommandError> {
        let serialized = serde_json::to_string(receipt).map_err(database_error)?;
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        require_updated(
            connection
                .execute(
                    "UPDATE command_journal SET state='completed',receipt_json=?3,
                       reconciliation_error=NULL,updated_at=?4
                     WHERE command_id=?1 AND library_id=?2",
                    params![command_id, self.library_id, serialized, now_ms()],
                )
                .map_err(database_error)?,
        )
    }

    pub(super) fn mark_needs_reconciliation(
        &self,
        command_id: &str,
        message: &str,
    ) -> Result<(), CommandError> {
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        require_updated(
            connection
                .execute(
                    "UPDATE command_journal SET state='needs_reconciliation',
                       reconciliation_error=?3,updated_at=?4
                     WHERE command_id=?1 AND library_id=?2",
                    params![command_id, self.library_id, message, now_ms()],
                )
                .map_err(database_error)?,
        )
    }

    pub(super) fn record_reconciliation_error(
        &self,
        command_id: &str,
        message: &str,
    ) -> Result<(), CommandError> {
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        require_updated(
            connection
                .execute(
                    "UPDATE command_journal SET reconciliation_error=?3,updated_at=?4
                     WHERE command_id=?1 AND library_id=?2",
                    params![command_id, self.library_id, message, now_ms()],
                )
                .map_err(database_error)?,
        )
    }

    pub(super) fn recoverable(&self) -> Result<Vec<JournalRecord>, CommandError> {
        let connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        let mut statement = connection
            .prepare(
                "SELECT command_id,principal_kind,principal_id,idempotency_key,request_digest,
                        state,descriptor_json,receipt_json,reconciliation_error
                 FROM command_journal
                 WHERE library_id=?1 AND state IN(
                   'prepared','staged','filesystem_applied','needs_reconciliation'
                 ) ORDER BY created_at,command_id",
            )
            .map_err(database_error)?;
        statement
            .query_map([&self.library_id], parse_record)
            .map_err(database_error)?
            .map(|row| {
                row.map_err(database_error)
                    .and_then(parse_serialized_record)
            })
            .collect()
    }

    pub(super) fn apply_quota_once(
        &self,
        command_id: &str,
        grant_id: &GrantId,
        delta: i64,
    ) -> Result<(), CommandError> {
        if delta == 0 {
            return Ok(());
        }
        let mut connection = state_db::connection(&self.database).map_err(CommandError::from)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM shares WHERE grant_id=?1)",
                [grant_id.as_str()],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if !exists {
            return Err(CommandError::new(
                CommandErrorCode::NotFound,
                "Grant no longer exists while applying quota",
            ));
        }
        let inserted = transaction
            .execute(
                "INSERT OR IGNORE INTO command_quota_ledger(
                   command_id,grant_id,delta,applied_at
                 ) VALUES(?1,?2,?3,?4)",
                params![command_id, grant_id.as_str(), delta, now_ms()],
            )
            .map_err(database_error)?;
        if inserted > 0 {
            transaction
                .execute(
                    "UPDATE shares SET used_bytes=MAX(COALESCE(used_bytes,0)+?1,0)
                     WHERE grant_id=?2",
                    params![delta, grant_id.as_str()],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)
    }
}

type RawRecord = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

fn parse_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRecord> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
    ))
}

fn parse_serialized_record(raw: RawRecord) -> Result<JournalRecord, CommandError> {
    Ok(JournalRecord {
        command_id: raw.0,
        principal_kind: raw.1,
        principal_id: raw.2,
        idempotency_key: raw.3,
        request_digest: raw.4,
        state: JournalState::parse(&raw.5)?,
        operation: serde_json::from_str(&raw.6).map_err(database_error)?,
        receipt: raw
            .7
            .map(|value| serde_json::from_str(&value).map_err(database_error))
            .transpose()?,
        error: raw.8,
    })
}

fn require_updated(affected: usize) -> Result<(), CommandError> {
    if affected == 0 {
        Err(CommandError::new(
            CommandErrorCode::NotFound,
            "Command journal entry not found",
        ))
    } else {
        Ok(())
    }
}
