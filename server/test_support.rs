use crate::{
    app::AppState,
    config::{Config, FileSearchConfig, MediaRoot, WriteAccess},
    state_db,
};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::Mutex;

pub struct TestApp {
    pub state: Arc<AppState>,
    pub directory: PathBuf,
    pub media: PathBuf,
}

impl TestApp {
    pub fn new() -> Self {
        let directory = std::env::temp_dir().join(format!("derp-test-{}", uuid::Uuid::new_v4()));
        let media = directory.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let config = Config {
            port: 0,
            write_access: WriteAccess::Filesystem,
            roots: vec![MediaRoot {
                id: "media".into(),
                name: "Media".into(),
                path: media.clone(),
                editable_folders: vec![],
            }],
            library_key: "test".into(),
            data_path: directory.join("data"),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: directory.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: Default::default(),
            playback: Default::default(),
            hermes: None,
            media_ai: Default::default(),
            music: Default::default(),
        };
        state_db::initialize(&config).unwrap();
        let database = state_db::AppDatabase::from_config(&config);
        let state = Arc::new(AppState {
            media_ai: crate::media_ai::Runtime::new(),
            dev: false,
            vite_port: 0,
            client: reqwest::Client::new(),
            events: tokio::sync::broadcast::channel(16).0,
            admin_events: tokio::sync::broadcast::channel(16).0,
            hermes_events: tokio::sync::broadcast::channel(16).0,
            database: database.clone(),
            settings: crate::settings_persistence::SettingsRepository::from_config(&config),
            stats: crate::stats_persistence::StatsRepository::from_config(&config),
            workspaces: crate::workspace_persistence::WorkspaceRepository::from_config(&config),
            reader_state_db: Mutex::new(()),
            thumbnails: crate::thumbnails::Thumbnailer::new(
                config.data_path.join("thumbnails"),
                database,
            ),
            image_variants: crate::image_variants::ImageVariants::new(
                config.data_path.join("images"),
                config.image_optimization.clone(),
            ),
            file_search: crate::file_search::FileSearch::new(
                config.file_search.clone(),
                config.roots.clone(),
            ),
            hermes: None,
            hermes_project_operations: Mutex::new(()),
            file_mutations: Mutex::new(()),
            playback: crate::video_playback::PlaybackRuntime::new(&config),
            hermes_runtime_ids: Mutex::new(HashMap::new()),
            hermes_active_ids: Mutex::new(HashSet::new()),
            config,
        });
        Self {
            state,
            directory,
            media,
        }
    }

    pub fn write(&self, name: &str, bytes: &[u8]) {
        let path = self.media.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }
}

impl Drop for TestApp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}
