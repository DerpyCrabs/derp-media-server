mod types;

#[cfg(test)]
mod tests;

pub(crate) use types::*;

use crate::{config::Config, state_db};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA_VERSION: i64 = 5;
const SCHEMA_BACKUP: &str = "app-before-spaces-v5.sqlite3";
const HISTORY_RETENTION: i64 = 50;
const COMMAND_RECEIPTS_TABLE: &str = "space_command_receipts";

#[derive(Clone)]
pub(crate) struct SpaceEngine {
    database: PathBuf,
    library_id: String,
    history_retention: i64,
}

#[derive(Debug)]
struct StoredSpace {
    id: String,
    schema_version: i64,
    name: String,
    revision: i64,
    origin: String,
    panes_json: String,
    arrangements_json: String,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
}

pub(crate) fn initialize(config: &Config) -> Result<SpaceEngine, String> {
    let database = state_db::database(config);
    apply_schema(config, &database)?;
    let engine = SpaceEngine {
        database,
        library_id: config.library_key.clone(),
        history_retention: HISTORY_RETENTION,
    };
    let legacy = state_db::document(&engine.database, "canvases", &engine.library_id, json!([]))
        .map_err(|error| error.1)?;
    engine
        .import_canvases(&legacy)
        .map_err(|error| error.message)?;
    Ok(engine)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())
}

fn backup_before_schema(config: &Config, connection: &Connection) -> Result<(), String> {
    let directory = config.data_path.join("schema-backups");
    let backup = directory.join(SCHEMA_BACKUP);
    if backup.exists() {
        return Ok(());
    }
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create Space schema backup directory {}: {error}",
            directory.display()
        )
    })?;
    connection
        .execute("VACUUM INTO ?1", [backup.to_string_lossy().into_owned()])
        .map_err(|error| {
            format!(
                "Failed to back up app database to {}: {error}",
                backup.display()
            )
        })?;
    Ok(())
}

fn apply_schema(config: &Config, database: &Path) -> Result<(), String> {
    let mut connection = state_db::connection(database).map_err(|error| error.1)?;
    let applied = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=?1)",
            [SCHEMA_VERSION],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if applied {
        for table in ["spaces", "space_revisions", "space_imports"] {
            if !table_exists(&connection, table)? {
                return Err(format!(
                    "Space persistence recovery required: schema version exists without {table}"
                ));
            }
        }
        ensure_command_receipts_schema(&mut connection)?;
        return Ok(());
    }

    backup_before_schema(config, &connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "CREATE TABLE spaces (
               library_id TEXT NOT NULL,
               id TEXT NOT NULL,
               schema_version INTEGER NOT NULL,
               name TEXT NOT NULL,
               revision INTEGER NOT NULL,
               origin TEXT NOT NULL,
               panes_json TEXT NOT NULL,
               arrangements_json TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               deleted_at INTEGER,
               PRIMARY KEY(library_id,id)
             );
             CREATE INDEX spaces_updated
               ON spaces(library_id,deleted_at,updated_at DESC,id);
             CREATE TABLE space_revisions (
               library_id TEXT NOT NULL,
               space_id TEXT NOT NULL,
               revision INTEGER NOT NULL,
               snapshot_json TEXT NOT NULL,
               command_type TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               PRIMARY KEY(library_id,space_id,revision),
               FOREIGN KEY(library_id,space_id) REFERENCES spaces(library_id,id)
             );
             CREATE INDEX space_revision_history
               ON space_revisions(library_id,space_id,revision DESC);
             CREATE TABLE space_imports (
               library_id TEXT NOT NULL,
               source_kind TEXT NOT NULL,
               source_key TEXT NOT NULL,
               source_digest TEXT NOT NULL,
               space_id TEXT,
               space_revision INTEGER,
               status TEXT NOT NULL,
               raw_json TEXT NOT NULL,
               error TEXT,
               imported_at INTEGER NOT NULL,
               PRIMARY KEY(library_id,source_kind,source_key,source_digest)
             );
             CREATE INDEX space_import_source
               ON space_imports(library_id,source_kind,source_key,imported_at DESC);",
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO schema_migrations(version,applied_at) VALUES(?1,?2)",
            params![SCHEMA_VERSION, now_ms()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    ensure_command_receipts_schema(&mut connection)
}

fn ensure_command_receipts_schema(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS space_command_receipts (
               library_id TEXT NOT NULL,
               command_id TEXT NOT NULL,
               request_digest TEXT NOT NULL,
               result_space_id TEXT NOT NULL,
               PRIMARY KEY(library_id,command_id),
               FOREIGN KEY(library_id,result_space_id) REFERENCES spaces(library_id,id)
             );",
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    if !table_exists(connection, COMMAND_RECEIPTS_TABLE)? {
        return Err(format!(
            "Space persistence recovery required: schema version exists without {COMMAND_RECEIPTS_TABLE}"
        ));
    }
    Ok(())
}

impl SpaceEngine {
    #[cfg(test)]
    fn for_test(database: PathBuf, library_id: impl Into<String>, retention: i64) -> Self {
        Self {
            database,
            library_id: library_id.into(),
            history_retention: retention,
        }
    }

