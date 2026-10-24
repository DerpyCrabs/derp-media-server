use crate::{
    app::{AppState, Shared},
    config::Config,
    file_search::FileSearch,
    image_variants, routes, state_db, thumbnails,
};
use axum::{Router, extract::DefaultBodyLimit};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    process::Stdio,
    sync::Arc,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    sync::Mutex,
};
use tower_http::compression::CompressionLayer;

async fn start_vite(client_port: u16) -> Result<(Child, u16), String> {
    let mut child = Command::new("bun")
        .arg("tooling/dev-server.ts")
        .env("PORT", client_port.to_string())
        .env("VITE_HMR_CLIENT_PORT", client_port.to_string())
        .env_remove("VITE_HMR_PORT")
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Failed to start Vite: {error}"))?;
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let port = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
            if let Some(value) = line.strip_prefix("DERP_VITE_READY=") {
                return value.parse::<u16>().map_err(|error| error.to_string());
            }
            println!("{line}");
        }
        Err("Vite exited before becoming ready".to_string())
    })
    .await
    .map_err(|_| "Vite did not become ready within 30 seconds".to_string())??;
    tokio::spawn(async move {
        while let Ok(Some(line)) = lines.next_line().await {
            println!("{line}");
        }
    });
    Ok((child, port))
}

fn router(state: Shared) -> Router {
    Router::new()
        .merge(crate::activity::router())
        .merge(crate::media_ai::router())
        .merge(crate::music::router())
        .merge(routes::config::router())
        .merge(routes::desktop::router())
        .merge(routes::files::router())
        .merge(crate::file_jobs::router())
        .merge(routes::hermes_chat::router())
        .merge(routes::settings::router())
        .merge(routes::search::router())
        .merge(routes::stats::router())
        .merge(routes::workspaces::router())
        .merge(routes::media::router())
        .merge(crate::video_playback::router())
        .merge(routes::reader_state::router())
        .merge(routes::sse::router())
        .fallback(crate::html::fallback)
        .layer(DefaultBodyLimit::max(1_048_576))
        .layer(CompressionLayer::new())
        .with_state(state)
}

pub(crate) async fn run() {
    let mut config =
        Config::load().unwrap_or_else(|error| panic!("Failed to load config: {error}"));
    let address = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .unwrap_or_else(|error| panic!("Failed to bind HTTP server at {address}: {error}"));
    config.port = listener
        .local_addr()
        .expect("HTTP listener has no local address")
        .port();
    state_db::initialize(&config)
        .unwrap_or_else(|error| panic!("Failed to initialize app database: {error}"));
    let dev = std::env::var("NODE_ENV").unwrap_or_default() != "production"
        && !std::env::args().any(|argument| argument == "--production");
    let (mut vite, vite_port) = if dev {
        let (child, port) = start_vite(config.port)
            .await
            .unwrap_or_else(|error| panic!("{error}"));
        (Some(child), port)
    } else {
        (None, 0)
    };
    let search_roots = config.roots.clone();
    let (events, _) = tokio::sync::broadcast::channel(256);
    let (admin_events, _) = tokio::sync::broadcast::channel(256);
    let (hermes_events, _) = tokio::sync::broadcast::channel(1024);
    let (hermes_transport_events, _) = tokio::sync::broadcast::channel(1024);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();
    let mut managed_hermes = match crate::hermes_process::start(config.hermes.as_ref()).await {
        Ok(managed) => managed,
        Err(error) => {
            eprintln!("Failed to auto-start Hermes backend: {error}");
            None
        }
    };
    let mut hermes_config = config.hermes.clone();
    if let (Some(config), Some(token)) = (
        hermes_config.as_mut(),
        managed_hermes
            .as_ref()
            .and_then(|managed| managed.token.clone()),
    ) {
        config.token = Some(token);
    }
    let hermes: Option<Arc<dyn crate::hermes::HermesTransport>> = hermes_config.map(|value| {
        Arc::new(crate::hermes::HermesHub::new(
            value,
            client.clone(),
            hermes_transport_events.clone(),
        )) as Arc<dyn crate::hermes::HermesTransport>
    });
    let state = Arc::new(AppState {
        file_jobs: Default::default(),
        config: config.clone(),
        media_ai: crate::media_ai::Runtime::new(),
        dev,
        vite_port,
        client,
        events,
        admin_events,
        hermes_events,
        database: state_db::AppDatabase::from_config(&config),
        settings: crate::settings_persistence::SettingsRepository::from_config(&config),
        stats: crate::stats_persistence::StatsRepository::from_config(&config),
        workspaces: crate::workspace_persistence::WorkspaceRepository::from_config(&config),
        reader_state_db: Mutex::new(()),
        thumbnails: thumbnails::Thumbnailer::new(
            config.data_path.join("thumbnails"),
            state_db::AppDatabase::from_config(&config),
        ),
        image_variants: image_variants::ImageVariants::new(
            config.data_path.join("image-variants"),
            config.image_optimization.clone(),
        ),
        file_search: FileSearch::new(config.file_search.clone(), search_roots),
        hermes,
        hermes_project_operations: Mutex::new(()),
        file_mutations: Mutex::new(()),
        playback: crate::video_playback::PlaybackRuntime::new(&config),
        hermes_runtime_ids: Mutex::new(HashMap::new()),
        hermes_active_ids: Mutex::new(HashSet::new()),
    });
    crate::media_ai::start(&state);
    crate::music::start(&state);
    routes::hermes_chat::start_event_bridge(&state, hermes_transport_events.subscribe());
    println!("Media server listening on http://localhost:{}", config.port);
    println!(
        "Workspace available at http://localhost:{}/workspace",
        config.port
    );
    println!(
        "DERP_SERVER_READY={}",
        serde_json::json!({"port": config.port, "pid": std::process::id()})
    );
    std::io::stdout()
        .flush()
        .expect("Failed to flush server readiness");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut terminate =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("Failed to listen for SIGTERM");
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {},
                    _ = terminate.recv() => {},
                }
            }
            #[cfg(not(unix))]
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .unwrap();
    if let Some(child) = vite.as_mut() {
        let _ = child.kill().await;
    }
    if let Some(child) = managed_hermes
        .as_mut()
        .and_then(|managed| managed.child.as_mut())
    {
        let _ = child.kill().await;
    }
}
