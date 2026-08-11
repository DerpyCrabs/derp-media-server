use crate::{
    config::Config,
    error::{AppError, AppResult},
    shares::{GrantId, Share},
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const LEGACY_FILES: [&str; 5] = [
    "settings.json",
    "stats.json",
    "shares.json",
    "mounts.json",
    "canvases.json",
];
const GRANT_SCHEMA_VERSION: i64 = 4;
const GRANT_SCHEMA_BACKUP: &str = "app-before-grants-v4.sqlite3";

pub fn database(config: &Config) -> PathBuf {
    config.data_path.join("app.sqlite3")
}

fn error(error: impl std::fmt::Display) -> AppError {
    AppError::internal(error.to_string())
}

fn table_exists(connection: &Connection, table: &str) -> AppResult<bool> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            [table],
            |row| row.get(0),
        )
        .map_err(error)
}

fn column_exists(connection: &Connection, table: &str, column: &str) -> AppResult<bool> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(error)?;
    let mut rows = statement.query([]).map_err(error)?;
    while let Some(row) = rows.next().map_err(error)? {
        if row.get::<_, String>(1).map_err(error)? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn namespace_keys(connection: &Connection, key: &str) -> AppResult<Vec<String>> {
    if !table_exists(connection, "legacy_library_keys")? {
        return Ok(vec![key.to_string()]);
    }
    let library_id: Option<String> = connection
        .query_row(
            "SELECT id FROM libraries WHERE id=?1
             UNION
             SELECT library_id FROM legacy_library_keys WHERE legacy_key=?1
             LIMIT 1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    let Some(library_id) = library_id else {
        return Ok(vec![key.to_string()]);
    };
    let mut keys = vec![library_id.clone()];
    let mut statement = connection
        .prepare(
            "SELECT legacy_key FROM legacy_library_keys
             WHERE library_id=?1 ORDER BY first_seen_at,legacy_key",
        )
        .map_err(error)?;
    for row in statement
        .query_map([library_id], |row| row.get::<_, String>(0))
        .map_err(error)?
    {
        let key = row.map_err(error)?;
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    Ok(keys)
}

fn namespace_revision(connection: &Connection, kind: &str, key: &str) -> AppResult<i64> {
    if !table_exists(connection, "legacy_namespace_revisions")? {
        return Ok(0);
    }
    connection
        .query_row(
            "SELECT revision FROM legacy_namespace_revisions
             WHERE object_kind=?1 AND legacy_key=?2",
            params![kind, key],
            |row| row.get(0),
        )
        .optional()
        .map(|value| value.unwrap_or(0))
        .map_err(error)
}

pub fn connection(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppError::io)?;
    }
    let connection = Connection::open(path).map_err(error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(error)?;
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(error)?;
    Ok(connection)
}

pub fn initialize(config: &Config) -> Result<(), String> {
    let path = database(config);
    let mut connection = connection(&path).map_err(|error| error.1)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               applied_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
    let version: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if version < 1 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS state_documents (
                   kind TEXT NOT NULL,
                   library_key TEXT NOT NULL,
                   value_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL,
                   PRIMARY KEY(kind, library_key)
                 );
                 CREATE TABLE IF NOT EXISTS shares (
                   library_key TEXT NOT NULL,
                   grant_id TEXT,
                   token TEXT NOT NULL,
                   path TEXT NOT NULL,
                   is_directory INTEGER NOT NULL,
                   editable INTEGER NOT NULL,
                   passcode TEXT,
                   created_at INTEGER NOT NULL,
                   root_id TEXT,
                   source_id TEXT,
                   root_relative_path TEXT,
                   restrictions_json TEXT,
                   used_bytes INTEGER,
                   workspace_taskbar_pins_json TEXT,
                   workspace_layout_presets_json TEXT,
                   PRIMARY KEY(library_key, token)
                 );
                 CREATE TABLE IF NOT EXISTS mounts (
                   id TEXT PRIMARY KEY,
                   name TEXT NOT NULL,
                   path TEXT NOT NULL,
                   created_at INTEGER
                 );
                 CREATE TABLE IF NOT EXISTS legacy_state_import (
                   version INTEGER PRIMARY KEY,
                   imported_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS reader_state (
                   scope TEXT NOT NULL,
                   path TEXT NOT NULL,
                   state_json TEXT NOT NULL,
                   fingerprint TEXT NOT NULL,
                   revision INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL,
                   PRIMARY KEY(scope, path)
                 );
                 CREATE TABLE IF NOT EXISTS app_preferences (
                   scope TEXT PRIMARY KEY,
                   state_json TEXT NOT NULL,
                   revision INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );",
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?1)",
                [now_ms()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    if !column_exists(&connection, "shares", "source_id").map_err(|error| error.1)? {
        connection
            .execute("ALTER TABLE shares ADD COLUMN source_id TEXT", [])
            .map_err(|error| error.to_string())?;
    }
    import_legacy(config, &mut connection)?;
    Ok(())
}

fn backup_before_grant_schema(config: &Config, connection: &Connection) -> Result<(), String> {
    let directory = config.data_path.join("schema-backups");
    let backup = directory.join(GRANT_SCHEMA_BACKUP);
    if backup.exists() {
        return Ok(());
    }
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create Grant schema backup directory {}: {error}",
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

pub(crate) fn initialize_grants(config: &Config) -> Result<(), String> {
    let database = database(config);
    let mut connection = connection(&database).map_err(|error| error.1)?;
    let applied = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=?1)",
            [GRANT_SCHEMA_VERSION],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if applied {
        if !column_exists(&connection, "shares", "grant_id").map_err(|error| error.1)? {
            return Err(
                "Grant persistence recovery required: schema version exists without grant_id"
                    .into(),
            );
        }
        let missing: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM shares WHERE grant_id IS NULL OR grant_id=''",
                [],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if missing != 0 {
            return Err(
                "Grant persistence recovery required: stored Grant lacks internal ID".into(),
            );
        }
        return Ok(());
    }

    backup_before_grant_schema(config, &connection)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    if !column_exists(&transaction, "shares", "grant_id").map_err(|error| error.1)? {
        transaction
            .execute("ALTER TABLE shares ADD COLUMN grant_id TEXT", [])
            .map_err(|error| error.to_string())?;
    }

    let stored = {
        let mut statement = transaction
            .prepare("SELECT token,grant_id FROM shares ORDER BY token,library_key")
            .map_err(|error| error.to_string())?;
        statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };
    let mut ids = HashMap::<String, GrantId>::new();
    for (token, stored_id) in &stored {
        let Some(stored_id) = stored_id.as_ref().filter(|value| !value.is_empty()) else {
            continue;
        };
        let stored_id = GrantId::from_stored(stored_id);
        if let Some(existing) = ids.get(token)
            && existing != &stored_id
        {
            return Err(format!(
                "Grant persistence recovery required: token {token} has multiple internal IDs"
            ));
        }
        ids.insert(token.clone(), stored_id);
    }
    for (token, _) in stored {
        ids.entry(token).or_insert_with(GrantId::new);
    }
    for (token, grant_id) in ids {
        transaction
            .execute(
                "UPDATE shares SET grant_id=?1
                 WHERE token=?2 AND (grant_id IS NULL OR grant_id='')",
                params![grant_id.as_str(), token],
            )
            .map_err(|error| error.to_string())?;
    }
    let missing: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM shares WHERE grant_id IS NULL OR grant_id=''",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if missing != 0 {
        return Err("Grant persistence recovery required: internal ID backfill incomplete".into());
    }
    transaction
        .execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS shares_grant_id_per_library
               ON shares(library_key,grant_id);
             CREATE INDEX IF NOT EXISTS shares_token_lookup ON shares(token);",
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO schema_migrations(version,applied_at) VALUES(?1,?2)",
            params![GRANT_SCHEMA_VERSION, now_ms()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn read_legacy(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| format!("Invalid {}: {error}", path.display()))
}

fn object<'a>(path: &Path, value: &'a Value) -> Result<&'a serde_json::Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("Invalid {}: expected object", path.display()))
}

fn import_legacy(config: &Config, connection: &mut Connection) -> Result<(), String> {
    let imported = connection
        .query_row(
            "SELECT 1 FROM legacy_state_import WHERE version=1",
            [],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if imported {
        return Ok(());
    }

    let loaded = LEGACY_FILES
        .iter()
        .map(|name| {
            let path = config.data_path.join(name);
            read_legacy(&path).map(|value| (path, value))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    let populated: i64 = transaction
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM state_documents) +
               (SELECT COUNT(*) FROM shares) +
               (SELECT COUNT(*) FROM mounts)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if populated != 0 {
        return Err("Cannot import legacy JSON: SQLite state tables are not empty".into());
    }

    for (path, value) in &loaded {
        let Some(value) = value else { continue };
        match path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
        {
            "settings.json" => import_documents(&transaction, path, "settings", value)?,
            "stats.json" => import_documents(&transaction, path, "stats", value)?,
            "canvases.json" => import_documents(&transaction, path, "canvases", value)?,
            "shares.json" => import_shares(&transaction, path, value)?,
            "mounts.json" => import_mounts(&transaction, path, value)?,
            _ => {}
        }
    }
    transaction
        .execute(
            "INSERT INTO legacy_state_import(version, imported_at) VALUES(1, ?1)",
            [now_ms()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    archive_legacy(&config.data_path, &loaded);
    Ok(())
}

fn import_documents(
    transaction: &Transaction<'_>,
    path: &Path,
    kind: &str,
    value: &Value,
) -> Result<(), String> {
    for (library_key, document) in object(path, value)? {
        validate_document(path, kind, library_key, document)?;
        let serialized = serde_json::to_string(document).map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
                 VALUES(?1, ?2, ?3, ?4)",
                params![kind, library_key, serialized, now_ms()],
            )
            .map_err(|error| {
                format!("Invalid {} section {library_key}: {error}", path.display())
            })?;
    }
    Ok(())
}

fn validate_document(
    path: &Path,
    kind: &str,
    library_key: &str,
    document: &Value,
) -> Result<(), String> {
    let invalid = || {
        format!(
            "Invalid {} section {library_key}: invalid {kind} structure",
            path.display()
        )
    };
    match kind {
        "canvases" if !document.is_array() => Err(invalid()),
        "settings" => {
            let value = document.as_object().ok_or_else(invalid)?;
            for key in ["viewModes", "customIcons", "autoSave"] {
                if value.get(key).is_some_and(|field| !field.is_object()) {
                    return Err(invalid());
                }
            }
            for key in [
                "favorites",
                "knowledgeBases",
                "workspaceTaskbarPins",
                "workspaceLayoutPresets",
            ] {
                if value.get(key).is_some_and(|field| !field.is_array()) {
                    return Err(invalid());
                }
            }
            Ok(())
        }
        "stats" => {
            let value = document.as_object().ok_or_else(invalid)?;
            if ["views", "shareViews"]
                .iter()
                .any(|key| value.get(*key).is_some_and(|field| !field.is_object()))
            {
                Err(invalid())
            } else {
                Ok(())
            }
        }
        _ => Ok(()),
    }
}

fn import_shares(transaction: &Transaction<'_>, path: &Path, value: &Value) -> Result<(), String> {
    let mut identities = HashSet::new();
    for (library_key, section) in object(path, value)? {
        let items = section
            .as_object()
            .and_then(|section| section.get("shares"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                format!(
                    "Invalid {} section {library_key}: expected shares array",
                    path.display()
                )
            })?;
        for (index, item) in items.iter().enumerate() {
            let share: Share = serde_json::from_value(item.clone()).map_err(|error| {
                format!(
                    "Invalid {} section {library_key} share {index}: {error}",
                    path.display()
                )
            })?;
            if share.token.is_empty() || share.path.is_empty() {
                return Err(format!(
                    "Invalid {} section {library_key} share {index}: token and path are required",
                    path.display()
                ));
            }
            if !identities.insert((library_key.clone(), share.token.clone())) {
                return Err(format!(
                    "Invalid {}: duplicate share token {} in {library_key}",
                    path.display(),
                    share.token
                ));
            }
            insert_share(transaction, library_key, &share).map_err(|error| error.1)?;
        }
    }
    Ok(())
}

fn import_mounts(transaction: &Transaction<'_>, path: &Path, value: &Value) -> Result<(), String> {
    let items = object(path, value)?
        .get("mounts")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("Invalid {}: expected mounts array", path.display()))?;
    let mut ids = HashSet::new();
    for (index, item) in items.iter().enumerate() {
        let id = item.get("id").and_then(Value::as_str).unwrap_or("");
        let name = item.get("name").and_then(Value::as_str).unwrap_or("");
        let mount_path = item.get("path").and_then(Value::as_str).unwrap_or("");
        if id.is_empty() || name.is_empty() || mount_path.is_empty() || !ids.insert(id) {
            return Err(format!(
                "Invalid {} mount {index}: unique id, name, and path are required",
                path.display()
            ));
        }
        let created_at = item
            .get("createdAt")
            .and_then(Value::as_u64)
            .map(|v| v as i64);
        transaction
            .execute(
                "INSERT INTO mounts(id, name, path, created_at) VALUES(?1, ?2, ?3, ?4)",
                params![id, name, mount_path, created_at],
            )
            .map_err(|error| format!("Invalid {} mount {index}: {error}", path.display()))?;
    }
    Ok(())
}

fn archive_legacy(data_path: &Path, loaded: &[(PathBuf, Option<Value>)]) {
    let existing = loaded
        .iter()
        .filter(|(_, value)| value.is_some())
        .collect::<Vec<_>>();
    if existing.is_empty() {
        return;
    }
    let backup = data_path
        .join("legacy-json-backup")
        .join(now_ms().to_string());
    if let Err(error) = fs::create_dir_all(&backup) {
        eprintln!("Warning: failed to create legacy JSON backup: {error}");
        return;
    }
    for (source, _) in existing {
        let destination = backup.join(source.file_name().unwrap_or_default());
        if let Err(error) = fs::rename(source, &destination) {
            eprintln!(
                "Warning: failed to archive {} to {}: {error}",
                source.display(),
                destination.display()
            );
        }
    }
}

pub fn document(
    database: &Path,
    kind: &str,
    library_key: &str,
    default: Value,
) -> AppResult<Value> {
    let connection = connection(database)?;
    let mut selected: Option<(i64, i64, String)> = None;
    for key in namespace_keys(&connection, library_key)? {
        let row: Option<(String, i64)> = connection
            .query_row(
                "SELECT value_json,updated_at FROM state_documents
                 WHERE kind=?1 AND library_key=?2",
                params![kind, key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(error)?;
        let Some((raw, updated_at)) = row else {
            continue;
        };
        let revision = namespace_revision(&connection, &format!("document:{kind}"), &key)?;
        if selected
            .as_ref()
            .is_none_or(|current| (revision, updated_at) > (current.0, current.1))
        {
            selected = Some((revision, updated_at, raw));
        }
    }
    selected
        .map(|(_, _, raw)| serde_json::from_str(&raw).map_err(error))
        .transpose()
        .map(|value| value.unwrap_or(default))
}

pub fn update_document<T>(
    database: &Path,
    kind: &str,
    library_key: &str,
    default: Value,
    update: impl FnOnce(&mut Value) -> AppResult<T>,
) -> AppResult<T> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let keys = namespace_keys(&transaction, library_key)?;
    let mut selected: Option<(i64, i64, String)> = None;
    for key in &keys {
        let row: Option<(String, i64)> = transaction
            .query_row(
                "SELECT value_json,updated_at FROM state_documents
                 WHERE kind=?1 AND library_key=?2",
                params![kind, key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(error)?;
        let Some((raw, updated_at)) = row else {
            continue;
        };
        let revision = namespace_revision(&transaction, &format!("document:{kind}"), key)?;
        if selected
            .as_ref()
            .is_none_or(|current| (revision, updated_at) > (current.0, current.1))
        {
            selected = Some((revision, updated_at, raw));
        }
    }
    let mut value = selected
        .map(|(_, _, raw)| serde_json::from_str(&raw).map_err(error))
        .transpose()?
        .unwrap_or(default);
    let result = update(&mut value)?;
    let serialized = serde_json::to_string(&value).map_err(error)?;
    let updated_at = now_ms();
    for key in keys {
        transaction
            .execute(
                "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(kind, library_key) DO UPDATE SET
                   value_json=excluded.value_json, updated_at=excluded.updated_at",
                params![kind, key, serialized, updated_at],
            )
            .map_err(error)?;
    }
    transaction.commit().map_err(error)?;
    Ok(result)
}

pub(crate) fn synchronize_library_namespaces(
    transaction: &Transaction<'_>,
    library_key: &str,
) -> AppResult<()> {
    let keys = namespace_keys(transaction, library_key)?;
    let mut kinds = Vec::new();
    let mut statement = transaction
        .prepare("SELECT DISTINCT kind FROM state_documents ORDER BY kind")
        .map_err(error)?;
    for row in statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(error)?
    {
        let kind = row.map_err(error)?;
        if keys.iter().any(|key| {
            transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM state_documents
                     WHERE kind=?1 AND library_key=?2)",
                    params![kind, key],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap_or(false)
        }) {
            kinds.push(kind);
        }
    }
    drop(statement);

    for kind in kinds {
        let mut selected: Option<(i64, i64, String)> = None;
        for key in &keys {
            let row: Option<(String, i64)> = transaction
                .query_row(
                    "SELECT value_json,updated_at FROM state_documents
                     WHERE kind=?1 AND library_key=?2",
                    params![kind, key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(error)?;
            let Some((raw, updated_at)) = row else {
                continue;
            };
            let revision = namespace_revision(transaction, &format!("document:{kind}"), key)?;
            if selected
                .as_ref()
                .is_none_or(|current| (revision, updated_at) > (current.0, current.1))
            {
                selected = Some((revision, updated_at, raw));
            }
        }
        if let Some((_, updated_at, raw)) = selected {
            for key in &keys {
                transaction
                    .execute(
                        "INSERT INTO state_documents(kind,library_key,value_json,updated_at)
                         VALUES(?1,?2,?3,?4)
                         ON CONFLICT(kind,library_key) DO UPDATE SET
                           value_json=excluded.value_json,updated_at=excluded.updated_at",
                        params![kind, key, raw, updated_at],
                    )
                    .map_err(error)?;
            }
        }
    }

    let mut selected: Option<(i64, bool, Vec<Share>)> = None;
    for key in &keys {
        let list = shares_in(transaction, key)?;
        let revision = namespace_revision(transaction, "shares", key)?;
        let score = (revision, !list.is_empty());
        if selected
            .as_ref()
            .is_none_or(|current| score > (current.0, current.1))
        {
            selected = Some((revision, !list.is_empty(), list));
        }
    }
    let mut shares = selected.map(|(_, _, list)| list).unwrap_or_default();
    for share in &mut shares {
        if share.grant_id.is_none() {
            share.grant_id = Some(GrantId::new());
        }
    }
    let selected_tokens = shares
        .iter()
        .map(|share| share.token.as_str())
        .collect::<HashSet<_>>();
    for key in &keys {
        for existing in shares_in(transaction, key)? {
            if selected_tokens.contains(existing.token.as_str()) {
                continue;
            }
            transaction
                .execute(
                    "DELETE FROM shares WHERE library_key=?1 AND token=?2",
                    params![key, existing.token],
                )
                .map_err(error)?;
        }
        for share in &shares {
            upsert_share(transaction, key, share)?;
        }
    }
    Ok(())
}

fn json_column(value: &Option<Value>) -> AppResult<Option<String>> {
    value
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(error))
        .transpose()
}

struct StoredShareRow {
    token: String,
    path: String,
    is_directory: bool,
    editable: bool,
    passcode: Option<String>,
    created_at: i64,
    root_id: Option<String>,
    source_id: Option<String>,
    root_relative_path: Option<String>,
    restrictions: Option<String>,
    used_bytes: Option<i64>,
    pins: Option<String>,
    presets: Option<String>,
    grant_id: Option<String>,
}

fn stored_share_row(
    row: &rusqlite::Row<'_>,
    has_grant_id: bool,
) -> rusqlite::Result<StoredShareRow> {
    Ok(StoredShareRow {
        token: row.get(0)?,
        path: row.get(1)?,
        is_directory: row.get(2)?,
        editable: row.get(3)?,
        passcode: row.get(4)?,
        created_at: row.get(5)?,
        root_id: row.get(6)?,
        source_id: row.get(7)?,
        root_relative_path: row.get(8)?,
        restrictions: row.get(9)?,
        used_bytes: row.get(10)?,
        pins: row.get(11)?,
        presets: row.get(12)?,
        grant_id: if has_grant_id { row.get(13)? } else { None },
    })
}

fn decode_share(row: StoredShareRow) -> AppResult<Share> {
    Ok(Share {
        grant_id: row.grant_id.map(GrantId::from_stored),
        token: row.token,
        path: row.path,
        is_directory: row.is_directory,
        editable: row.editable,
        passcode: row.passcode,
        created_at: row.created_at as u64,
        root_id: row.root_id,
        source_id: row.source_id,
        root_relative_path: row.root_relative_path,
        unavailable: None,
        restrictions: row
            .restrictions
            .map(|raw| serde_json::from_str(&raw).map_err(error))
            .transpose()?,
        used_bytes: row.used_bytes.map(|value| value as u64),
        workspace_taskbar_pins: row
            .pins
            .map(|raw| serde_json::from_str(&raw).map_err(error))
            .transpose()?,
        workspace_layout_presets: row
            .presets
            .map(|raw| serde_json::from_str(&raw).map_err(error))
            .transpose()?,
    })
}

fn insert_share(transaction: &Transaction<'_>, library_key: &str, share: &Share) -> AppResult<()> {
    let restrictions = share
        .restrictions
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(error))
        .transpose()?;
    let pins = json_column(&share.workspace_taskbar_pins)?;
    let presets = json_column(&share.workspace_layout_presets)?;
    if column_exists(transaction, "shares", "grant_id")? {
        let grant_id = share.grant_id.clone().unwrap_or_else(GrantId::new);
        transaction
            .execute(
                "INSERT INTO shares(
                   library_key, token, path, is_directory, editable, passcode, created_at,
                   root_id, source_id, root_relative_path, restrictions_json, used_bytes,
                   workspace_taskbar_pins_json, workspace_layout_presets_json, grant_id
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    library_key,
                    share.token,
                    share.path,
                    share.is_directory,
                    share.editable,
                    share.passcode,
                    share.created_at as i64,
                    share.root_id,
                    share.source_id,
                    share.root_relative_path,
                    restrictions,
                    share.used_bytes.map(|value| value as i64),
                    pins,
                    presets,
                    grant_id.as_str(),
                ],
            )
            .map_err(error)?;
    } else {
        transaction
            .execute(
                "INSERT INTO shares(
                   library_key, token, path, is_directory, editable, passcode, created_at,
                   root_id, source_id, root_relative_path, restrictions_json, used_bytes,
                   workspace_taskbar_pins_json, workspace_layout_presets_json
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    library_key,
                    share.token,
                    share.path,
                    share.is_directory,
                    share.editable,
                    share.passcode,
                    share.created_at as i64,
                    share.root_id,
                    share.source_id,
                    share.root_relative_path,
                    restrictions,
                    share.used_bytes.map(|value| value as i64),
                    pins,
                    presets,
                ],
            )
            .map_err(error)?;
    }
    Ok(())
}

fn shares_in(transaction: &Transaction<'_>, library_key: &str) -> AppResult<Vec<Share>> {
    let has_grant_id = column_exists(transaction, "shares", "grant_id")?;
    let grant_column = if has_grant_id { ",grant_id" } else { "" };
    let mut statement = transaction
        .prepare(&format!(
            "SELECT token,path,is_directory,editable,passcode,created_at,root_id,
                    source_id,root_relative_path,restrictions_json,used_bytes,
                    workspace_taskbar_pins_json,workspace_layout_presets_json{grant_column}
             FROM shares WHERE library_key=?1 ORDER BY created_at,token"
        ))
        .map_err(error)?;
    let rows = statement
        .query_map([library_key], |row| stored_share_row(row, has_grant_id))
        .map_err(error)?;
    rows.map(|row| decode_share(row.map_err(error)?)).collect()
}

pub fn shares(database: &Path, library_key: &str) -> AppResult<Vec<Share>> {
    let mut connection = connection(database)?;
    let transaction = connection.transaction().map_err(error)?;
    let keys = namespace_keys(&transaction, library_key)?;
    let mut selected: Option<(i64, bool, Vec<Share>)> = None;
    for key in keys {
        let list = shares_in(&transaction, &key)?;
        let revision = namespace_revision(&transaction, "shares", &key)?;
        let score = (revision, !list.is_empty());
        if selected
            .as_ref()
            .is_none_or(|current| score > (current.0, current.1))
        {
            selected = Some((revision, !list.is_empty(), list));
        }
    }
    Ok(selected.map(|(_, _, list)| list).unwrap_or_default())
}

fn preferred_namespace(transaction: &Transaction<'_>, library_key: &str) -> AppResult<String> {
    let keys = namespace_keys(transaction, library_key)?;
    let mut selected: Option<(i64, bool, String)> = None;
    for key in keys {
        let populated = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM shares WHERE library_key=?1)",
                [&key],
                |row| row.get::<_, bool>(0),
            )
            .map_err(error)?;
        let revision = namespace_revision(transaction, "shares", &key)?;
        let score = (revision, populated);
        if selected
            .as_ref()
            .is_none_or(|current| score > (current.0, current.1))
        {
            selected = Some((revision, populated, key));
        }
    }
    selected
        .map(|(_, _, key)| key)
        .ok_or_else(|| AppError::internal("Library namespace is unavailable"))
}

fn share_in_by_token(
    transaction: &Transaction<'_>,
    library_key: &str,
    token: &str,
) -> AppResult<Option<Share>> {
    let has_grant_id = column_exists(transaction, "shares", "grant_id")?;
    let grant_column = if has_grant_id { ",grant_id" } else { "" };
    let row = transaction
        .query_row(
            &format!(
                "SELECT token,path,is_directory,editable,passcode,created_at,root_id,
                        source_id,root_relative_path,restrictions_json,used_bytes,
                        workspace_taskbar_pins_json,workspace_layout_presets_json{grant_column}
                 FROM shares WHERE library_key=?1 AND token=?2"
            ),
            params![library_key, token],
            |row| stored_share_row(row, has_grant_id),
        )
        .optional()
        .map_err(error)?;
    row.map(decode_share).transpose()
}

fn share_in_by_id(
    transaction: &Transaction<'_>,
    library_key: &str,
    grant_id: &GrantId,
) -> AppResult<Option<Share>> {
    if !column_exists(transaction, "shares", "grant_id")? {
        return Ok(None);
    }
    let row = transaction
        .query_row(
            "SELECT token,path,is_directory,editable,passcode,created_at,root_id,
                    source_id,root_relative_path,restrictions_json,used_bytes,
                    workspace_taskbar_pins_json,workspace_layout_presets_json,grant_id
             FROM shares WHERE library_key=?1 AND grant_id=?2",
            params![library_key, grant_id.as_str()],
            |row| stored_share_row(row, true),
        )
        .optional()
        .map_err(error)?;
    row.map(decode_share).transpose()
}

pub(crate) fn share_by_token(
    database: &Path,
    library_key: &str,
    token: &str,
) -> AppResult<Option<Share>> {
    let mut connection = connection(database)?;
    let transaction = connection.transaction().map_err(error)?;
    let key = preferred_namespace(&transaction, library_key)?;
    share_in_by_token(&transaction, &key, token)
}

pub(crate) fn share_by_id(
    database: &Path,
    library_key: &str,
    grant_id: &GrantId,
) -> AppResult<Option<Share>> {
    let mut connection = connection(database)?;
    let transaction = connection.transaction().map_err(error)?;
    let key = preferred_namespace(&transaction, library_key)?;
    share_in_by_id(&transaction, &key, grant_id)
}

fn upsert_share(transaction: &Transaction<'_>, library_key: &str, share: &Share) -> AppResult<()> {
    let restrictions = share
        .restrictions
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(error))
        .transpose()?;
    let pins = json_column(&share.workspace_taskbar_pins)?;
    let presets = json_column(&share.workspace_layout_presets)?;
    if column_exists(transaction, "shares", "grant_id")? {
        let grant_id = share
            .grant_id
            .as_ref()
            .ok_or_else(|| AppError::internal("Grant internal ID is missing"))?;
        transaction
            .execute(
                "INSERT INTO shares(
                   library_key,token,path,is_directory,editable,passcode,created_at,
                   root_id,source_id,root_relative_path,restrictions_json,used_bytes,
                   workspace_taskbar_pins_json,workspace_layout_presets_json,grant_id
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
                 ON CONFLICT(library_key,token) DO UPDATE SET
                   path=excluded.path,is_directory=excluded.is_directory,
                   editable=excluded.editable,passcode=excluded.passcode,
                   created_at=excluded.created_at,root_id=excluded.root_id,
                   source_id=excluded.source_id,root_relative_path=excluded.root_relative_path,
                   restrictions_json=excluded.restrictions_json,used_bytes=excluded.used_bytes,
                   workspace_taskbar_pins_json=excluded.workspace_taskbar_pins_json,
                   workspace_layout_presets_json=excluded.workspace_layout_presets_json,
                   grant_id=excluded.grant_id",
                params![
                    library_key,
                    share.token,
                    share.path,
                    share.is_directory,
                    share.editable,
                    share.passcode,
                    share.created_at as i64,
                    share.root_id,
                    share.source_id,
                    share.root_relative_path,
                    restrictions,
                    share.used_bytes.map(|value| value as i64),
                    pins,
                    presets,
                    grant_id.as_str(),
                ],
            )
            .map_err(error)?;
    } else {
        transaction
            .execute(
                "INSERT INTO shares(
                   library_key,token,path,is_directory,editable,passcode,created_at,
                   root_id,source_id,root_relative_path,restrictions_json,used_bytes,
                   workspace_taskbar_pins_json,workspace_layout_presets_json
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
                 ON CONFLICT(library_key,token) DO UPDATE SET
                   path=excluded.path,is_directory=excluded.is_directory,
                   editable=excluded.editable,passcode=excluded.passcode,
                   created_at=excluded.created_at,root_id=excluded.root_id,
                   source_id=excluded.source_id,root_relative_path=excluded.root_relative_path,
                   restrictions_json=excluded.restrictions_json,used_bytes=excluded.used_bytes,
                   workspace_taskbar_pins_json=excluded.workspace_taskbar_pins_json,
                   workspace_layout_presets_json=excluded.workspace_layout_presets_json",
                params![
                    library_key,
                    share.token,
                    share.path,
                    share.is_directory,
                    share.editable,
                    share.passcode,
                    share.created_at as i64,
                    share.root_id,
                    share.source_id,
                    share.root_relative_path,
                    restrictions,
                    share.used_bytes.map(|value| value as i64),
                    pins,
                    presets,
                ],
            )
            .map_err(error)?;
    }
    Ok(())
}