    pub(crate) fn list(&self) -> Result<Vec<SpaceSummary>, SpaceError> {
        let connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        let mut statement = connection.prepare(
            "SELECT id,schema_version,name,revision,origin,panes_json,arrangements_json,
                    created_at,updated_at,deleted_at
             FROM spaces WHERE library_id=?1
             ORDER BY deleted_at IS NOT NULL,updated_at DESC,id",
        )?;
        let rows = statement
            .query_map([&self.library_id], stored_space_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(decode_space)
            .map(|space| space.map(|space| SpaceSummary::from(&space)))
            .collect()
    }

    pub(crate) fn load(&self, id: &str) -> Result<Space, SpaceError> {
        let connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        load_in(&connection, &self.library_id, id)?
            .ok_or_else(|| SpaceError::not_found("Space not found"))
    }

    pub(crate) fn history(&self, id: &str) -> Result<Vec<SpaceRevisionSummary>, SpaceError> {
        let connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        if load_in(&connection, &self.library_id, id)?.is_none() {
            return Err(SpaceError::not_found("Space not found"));
        }
        let mut statement = connection.prepare(
            "SELECT revision,snapshot_json,command_type,created_at
             FROM space_revisions
             WHERE library_id=?1 AND space_id=?2 ORDER BY revision DESC",
        )?;
        let rows = statement
            .query_map(params![self.library_id, id], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(revision, raw, command_type, created_at)| {
                let snapshot: Space = serde_json::from_str(&raw)?;
                Ok(SpaceRevisionSummary {
                    revision,
                    name: snapshot.name,
                    command_type,
                    created_at,
                    deleted_at: snapshot.deleted_at,
                })
            })
            .collect()
    }

    pub(crate) fn revision(&self, id: &str, revision: i64) -> Result<Space, SpaceError> {
        let connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        revision_in(&connection, &self.library_id, id, revision)
    }

    pub(crate) fn apply(&self, request: ApplySpaceCommand) -> Result<Space, SpaceError> {
        let mut connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(SpaceError::from)?;
        let ApplySpaceCommand {
            command_id,
            space_id,
            expected_revision,
            command,
        } = request;
        let request_digest = if let Some(command_id) = command_id.as_deref() {
            validate_command_id(command_id)?;
            let digest = command_request_digest(space_id.as_deref(), &command)?;
            if let Some((recorded_digest, result_space_id)) =
                command_receipt_in(&transaction, &self.library_id, command_id)?
            {
                if recorded_digest != digest {
                    return Err(SpaceError::invalid(
                        "Space command ID was already used for a different command",
                    ));
                }
                let current = load_in(&transaction, &self.library_id, &result_space_id)?
                    .ok_or_else(|| {
                        SpaceError::internal(
                            "Space command receipt references a missing result Space",
                        )
                    })?;
                transaction.commit()?;
                return Ok(current);
            }
            Some(digest)
        } else {
            None
        };
        let result = match command {
            SpaceCommand::Create {
                id,
                name,
                origin,
                panes,
                arrangements,
            } => self.create_in(
                &transaction,
                space_id,
                expected_revision,
                id,
                name,
                origin,
                panes,
                arrangements,
                "create",
            ),
            SpaceCommand::Duplicate {
                source_revision,
                new_id,
                name,
            } => self.duplicate_in(
                &transaction,
                space_id,
                expected_revision,
                source_revision,
                new_id,
                name,
            ),
            command => self.update_in(&transaction, space_id, expected_revision, command),
        }?;
        if let (Some(command_id), Some(request_digest)) = (command_id, request_digest) {
            insert_command_receipt(
                &transaction,
                &self.library_id,
                &command_id,
                &request_digest,
                &result.id,
            )?;
        }
        transaction.commit()?;
        Ok(result)
    }

    #[allow(clippy::too_many_arguments)]
    fn create_in(
        &self,
        transaction: &Transaction<'_>,
        outer_id: Option<String>,
        expected_revision: Option<i64>,
        command_id: Option<String>,
        name: String,
        origin: SpaceOrigin,
        panes: BTreeMap<String, PaneContent>,
        arrangements: SpaceArrangements,
        command_type: &str,
    ) -> Result<Space, SpaceError> {
        if expected_revision.is_some_and(|revision| revision != 0) {
            return Err(SpaceError::invalid("New Space expected revision must be 0"));
        }
        if outer_id.is_some() && command_id.is_some() && outer_id != command_id {
            return Err(SpaceError::invalid("Space IDs do not match"));
        }
        let id = outer_id
            .or(command_id)
            .unwrap_or_else(|| format!("space-{}", uuid::Uuid::new_v4()));
        validate_id(&id)?;
        let name = validate_name(&name)?;
        validate_panes(&panes)?;
        validate_arrangements(&arrangements, &panes)?;
        if let Some(current) = load_in(transaction, &self.library_id, &id)? {
            return Err(SpaceError::already_exists(current));
        }
        let now = now_ms();
        let space = Space {
            schema_version: SPACE_SCHEMA_VERSION,
            id,
            name,
            revision: 1,
            origin,
            panes,
            arrangements,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        };
        insert_head(transaction, &self.library_id, &space)?;
        append_revision(transaction, &self.library_id, &space, command_type)?;
        Ok(space)
    }

    fn duplicate_in(
        &self,
        transaction: &Transaction<'_>,
        source_id: Option<String>,
        expected_revision: Option<i64>,
        source_revision: Option<i64>,
        new_id: Option<String>,
        name: Option<String>,
    ) -> Result<Space, SpaceError> {
        let source_id = source_id.ok_or_else(|| SpaceError::invalid("Space ID is required"))?;
        let current = load_in(transaction, &self.library_id, &source_id)?
            .ok_or_else(|| SpaceError::not_found("Space not found"))?;
        require_expected(expected_revision, &current)?;
        let source = match source_revision {
            Some(revision) => revision_in(transaction, &self.library_id, &source_id, revision)?,
            None => current,
        };
        if source.deleted_at.is_some() {
            return Err(SpaceError::invalid(
                "Deleted revision cannot be duplicated; choose a retained live revision",
            ));
        }
        self.create_in(
            transaction,
            None,
            Some(0),
            new_id,
            name.unwrap_or_else(|| format!("{} copy", source.name)),
            source.origin,
            source.panes,
            source.arrangements,
            "duplicate",
        )
    }

    fn update_in(
        &self,
        transaction: &Transaction<'_>,
        id: Option<String>,
        expected_revision: Option<i64>,
        command: SpaceCommand,
    ) -> Result<Space, SpaceError> {
        let id = id.ok_or_else(|| SpaceError::invalid("Space ID is required"))?;
        let mut space = load_in(transaction, &self.library_id, &id)?
            .ok_or_else(|| SpaceError::not_found("Space not found"))?;
        require_expected(expected_revision, &space)?;
        let command_type = command.kind();
        if space.deleted_at.is_some() && !matches!(command, SpaceCommand::RestoreRevision { .. }) {
            return Err(SpaceError::invalid("Deleted Space is read-only"));
        }
        match command {
            SpaceCommand::Rename { name } => space.name = validate_name(&name)?,
            SpaceCommand::Delete => space.deleted_at = Some(now_ms()),
            SpaceCommand::AddPane { pane_id, pane } => {
                validate_id(&pane_id)?;
                validate_pane(&pane)?;
                if space.panes.contains_key(&pane_id) {
                    return Err(SpaceError::invalid("Pane already exists"));
                }
                space.panes.insert(pane_id, pane);
            }
            SpaceCommand::RemovePane { pane_id } => {
                if space.panes.remove(&pane_id).is_none() {
                    return Err(SpaceError::not_found("Pane not found"));
                }
                prune_pane_from_arrangements(&mut space.arrangements, &pane_id);
            }
            SpaceCommand::UpdatePane { pane_id, pane } => {
                validate_pane(&pane)?;
                let target = space
                    .panes
                    .get_mut(&pane_id)
                    .ok_or_else(|| SpaceError::not_found("Pane not found"))?;
                *target = pane;
            }
            SpaceCommand::ApplyArrangement {
                presentation,
                arrangement,
            } => match presentation {
                ArrangementPresentation::Tiled => space.arrangements.tiled = arrangement,
                ArrangementPresentation::Spatial => space.arrangements.spatial = arrangement,
            },
            SpaceCommand::RestoreRevision { revision } => {
                let restored = revision_in(transaction, &self.library_id, &id, revision)?;
                space.name = restored.name;
                space.origin = restored.origin;
                space.panes = restored.panes;
                space.arrangements = restored.arrangements;
                space.deleted_at = restored.deleted_at;
            }
            SpaceCommand::Create { .. } | SpaceCommand::Duplicate { .. } => unreachable!(),
        }
        validate_panes(&space.panes)?;
        validate_arrangements(&space.arrangements, &space.panes)?;
        space.revision += 1;
        space.updated_at = now_ms();
        update_head(transaction, &self.library_id, &space)?;
        append_revision(transaction, &self.library_id, &space, command_type)?;
        prune_history(
            transaction,
            &self.library_id,
            &space.id,
            self.history_retention,
        )?;
        Ok(space)
    }

    pub(crate) fn import_canvases(
        &self,
        raw: &Value,
    ) -> Result<(Vec<Space>, Vec<SpaceImportRecord>), SpaceError> {
        let items = raw
            .as_array()
            .ok_or_else(|| SpaceError::invalid("Canvas import must be an array"))?;
        let mut spaces: Vec<Space> = Vec::new();
        let mut imports = Vec::new();
        for raw_record in items {
            let (space, record) = self.import_canvas(raw_record)?;
            if let Some(space) = space {
                if let Some(existing) = spaces.iter_mut().find(|item| item.id == space.id) {
                    *existing = space;
                } else {
                    spaces.push(space);
                }
            }
            imports.push(record);
        }
        Ok((spaces, imports))
    }

    fn import_canvas(&self, raw: &Value) -> Result<(Option<Space>, SpaceImportRecord), SpaceError> {
        let digest = json_digest(raw)?;
        let candidate_id = raw.get("id").and_then(Value::as_str);
        if let Some(id) = candidate_id
            && let Some(current) = {
                let connection = state_db::connection(&self.database)
                    .map_err(|error| SpaceError::internal(error.1))?;
                load_in(&connection, &self.library_id, id)?
            }
            && space_to_legacy_canvas(&current) == *raw
        {
            let record = SpaceImportRecord {
                source_kind: "canvas".into(),
                source_key: id.to_string(),
                source_digest: digest,
                space_id: Some(id.to_string()),
                status: "unchanged".into(),
                error: None,
                imported_at: now_ms(),
                raw: raw.clone(),
            };
            return Ok((Some(current), record));
        }
        let source_key = candidate_id
            .filter(|id| valid_id(id))
            .map(str::to_string)
            .unwrap_or_else(|| format!("quarantine:{digest}"));
        let mut connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(SpaceError::from)?;
        if let Some(record) = import_record_in(
            &transaction,
            &self.library_id,
            "canvas",
            &source_key,
            &digest,
        )? {
            let space = record
                .space_id
                .as_deref()
                .map(|id| load_in(&transaction, &self.library_id, id))
                .transpose()?
                .flatten();
            transaction.commit()?;
            return Ok((space, record));
        }

        let imported_at = now_ms();
        let converted = canvas_to_space(raw);
        let (space, status, error) = match converted {
            Err(error) => (None, "quarantined".to_string(), Some(error.message)),
            Ok(mut candidate) => {
                let existing = load_in(&transaction, &self.library_id, &candidate.id)?;
                match existing {
                    None => {
                        insert_head(&transaction, &self.library_id, &candidate)?;
                        append_revision(
                            &transaction,
                            &self.library_id,
                            &candidate,
                            "importCanvas",
                        )?;
                        (Some(candidate), "imported".into(), None)
                    }
                    Some(current) if current.origin != SpaceOrigin::Canvas => (
                        None,
                        "quarantined".into(),
                        Some("Space ID already belongs to a Workspace import".into()),
                    ),
                    Some(current) => {
                        let prior = latest_import_in(
                            &transaction,
                            &self.library_id,
                            "canvas",
                            &source_key,
                        )?;
                        if prior.as_ref().is_some_and(|(_, previous_raw, _)| {
                            !legacy_record_is_newer(raw, previous_raw)
                        }) {
                            (Some(current), "unchanged".into(), None)
                        } else if canvas_durable_content_eq(&candidate, &current) {
                            (Some(current), "unchanged".into(), None)
                        } else if prior.as_ref().is_some_and(|(_, _, imported_revision)| {
                            *imported_revision == current.revision
                        }) {
                            candidate.revision = current.revision + 1;
                            candidate.created_at = current.created_at;
                            candidate.updated_at = imported_at;
                            update_head(&transaction, &self.library_id, &candidate)?;
                            append_revision(
                                &transaction,
                                &self.library_id,
                                &candidate,
                                "importCanvas",
                            )?;
                            prune_history(
                                &transaction,
                                &self.library_id,
                                &candidate.id,
                                self.history_retention,
                            )?;
                            (Some(candidate), "updated".into(), None)
                        } else {
                            (
                                None,
                                "quarantined".into(),
                                Some(
                                    "Canvas changed after its imported Space was edited; raw record retained"
                                        .into(),
                                ),
                            )
                        }
                    }
                }
            }
        };
        let record = SpaceImportRecord {
            source_kind: "canvas".into(),
            source_key,
            source_digest: digest,
            space_id: space.as_ref().map(|space| space.id.clone()),
            status,
            error,
            imported_at,
            raw: raw.clone(),
        };
        insert_import_record(&transaction, &self.library_id, &record, space.as_ref())?;
        transaction.commit()?;
        Ok((space, record))
    }

    pub(crate) fn import_workspace(
        &self,
        request: WorkspaceImportRequest,
    ) -> Result<(Space, SpaceImportRecord), SpaceError> {
        validate_import_source_key(&request.source_key)?;
        let digest = json_digest(&request.raw)?;
        let mut connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(SpaceError::from)?;
        if let Some(record) = import_record_in(
            &transaction,
            &self.library_id,
            "workspace",
            &request.source_key,
            &digest,
        )? {
            let space = record
                .space_id
                .as_deref()
                .ok_or_else(|| SpaceError::internal("Workspace import record has no Space"))
                .and_then(|id| {
                    load_in(&transaction, &self.library_id, id)?.ok_or_else(|| {
                        SpaceError::internal("Workspace import record references a missing Space")
                    })
                })?;
            transaction.commit()?;
            return Ok((space, record));
        }

        let imported_at = now_ms();
        let space = self.create_in(
            &transaction,
            None,
            Some(0),
            request.id,
            request.name,
            SpaceOrigin::Workspace,
            request.panes,
            request.arrangements,
            "importWorkspace",
        )?;
        let record = SpaceImportRecord {
            source_kind: "workspace".into(),
            source_key: request.source_key,
            source_digest: digest,
            space_id: Some(space.id.clone()),
            status: "imported".into(),
            error: None,
            imported_at,
            raw: request.raw,
        };
        insert_import_record(&transaction, &self.library_id, &record, Some(&space))?;
        transaction.commit()?;
        Ok((space, record))
    }

    pub(crate) fn import_export(&self) -> Result<Vec<SpaceImportRecord>, SpaceError> {
        let connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        let mut statement = connection.prepare(
            "SELECT source_kind,source_key,source_digest,space_id,status,error,imported_at,raw_json
             FROM space_imports WHERE library_id=?1
             ORDER BY imported_at DESC,source_kind,source_key,source_digest",
        )?;
        statement
            .query_map([&self.library_id], import_record_from_row)?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(decode_import_record)
            .collect()
    }

    pub(crate) fn legacy_canvases(&self) -> Result<Vec<Value>, SpaceError> {
        let connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        let mut statement = connection.prepare(
            "SELECT id,schema_version,name,revision,origin,panes_json,arrangements_json,
                    created_at,updated_at,deleted_at
             FROM spaces WHERE library_id=?1 AND origin='canvas'
             ORDER BY updated_at DESC,id",
        )?;
        statement
            .query_map([&self.library_id], stored_space_from_row)?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(decode_space)
            .map(|space| space.map(|space| space_to_legacy_canvas(&space)))
            .collect()
    }

    pub(crate) fn sync_legacy_canvases(&self, raw: &Value) -> Result<Vec<Value>, SpaceError> {
        self.import_canvases(raw)?;
        self.legacy_canvases()
    }

    pub(crate) fn reconcile_move(&self, old_path: &str, new_path: &str) -> Result<(), SpaceError> {
        self.reconcile_paths("resourceMove", |space| {
            let mut changed = false;
            for pane in space.panes.values_mut() {
                changed |= move_paths_in_value(
                    &mut Value::Object(pane.state.clone()),
                    old_path,
                    new_path,
                    &mut pane.state,
                );
            }
            changed
        })
    }

    pub(crate) fn reconcile_remove(&self, path: &str) -> Result<(), SpaceError> {
        self.reconcile_paths("resourceDelete", |space| {
            let affected = space
                .panes
                .iter()
                .filter(|(_, pane)| nested_path_matches(&Value::Object(pane.state.clone()), path))
                .map(|(id, pane)| (id.clone(), pane_has_stable_ref(pane)))
                .collect::<Vec<_>>();
            if affected.is_empty() {
                return false;
            }
            let mut changed = false;
            for (id, stable) in affected {
                if stable {
                    if let Some(pane) = space.panes.get_mut(&id) {
                        if !pane_is_missing(pane) {
                            mark_pane_missing(pane);
                            changed = true;
                        }
                    }
                } else {
                    space.panes.remove(&id);
                    prune_pane_from_arrangements(&mut space.arrangements, &id);
                    changed = true;
                }
            }
            changed
        })
    }

    fn reconcile_paths(
        &self,
        command_type: &str,
        mut mutate: impl FnMut(&mut Space) -> bool,
    ) -> Result<(), SpaceError> {
        let mut connection =
            state_db::connection(&self.database).map_err(|error| SpaceError::internal(error.1))?;
        if !table_exists(&connection, "spaces").map_err(SpaceError::internal)? {
            return Ok(());
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(SpaceError::from)?;
        let rows = {
            let mut statement = transaction.prepare(
                "SELECT id,schema_version,name,revision,origin,panes_json,arrangements_json,
                        created_at,updated_at,deleted_at
                 FROM spaces WHERE library_id=?1 AND deleted_at IS NULL",
            )?;
            statement
                .query_map([&self.library_id], stored_space_from_row)?
                .collect::<Result<Vec<_>, _>>()?
        };
        for row in rows {
            let mut space = decode_space(row)?;
            if !mutate(&mut space) {
                continue;
            }
            validate_arrangements(&space.arrangements, &space.panes)?;
            space.revision += 1;
            space.updated_at = now_ms();
            update_head(&transaction, &self.library_id, &space)?;
            append_revision(&transaction, &self.library_id, &space, command_type)?;
            prune_history(
                &transaction,
                &self.library_id,
                &space.id,
                self.history_retention,
            )?;
        }
        transaction.commit()?;
        Ok(())
    }
}

fn require_expected(expected: Option<i64>, current: &Space) -> Result<(), SpaceError> {
    let expected = expected.ok_or_else(|| SpaceError::invalid("Expected revision is required"))?;
    if expected != current.revision {
        return Err(SpaceError::conflict(expected, current.clone()));
    }
    Ok(())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.encode_utf16().count() <= 128
        && !id
            .chars()
            .any(|character| character <= '\u{001f}' || character == '\u{007f}')
}

fn validate_id(id: &str) -> Result<(), SpaceError> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(SpaceError::invalid(
            "Space and Pane IDs must contain 1 to 128 UTF-16 code units and no control characters",
        ))
    }
}

