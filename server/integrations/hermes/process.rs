use super::config::HermesConfig;
use std::{
    fs::OpenOptions,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    net::TcpStream,
    process::{Child, Command},
};

pub(crate) struct ManagedHermes {
    pub(crate) child: Option<Child>,
    pub(crate) token: Option<String>,
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn default_home() -> Option<PathBuf> {
    std::env::var_os("HERMES_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(|path| PathBuf::from(path).join("hermes")))
        .or_else(|| std::env::var_os("HOME").map(|path| PathBuf::from(path).join(".hermes")))
}

fn python_executable(home: &Path) -> PathBuf {
    let windows = home.join("hermes-agent/venv/Scripts/python.exe");
    if windows.is_file() {
        return windows;
    }
    let unix = home.join("hermes-agent/venv/bin/python");
    if unix.is_file() {
        return unix;
    }
    PathBuf::from("python")
}

async fn reachable(host: &str, port: u16) -> bool {
    tokio::time::timeout(Duration::from_millis(350), TcpStream::connect((host, port)))
        .await
        .is_ok_and(|result| result.is_ok())
}

fn generated_session_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn token_from_dashboard_html(html: &str) -> Option<String> {
    let marker = "window.__HERMES_SESSION_TOKEN__=\"";
    let value = html.split_once(marker)?.1.split_once('"')?.0;
    (!value.is_empty()).then(|| value.to_string())
}

async fn running_session_token(config: &HermesConfig) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Could not configure Hermes dashboard request: {error}"))?;
    let html = client
        .get(config.gateway_url.clone())
        .send()
        .await
        .map_err(|error| format!("Could not read running Hermes dashboard: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Could not read running Hermes dashboard: {error}"))?;
    token_from_dashboard_html(&html)
        .ok_or_else(|| "Running Hermes dashboard did not expose its local session token".into())
}

pub(crate) async fn start(config: Option<&HermesConfig>) -> Result<Option<ManagedHermes>, String> {
    let Some(config) = config.filter(|config| config.auto_start) else {
        return Ok(None);
    };
    let host = config
        .gateway_url
        .host_str()
        .ok_or_else(|| "Hermes gateway URL has no host".to_string())?;
    if !matches!(host, "127.0.0.1" | "localhost" | "::1") {
        return Err("Hermes autoStart requires a loopback gatewayUrl".into());
    }
    let port = config
        .gateway_url
        .port_or_known_default()
        .ok_or_else(|| "Hermes gateway URL has no port".to_string())?;
    if reachable(host, port).await {
        println!("Hermes backend already listening on {host}:{port}");
        let token = match &config.token {
            Some(_) => None,
            None => Some(running_session_token(config).await?),
        };
        return Ok(Some(ManagedHermes { child: None, token }));
    }

    let home = config
        .home
        .clone()
        .or_else(default_home)
        .ok_or_else(|| "Hermes autoStart could not resolve HERMES_HOME".to_string())?;
    let repository = home.join("hermes-agent");
    if !repository.is_dir() {
        return Err(format!(
            "Hermes installation was not found at {}",
            repository.display()
        ));
    }
    let python = python_executable(&home);
    let logs = home.join("logs");
    std::fs::create_dir_all(&logs).map_err(|error| error.to_string())?;
    let output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs.join("derp-backend.log"))
        .map_err(|error| error.to_string())?;
    let error_output = output.try_clone().map_err(|error| error.to_string())?;
    let session_token = config.token.clone().unwrap_or_else(generated_session_token);

    let mut command = Command::new(python);
    command
        .args(["-m", "hermes_cli.main", "serve", "--host", host, "--port"])
        .arg(port.to_string())
        .arg("--skip-build")
        .current_dir(&repository)
        .env("HERMES_HOME", &home)
        .env("VIRTUAL_ENV", repository.join("venv"))
        .env("PYTHONPATH", &repository)
        .env("HERMES_DASHBOARD_SESSION_TOKEN", &session_token)
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::from(output))
        .stderr(Stdio::from(error_output));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = CREATE_NO_WINDOW;

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start Hermes backend: {error}"))?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(45);
    loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!(
                "Hermes backend exited before becoming ready: {status}"
            ));
        }
        if reachable(host, port).await {
            println!("Managed Hermes backend listening on {host}:{port}");
            return Ok(Some(ManagedHermes {
                child: Some(child),
                token: config.token.is_none().then_some(session_token),
            }));
        }
        if tokio::time::Instant::now() >= deadline {
            let _ = child.kill().await;
            return Err("Hermes backend did not become ready within 45 seconds".into());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::token_from_dashboard_html;

    #[test]
    fn extracts_dashboard_session_token() {
        let html = r#"<script>window.__HERMES_SESSION_TOKEN__="local-only";</script>"#;
        assert_eq!(
            token_from_dashboard_html(html).as_deref(),
            Some("local-only")
        );
        assert_eq!(token_from_dashboard_html("<html></html>"), None);
    }
}
