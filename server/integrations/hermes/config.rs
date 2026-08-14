use serde::Deserialize;
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RawHermesConfig {
    gateway_url: String,
    token: Option<String>,
    token_env: Option<String>,
    profile: Option<String>,
    filesystem_mode: Option<HermesFilesystemMode>,
    #[serde(default)]
    auto_start: bool,
    home: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum HermesFilesystemMode {
    Upload,
    Shared,
}

#[derive(Clone)]
pub(crate) struct HermesConfig {
    pub gateway_url: url::Url,
    pub token: Option<String>,
    pub profile: Option<String>,
    pub filesystem_mode: HermesFilesystemMode,
    pub auto_start: bool,
    pub home: Option<PathBuf>,
}

impl std::fmt::Debug for HermesConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HermesConfig")
            .field("gateway_url", &self.gateway_url)
            .field("token", &self.token.as_ref().map(|_| "[redacted]"))
            .field("profile", &self.profile)
            .field("filesystem_mode", &self.filesystem_mode)
            .field("auto_start", &self.auto_start)
            .field("home", &self.home)
            .finish()
    }
}

pub(crate) fn parse(raw: Option<RawHermesConfig>) -> Result<Option<HermesConfig>, String> {
    let Some(raw) = raw else { return Ok(None) };
    if raw.token.is_some() && raw.token_env.is_some() {
        return Err("hermes.token and hermes.tokenEnv cannot both be configured".into());
    }
    let mut gateway_url = url::Url::parse(raw.gateway_url.trim())
        .map_err(|_| "hermes.gatewayUrl must be a valid HTTP URL".to_string())?;
    if gateway_url.scheme() != "http" || gateway_url.host_str().is_none() {
        return Err("hermes.gatewayUrl must be a valid HTTP URL".into());
    }
    gateway_url.set_query(None);
    gateway_url.set_fragment(None);
    if !gateway_url.path().ends_with('/') {
        gateway_url.set_path(&format!("{}/", gateway_url.path()));
    }
    let token = match raw.token_env {
        Some(name) => Some(
            std::env::var(&name)
                .map_err(|_| format!("Hermes token environment variable {name} is not set"))?,
        ),
        None => raw.token,
    }
    .filter(|value| !value.is_empty());
    Ok(Some(HermesConfig {
        gateway_url,
        token,
        profile: raw.profile.filter(|value| !value.trim().is_empty()),
        filesystem_mode: raw.filesystem_mode.unwrap_or(HermesFilesystemMode::Upload),
        auto_start: raw.auto_start,
        home: raw.home,
    }))
}
