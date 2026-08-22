use crate::{config::Config, error::AppResult, state_db};
use rusqlite::Transaction;
use serde::{Serialize, de::DeserializeOwned};
#[cfg(test)]
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

    pub(crate) fn read<Document>(&self, kind: &str, default: Document) -> AppResult<Document>
    where
        Document: Serialize + DeserializeOwned,
    {
        let default = serde_json::to_value(default)
            .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
        let value = self.database.document(kind, &self.library_key, default)?;
        serde_json::from_value(value)
            .map_err(|error| crate::error::AppError::internal(error.to_string()))
    }

    pub(crate) fn update<Document, Result>(
        &self,
        kind: &str,
        default: Document,
        update: impl FnOnce(&mut Document) -> AppResult<Result>,
    ) -> AppResult<Result>
    where
        Document: Serialize + DeserializeOwned,
    {
        let default = serde_json::to_value(default)
            .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
        self.database
            .update(kind, &self.library_key, default, |value| {
                let mut document = serde_json::from_value(value.take())
                    .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
                let result = update(&mut document)?;
                *value = serde_json::to_value(document)
                    .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
                Ok(result)
            })
    }

    pub(crate) fn update_in_transaction<Document, Result>(
        &self,
        transaction: &Transaction<'_>,
        kind: &str,
        default: Document,
        update: impl FnOnce(&mut Document) -> AppResult<Result>,
    ) -> AppResult<Result>
    where
        Document: Serialize + DeserializeOwned,
    {
        let default = serde_json::to_value(default)
            .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
        state_db::mutate_document_in_transaction(
            transaction,
            kind,
            &self.library_key,
            default,
            |value| {
                let mut document = serde_json::from_value(value.take())
                    .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
                let result = update(&mut document)?;
                *value = serde_json::to_value(document)
                    .map_err(|error| crate::error::AppError::internal(error.to_string()))?;
                Ok(result)
            },
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