fn validate_command_id(id: &str) -> Result<(), SpaceError> {
    if valid_id(id) {
        Ok(())
    } else {
        Err(SpaceError::invalid(
            "Space command ID must contain 1 to 128 UTF-16 code units and no control characters",
        ))
    }
}

pub(crate) fn validate_route_id(id: &str) -> Result<(), SpaceError> {
    validate_id(id)
}

fn validate_name(name: &str) -> Result<String, SpaceError> {
    let trimmed = name.trim();
    if trimmed.is_empty() || name.encode_utf16().count() > 120 {
        return Err(SpaceError::invalid(
            "Space name must contain 1 to 120 UTF-16 code units",
        ));
    }
    Ok(trimmed.to_string())
}

fn validate_import_source_key(source_key: &str) -> Result<(), SpaceError> {
    if !source_key.is_empty()
        && source_key.encode_utf16().count() <= 512
        && !source_key
            .chars()
            .any(|character| character <= '\u{001f}' || character == '\u{007f}')
    {
        return Ok(());
    }
    Err(SpaceError::invalid(
        "Workspace import source key must contain 1 to 512 UTF-16 code units and no control characters",
    ))
}

fn validate_pane(pane: &PaneContent) -> Result<(), SpaceError> {
    let serialized = serde_json::to_vec(pane)?;
    if serialized.len() > 256 * 1024 {
        return Err(SpaceError::invalid("Pane exceeds 256 KB"));
    }
    Ok(())
}