fn update_share_by_id(
    transaction: &Transaction<'_>,
    library_key: &str,
    grant_id: &GrantId,
    share: &Share,
) -> AppResult<bool> {
    let restrictions = share
        .restrictions
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(error))
        .transpose()?;
    let pins = json_column(&share.workspace_taskbar_pins)?;
    let presets = json_column(&share.workspace_layout_presets)?;
    transaction
        .execute(
            "UPDATE shares SET
               token=?1,path=?2,is_directory=?3,editable=?4,passcode=?5,created_at=?6,
               root_id=?7,source_id=?8,root_relative_path=?9,restrictions_json=?10,
               used_bytes=?11,workspace_taskbar_pins_json=?12,
               workspace_layout_presets_json=?13
             WHERE library_key=?14 AND grant_id=?15",
            params![
                share.token,
                share.path,
                share.is_directory,
                share.editable,
                share.passcode,
                share.created_at as i64,
                share.root_id,
                share.source_id,
                share.root_relative_path,
                restrictions,
                share.used_bytes.map(|value| value as i64),
                pins,
                presets,
                library_key,
                grant_id.as_str(),
            ],
        )
        .map(|updated| updated != 0)
        .map_err(error)
}

pub(crate) fn insert_grant(database: &Path, library_key: &str, share: &Share) -> AppResult<()> {
    if share.grant_id.is_none() {
        return Err(AppError::internal("Grant internal ID is missing"));
    }
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    for key in namespace_keys(&transaction, library_key)? {
        insert_share(&transaction, &key, share)?;
    }
    transaction.commit().map_err(error)
}

