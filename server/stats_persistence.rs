use crate::{
    config::Config,
    error::{AppError, AppResult},
    logical_path,
    store::DocumentStore,
};
use rusqlite::Transaction;
use serde_json::{Map, Value, json};

const KIND: &str = "stats";

fn defaults() -> Value {
    json!({"views":{}})
}

fn views_mut(value: &mut Value) -> AppResult<&mut Map<String, Value>> {
    value["views"]
        .as_object_mut()
        .ok_or_else(|| AppError::internal("Invalid stats document"))
}

pub(crate) fn canonical_document(value: Value) -> AppResult<Value> {
    if value["views"].is_object() {
        Ok(value)
    } else {
        Err(AppError::internal("Invalid stats document"))
    }
}

#[derive(Clone, Debug)]
pub(crate) struct StatsRepository {
    store: DocumentStore,
}

impl StatsRepository {
    pub fn from_config(config: &Config) -> Self {
        Self {
            store: DocumentStore::from_config(config),
        }
    }

    #[cfg(test)]
    fn from_store(store: DocumentStore) -> Self {
        Self { store }
    }

    pub fn views(&self) -> AppResult<Value> {
        let value = self.store.read(KIND, defaults())?;
        value["views"]
            .as_object()
            .cloned()
            .map(Value::Object)
            .ok_or_else(|| AppError::internal("Invalid stats document"))
    }

    pub fn increment(&self, path: &str) -> AppResult<u64> {
        self.update(|views| {
            let count = views
                .get(path)
                .and_then(Value::as_u64)
                .unwrap_or(0)
                .checked_add(1)
                .ok_or_else(|| AppError::conflict("View count is exhausted"))?;
            views.insert(path.into(), json!(count));
            Ok(count)
        })
    }

    pub fn move_paths_in_transaction(
        &self,
        transaction: &Transaction<'_>,
        old_path: &str,
        new_path: &str,
    ) -> AppResult<()> {
        self.update_in_transaction(transaction, |views| {
            logical_path::move_map_keys(views, old_path, new_path);
            Ok(())
        })
    }

    pub fn remove_paths_in_transaction(
        &self,
        transaction: &Transaction<'_>,
        path: &str,
    ) -> AppResult<()> {
        self.update_in_transaction(transaction, |views| {
            views.retain(|candidate, _| !logical_path::matches(candidate, path));
            Ok(())
        })
    }

    fn update<T>(
        &self,
        update: impl FnOnce(&mut Map<String, Value>) -> AppResult<T>,
    ) -> AppResult<T> {
        self.store
            .update(KIND, defaults(), |value| update(views_mut(value)?))
    }

    fn update_in_transaction<T>(
        &self,
        transaction: &Transaction<'_>,
        update: impl FnOnce(&mut Map<String, Value>) -> AppResult<T>,
    ) -> AppResult<T> {
        self.store
            .update_in_transaction(transaction, KIND, defaults(), |value| {
                update(views_mut(value)?)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings_persistence::{SettingsCommand, SettingsRepository};

    fn repositories() -> (SettingsRepository, StatsRepository, std::path::PathBuf) {
        let database = std::env::temp_dir().join(format!(
            "derp-stats-repository-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let connection = crate::state_db::connection(&database).unwrap();
        connection
            .execute(
                "CREATE TABLE state_documents (kind TEXT NOT NULL, library_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind, library_key))",
                [],
            )
            .unwrap();
        drop(connection);
        (
            SettingsRepository::from_store(DocumentStore::new(&database, "library")),
            StatsRepository::from_store(DocumentStore::new(&database, "library")),
            database,
        )
    }

    fn insert_raw(database: &std::path::Path, value: &Value) {
        crate::state_db::connection(database)
            .unwrap()
            .execute(
                "INSERT OR REPLACE INTO state_documents(kind,library_key,value_json,updated_at)
                 VALUES('stats','library',?1,0)",
                [value.to_string()],
            )
            .unwrap();
    }

    #[test]
    fn stats_requires_a_views_object() {
        let (_, repository, database) = repositories();
        for malformed in [json!(null), json!({}), json!({"views":[]})] {
            insert_raw(&database, &malformed);
            assert!(repository.views().is_err());
            assert!(repository.increment("note.md").is_err());
        }
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn increment_rejects_overflow_without_changing_the_count() {
        let (_, repository, database) = repositories();
        insert_raw(&database, &json!({"views":{"note.md":u64::MAX}}));

        let result = repository.increment("note.md");

        assert!(result.is_err());
        assert_eq!(repository.views().unwrap()["note.md"], u64::MAX);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn increment_starts_a_missing_path_at_one() {
        let (_, repository, database) = repositories();

        let count = repository.increment("Documents/readme.md").unwrap();

        assert_eq!(count, 1);
        assert_eq!(repository.views().unwrap()["Documents/readme.md"], 1);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn settings_and_stats_path_rewrite_share_one_rollback_boundary() {
        let (settings, stats, database) = repositories();
        settings
            .execute(SettingsCommand::ToggleFavorite {
                path: "Books/Old/note.md".into(),
            })
            .unwrap();
        stats.increment("Books/Old/note.md").unwrap();
        let app_database = crate::state_db::AppDatabase::new(&database);

        let result: AppResult<()> = app_database.transaction(|transaction| {
            settings.move_paths_in_transaction(transaction, "Books/Old", "Books/New")?;
            stats.move_paths_in_transaction(transaction, "Books/Old", "Books/New")?;
            Err(AppError::internal("abort path transaction"))
        });

        assert!(result.is_err());
        assert_eq!(settings.favorites().unwrap(), vec!["Books/Old/note.md"]);
        assert_eq!(stats.views().unwrap()["Books/Old/note.md"], 1);
        assert!(stats.views().unwrap().get("Books/New/note.md").is_none());
        let _ = std::fs::remove_file(database);
    }
}