fn validate_panes(panes: &BTreeMap<String, PaneContent>) -> Result<(), SpaceError> {
    if panes.len() > 256 {
        return Err(SpaceError::invalid(
            "Space cannot contain more than 256 Panes",
        ));
    }
    for (id, pane) in panes {
        validate_id(id)?;
        validate_pane(pane)?;
    }
    Ok(())
}

fn validate_arrangements(
    arrangements: &SpaceArrangements,
    panes: &BTreeMap<String, PaneContent>,
) -> Result<(), SpaceError> {
    if let Some(spatial) = &arrangements.spatial {
        let object = spatial
            .as_object()
            .ok_or_else(|| SpaceError::invalid("Spatial arrangement must be an object"))?;
        let placements = object
            .get("placements")
            .and_then(Value::as_object)
            .ok_or_else(|| SpaceError::invalid("Spatial arrangement requires placements"))?;
        for (pane_id, placement) in placements {
            if !panes.contains_key(pane_id) {
                return Err(SpaceError::invalid(format!(
                    "Spatial arrangement references unknown Pane {pane_id}"
                )));
            }
            let bounds = placement
                .get("bounds")
                .and_then(Value::as_object)
                .ok_or_else(|| SpaceError::invalid("Spatial placement requires bounds"))?;
            for key in ["x", "y", "width", "height"] {
                if !bounds
                    .get(key)
                    .and_then(Value::as_f64)
                    .is_some_and(f64::is_finite)
                {
                    return Err(SpaceError::invalid("Spatial bounds must be finite"));
                }
            }
            if bounds["width"].as_f64().unwrap_or_default() <= 0.0
                || bounds["height"].as_f64().unwrap_or_default() <= 0.0
            {
                return Err(SpaceError::invalid(
                    "Spatial bounds must have positive size",
                ));
            }
            if !placement
                .get("zIndex")
                .and_then(Value::as_i64)
                .is_some_and(|value| value >= 0)
            {
                return Err(SpaceError::invalid(
                    "Spatial placement requires non-negative zIndex",
                ));
            }
        }
    }
    if let Some(tiled) = &arrangements.tiled {
        let object = tiled
            .as_object()
            .ok_or_else(|| SpaceError::invalid("Tiled arrangement must be an object"))?;
        if let Some(placements) = object.get("placements") {
            let placements = placements
                .as_object()
                .ok_or_else(|| SpaceError::invalid("Tiled placements must be an object"))?;
            for pane_id in placements.keys() {
                if !panes.contains_key(pane_id) {
                    return Err(SpaceError::invalid(format!(
                        "Tiled arrangement references unknown Pane {pane_id}"
                    )));
                }
            }
        }
        if let Some(groups) = object.get("tabGroups") {
            let groups = groups
                .as_object()
                .ok_or_else(|| SpaceError::invalid("Tab groups must be an object"))?;
            for members in groups.values() {
                let members = members
                    .as_array()
                    .ok_or_else(|| SpaceError::invalid("Tab group members must be an array"))?;
                for pane_id in members {
                    let pane_id = pane_id
                        .as_str()
                        .ok_or_else(|| SpaceError::invalid("Tab group member must be a Pane ID"))?;
                    if !panes.contains_key(pane_id) {
                        return Err(SpaceError::invalid(format!(
                            "Tab group references unknown Pane {pane_id}"
                        )));
                    }
                }
            }
        }
        if let Some(splits) = object.get("splits") {
            let splits = splits
                .as_object()
                .ok_or_else(|| SpaceError::invalid("Splits must be an object"))?;
            for split in splits.values() {
                let pane_id = split
                    .get("leftPaneId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| SpaceError::invalid("Split requires leftPaneId"))?;
                if !panes.contains_key(pane_id) {
                    return Err(SpaceError::invalid(format!(
                        "Split references unknown Pane {pane_id}"
                    )));
                }
            }
        }
        for key in ["paneIds", "paneOrder"] {
            if let Some(ids) = object.get(key) {
                let ids = ids
                    .as_array()
                    .ok_or_else(|| SpaceError::invalid(format!("{key} must be an array")))?;
                let mut seen = HashSet::new();
                for pane_id in ids {
                    let pane_id = pane_id.as_str().ok_or_else(|| {
                        SpaceError::invalid(format!("{key} must contain Pane IDs"))
                    })?;
                    if !panes.contains_key(pane_id) {
                        return Err(SpaceError::invalid(format!(
                            "Tiled arrangement references unknown Pane {pane_id}"
                        )));
                    }
                    if !seen.insert(pane_id) {
                        return Err(SpaceError::invalid(format!(
                            "{key} cannot contain duplicate Pane IDs"
                        )));
                    }
                }
            }
        }
        if let Some(pane_id) = object.get("paneId") {
            let pane_id = pane_id
                .as_str()
                .ok_or_else(|| SpaceError::invalid("paneId must be a Pane ID"))?;
            if !panes.contains_key(pane_id) {
                return Err(SpaceError::invalid(format!(
                    "Tiled arrangement references unknown Pane {pane_id}"
                )));
            }
        }
    }
    Ok(())
}

fn prune_pane_from_arrangements(arrangements: &mut SpaceArrangements, pane_id: &str) {
    for arrangement in [&mut arrangements.spatial, &mut arrangements.tiled]
        .into_iter()
        .flatten()
    {
        if let Some(placements) = arrangement
            .get_mut("placements")
            .and_then(Value::as_object_mut)
        {
            placements.remove(pane_id);
        }
    }
    if let Some(tiled) = arrangements.tiled.as_mut().and_then(Value::as_object_mut) {
        if let Some(groups) = tiled.get_mut("tabGroups").and_then(Value::as_object_mut) {
            groups.retain(|_, members| {
                if let Some(members) = members.as_array_mut() {
                    members.retain(|member| member.as_str() != Some(pane_id));
                    !members.is_empty()
                } else {
                    true
                }
            });
        }
        if let Some(splits) = tiled.get_mut("splits").and_then(Value::as_object_mut) {
            splits.retain(|_, split| {
                split.get("leftPaneId").and_then(Value::as_str) != Some(pane_id)
            });
        }
        for key in ["paneIds", "paneOrder"] {
            if let Some(ids) = tiled.get_mut(key).and_then(Value::as_array_mut) {
                ids.retain(|id| id.as_str() != Some(pane_id));
            }
        }
        if tiled.get("paneId").and_then(Value::as_str) == Some(pane_id) {
            tiled.remove("paneId");
        }
    }
}

fn stored_space_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredSpace> {
    Ok(StoredSpace {
        id: row.get(0)?,
        schema_version: row.get(1)?,
        name: row.get(2)?,
        revision: row.get(3)?,
        origin: row.get(4)?,
        panes_json: row.get(5)?,
        arrangements_json: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
    })
}

fn decode_space(row: StoredSpace) -> Result<Space, SpaceError> {
    let origin = match row.origin.as_str() {
        "canvas" => SpaceOrigin::Canvas,
        "workspace" => SpaceOrigin::Workspace,
        _ => return Err(SpaceError::internal("Stored Space has invalid origin")),
    };
    Ok(Space {
        schema_version: row.schema_version,
        id: row.id,
        name: row.name,
        revision: row.revision,
        origin,
        panes: serde_json::from_str(&row.panes_json)?,
        arrangements: serde_json::from_str(&row.arrangements_json)?,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
    })
}

fn load_in(
    connection: &Connection,
    library_id: &str,
    id: &str,
) -> Result<Option<Space>, SpaceError> {
    connection
        .query_row(
            "SELECT id,schema_version,name,revision,origin,panes_json,arrangements_json,
                    created_at,updated_at,deleted_at
             FROM spaces WHERE library_id=?1 AND id=?2",
            params![library_id, id],
            stored_space_from_row,
        )
        .optional()?
        .map(decode_space)
        .transpose()
}

fn command_receipt_in(
    transaction: &Transaction<'_>,
    library_id: &str,
    command_id: &str,
) -> Result<Option<(String, String)>, SpaceError> {
    transaction
        .query_row(
            "SELECT request_digest,result_space_id FROM space_command_receipts
             WHERE library_id=?1 AND command_id=?2",
            params![library_id, command_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(SpaceError::from)
}

fn insert_command_receipt(
    transaction: &Transaction<'_>,
    library_id: &str,
    command_id: &str,
    request_digest: &str,
    result_space_id: &str,
) -> Result<(), SpaceError> {
    transaction.execute(
        "INSERT INTO space_command_receipts(
           library_id,command_id,request_digest,result_space_id
         ) VALUES(?1,?2,?3,?4)",
        params![library_id, command_id, request_digest, result_space_id],
    )?;
    Ok(())
}

fn revision_in(
    connection: &Connection,
    library_id: &str,
    id: &str,
    revision: i64,
) -> Result<Space, SpaceError> {
    let head = load_in(connection, library_id, id)?
        .ok_or_else(|| SpaceError::not_found("Space not found"))?;
    let raw: Option<String> = connection
        .query_row(
            "SELECT snapshot_json FROM space_revisions
             WHERE library_id=?1 AND space_id=?2 AND revision=?3",
            params![library_id, id, revision],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(raw) = raw {
        return serde_json::from_str(&raw).map_err(SpaceError::from);
    }
    let oldest: Option<i64> = connection
        .query_row(
            "SELECT MIN(revision) FROM space_revisions WHERE library_id=?1 AND space_id=?2",
            params![library_id, id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if revision > 0 && revision <= head.revision && oldest.is_some_and(|oldest| revision < oldest) {
        Err(SpaceError::history_expired(oldest.unwrap()))
    } else {
        Err(SpaceError::not_found("Space revision not found"))
    }
}

fn origin_str(origin: SpaceOrigin) -> &'static str {
    match origin {
        SpaceOrigin::Canvas => "canvas",
        SpaceOrigin::Workspace => "workspace",
    }
}

fn insert_head(
    transaction: &Transaction<'_>,
    library_id: &str,
    space: &Space,
) -> Result<(), SpaceError> {
    transaction.execute(
        "INSERT INTO spaces(
           library_id,id,schema_version,name,revision,origin,panes_json,arrangements_json,
           created_at,updated_at,deleted_at
         ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            library_id,
            space.id,
            space.schema_version,
            space.name,
            space.revision,
            origin_str(space.origin),
            serde_json::to_string(&space.panes)?,
            serde_json::to_string(&space.arrangements)?,
            space.created_at,
            space.updated_at,
            space.deleted_at,
        ],
    )?;
    Ok(())
}

fn update_head(
    transaction: &Transaction<'_>,
    library_id: &str,
    space: &Space,
) -> Result<(), SpaceError> {
    let changed = transaction.execute(
        "UPDATE spaces SET schema_version=?3,name=?4,revision=?5,origin=?6,
           panes_json=?7,arrangements_json=?8,created_at=?9,updated_at=?10,deleted_at=?11
         WHERE library_id=?1 AND id=?2",
        params![
            library_id,
            space.id,
            space.schema_version,
            space.name,
            space.revision,
            origin_str(space.origin),
            serde_json::to_string(&space.panes)?,
            serde_json::to_string(&space.arrangements)?,
            space.created_at,
            space.updated_at,
            space.deleted_at,
        ],
    )?;
    if changed != 1 {
        return Err(SpaceError::internal("Space head update was not applied"));
    }
    Ok(())
}

fn append_revision(
    transaction: &Transaction<'_>,
    library_id: &str,
    space: &Space,
    command_type: &str,
) -> Result<(), SpaceError> {
    transaction.execute(
        "INSERT INTO space_revisions(
           library_id,space_id,revision,snapshot_json,command_type,created_at
         ) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            library_id,
            space.id,
            space.revision,
            serde_json::to_string(space)?,
            command_type,
            space.updated_at,
        ],
    )?;
    Ok(())
}

fn prune_history(
    transaction: &Transaction<'_>,
    library_id: &str,
    id: &str,
    retention: i64,
) -> Result<(), SpaceError> {
    transaction.execute(
        "DELETE FROM space_revisions
         WHERE library_id=?1 AND space_id=?2 AND revision NOT IN (
           SELECT revision FROM space_revisions
           WHERE library_id=?1 AND space_id=?2
           ORDER BY revision DESC LIMIT ?3
         )",
        params![library_id, id, retention],
    )?;
    Ok(())
}

fn json_digest(value: &Value) -> Result<String, SpaceError> {
    let bytes = serde_json::to_vec(value)?;
    let digest = Sha256::digest(bytes);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn command_request_digest(
    space_id: Option<&str>,
    command: &SpaceCommand,
) -> Result<String, SpaceError> {
    json_digest(&json!({"spaceId":space_id,"command":command}))
}

fn path_has_dot_dot(path: &str) -> bool {
    path.split(['/', '\\']).any(|segment| segment == "..")
}

fn canvas_to_space(record: &Value) -> Result<Space, SpaceError> {
    let object = record
        .as_object()
        .ok_or_else(|| SpaceError::invalid("Canvas record must be an object"))?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| SpaceError::invalid("Canvas ID is required"))?;
    validate_id(id)?;
    let writer_id = object
        .get("writerId")
        .and_then(Value::as_str)
        .filter(|value| valid_id(value))
        .ok_or_else(|| SpaceError::invalid("Canvas writer ID is invalid"))?;
    let _ = writer_id;
    let name = validate_name(
        object
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| SpaceError::invalid("Canvas name is required"))?,
    )?;
    let updated_at = object
        .get("updatedAt")
        .and_then(Value::as_u64)
        .and_then(|value| i64::try_from(value).ok())
        .ok_or_else(|| SpaceError::invalid("Canvas updatedAt is invalid"))?;
    let deleted = object
        .get("deleted")
        .and_then(Value::as_bool)
        .ok_or_else(|| SpaceError::invalid("Canvas deleted flag is required"))?;
    let mut panes = BTreeMap::new();
    let mut placements = Map::new();
    if !deleted {
        let state = object
            .get("state")
            .and_then(Value::as_object)
            .ok_or_else(|| SpaceError::invalid("Live Canvas state is required"))?;
        if state.get("version").and_then(Value::as_u64) != Some(1)
            || !state.get("camera").is_some_and(Value::is_object)
        {
            return Err(SpaceError::invalid("Canvas state schema is invalid"));
        }
        let windows = state
            .get("windows")
            .and_then(Value::as_array)
            .ok_or_else(|| SpaceError::invalid("Canvas windows are required"))?;
        let mut ids = HashSet::new();
        for window in windows {
            let window = window
                .as_object()
                .ok_or_else(|| SpaceError::invalid("Canvas window must be an object"))?;
            let pane_id = window
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| SpaceError::invalid("Canvas window ID is required"))?;
            validate_id(pane_id)?;
            if !ids.insert(pane_id.to_string()) {
                return Err(SpaceError::invalid("Canvas window IDs must be unique"));
            }
            let definition = window
                .get("definition")
                .and_then(Value::as_object)
                .ok_or_else(|| SpaceError::invalid("Canvas window definition is required"))?;
            if definition.get("id").and_then(Value::as_str) != Some(pane_id) {
                return Err(SpaceError::invalid("Canvas window identity changed"));
            }
            if definition
                .get("source")
                .and_then(|source| source.get("kind"))
                .and_then(Value::as_str)
                != Some("local")
            {
                return Err(SpaceError::invalid("Canvas window source must be local"));
            }
            let (kind, legacy_type) = match definition.get("type").and_then(Value::as_str) {
                Some("browser") => (PaneKind::Browser, "browser"),
                Some("viewer") => (PaneKind::Viewer, "viewer"),
                Some("hermes") => {
                    if definition
                        .get("hermes")
                        .and_then(|value| value.get("sessionId"))
                        .and_then(Value::as_str)
                        .is_none()
                    {
                        return Err(SpaceError::invalid(
                            "Canvas assistant Pane requires a session ID",
                        ));
                    }
                    (PaneKind::Assistant, "hermes")
                }
                _ => return Err(SpaceError::invalid("Canvas window type is invalid")),
            };
            let _ = legacy_type;
            if let Some(target) = definition.get("resourceTarget") {
                let reference = target
                    .get("ref")
                    .and_then(Value::as_object)
                    .ok_or_else(|| {
                        SpaceError::invalid("Canvas Resource target reference is invalid")
                    })?;
                if ["libraryId", "resourceId"].iter().any(|key| {
                    reference
                        .get(*key)
                        .and_then(Value::as_str)
                        .is_none_or(str::is_empty)
                }) || target
                    .get("legacyLocator")
                    .and_then(Value::as_str)
                    .is_none_or(path_has_dot_dot)
                {
                    return Err(SpaceError::invalid("Canvas Resource target is invalid"));
                }
            }
            let mut pane_state = definition.clone();
            for key in ["id", "type", "layout", "tabGroupId"] {
                pane_state.remove(key);
            }
            let bounds = window
                .get("bounds")
                .and_then(Value::as_object)
                .ok_or_else(|| SpaceError::invalid("Canvas window bounds are required"))?;
            for key in ["x", "y", "width", "height"] {
                if !bounds
                    .get(key)
                    .and_then(Value::as_f64)
                    .is_some_and(f64::is_finite)
                {
                    return Err(SpaceError::invalid("Canvas window bounds are invalid"));
                }
            }
            if bounds["width"].as_f64().unwrap_or_default() <= 0.0
                || bounds["height"].as_f64().unwrap_or_default() <= 0.0
            {
                return Err(SpaceError::invalid("Canvas window size must be positive"));
            }
            let z_index = window
                .get("zIndex")
                .and_then(Value::as_i64)
                .filter(|value| *value >= 0)
                .ok_or_else(|| SpaceError::invalid("Canvas zIndex is invalid"))?;
            panes.insert(
                pane_id.to_string(),
                PaneContent {
                    kind,
                    state: pane_state,
                },
            );
            placements.insert(
                pane_id.to_string(),
                json!({"bounds":Value::Object(bounds.clone()),"zIndex":z_index}),
            );
        }
    }
    let arrangements = SpaceArrangements {
        tiled: None,
        spatial: Some(json!({"placements":placements})),
    };
    validate_panes(&panes)?;
    validate_arrangements(&arrangements, &panes)?;
    Ok(Space {
        schema_version: SPACE_SCHEMA_VERSION,
        id: id.to_string(),
        name,
        revision: 1,
        origin: SpaceOrigin::Canvas,
        panes,
        arrangements,
        created_at: updated_at,
        updated_at,
        deleted_at: deleted.then_some(updated_at),
    })
}

