use crate::{
    app::{AppState, Shared},
    config::Config,
    file_search::FileSearch,
    image_variants, routes, state_db, thumbnails,
};
use axum::{Router, extract::DefaultBodyLimit, routing::any};
use std::{
    collections::{HashMap, HashSet},
    process::Stdio,
    sync::Arc,
};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};
use tower_http::compression::CompressionLayer;

fn start_vite(port: u16, client_port: u16) -> Child {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("cmd");
        command.args(["/c", "bun"]);
        command
    } else {
        Command::new("bun")
    };
    command
        .args(["x", "vite", "--host", "0.0.0.0", "--port"])
        .arg(port.to_string())
        .arg("--strictPort")
        .env("VITE_HMR_PORT", port.to_string())
        .env("VITE_HMR_CLIENT_PORT", client_port.to_string())
        .kill_on_drop(true)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    command
        .spawn()
        .unwrap_or_else(|error| panic!("Failed to start Vite: {error}"))
}

async fn wait_for_vite(child: &mut Child, port: u16) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("Vite exited before becoming ready: {status}"));
        }
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Vite did not become ready within 30 seconds".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
}

fn vite_port(server_port: u16) -> u16 {
    let preferred = if server_port <= u16::MAX - 10_000 {
        server_port + 10_000
    } else {
        server_port - 10_000
    };
    if std::net::TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(preferred)
}

async fn api_not_found() -> crate::error::AppError {
    crate::error::AppError::not_found("API route not found")
}

pub(crate) fn build_router(state: Shared) -> Router {
    Router::new()
        .merge(routes::config::router())
        .merge(routes::canvases::router())
        .merge(routes::files::router())
        .merge(routes::hermes_chat::router())
        .merge(routes::settings::router())
        .merge(routes::search::router())
        .merge(routes::stats::router())
        .merge(routes::media::router())
        .merge(routes::reader_state::router())
        .merge(routes::sse::router())
        .route("/api", any(api_not_found))
        .route("/api/", any(api_not_found))
        .nest("/api", Router::new().fallback(api_not_found))
        .fallback(crate::html::fallback)
        .layer(DefaultBodyLimit::max(1_048_576))
        .layer(CompressionLayer::new())
        .with_state(state)
}

