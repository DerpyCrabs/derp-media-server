use crate::{
    config::Config,
    error::{AppError, AppResult},
    shares::Share,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;
use std::{
    collections::HashSet,
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

pub fn database(config: &Config) -> PathBuf {
    config.data_path.join("app.sqlite3")
}

fn error(error: impl std::fmt::Display) -> AppError {
    AppError::internal(error.to_string())
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
                   token TEXT NOT NULL,
                   path TEXT NOT NULL,
                   is_directory INTEGER NOT NULL,
                   editable INTEGER NOT NULL,
                   passcode TEXT,
                   created_at INTEGER NOT NULL,
                   root_id TEXT,
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
    import_legacy(config, &mut connection)?;
    Ok(())
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
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key=?2",
            params![kind, library_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(error))
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
    let raw: Option<String> = transaction
        .query_row(
            "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key=?2",
            params![kind, library_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    let mut value = raw
        .map(|raw| serde_json::from_str(&raw).map_err(error))
        .transpose()?
        .unwrap_or(default);
    let result = update(&mut value)?;
    let serialized = serde_json::to_string(&value).map_err(error)?;
    transaction
        .execute(
            "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(kind, library_key) DO UPDATE SET
               value_json=excluded.value_json, updated_at=excluded.updated_at",
            params![kind, library_key, serialized, now_ms()],
        )
        .map_err(error)?;
    transaction.commit().map_err(error)?;
    Ok(result)
}

fn json_column(value: &Option<Value>) -> AppResult<Option<String>> {
    value
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(error))
        .transpose()
}

fn insert_share(transaction: &Transaction<'_>, library_key: &str, share: &Share) -> AppResult<()> {
    let restrictions = share
        .restrictions
        .as_ref()
        .map(|value| serde_json::to_string(value).map_err(error))
        .transpose()?;
    transaction
        .execute(
            "INSERT INTO shares(
               library_key, token, path, is_directory, editable, passcode, created_at,
               root_id, root_relative_path, restrictions_json, used_bytes,
               workspace_taskbar_pins_json, workspace_layout_presets_json
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                library_key,
                share.token,
                share.path,
                share.is_directory,
                share.editable,
                share.passcode,
                share.created_at as i64,
                share.root_id,
                share.root_relative_path,
                restrictions,
                share.used_bytes.map(|value| value as i64),
                json_column(&share.workspace_taskbar_pins)?,
                json_column(&share.workspace_layout_presets)?,
            ],
        )
        .map_err(error)?;
    Ok(())
}

fn shares_in(transaction: &Transaction<'_>, library_key: &str) -> AppResult<Vec<Share>> {
    let mut statement = transaction
        .prepare(
            "SELECT token,path,is_directory,editable,passcode,created_at,root_id,
                    root_relative_path,restrictions_json,used_bytes,
                    workspace_taskbar_pins_json,workspace_layout_presets_json
             FROM shares WHERE library_key=?1 ORDER BY created_at, token",
        )
        .map_err(error)?;
    let rows = statement
        .query_map([library_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, bool>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, Option<String>>(11)?,
            ))
        })
        .map_err(error)?;
    rows.map(|row| {
        let (
            token,
            path,
            is_directory,
            editable,
            passcode,
            created_at,
            root_id,
            root_relative_path,
            restrictions,
            used_bytes,
            pins,
            presets,
        ) = row.map_err(error)?;
        Ok(Share {
            token,
            path,
            is_directory,
            editable,
            passcode,
            created_at: created_at as u64,
            root_id,
            root_relative_path,
            unavailable: None,
            restrictions: restrictions
                .map(|raw| serde_json::from_str(&raw).map_err(error))
                .transpose()?,
            used_bytes: used_bytes.map(|value| value as u64),
            workspace_taskbar_pins: pins
                .map(|raw| serde_json::from_str(&raw).map_err(error))
                .transpose()?,
            workspace_layout_presets: presets
                .map(|raw| serde_json::from_str(&raw).map_err(error))
                .transpose()?,
        })
    })
    .collect()
}

pub fn shares(database: &Path, library_key: &str) -> AppResult<Vec<Share>> {
    let mut connection = connection(database)?;
    let transaction = connection.transaction().map_err(error)?;
    shares_in(&transaction, library_key)
}

pub fn mutate_shares<T>(
    database: &Path,
    library_key: &str,
    update: impl FnOnce(&mut Vec<Share>) -> AppResult<T>,
) -> AppResult<T> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let mut list = shares_in(&transaction, library_key)?;
    let result = update(&mut list)?;
    transaction
        .execute("DELETE FROM shares WHERE library_key=?1", [library_key])
        .map_err(error)?;
    for share in &list {
        insert_share(&transaction, library_key, share)?;
    }
    transaction.commit().map_err(error)?;
    Ok(result)
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
}