fn legacy_record_is_newer(candidate: &Value, current: &Value) -> bool {
    let candidate_time = candidate
        .get("updatedAt")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    let current_time = current
        .get("updatedAt")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    candidate_time > current_time
        || (candidate_time == current_time
            && candidate
                .get("writerId")
                .and_then(Value::as_str)
                .unwrap_or_default()
                > current
                    .get("writerId")
                    .and_then(Value::as_str)
                    .unwrap_or_default())
}

fn canvas_durable_content_eq(candidate: &Space, current: &Space) -> bool {
    candidate.id == current.id
        && candidate.name == current.name
        && candidate.origin == current.origin
        && candidate.panes == current.panes
        && candidate.arrangements == current.arrangements
        && candidate.deleted_at.is_some() == current.deleted_at.is_some()
}

fn insert_import_record(
    transaction: &Transaction<'_>,
    library_id: &str,
    record: &SpaceImportRecord,
    space: Option<&Space>,
) -> Result<(), SpaceError> {
    transaction.execute(
        "INSERT INTO space_imports(
           library_id,source_kind,source_key,source_digest,space_id,space_revision,
           status,raw_json,error,imported_at
         ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            library_id,
            record.source_kind,
            record.source_key,
            record.source_digest,
            record.space_id,
            space.map(|space| space.revision),
            record.status,
            serde_json::to_string(&record.raw)?,
            record.error,
            record.imported_at,
        ],
    )?;
    Ok(())
}

