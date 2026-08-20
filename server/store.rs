use crate::{config::Config, error::AppResult, state_db};
use rusqlite::Transaction;
use serde_json::Value;
#[cfg(test)]
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub(crate) struct DocumentStore {
    database: state_db::AppDatabase,
    library_key: String,
}

impl DocumentStore {
    #[cfg(test)]
    pub(crate) fn new(database: impl Into<PathBuf>, library_key: impl Into<String>) -> Self {
        Self {
            database: state_db::AppDatabase::new(database),
            library_key: library_key.into(),
        }
    }

    pub(crate) fn from_config(config: &Config) -> Self {
        Self {
            database: state_db::AppDatabase::from_config(config),
            library_key: config.library_key.clone(),
        }
    }

    pub(crate) fn read(&self, kind: &str, default: Value) -> AppResult<Value> {
        self.database.document(kind, &self.library_key, default)
    }

    pub(crate) fn update<T>(
        &self,
        kind: &str,
        default: Value,
        update: impl FnOnce(&mut Value) -> AppResult<T>,
    ) -> AppResult<T> {
        self.database
            .update(kind, &self.library_key, default, update)
    }

    pub(crate) fn update_in_transaction<T>(
        &self,
        transaction: &Transaction<'_>,
        kind: &str,
        default: Value,
        update: impl FnOnce(&mut Value) -> AppResult<T>,
    ) -> AppResult<T> {
        state_db::mutate_document_in_transaction(
            transaction,
            kind,
            &self.library_key,
            default,
            update,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_store_propagates_database_read_error() {
        let database = std::env::temp_dir().join(format!(
            "derp-store-invalid-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let connection = state_db::connection(&database).unwrap();
        connection
            .execute(
                "CREATE TABLE state_documents (kind TEXT NOT NULL, library_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind, library_key))",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO state_documents(kind, library_key, value_json, updated_at) VALUES('settings', 'library', '{bad', 0)",
                [],
            )
            .unwrap();
        drop(connection);

        let result = DocumentStore::new(&database, "library").read("settings", Value::Null);

        assert!(result.is_err());
        let _ = std::fs::remove_file(database);
    }
}