pub(crate) fn update_grant(
    database: &Path,
    library_key: &str,
    grant_id: &GrantId,
    update: impl FnOnce(&mut Share) -> AppResult<()>,
) -> AppResult<Option<Share>> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let selected = preferred_namespace(&transaction, library_key)?;
    let Some(mut share) = share_in_by_id(&transaction, &selected, grant_id)? else {
        return Ok(None);
    };
    update(&mut share)?;
    for key in namespace_keys(&transaction, library_key)? {
        if !update_share_by_id(&transaction, &key, grant_id, &share)? {
            insert_share(&transaction, &key, &share)?;
        }
    }
    transaction.commit().map_err(error)?;
    Ok(Some(share))
}

pub(crate) fn mutate_grants(
    database: &Path,
    library_key: &str,
    mut update: impl FnMut(&mut Share) -> AppResult<bool>,
) -> AppResult<Vec<Share>> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let selected = preferred_namespace(&transaction, library_key)?;
    let mut shares = shares_in(&transaction, &selected)?;
    let keys = namespace_keys(&transaction, library_key)?;
    let mut changed = Vec::new();
    for share in &mut shares {
        if !update(share)? {
            continue;
        }
        let grant_id = share
            .grant_id
            .as_ref()
            .ok_or_else(|| AppError::internal("Grant internal ID is missing"))?;
        for key in &keys {
            if !update_share_by_id(&transaction, key, grant_id, share)? {
                insert_share(&transaction, key, share)?;
            }
        }
        changed.push(share.clone());
    }
    transaction.commit().map_err(error)?;
    Ok(changed)
}