type RawImportRow = (
    String,
    String,
    String,
    Option<String>,
    String,
    Option<String>,
    i64,
    String,
);

fn import_record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawImportRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
    ))
}

fn decode_import_record(row: RawImportRow) -> Result<SpaceImportRecord, SpaceError> {
    Ok(SpaceImportRecord {
        source_kind: row.0,
        source_key: row.1,
        source_digest: row.2,
        space_id: row.3,
        status: row.4,
        error: row.5,
        imported_at: row.6,
        raw: serde_json::from_str(&row.7)?,
    })
}

fn import_record_in(
    connection: &Connection,
    library_id: &str,
    source_kind: &str,
    source_key: &str,
    digest: &str,
) -> Result<Option<SpaceImportRecord>, SpaceError> {
    connection
        .query_row(
            "SELECT source_kind,source_key,source_digest,space_id,status,error,imported_at,raw_json
             FROM space_imports
             WHERE library_id=?1 AND source_kind=?2 AND source_key=?3 AND source_digest=?4",
            params![library_id, source_kind, source_key, digest],
            import_record_from_row,
        )
        .optional()?
        .map(decode_import_record)
        .transpose()
}

fn latest_import_in(
    connection: &Connection,
    library_id: &str,
    source_kind: &str,
    source_key: &str,
) -> Result<Option<(SpaceImportRecord, Value, i64)>, SpaceError> {
    let row: Option<(RawImportRow, i64)> = connection
        .query_row(
            "SELECT source_kind,source_key,source_digest,space_id,status,error,imported_at,
                    raw_json,COALESCE(space_revision,0)
             FROM space_imports
             WHERE library_id=?1 AND source_kind=?2 AND source_key=?3 AND space_id IS NOT NULL
             ORDER BY imported_at DESC,rowid DESC LIMIT 1",
            params![library_id, source_kind, source_key],
            |row| Ok((import_record_from_row(row)?, row.get::<_, i64>(8)?)),
        )
        .optional()?;
    row.map(|(row, revision)| {
        let record = decode_import_record(row)?;
        Ok((record.clone(), record.raw.clone(), revision))
    })
    .transpose()
}

