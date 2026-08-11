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
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let keys = if let Some(scope) = scope {
        let mut statement = transaction
            .prepare("SELECT scope,path FROM reader_state WHERE scope=?1")
            .map_err(|error| AppError::internal(error.to_string()))?;
        statement
            .query_map(params![scope], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| AppError::internal(error.to_string()))?
            .collect::<Result<Vec<(String, String)>, _>>()
            .map_err(|error| AppError::internal(error.to_string()))?
    } else {
        let mut statement = transaction
            .prepare("SELECT scope,path FROM reader_state")
            .map_err(|error| AppError::internal(error.to_string()))?;
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| AppError::internal(error.to_string()))?
            .collect::<Result<Vec<(String, String)>, _>>()
            .map_err(|error| AppError::internal(error.to_string()))?
    };
    for (scope, stored_path) in keys {
        if matching_suffix(&stored_path, path).is_some() {
            transaction
                .execute(
                    "DELETE FROM reader_state WHERE scope=?1 AND path=?2",
                    params![scope, stored_path],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
        }
    }
    transaction
        .commit()
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
    if old_path == new_path {
        return Ok(());
    }
    if matching_suffix(new_path, old_path).is_some_and(|suffix| !suffix.is_empty())
        || matching_suffix(old_path, new_path).is_some_and(|suffix| !suffix.is_empty())
    {
        return Err(AppError::bad(
            "Cannot move a path onto its ancestor or descendant",
        ));
    }
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let rows = {
        let mut statement = transaction
            .prepare(
                "SELECT scope,path,state_json,fingerprint,revision,updated_at FROM reader_state",
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(|error| AppError::internal(error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| AppError::internal(error.to_string()))?
    };
    let mut moved = Vec::new();
    for (scope, stored_path, state_json, fingerprint, revision, updated_at) in rows {
        let Some(suffix) = matching_suffix(&stored_path, old_path) else {
            continue;
        };
        let destination = format!("{new_path}{suffix}");
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
                    destination,
                    state_json,
                    fingerprint,
                    revision,
                    updated_at
                ],
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        moved.push((scope, stored_path, destination));
    }
    for (scope, source, destination) in &moved {
        let source_is_destination = moved
            .iter()
            .any(|(destination_scope, _, destination_path)| {
                destination_scope == scope && destination_path == source
            });
        if source != destination && !source_is_destination {
            transaction
                .execute(
                    "DELETE FROM reader_state WHERE scope=?1 AND path=?2",
                    params![scope, source],
                )
                .map_err(|error| AppError::internal(error.to_string()))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let base =
            std::env::temp_dir().join(format!("derp-reader-state-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let database = base.join("app.sqlite3");
        let connection = state_db::connection(&database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE reader_state (
                   scope TEXT NOT NULL,
                   path TEXT NOT NULL,
                   state_json TEXT NOT NULL,
                   fingerprint TEXT NOT NULL,
                   revision INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL,
                   PRIMARY KEY(scope,path)
                 );",
            )
            .unwrap();
        (base, database)
    }

    #[test]
    fn move_prefix_upserts_source_then_replay_preserves_destination() {
        let (base, database) = fixture("move-replay");
        put(
            &database,
            "owner",
            "Old/item.md",
            &serde_json::json!({"page":7}),
            "source",
            0,
            7,
        )
        .unwrap();
        put(
            &database,
            "owner",
            "New/item.md",
            &serde_json::json!({"page":99}),
            "destination",
            0,
            99,
        )
        .unwrap();
        put(
            &database,
            "share:one",
            "Old/child.md",
            &serde_json::json!({"page":3}),
            "child",
            0,
            3,
        )
        .unwrap();
        put(
            &database,
            "owner",
            "Oldish/item.md",
            &serde_json::json!({"page":2}),
            "unrelated",
            0,
            2,
        )
        .unwrap();

        move_prefix(&database, "Old", "New").unwrap();
        move_prefix(&database, "Old", "New").unwrap();

        assert!(get(&database, "owner", "Old/item.md").unwrap().is_none());
        assert!(
            get(&database, "share:one", "Old/child.md")
                .unwrap()
                .is_none()
        );
        let moved = get(&database, "owner", "New/item.md").unwrap().unwrap();
        assert_eq!(moved.value, serde_json::json!({"page":7}));
        assert_eq!(moved.fingerprint, "source");
        assert_eq!(
            get(&database, "share:one", "New/child.md")
                .unwrap()
                .unwrap()
                .value,
            serde_json::json!({"page":3})
        );
        assert_eq!(
            get(&database, "owner", "Oldish/item.md")
                .unwrap()
                .unwrap()
                .value,
            serde_json::json!({"page":2})
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn move_prefix_rejects_descendant_destination_without_mutating_rows() {
        let (base, database) = fixture("move-descendant");
        put(
            &database,
            "owner",
            "Old/item.md",
            &serde_json::json!({"page":7}),
            "source",
            0,
            7,
        )
        .unwrap();

        assert!(move_prefix(&database, "Old", "Old/child").is_err());
        assert!(move_prefix(&database, "Old/item.md", "Old").is_err());
        assert_eq!(
            get(&database, "owner", "Old/item.md")
                .unwrap()
                .unwrap()
                .value,
            serde_json::json!({"page":7})
        );
        assert!(
            get(&database, "owner", "Old/child/item.md")
                .unwrap()
                .is_none()
        );
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn casing_variant_move_and_remove_preserve_suffix_and_replay_safely() {
        let (base, database) = fixture("windows-casing");
        put(
            &database,
            "owner",
            "Parent/Sub/Child.MD",
            &serde_json::json!({"page":7}),
            "source",
            0,
            7,
        )
        .unwrap();
        put(
            &database,
            "owner",
            "Parentish/Sub/Child.MD",
            &serde_json::json!({"page":2}),
            "unrelated",
            0,
            2,
        )
        .unwrap();

        move_prefix(&database, "pArEnT", "parent").unwrap();
        move_prefix(&database, "pArEnT", "parent").unwrap();

        assert!(
            get(&database, "owner", "Parent/Sub/Child.MD")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            get(&database, "owner", "parent/Sub/Child.MD")
                .unwrap()
                .unwrap()
                .value,
            serde_json::json!({"page":7})
        );
        assert_eq!(
            get(&database, "owner", "Parentish/Sub/Child.MD")
                .unwrap()
                .unwrap()
                .value,
            serde_json::json!({"page":2})
        );
        assert!(move_prefix(&database, "PARENT", "parent/nested").is_err());

        remove_prefix(&database, None, "PaReNt").unwrap();
        assert!(
            get(&database, "owner", "parent/Sub/Child.MD")
                .unwrap()
                .is_none()
        );
        assert!(
            get(&database, "owner", "Parentish/Sub/Child.MD")
                .unwrap()
                .is_some()
        );
        fs::remove_dir_all(base).unwrap();
    }
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
    updated_at: u128,
) -> AppResult<i64> {
    let serialized =
        serde_json::to_string(value).map_err(|error| AppError::bad(error.to_string()))?;
    if serialized.len() > 32 * 1024 {
        return Err(AppError::bad("Reader preferences exceed 32 KB"));
    }
    let connection = connection(database)?;
    connection
        .execute(
            "INSERT INTO app_preferences(scope,state_json,revision,updated_at) VALUES(?1,?2,1,?3)
             ON CONFLICT(scope) DO UPDATE SET state_json=excluded.state_json,
               revision=app_preferences.revision+1, updated_at=excluded.updated_at",
            params![scope, serialized, updated_at as i64],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    let (_, revision) = preferences(database, scope)?;
    Ok(revision)
}
