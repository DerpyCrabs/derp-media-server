use crate::{
    app::{AppState, Shared, emit_admin, settings_path},
    config::{Config, TlsConfig},
    file_search::FileSearch,
    image_variants, routes, thumbnails,
};
use axum::{Router, extract::DefaultBodyLimit, middleware};
use std::sync::atomic::AtomicU64;
use std::{collections::HashMap, process::Stdio, sync::Arc};
use tokio::{
    fs,
    process::{Child, Command},
    sync::{Mutex, RwLock},
};
use tower_http::compression::CompressionLayer;

async fn rustls_config(tls: &TlsConfig) -> Result<axum_server::tls_rustls::RustlsConfig, String> {
    if let Some(path) = &tls.pfx_path {
        let data = fs::read(path)
            .await
            .map_err(|error| format!("Failed to read TLS PFX: {error}"))?;
        let bundle =
            p12::PFX::parse(&data).map_err(|error| format!("Invalid TLS PFX: {error:?}"))?;
        let password = tls.passphrase.as_deref().unwrap_or("");
        if !bundle.verify_mac(password) {
            return Err("Failed to decrypt TLS PFX".into());
        }
        let certificates = bundle
            .cert_x509_bags(password)
            .map_err(|error| format!("Failed to read TLS PFX certificates: {error:?}"))?;
        let key = bundle
            .key_bags(password)
            .map_err(|error| format!("Failed to read TLS PFX private key: {error:?}"))?
            .into_iter()
            .next()
            .ok_or_else(|| "TLS PFX has no private key".to_string())?;
        if certificates.is_empty() {
            return Err("TLS PFX has no certificate".into());
        }
        return axum_server::tls_rustls::RustlsConfig::from_der(certificates, key)
            .await
            .map_err(|error| error.to_string());
    }
    let certificate = tls
        .cert_path
        .as_ref()
        .ok_or_else(|| "TLS certPath is required".to_string())?;
    let key = tls
        .key_path
        .as_ref()
        .ok_or_else(|| "TLS keyPath is required".to_string())?;
    axum_server::tls_rustls::RustlsConfig::from_pem_file(certificate, key)
        .await
        .map_err(|error| error.to_string())
}

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

fn router(state: Shared) -> Router {
    Router::new()
        .merge(routes::auth::router())
        .merge(routes::canvases::router())
        .merge(routes::files::router())
        .merge(routes::hermes_chat::router())
        .merge(routes::settings::router())
        .merge(routes::mounts::router())
        .merge(routes::shares::router())
        .merge(routes::share_access::router())
        .merge(routes::share_media::router())
        .merge(routes::search::router())
        .merge(routes::share_search::router())
        .merge(routes::stats::router())
        .merge(routes::media::router())
        .merge(routes::sse::router())
        .fallback(crate::html::fallback)
        .layer(DefaultBodyLimit::max(1_048_576))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            routes::auth::middleware,
        ))
        .layer(CompressionLayer::new())
        .with_state(state)
}

fn watch_settings(state: &Shared) {
    let weak = Arc::downgrade(state);
    tokio::spawn(async move {
        let mut last_modified = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let Some(state) = weak.upgrade() else { break };
            let modified = fs::metadata(settings_path(&state))
                .await
                .ok()
                .and_then(|metadata| metadata.modified().ok());
            if last_modified.is_some() && modified.is_some() && modified != last_modified {
                emit_admin(&state, "settings-changed");
            }
            if modified.is_some() {
                last_modified = modified;
            }
        }
    });
}

pub(crate) async fn run() {
    let config = Config::load().unwrap_or_else(|error| panic!("Failed to load config: {error}"));
    let dev = std::env::var("NODE_ENV").unwrap_or_default() != "production"
        && !std::env::args().any(|argument| argument == "--production");
    let vite_port = vite_port(config.port);
    let mut vite = dev.then(|| start_vite(vite_port, config.port));
    if let Some(child) = vite.as_mut() {
        wait_for_vite(child, vite_port)
            .await
            .unwrap_or_else(|error| panic!("Failed to start Vite: {error}"));
    }
    let runtime_roots = routes::mounts::load(&config);
    let mut search_roots = config.roots.clone();
    search_roots.extend(runtime_roots.clone());
    let (events, _) = tokio::sync::broadcast::channel(256);
    let (admin_events, _) = tokio::sync::broadcast::channel(256);
    let (hermes_events, _) = tokio::sync::broadcast::channel(1024);
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
            hermes_events.clone(),
        )) as Arc<dyn crate::hermes::HermesTransport>
    });
    let state = Arc::new(AppState {
        config: config.clone(),
        runtime_roots: RwLock::new(runtime_roots),
        store_lock: Mutex::new(()),
        dev,
        vite_port,
        client,
        events,
        admin_events,
        hermes_events,
        image_grants: Mutex::new(HashMap::new()),
        share_images: Mutex::new(HashMap::new()),
        image_operations: Mutex::new(()),
        preview_sequence: AtomicU64::new(0),
        login_attempts: Mutex::new(HashMap::new()),
        share_verify_attempts: Mutex::new(HashMap::new()),
        thumbnails: thumbnails::Thumbnailer::new(config.data_path.join("thumbnails")),
        image_variants: image_variants::ImageVariants::new(
            config.data_path.join("image-variants"),
            config.image_optimization.clone(),
        ),
        file_search: FileSearch::new(config.file_search.clone(), search_roots),
        hermes,
        hermes_project_operations: Mutex::new(()),
        hermes_runtime_ids: Mutex::new(HashMap::new()),
    });
    watch_settings(&state);
    let address = format!("0.0.0.0:{}", config.port);
    if let Some(tls) = &config.tls {
        let tls = rustls_config(tls)
            .await
            .unwrap_or_else(|error| panic!("Failed to configure TLS: {error}"));
        println!(
            "Media server listening on https://localhost:{}",
            config.port
        );
        println!(
            "Workspace available at https://localhost:{}/workspace",
            config.port
        );
        axum_server::bind_rustls(address.parse::<std::net::SocketAddr>().unwrap(), tls)
            .serve(router(state).into_make_service())
            .await
            .unwrap();
    } else {
        let listener = tokio::net::TcpListener::bind(&address).await.unwrap();
        println!("Media server listening on http://localhost:{}", config.port);
        println!(
            "Workspace available at http://localhost:{}/workspace",
            config.port
        );
        axum::serve(listener, router(state))
            .with_graceful_shutdown(async {
                let _ = tokio::signal::ctrl_c().await;
            })
            .await
            .unwrap();
    }
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