fn space_to_legacy_canvas(space: &Space) -> Value {
    if space.deleted_at.is_some() {
        return json!({
            "id":space.id,
            "name":space.name,
            "updatedAt":space.updated_at.max(0) as u64,
            "writerId":"space-engine",
            "deleted":true,
            "state":Value::Null,
        });
    }
    let placements = space
        .arrangements
        .spatial
        .as_ref()
        .and_then(|value| value.get("placements"))
        .and_then(Value::as_object);
    let windows = space
        .panes
        .iter()
        .map(|(id, pane)| {
            let mut definition = pane.state.clone();
            definition.insert("id".into(), Value::String(id.clone()));
            definition.insert(
                "type".into(),
                Value::String(
                    match pane.kind {
                        PaneKind::Browser => "browser",
                        PaneKind::Viewer => "viewer",
                        PaneKind::Assistant => "hermes",
                    }
                    .into(),
                ),
            );
            definition.insert("tabGroupId".into(), Value::Null);
            let placement = placements.and_then(|placements| placements.get(id));
            json!({
                "id":id,
                "definition":definition,
                "bounds":placement.and_then(|value|value.get("bounds")).cloned()
                    .unwrap_or_else(||json!({"x":0,"y":0,"width":640,"height":480})),
                "zIndex":placement.and_then(|value|value.get("zIndex")).and_then(Value::as_i64)
                    .unwrap_or(1),
            })
        })
        .collect::<Vec<_>>();
    let next_item_id = space
        .panes
        .keys()
        .filter_map(|id| id.strip_prefix("canvas-window-")?.parse::<u64>().ok())
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    let next_z_index = windows
        .iter()
        .filter_map(|window| window.get("zIndex").and_then(Value::as_i64))
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    json!({
        "id":space.id,
        "name":space.name,
        "updatedAt":space.updated_at.max(0) as u64,
        "writerId":"space-engine",
        "deleted":false,
        "state":{
            "version":1,
            "windows":windows,
            "maximizedWindowId":Value::Null,
            "camera":{"x":0,"y":0,"zoom":1},
            "windowSizeByType":{},
            "nextItemId":next_item_id,
            "nextZIndex":next_z_index,
        }
    })
}