pub(crate) fn delete_grant(
    database: &Path,
    library_key: &str,
    grant_id: &GrantId,
) -> AppResult<bool> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut deleted = false;
    for key in namespace_keys(&transaction, library_key)? {
        deleted |= transaction
            .execute(
                "DELETE FROM shares WHERE library_key=?1 AND grant_id=?2",
                params![key, grant_id.as_str()],
            )
            .map_err(error)?
            > 0;
    }
    transaction.commit().map_err(error)?;
    Ok(deleted)
}

pub(crate) struct ShareSourceBinding {
    pub(crate) source_id: String,
    pub(crate) configured_id: Option<String>,
    pub(crate) canonical_locator: String,
    pub(crate) legacy_ids: Vec<String>,
}

pub(crate) fn share_source_aliases(
    database: &Path,
    library_id: &str,
    source_id: Option<&str>,
    legacy_root_id: Option<&str>,
) -> AppResult<Option<ShareSourceBinding>> {
    let connection = connection(database)?;
    if !table_exists(&connection, "sources")? || !table_exists(&connection, "source_legacy_keys")? {
        return Ok(None);
    }
    let source_ids = if let Some(source_id) = source_id {
        let found = connection
            .query_row(
                "SELECT id FROM sources
                 WHERE library_id=?1 AND id=?2 AND provider='filesystem'",
                params![library_id, source_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(error)?;
        found.into_iter().collect::<Vec<_>>()
    } else if let Some(legacy_root_id) = legacy_root_id {
        let mut statement = connection
            .prepare(
                "SELECT DISTINCT s.id FROM sources s
                 JOIN source_legacy_keys k ON k.source_id=s.id
                 WHERE s.library_id=?1 AND s.provider='filesystem' AND k.legacy_id=?2
                 ORDER BY s.id",
            )
            .map_err(error)?;
        statement
            .query_map(params![library_id, legacy_root_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(error)?
            .map(|row| row.map_err(error))
            .collect::<AppResult<Vec<_>>>()?
    } else {
        Vec::new()
    };
    if source_ids.len() > 1 {
        return Err(AppError::internal(
            "Share Source recovery required: legacy root id matches multiple Sources",
        ));
    }
    if source_ids.is_empty() {
        return Ok(None);
    }
    let source_id = source_ids.into_iter().next().unwrap();
    let (configured_id, canonical_locator) = connection
        .query_row(
            "SELECT configured_id,canonical_locator FROM sources WHERE id=?1",
            [&source_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(error)?;
    let mut statement = connection
        .prepare(
            "SELECT legacy_id FROM source_legacy_keys
             WHERE source_id=?1 ORDER BY first_seen_at,legacy_id",
        )
        .map_err(error)?;
    let legacy_ids = statement
        .query_map([&source_id], |row| row.get::<_, String>(0))
        .map_err(error)?
        .map(|row| row.map_err(error))
        .collect::<AppResult<Vec<_>>>()?;
    Ok(Some(ShareSourceBinding {
        source_id,
        configured_id,
        canonical_locator,
        legacy_ids,
    }))
}

pub(crate) fn repair_share_source(
    database: &Path,
    library_key: &str,
    grant_id: &GrantId,
    source_id: &str,
    root_id: &str,
    root_relative_path: &str,
    path: &str,
    workspace_taskbar_pins: &Option<Value>,
    workspace_layout_presets: &Option<Value>,
) -> AppResult<()> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    for key in namespace_keys(&transaction, library_key)? {
        transaction
            .execute(
                "UPDATE shares SET source_id=?1,root_id=?2,root_relative_path=?3,path=?4,
                   workspace_taskbar_pins_json=?5,workspace_layout_presets_json=?6
                 WHERE library_key=?7 AND grant_id=?8",
                params![
                    source_id,
                    root_id,
                    root_relative_path,
                    path,
                    json_column(workspace_taskbar_pins)?,
                    json_column(workspace_layout_presets)?,
                    key,
                    grant_id.as_str()
                ],
            )
            .map_err(error)?;
    }
    transaction.commit().map_err(error)
}

pub fn mounts(database: &Path) -> AppResult<Vec<(String, String, PathBuf, Option<u128>)>> {
    let connection = connection(database)?;
    let mut statement = connection
        .prepare("SELECT id,name,path,created_at FROM mounts ORDER BY created_at,id")
        .map_err(error)?;
    statement
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                PathBuf::from(row.get::<_, String>(2)?),
                row.get::<_, Option<i64>>(3)?.map(|value| value as u128),
            ))
        })
        .map_err(error)?
        .map(|row| row.map_err(error))
        .collect()
}

pub fn replace_mounts(
    database: &Path,
    mounts: &[(String, String, PathBuf, Option<u128>)],
) -> AppResult<()> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    transaction
        .execute("DELETE FROM mounts", [])
        .map_err(error)?;
    for (id, name, path, created_at) in mounts {
        transaction
            .execute(
                "INSERT INTO mounts(id,name,path,created_at) VALUES(?1,?2,?3,?4)",
                params![
                    id,
                    name,
                    path.to_string_lossy(),
                    created_at.map(|value| value as i64)
                ],
            )
            .map_err(error)?;
    }
    transaction.commit().map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig};

    fn test_config(data_path: PathBuf) -> Config {
        Config {
            port: 3000,
            roots: vec![],
            library_key: "library".into(),
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
        }
    }

    fn temp_data(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("derp-state-{name}-{}", uuid::Uuid::new_v4()))
    }

    fn test_share(token: &str) -> Share {
        Share {
            grant_id: Some(GrantId::new()),
            token: token.into(),
            path: format!("Shared/{token}.txt"),
            is_directory: false,
            editable: false,
            passcode: None,
            created_at: 1,
            root_id: None,
            source_id: None,
            root_relative_path: None,
            unavailable: None,
            restrictions: None,
            used_bytes: None,
            workspace_taskbar_pins: None,
            workspace_layout_presets: None,
        }
    }

    #[test]
    fn imports_and_archives_legacy_state() {
        let data_path = temp_data("import");
        fs::create_dir_all(&data_path).unwrap();
        fs::write(
            data_path.join("settings.json"),
            r#"{"library":{"favorites":["one.jpg"],"future":true}}"#,
        )
        .unwrap();
        fs::write(
            data_path.join("stats.json"),
            r#"{"library":{"views":{"one.jpg":3},"shareViews":{}}}"#,
        )
        .unwrap();
        fs::write(data_path.join("canvases.json"), r#"{"library":[]}"#).unwrap();
        fs::write(
            data_path.join("shares.json"),
            r#"{"library":{"shares":[{"token":"token","path":"one.jpg","isDirectory":false,"editable":false,"passcode":"ciphertext","createdAt":7,"ignored":"value"}]}}"#,
        )
        .unwrap();
        fs::write(
            data_path.join("mounts.json"),
            r#"{"version":1,"mounts":[{"id":"mount","name":"Archive","path":"C:\\\\Archive","createdAt":9,"ignored":true}]}"#,
        )
        .unwrap();
        let config = test_config(data_path.clone());

        initialize(&config).unwrap();

        assert_eq!(
            document(&database(&config), "settings", "library", Value::Null).unwrap()["future"],
            true
        );
        let imported_shares = shares(&database(&config), "library").unwrap();
        assert_eq!(imported_shares.len(), 1);
        assert!(imported_shares[0].grant_id.is_some());
        assert_eq!(imported_shares[0].passcode.as_deref(), Some("ciphertext"));
        assert_eq!(mounts(&database(&config)).unwrap().len(), 1);
        for name in LEGACY_FILES {
            assert!(!data_path.join(name).exists());
        }
        let archived = fs::read_dir(data_path.join("legacy-json-backup"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert!(archived.join("shares.json").exists());
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn malformed_json_rolls_back_import() {
        let data_path = temp_data("malformed");
        fs::create_dir_all(&data_path).unwrap();
        fs::write(data_path.join("settings.json"), "{bad").unwrap();
        let config = test_config(data_path.clone());

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("settings.json"));
        assert!(data_path.join("settings.json").exists());
        let connection = connection(&database(&config)).unwrap();
        let imported: i64 = connection
            .query_row("SELECT COUNT(*) FROM legacy_state_import", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(imported, 0);
        drop(connection);
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn restart_does_not_reimport_new_legacy_file() {
        let data_path = temp_data("restart");
        fs::create_dir_all(&data_path).unwrap();
        fs::write(
            data_path.join("settings.json"),
            r#"{"library":{"favorites":["original"]}}"#,
        )
        .unwrap();
        let config = test_config(data_path.clone());
        initialize(&config).unwrap();
        fs::write(
            data_path.join("settings.json"),
            r#"{"library":{"favorites":["replacement"]}}"#,
        )
        .unwrap();

        initialize(&config).unwrap();

        let settings = document(&database(&config), "settings", "library", Value::Null).unwrap();
        assert_eq!(settings["favorites"], serde_json::json!(["original"]));
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn production_share_schema_adds_source_identity_idempotently() {
        let data_path = temp_data("share-source-upgrade");
        fs::create_dir_all(&data_path).unwrap();
        let config = test_config(data_path.clone());
        initialize(&config).unwrap();
        let db = connection(&database(&config)).unwrap();
        db.execute_batch(
            "ALTER TABLE shares DROP COLUMN source_id;
                 INSERT INTO shares(
                   library_key,token,path,is_directory,editable,created_at,
                   root_id,root_relative_path
                 ) VALUES('library','token','Movies/file.txt',0,0,1,'config:movies','file.txt');",
        )
        .unwrap();
        drop(db);

        initialize(&config).unwrap();
        initialize(&config).unwrap();

        let db = connection(&database(&config)).unwrap();
        let source_columns: i64 = db
            .prepare("PRAGMA table_info(shares)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|name| name.unwrap())
            .filter(|name| name == "source_id")
            .count() as i64;
        assert_eq!(source_columns, 1);
        drop(db);
        let share = shares(&database(&config), "library").unwrap().remove(0);
        assert_eq!(share.path, "Movies/file.txt");
        assert_eq!(share.source_id, None);
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn grant_schema_upgrade_backs_up_and_backfills_one_id_across_aliases() {
        let data_path = temp_data("grant-id-upgrade");
        fs::create_dir_all(&data_path).unwrap();
        let mut config = test_config(data_path.clone());
        initialize(&config).unwrap();
        crate::resources::initialize_identity(&mut config).unwrap();
        let canonical = config.library_key.clone();
        let legacy_db = connection(&database(&config)).unwrap();
        legacy_db
            .execute("ALTER TABLE shares DROP COLUMN grant_id", [])
            .unwrap();
        for key in [canonical.as_str(), "library"] {
            legacy_db
                .execute(
                    "INSERT INTO shares(
                       library_key,token,path,is_directory,editable,created_at
                     ) VALUES(?1,'stable-token','Shared/file.txt',0,0,1)",
                    [key],
                )
                .unwrap();
        }
        drop(legacy_db);

        initialize_grants(&config).unwrap();

        let backup = data_path.join("schema-backups").join(GRANT_SCHEMA_BACKUP);
        assert!(backup.is_file());
        let backup_db = connection(&backup).unwrap();
        assert!(!column_exists(&backup_db, "shares", "grant_id").unwrap());
        drop(backup_db);
        let migrated_db = connection(&database(&config)).unwrap();
        let (rows, ids): (i64, i64) = migrated_db
            .query_row(
                "SELECT COUNT(*),COUNT(DISTINCT grant_id)
                 FROM shares WHERE token='stable-token'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((rows, ids), (2, 1));
        let grant_id: String = migrated_db
            .query_row(
                "SELECT grant_id FROM shares WHERE library_key=?1 AND token='stable-token'",
                [&canonical],
                |row| row.get(0),
            )
            .unwrap();
        drop(migrated_db);

        initialize_grants(&config).unwrap();

        let loaded = share_by_token(&database(&config), &canonical, "stable-token")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.grant_id.unwrap().as_str(), grant_id);
        let connection = connection(&database(&config)).unwrap();
        let versions: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version=4",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(versions, 1);
        drop(connection);
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn targeted_grant_updates_preserve_unrelated_rows_and_stable_ids() {
        let data_path = temp_data("targeted-grants");
        fs::create_dir_all(&data_path).unwrap();
        let mut config = test_config(data_path.clone());
        initialize(&config).unwrap();
        crate::resources::initialize_identity(&mut config).unwrap();
        initialize_grants(&config).unwrap();
        let first = test_share("first");
        let second = test_share("second");
        let first_id = first.grant_id.clone().unwrap();
        let second_id = second.grant_id.clone().unwrap();
        insert_grant(&database(&config), &config.library_key, &first).unwrap();
        insert_grant(&database(&config), &config.library_key, &second).unwrap();
        let prepared_db = connection(&database(&config)).unwrap();
        prepared_db
            .execute("ALTER TABLE shares ADD COLUMN test_sentinel TEXT", [])
            .unwrap();
        prepared_db
            .execute(
                "UPDATE shares SET test_sentinel='keep'
                 WHERE grant_id=?1",
                [second_id.as_str()],
            )
            .unwrap();
        let second_rowid: i64 = prepared_db
            .query_row(
                "SELECT rowid FROM shares WHERE library_key=?1 AND grant_id=?2",
                params![config.library_key.as_str(), second_id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        drop(prepared_db);

        update_grant(
            &database(&config),
            &config.library_key,
            &first_id,
            |share| {
                share.editable = true;
                share.used_bytes = Some(25);
                Ok(())
            },
        )
        .unwrap()
        .unwrap();
        let untouched = share_by_id(&database(&config), &config.library_key, &second_id)
            .unwrap()
            .unwrap();
        assert_eq!(untouched.token, "second");
        assert_eq!(untouched.used_bytes, None);
        let connection = connection(&database(&config)).unwrap();
        let after_rowid: i64 = connection
            .query_row(
                "SELECT rowid FROM shares WHERE library_key=?1 AND grant_id=?2",
                params![config.library_key.as_str(), second_id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(after_rowid, second_rowid);
        let sentinel: String = connection
            .query_row(
                "SELECT test_sentinel FROM shares WHERE library_key=?1 AND grant_id=?2",
                params![config.library_key.as_str(), second_id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(sentinel, "keep");
        drop(connection);
        let changed = share_by_id(&database(&config), &config.library_key, &first_id)
            .unwrap()
            .unwrap();
        assert!(changed.editable);
        assert_eq!(changed.used_bytes, Some(25));
        assert!(delete_grant(&database(&config), &config.library_key, &first_id).unwrap());
        assert!(
            share_by_id(&database(&config), &config.library_key, &first_id)
                .unwrap()
                .is_none()
        );
        assert!(
            share_by_id(&database(&config), &config.library_key, &second_id)
                .unwrap()
                .is_some()
        );
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn malformed_grant_row_is_reported_instead_of_becoming_an_empty_list() {
        let data_path = temp_data("grant-read-error");
        fs::create_dir_all(&data_path).unwrap();
        let mut config = test_config(data_path.clone());
        initialize(&config).unwrap();
        crate::resources::initialize_identity(&mut config).unwrap();
        initialize_grants(&config).unwrap();
        let share = test_share("malformed");
        insert_grant(&database(&config), &config.library_key, &share).unwrap();
        let connection = connection(&database(&config)).unwrap();
        connection
            .execute(
                "UPDATE shares SET restrictions_json='{bad' WHERE token='malformed'",
                [],
            )
            .unwrap();
        drop(connection);

        let failure = shares(&database(&config), &config.library_key).unwrap_err();
        assert!(!failure.1.is_empty());
        fs::remove_dir_all(data_path).unwrap();
    }
}
