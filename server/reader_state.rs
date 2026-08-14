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

pub fn get(database: &Path, path: &str) -> AppResult<Option<ReaderState>> {
    let connection = connection(database)?;
    connection
        .query_row(
            "SELECT state_json, fingerprint, revision FROM reader_state WHERE path=?1",
            params![path],
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
            "SELECT revision FROM reader_state WHERE path=?1",
            params![path],
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
            "INSERT INTO reader_state(path,state_json,fingerprint,revision,updated_at)
             VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(path) DO UPDATE SET
               state_json=excluded.state_json,
               fingerprint=excluded.fingerprint,
               revision=excluded.revision,
               updated_at=excluded.updated_at",
            params![path, serialized, fingerprint, revision, updated_at as i64],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    transaction
        .commit()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(revision)
}

pub fn remove_prefix(database: &Path, path: &str) -> AppResult<()> {
    let connection = connection(database)?;
    let like = like_prefix(path);
    connection
        .execute(
            "DELETE FROM reader_state WHERE path=?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn remove_exact(database: &Path, path: &str) -> AppResult<()> {
    let connection = connection(database)?;
    connection
        .execute("DELETE FROM reader_state WHERE path=?1", params![path])
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

pub fn preferences(database: &Path) -> AppResult<(Value, i64)> {
    let connection = connection(database)?;
    connection
        .query_row(
            "SELECT state_json, revision FROM app_preferences WHERE id=1",
            [],
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
            "SELECT revision FROM app_preferences WHERE id=1",
            [],
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
            "INSERT INTO app_preferences(id,state_json,revision,updated_at) VALUES(1,?1,?2,?3)
             ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json,
               revision=excluded.revision, updated_at=excluded.updated_at",
            params![serialized, revision, updated_at as i64],
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
                   path TEXT PRIMARY KEY, state_json TEXT NOT NULL,
                   fingerprint TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE app_preferences (
                   id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT NOT NULL,
                   revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
                 );",
            )
            .unwrap();
        path
    }

    #[test]
    fn exact_removal_preserves_descendant_documents() {
        let database = database();
        put(&database, "Books", &json!({"page":1}), "a", 0, 1).unwrap();
        put(&database, "Books/novel.epub", &json!({"page":9}), "b", 0, 1).unwrap();

        remove_exact(&database, "Books").unwrap();

        assert!(get(&database, "Books").unwrap().is_none());
        assert!(get(&database, "Books/novel.epub").unwrap().is_some());
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn preference_writes_require_current_revision() {
        let database = database();
        assert_eq!(
            put_preferences(&database, &json!({"theme":"dark"}), 0, 1).unwrap(),
            1
        );
        assert!(put_preferences(&database, &json!({"theme":"light"}), 0, 2).is_err());
        assert_eq!(
            put_preferences(&database, &json!({"theme":"light"}), 1, 3).unwrap(),
            2
        );
        let _ = std::fs::remove_file(database);
    }
}