const SPACE_PATH_FIELDS: &[&str] = &[
    "path",
    "iconPath",
    "dir",
    "viewing",
    "legacyLocator",
    "sharePath",
    "rootPath",
];

fn logical_path_eq(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn matching_suffix<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    if logical_path_eq(path, prefix) {
        return Some("");
    }
    let split = prefix.len();
    (path.as_bytes().get(split) == Some(&b'/') && logical_path_eq(path.get(..split)?, prefix))
        .then(|| &path[split..])
}

fn rewrite_paths(value: &mut Value, old_path: &str, new_path: &str) -> bool {
    let mut changed = false;
    match value {
        Value::Array(items) => {
            for item in items {
                changed |= rewrite_paths(item, old_path, new_path);
            }
        }
        Value::Object(object) => {
            for (key, child) in object {
                if SPACE_PATH_FIELDS.contains(&key.as_str())
                    && let Some(path) = child.as_str()
                    && let Some(suffix) = matching_suffix(path, old_path)
                {
                    *child = Value::String(format!("{new_path}{suffix}"));
                    changed = true;
                } else {
                    changed |= rewrite_paths(child, old_path, new_path);
                }
            }
        }
        _ => {}
    }
    changed
}

fn move_paths_in_value(
    value: &mut Value,
    old_path: &str,
    new_path: &str,
    destination: &mut Map<String, Value>,
) -> bool {
    let changed = rewrite_paths(value, old_path, new_path);
    if changed && let Some(object) = value.as_object() {
        *destination = object.clone();
    }
    changed
}

fn nested_path_matches(value: &Value, path: &str) -> bool {
    match value {
        Value::Array(items) => items.iter().any(|item| nested_path_matches(item, path)),
        Value::Object(object) => object.iter().any(|(key, child)| {
            (SPACE_PATH_FIELDS.contains(&key.as_str())
                && child
                    .as_str()
                    .is_some_and(|candidate| matching_suffix(candidate, path).is_some()))
                || nested_path_matches(child, path)
        }),
        _ => false,
    }
}

fn pane_has_stable_ref(pane: &PaneContent) -> bool {
    pane.state
        .get("resourceTarget")
        .and_then(|target| target.get("ref"))
        .is_some_and(|reference| {
            ["libraryId", "resourceId"].iter().all(|key| {
                reference
                    .get(*key)
                    .and_then(Value::as_str)
                    .is_some_and(|value| !value.is_empty())
            })
        })
}

fn mark_pane_missing(pane: &mut PaneContent) {
    if let Some(target) = pane
        .state
        .get_mut("resourceTarget")
        .and_then(Value::as_object_mut)
    {
        target.insert("availability".into(), Value::String("missing".into()));
    }
}

fn pane_is_missing(pane: &PaneContent) -> bool {
    pane.state
        .get("resourceTarget")
        .and_then(|target| target.get("availability"))
        .and_then(Value::as_str)
        == Some("missing")
}

pub(crate) fn reconcile_move(
    config: &Config,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    SpaceEngine {
        database: state_db::database(config),
        library_id: config.library_key.clone(),
        history_retention: HISTORY_RETENTION,
    }
    .reconcile_move(old_path, new_path)
    .map_err(|error| error.message)
}

pub(crate) fn reconcile_remove(config: &Config, path: &str) -> Result<(), String> {
    SpaceEngine {
        database: state_db::database(config),
        library_id: config.library_key.clone(),
        history_retention: HISTORY_RETENTION,
    }
    .reconcile_remove(path)
    .map_err(|error| error.message)
}
