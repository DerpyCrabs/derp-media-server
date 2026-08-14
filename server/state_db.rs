use crate::{
    config::Config,
    error::{AppError, AppResult},
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateDocument {
    SettingsV1,
    PlaybackStatsV1,
    CanvasV2,
}

impl StateDocument {
    pub const fn name(self) -> &'static str {
        match self {
            Self::SettingsV1 => "settings.v1",
            Self::PlaybackStatsV1 => "playback-stats.v1",
            Self::CanvasV2 => "canvas.v2",
        }
    }
}

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
    let has_schema = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='state_schema')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;

    if has_schema {
        let version: i64 = connection
            .query_row("SELECT version FROM state_schema WHERE id=1", [], |row| {
                row.get(0)
            })
            .map_err(|error| error.to_string())?;
        if version != CURRENT_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported application state schema {version}; expected {CURRENT_SCHEMA_VERSION}"
            ));
        }
        return Ok(());
    }

    let table_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if table_count != 0 {
        return Err("Unsupported unversioned application state database".into());
    }

    connection
        .execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "CREATE TABLE state_schema (
               id INTEGER PRIMARY KEY CHECK(id=1),
               version INTEGER NOT NULL,
               applied_at INTEGER NOT NULL
             );
             CREATE TABLE state_documents (
               kind TEXT NOT NULL,
               library_key TEXT NOT NULL,
               value_json TEXT NOT NULL,
               updated_at INTEGER NOT NULL,
               PRIMARY KEY(kind, library_key)
             );
             CREATE TABLE reader_state (
               path TEXT PRIMARY KEY,
               state_json TEXT NOT NULL,
               fingerprint TEXT NOT NULL,
               revision INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE app_preferences (
               id INTEGER PRIMARY KEY CHECK(id=1),
               state_json TEXT NOT NULL,
               revision INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO state_schema(id, version, applied_at) VALUES(1, ?1, ?2)",
            params![CURRENT_SCHEMA_VERSION, now_ms()],
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

pub fn document(
    database: &Path,
    document_name: StateDocument,
    library_key: &str,
    default: Value,
) -> AppResult<Value> {
    let connection = connection(database)?;
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key=?2",
            params![document_name.name(), library_key],
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
    document_name: StateDocument,
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
            params![document_name.name(), library_key],
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
            params![document_name.name(), library_key, serialized, now_ms()],
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
    fn initializes_current_schema_idempotently() {
        let data_path = temp_data("current");
        let config = test_config(data_path.clone());

        initialize(&config).unwrap();
        initialize(&config).unwrap();

        let connection = connection(&database(&config)).unwrap();
        let version: i64 = connection
            .query_row("SELECT version FROM state_schema WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        let tables = connection
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        for table in [
            "app_preferences",
            "reader_state",
            "state_schema",
            "state_documents",
        ] {
            assert!(tables.iter().any(|name| name == table));
        }
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_noncurrent_schema_without_mutating_it() {
        let data_path = temp_data("unsupported");
        fs::create_dir_all(&data_path).unwrap();
        let database = data_path.join("app.sqlite3");
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE state_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at INTEGER NOT NULL);
                 INSERT INTO state_schema VALUES(1, 3, 1);
                 CREATE TABLE sentinel (value TEXT NOT NULL);
                 INSERT INTO sentinel VALUES('unchanged');",
            )
            .unwrap();
        drop(connection);
        let config = test_config(data_path.clone());

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("Unsupported application state schema 3"));
        let connection = Connection::open(database).unwrap();
        let value: String = connection
            .query_row("SELECT value FROM sentinel", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "unchanged");
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_unversioned_database_without_claiming_it() {
        let data_path = temp_data("unversioned");
        fs::create_dir_all(&data_path).unwrap();
        let database = data_path.join("app.sqlite3");
        Connection::open(&database)
            .unwrap()
            .execute_batch("CREATE TABLE unknown_state (value TEXT NOT NULL);")
            .unwrap();
        let config = test_config(data_path.clone());

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("Unsupported unversioned application state database"));
        let connection = Connection::open(database).unwrap();
        let has_schema: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='state_schema')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!has_schema);
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn current_documents_round_trip_and_preserve_corrupt_bytes() {
        let data_path = temp_data("documents");
        let config = test_config(data_path.clone());
        initialize(&config).unwrap();
        let database = database(&config);

        update_document(
            &database,
            StateDocument::SettingsV1,
            "library",
            serde_json::json!({}),
            |value| {
                value["favorites"] = serde_json::json!(["one.jpg"]);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(
            document(&database, StateDocument::SettingsV1, "library", Value::Null,).unwrap()["favorites"],
            serde_json::json!(["one.jpg"])
        );

        let corrupt = "{preserve exact invalid bytes  \n";
        connection(&database)
            .unwrap()
            .execute(
                "UPDATE state_documents SET value_json=?1 WHERE kind=?2 AND library_key='library'",
                params![corrupt, StateDocument::SettingsV1.name()],
            )
            .unwrap();
        assert!(
            update_document(
                &database,
                StateDocument::SettingsV1,
                "library",
                serde_json::json!({}),
                |_| Ok(()),
            )
            .is_err()
        );
        let stored: String = connection(&database)
            .unwrap()
            .query_row(
                "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key='library'",
                [StateDocument::SettingsV1.name()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, corrupt);
        fs::remove_dir_all(data_path).unwrap();
    }
}
