use crate::{
    error::{AppError, AppResult},
    state_db,
};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;

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

fn connection(database: &state_db::AppDatabase) -> AppResult<Connection> {
    database.connection()
}

pub fn get(
    database: &state_db::AppDatabase,
    scope: &str,
    path: &str,
) -> AppResult<Option<ReaderState>> {
    let connection = connection(database)?;
    let row: Option<(String, String, i64)> = connection
        .query_row(
            "SELECT state_json, fingerprint, revision FROM reader_state WHERE scope=?1 AND path=?2",
            params![scope, path],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| AppError::internal(error.to_string()))?;
    row.map(|(raw, fingerprint, revision)| {
        serde_json::from_str(&raw)
            .map(|value| ReaderState {
                value,
                fingerprint,
                revision,
            })
            .map_err(|error| AppError::internal(format!("Invalid reader state: {error}")))
    })
    .transpose()
}

pub fn put(
    database: &state_db::AppDatabase,
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

pub fn remove_prefix_in_transaction(
    transaction: &Transaction<'_>,
    scope: Option<&str>,
    path: &str,
) -> AppResult<()> {
    let like = like_prefix(path);
    if let Some(scope) = scope {
        transaction.execute(
            "DELETE FROM reader_state WHERE scope=?1 AND (path=?2 OR path LIKE ?3 ESCAPE '\\')",
            params![scope, path, like],
        )
    } else {
        transaction.execute(
            "DELETE FROM reader_state WHERE path=?1 OR path LIKE ?2 ESCAPE '\\'",
            params![path, like],
        )
    }
    .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn remove_exact(database: &state_db::AppDatabase, scope: &str, path: &str) -> AppResult<()> {
    let connection = connection(database)?;
    connection
        .execute(
            "DELETE FROM reader_state WHERE scope=?1 AND path=?2",
            params![scope, path],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn remove_exact_all_in_transaction(transaction: &Transaction<'_>, path: &str) -> AppResult<()> {
    remove_exact_all_with_connection(transaction, path)
}

fn remove_exact_all_with_connection(connection: &Connection, path: &str) -> AppResult<()> {
    connection
        .execute("DELETE FROM reader_state WHERE path=?1", params![path])
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn move_prefix_in_transaction(
    transaction: &Transaction<'_>,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
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
    Ok(())
}

pub fn preferences(database: &state_db::AppDatabase, scope: &str) -> AppResult<(Value, i64)> {
    let connection = connection(database)?;
    let row: Option<(String, i64)> = connection
        .query_row(
            "SELECT state_json, revision FROM app_preferences WHERE scope=?1",
            params![scope],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| AppError::internal(error.to_string()))?;
    match row {
        None => Ok((Value::Null, 0)),
        Some((raw, revision)) => serde_json::from_str(&raw)
            .map(|value| (value, revision))
            .map_err(|error| AppError::internal(format!("Invalid reader preferences: {error}"))),
    }
}

pub fn put_preferences(
    database: &state_db::AppDatabase,
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

    fn database() -> state_db::AppDatabase {
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
        state_db::AppDatabase::new(path)
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
        let _ = std::fs::remove_file(database.path());
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
        let _ = std::fs::remove_file(database.path());
    }

    #[test]
    fn malformed_reader_state_is_rejected() {
        let database = database();
        let connection = database.connection().unwrap();
        connection
            .execute(
                "INSERT INTO reader_state(scope,path,state_json,fingerprint,revision,updated_at) VALUES('admin','Books/bad','{bad','a',1,1)",
                [],
            )
            .unwrap();

        let result = get(&database, "admin", "Books/bad");

        assert!(result.is_err());
        let _ = std::fs::remove_file(database.path());
    }

    #[test]
    fn malformed_reader_preferences_are_rejected() {
        let database = database();
        let connection = database.connection().unwrap();
        connection
            .execute(
                "INSERT INTO app_preferences(scope,state_json,revision,updated_at) VALUES('admin','{bad',1,1)",
                [],
            )
            .unwrap();

        let result = preferences(&database, "admin");

        assert!(result.is_err());
        let _ = std::fs::remove_file(database.path());
    }
}
