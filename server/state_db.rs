use crate::{
    config::Config,
    error::{AppError, AppResult},
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const LEGACY_FILES: [&str; 3] = ["settings.json", "stats.json", "canvases.json"];

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
    if version < 2 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch("DROP TABLE IF EXISTS shares;")
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES(2, ?1)",
                [now_ms()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    if version < 3 {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch("DROP TABLE IF EXISTS mounts;")
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES(3, ?1)",
                [now_ms()],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    let _ = fs::remove_file(config.data_path.join("shares.json"));
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
        .query_row("SELECT COUNT(*) FROM state_documents", [], |row| row.get(0))
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
            if ["views"]
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{FileSearchConfig, ImageOptimizationConfig};

    fn test_config(data_path: PathBuf) -> Config {
        Config {
            port: 3000,
            roots: vec![],
            library_key: "library".into(),
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
            r#"{"library":{"views":{"one.jpg":3}}}"#,
        )
        .unwrap();
        fs::write(data_path.join("canvases.json"), r#"{"library":[]}"#).unwrap();
        let config = test_config(data_path.clone());

        initialize(&config).unwrap();

        assert_eq!(
            document(&database(&config), "settings", "library", Value::Null).unwrap()["future"],
            true
        );
        for name in LEGACY_FILES {
            assert!(!data_path.join(name).exists());
        }
        assert!(
            fs::read_dir(data_path.join("legacy-json-backup"))
                .unwrap()
                .next()
                .is_some()
        );
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