pub(crate) async fn run() {
    let config = Config::load().unwrap_or_else(|error| panic!("Failed to load config: {error}"));
    state_db::initialize(&config)
        .unwrap_or_else(|error| panic!("Failed to initialize app database: {error}"));
    let dev = std::env::var("NODE_ENV").unwrap_or_default() != "production"
        && !std::env::args().any(|argument| argument == "--production");
    let vite_port = vite_port(config.port);
    let mut vite = dev.then(|| start_vite(vite_port, config.port));
    if let Some(child) = vite.as_mut() {
        wait_for_vite(child, vite_port)
            .await
            .unwrap_or_else(|error| panic!("Failed to start Vite: {error}"));
    }
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
        config: config.clone(),
        file_commands: crate::file_commands::FileCommandService::new(config.clone()),
        dev,
        vite_port,
        client,
        events,
        admin_events,
        hermes_events,
        reader_state_db: Mutex::new(()),
        thumbnails: thumbnails::Thumbnailer::new(config.data_path.join("thumbnails")),
        image_variants: image_variants::ImageVariants::new(
            config.data_path.join("image-variants"),
            config.image_optimization.clone(),
        ),
        file_search: FileSearch::new(config.file_search.clone(), search_roots),
        hermes,
        hermes_project_operations: Mutex::new(()),
        hermes_runtime_ids: Mutex::new(HashMap::new()),
        hermes_active_ids: Mutex::new(HashSet::new()),
    });
    routes::hermes_chat::start_event_bridge(&state, hermes_transport_events.subscribe());
    let address = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&address).await.unwrap();
    println!("Media server listening on http://localhost:{}", config.port);
    println!(
        "Workspace available at http://localhost:{}/workspace",
        config.port
    );
    axum::serve(listener, build_router(state))
        .with_graceful_shutdown(async {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{FileSearchConfig, ImageOptimizationConfig, MediaRoot};
    use axum::{
        body::Body,
        http::{Request, StatusCode, header},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    fn test_state() -> (Shared, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("derp-build-router-{}", uuid::Uuid::new_v4()));
        let media = base.join("media");
        let data = base.join("data");
        std::fs::create_dir_all(&media).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        let config = Config {
            port: 3000,
            roots: vec![MediaRoot {
                id: "media".into(),
                name: "Media".into(),
                path: media,
                editable_folders: vec!["Editable".into()],
            }],
            library_key: "library".into(),
            data_path: data.clone(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            hermes: None,
        };
        state_db::initialize(&config).unwrap();
        let (events, _) = tokio::sync::broadcast::channel(8);
        let (admin_events, _) = tokio::sync::broadcast::channel(8);
        let (hermes_events, _) = tokio::sync::broadcast::channel(8);
        let state = Arc::new(AppState {
            config: config.clone(),
            file_commands: crate::file_commands::FileCommandService::new(config.clone()),
            dev: false,
            vite_port: 0,
            client: reqwest::Client::new(),
            events,
            admin_events,
            hermes_events,
            reader_state_db: Mutex::new(()),
            thumbnails: thumbnails::Thumbnailer::new(data.join("thumbnails")),
            image_variants: image_variants::ImageVariants::new(
                data.join("image-variants"),
                config.image_optimization.clone(),
            ),
            file_search: FileSearch::new(config.file_search.clone(), config.roots.clone()),
            hermes: None,
            hermes_project_operations: Mutex::new(()),
            hermes_runtime_ids: Mutex::new(HashMap::new()),
            hermes_active_ids: Mutex::new(HashSet::new()),
        });
        (state, base)
    }

    async fn assert_api_not_found(path: &str) {
        let (state, base) = test_state();
        let response = build_router(state.clone())
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"code":"notFound","message":"API route not found"})
        );
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn nested_api_fallback_never_serves_spa_html() {
        assert_api_not_found("/api").await;
        assert_api_not_found("/api/").await;
        assert_api_not_found("/api/files/unknown").await;
    }

    #[tokio::test]
    async fn upload_route_streams_then_finalizes_file() {
        let (state, base) = test_state();
        let boundary = "derp-router-upload-boundary";
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"targetDir\"\r\n\r\nEditable\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"note.txt\"\r\nContent-Type: text/plain\r\n\r\nstreamed body\r\n--{boundary}--\r\n"
        );
        let response = build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/files/upload")
                    .header(
                        header::CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            std::fs::read_to_string(base.join("media/Editable/note.txt")).unwrap(),
            "streamed body"
        );
        assert!(
            std::fs::read_dir(base.join("media/Editable"))
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| !entry.file_name().to_string_lossy().starts_with(".derp-"))
        );
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn late_multipart_validation_failure_does_not_commit_or_emit_earlier_files() {
        let (state, base) = test_state();
        let mut events = state.events.subscribe();
        let boundary = "derp-router-duplicate-upload-boundary";
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"targetDir\"\r\n\r\nEditable\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"note.txt\"\r\nContent-Type: text/plain\r\n\r\nfirst\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"note.txt\"\r\nContent-Type: text/plain\r\n\r\nsecond\r\n--{boundary}--\r\n"
        );

        let response = build_router(state.clone())
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/files/upload")
                    .header(
                        header::CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert!(!base.join("media/Editable/note.txt").exists());
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn multipart_batch_can_stage_more_files_than_the_concurrency_limit() {
        let (state, base) = test_state();
        let boundary = "derp-router-upload-batch-boundary";
        let mut body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"targetDir\"\r\n\r\nEditable\r\n"
        );
        for index in 0..=crate::file_commands::MAX_CONCURRENT_UPLOADS {
            body.push_str(&format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{index}.txt\"\r\nContent-Type: text/plain\r\n\r\n{index}\r\n"
            ));
        }
        body.push_str(&format!("--{boundary}--\r\n"));

        let response = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            build_router(state).oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/files/upload")
                    .header(
                        header::CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(body))
                    .unwrap(),
            ),
        )
        .await
        .expect("multipart staging deadlocked")
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        for index in 0..=crate::file_commands::MAX_CONCURRENT_UPLOADS {
            assert_eq!(
                std::fs::read_to_string(base.join(format!("media/Editable/{index}.txt"))).unwrap(),
                index.to_string()
            );
        }
        let _ = std::fs::remove_dir_all(base);
    }

    async fn assert_tagged_bad_request(request: Request<Body>) {
        let (state, base) = test_state();
        let response = build_router(state).oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value = serde_json::from_slice::<serde_json::Value>(&body).unwrap();
        assert_eq!(value["code"], "badRequest");
        assert!(
            value["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty())
        );
        let _ = std::fs::remove_dir_all(base);
    }

    async fn response_json(state: Shared, uri: &str) -> serde_json::Value {
        let response = build_router(state)
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
        let body = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&body).unwrap()
    }

    fn dehydrated_query_data(
        dehydrated: &serde_json::Value,
        key: serde_json::Value,
    ) -> serde_json::Value {
        dehydrated["queries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|query| query["queryKey"] == key)
            .unwrap_or_else(|| panic!("missing dehydrated query {key}"))["state"]["data"]
            .clone()
    }

    #[tokio::test]
    async fn http_and_ssr_bootstrap_share_query_data() {
        let (state, base) = test_state();
        std::fs::write(base.join("media/note.txt"), "same data").unwrap();
        let dehydrated = crate::html::dehydrated(&state, &"/".parse().unwrap()).await;

        for (uri, key) in [
            ("/api/config", serde_json::json!(["server-config"])),
            ("/api/settings", serde_json::json!(["settings"])),
            ("/api/files?dir=", serde_json::json!(["files", ""])),
            ("/api/stats/views", serde_json::json!(["stats"])),
        ] {
            assert_eq!(
                response_json(state.clone(), uri).await,
                dehydrated_query_data(&dehydrated, key),
                "SSR data drifted from {uri}"
            );
        }

        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn malformed_file_and_settings_json_use_tagged_errors() {
        for uri in ["/api/files/create", "/api/settings/viewMode"] {
            assert_tagged_bad_request(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{"))
                    .unwrap(),
            )
            .await;
        }
    }

    #[tokio::test]
    async fn malformed_file_query_uses_tagged_error() {
        assert_tagged_bad_request(
            Request::builder()
                .uri("/api/files?offset=not-a-number")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    }

    #[tokio::test]
    async fn malformed_upload_uses_tagged_error() {
        assert_tagged_bad_request(
            Request::builder()
                .method("POST")
                .uri("/api/files/upload")
                .header(header::CONTENT_TYPE, "multipart/form-data")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    }
}
