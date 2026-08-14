use crate::{config::Config, error::AppResult, state_db};
use serde_json::Value;

pub use crate::state_db::StateDocument;

pub fn read(config: &Config, document: StateDocument, default: Value) -> AppResult<Value> {
    state_db::document(
        &state_db::database(config),
        document,
        &config.library_key,
        default,
    )
}

pub fn update<T>(
    config: &Config,
    document: StateDocument,
    default: Value,
    update: impl FnOnce(&mut Value) -> AppResult<T>,
) -> AppResult<T> {
    state_db::update_document(
        &state_db::database(config),
        document,
        &config.library_key,
        default,
        update,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{FileSearchConfig, ImageOptimizationConfig};
    use rusqlite::params;

    #[test]
    fn corrupt_current_document_returns_error_and_preserves_bytes() {
        let data_path = std::env::temp_dir().join(format!("derp-store-{}", uuid::Uuid::new_v4()));
        let config = Config {
            port: 3000,
            roots: vec![],
            library_key: "library".into(),
            data_path: data_path.clone(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data_path.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            hermes: None,
        };
        state_db::initialize(&config).unwrap();
        update(
            &config,
            StateDocument::SettingsV1,
            serde_json::json!({}),
            |_| Ok(()),
        )
        .unwrap();
        let corrupt = "{preserve current invalid bytes\n";
        state_db::connection(&state_db::database(&config))
            .unwrap()
            .execute(
                "UPDATE state_documents SET value_json=?1 WHERE kind=?2 AND library_key=?3",
                params![
                    corrupt,
                    StateDocument::SettingsV1.name(),
                    &config.library_key
                ],
            )
            .unwrap();

        let error = read(&config, StateDocument::SettingsV1, serde_json::json!({})).unwrap_err();
        assert_eq!(error.0, axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        assert!(
            update(
                &config,
                StateDocument::SettingsV1,
                serde_json::json!({}),
                |_| Ok(())
            )
            .is_err()
        );
        let stored: String = state_db::connection(&state_db::database(&config))
            .unwrap()
            .query_row(
                "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key=?2",
                params![StateDocument::SettingsV1.name(), &config.library_key],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, corrupt);
        std::fs::remove_dir_all(data_path).unwrap();
    }
}
