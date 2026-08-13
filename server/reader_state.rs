use crate::{
    error::{AppError, AppResult},
    state_db,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::Value;
use std::path::Path;

#[derive(Debug)]
pub struct ReaderState {
    pub value: Value,
    pub fingerprint: String,
    pub revision: i64,
}

fn like_prefix(path: &str) -> String {
    format!(
        "{}/%",
        path.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}

fn connection(path: &Path) -> AppResult<Connection> {
    state_db::connection(path)
}

pub fn get(database: &Path, scope: &str, path: &str) -> AppResult<Option<ReaderState>> {
    let connection = connection(database)?;
    connection
        .query_row(
            "SELECT state_json, fingerprint, revision FROM reader_state WHERE scope=?1 AND path=?2",
            params![scope, path],
            |row| {
                let raw: String = row.get(0)?;
                Ok(ReaderState {
                    value: serde_json::from_str(&raw).unwrap_or(Value::Null),
                    fingerprint: row.get(1)?,
                    revision: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| AppError::internal(error.to_string()))
}

pub fn put(
    database: &Path,
    scope: &str,
    path: &str,
    value: &Value,
    fingerprint: &str,
    base_revision: i64,
    updated_at: u128,
) -> AppResult<i64> {
    let serialized =
        serde_json::to_string(value).map_err(|error| AppError::bad(error.to_string()))?;
    if serialized.len() > 32 * 1024 {
        return Err(AppError::bad("Reader state exceeds 32 KB"));
    }
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let current: Option<i64> = transaction
        .query_row(
            "SELECT revision FROM reader_state WHERE scope=?1 AND path=?2",
            params![scope, path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| AppError::internal(error.to_string()))?;
    if current.unwrap_or(0) != base_revision {
        return Err(AppError::conflict("Reader state changed"));
    }
    let revision = base_revision + 1;
    transaction
        .execute(
            "INSERT INTO reader_state(scope,path,state_json,fingerprint,revision,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(scope,path) DO UPDATE SET
               state_json=excluded.state_json,
               fingerprint=excluded.fingerprint,
               revision=excluded.revision,
               updated_at=excluded.updated_at",
            params![
                scope,
                path,
                serialized,
                fingerprint,
                revision,
                updated_at as i64
            ],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    transaction
        .commit()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(revision)
}

pub fn remove_prefix(database: &Path, scope: Option<&str>, path: &str) -> AppResult<()> {
    let connection = connection(database)?;
    let like = like_prefix(path);
    if let Some(scope) = scope {
        connection.execute(
            "DELETE FROM reader_state WHERE scope=?1 AND (path=?2 OR path LIKE ?3 ESCAPE '\\')",
            params![scope, path, like],
        )
    } else {
        connection.execute(
            "DELETE FROM reader_state WHERE path=?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
    }
    .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn remove_exact(database: &Path, scope: &str, path: &str) -> AppResult<()> {
    let connection = connection(database)?;
    connection
        .execute(
            "DELETE FROM reader_state WHERE scope=?1 AND path=?2",
            params![scope, path],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn remove_exact_all(database: &Path, path: &str) -> AppResult<()> {
    let connection = connection(database)?;
    connection
        .execute("DELETE FROM reader_state WHERE path=?1", params![path])
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn remove_scope(database: &Path, scope: &str) -> AppResult<()> {
    let connection = connection(database)?;
    connection
        .execute("DELETE FROM reader_state WHERE scope=?1", params![scope])
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn move_prefix(database: &Path, old_path: &str, new_path: &str) -> AppResult<()> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let old_like = like_prefix(old_path);
    let new_like = like_prefix(new_path);
    transaction
        .execute(
            "DELETE FROM reader_state WHERE path=?1 OR path LIKE ?2 ESCAPE '\\'",
            params![new_path, new_like],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    transaction
        .execute(
            "UPDATE reader_state SET path=?1 || substr(path, length(?2)+1)
             WHERE path=?2 OR path LIKE ?3 ESCAPE '\\'",
            params![new_path, old_path, old_like],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    transaction
        .commit()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn preferences(database: &Path, scope: &str) -> AppResult<(Value, i64)> {
    let connection = connection(database)?;
    connection
        .query_row(
            "SELECT state_json, revision FROM app_preferences WHERE scope=?1",
            params![scope],
            |row| {
                let raw: String = row.get(0)?;
                Ok((
                    serde_json::from_str(&raw).unwrap_or(Value::Null),
                    row.get(1)?,
                ))
            },
        )
        .optional()
        .map(|value| value.unwrap_or((Value::Null, 0)))
        .map_err(|error| AppError::internal(error.to_string()))
}

pub fn put_preferences(
    database: &Path,
    scope: &str,
    value: &Value,
    base_revision: i64,
    updated_at: u128,
) -> AppResult<i64> {
    let serialized =
        serde_json::to_string(value).map_err(|error| AppError::bad(error.to_string()))?;
    if serialized.len() > 32 * 1024 {
        return Err(AppError::bad("Reader preferences exceed 32 KB"));
    }
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let current: Option<i64> = transaction
        .query_row(
            "SELECT revision FROM app_preferences WHERE scope=?1",
            params![scope],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| AppError::internal(error.to_string()))?;
    if current.unwrap_or(0) != base_revision {
        return Err(AppError::conflict("Reader preferences changed"));
    }
    let revision = base_revision + 1;
    transaction
        .execute(
            "INSERT INTO app_preferences(scope,state_json,revision,updated_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(scope) DO UPDATE SET state_json=excluded.state_json,
               revision=excluded.revision, updated_at=excluded.updated_at",
            params![scope, serialized, revision, updated_at as i64],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    transaction
        .commit()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(revision)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn database() -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "derp-reader-state-{}-{unique}.sqlite3",
            std::process::id()
        ));
        let connection = state_db::connection(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE reader_state (
                   scope TEXT NOT NULL, path TEXT NOT NULL, state_json TEXT NOT NULL,
                   fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                   PRIMARY KEY(scope, path)
                 );
                 CREATE TABLE app_preferences (
                   scope TEXT PRIMARY KEY, state_json TEXT NOT NULL,
                   revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
                 );",
            )
            .unwrap();
        path
    }

    #[test]
    fn exact_removal_preserves_descendant_documents() {
        let database = database();
        put(&database, "admin", "Books", &json!({"page":1}), "a", 0, 1).unwrap();
        put(
            &database,
            "admin",
            "Books/novel.epub",
            &json!({"page":9}),
            "b",
            0,
            1,
        )
        .unwrap();

        remove_exact(&database, "admin", "Books").unwrap();

        assert!(get(&database, "admin", "Books").unwrap().is_none());
        assert!(
            get(&database, "admin", "Books/novel.epub")
                .unwrap()
                .is_some()
        );
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn preference_writes_require_current_revision() {
        let database = database();
        assert_eq!(
            put_preferences(&database, "admin", &json!({"theme":"dark"}), 0, 1).unwrap(),
            1
        );
        assert!(put_preferences(&database, "admin", &json!({"theme":"light"}), 0, 2).is_err());
        assert_eq!(
            put_preferences(&database, "admin", &json!({"theme":"light"}), 1, 3).unwrap(),
            2
        );
        let _ = std::fs::remove_file(database);
    }
}
