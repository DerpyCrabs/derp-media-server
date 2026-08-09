use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    #[serde(default, deserialize_with = "deserialize_js_bool")]
    pub enabled: bool,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub password: Option<String>,
    #[serde(default, deserialize_with = "deserialize_domains")]
    pub admin_access_domains: Option<Vec<String>>,
    #[serde(default, deserialize_with = "deserialize_positive_seconds")]
    pub session_max_age_seconds: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_bool")]
    pub secure_cookies: Option<bool>,
}

fn deserialize_js_bool<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(match value {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(value)) => value,
        Some(serde_json::Value::Number(value)) => value.as_f64().is_some_and(|value| value != 0.0),
        Some(serde_json::Value::String(value)) => !value.is_empty(),
        Some(serde_json::Value::Array(_) | serde_json::Value::Object(_)) => true,
    })
}

fn deserialize_optional_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| value.as_str().map(str::to_string)))
}

fn deserialize_optional_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| value.as_bool()))
}

fn deserialize_domains<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| {
        value.as_array().map(|values| {
            values
                .iter()
                .cloned()
                .map(js_string)
                .map(|value| value.trim().to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .collect()
        })
    }))
}

fn deserialize_positive_seconds<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value
        .and_then(|value| value.as_f64())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.floor().min(u64::MAX as f64) as u64))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchConfig {
    pub enabled: bool,
    pub index_path: PathBuf,
    pub watch_mode: String,
    pub max_recursive_watchers: u32,
    pub max_fs_concurrency: u32,
    pub reconcile_directories_per_second: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TlsConfig {
    #[serde(default, deserialize_with = "deserialize_optional_path")]
    pub cert_path: Option<PathBuf>,
    #[serde(default, deserialize_with = "deserialize_optional_path")]
    pub key_path: Option<PathBuf>,
    #[serde(default, deserialize_with = "deserialize_optional_path")]
    pub pfx_path: Option<PathBuf>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    pub passphrase: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaDirConfig {
    pub path: PathBuf,
    pub name: Option<serde_json::Value>,
    #[serde(default)]
    pub editable_folders: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRoot {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default)]
    pub editable_folders: Vec<String>,
    #[serde(default)]
    pub read_only: bool,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u128>,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawConfig {
    port: Option<serde_json::Value>,
    media_dir: Option<PathBuf>,
    #[serde(default, deserialize_with = "deserialize_value_array")]
    editable_folders: Vec<serde_json::Value>,
    #[serde(default, deserialize_with = "deserialize_media_dirs")]
    media_dirs: Option<Vec<MediaDirConfig>>,
    #[serde(default, deserialize_with = "deserialize_optional_string")]
    share_link_domain: Option<String>,
    #[serde(default, deserialize_with = "deserialize_auth")]
    auth: Option<AuthConfig>,
    #[serde(default, deserialize_with = "deserialize_optional_path")]
    data_path: Option<PathBuf>,
    #[serde(default, deserialize_with = "deserialize_file_search")]
    file_search: Option<RawFileSearchConfig>,
    image_optimization: Option<serde_json::Value>,
    #[serde(default, deserialize_with = "deserialize_tls")]
    tls: Option<TlsConfig>,
    hermes: Option<RawHermesConfig>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawHermesConfig {
    gateway_url: String,
    token: Option<String>,
    token_env: Option<String>,
    profile: Option<String>,
    filesystem_mode: Option<HermesFilesystemMode>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HermesFilesystemMode {
    Upload,
    Shared,
}

#[derive(Clone)]
pub struct HermesConfig {
    pub gateway_url: url::Url,
    pub token: Option<String>,
    pub profile: Option<String>,
    #[allow(dead_code)]
    pub filesystem_mode: HermesFilesystemMode,
}

impl std::fmt::Debug for HermesConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("HermesConfig")
            .field("gateway_url", &self.gateway_url)
            .field("token", &self.token.as_ref().map(|_| "[redacted]"))
            .field("profile", &self.profile)
            .field("filesystem_mode", &self.filesystem_mode)
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct ImageOptimizationConfig {
    pub enabled: bool,
    pub widths: Vec<u32>,
    pub quality: u8,
    pub max_cache_size: u64,
}

impl Default for ImageOptimizationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            widths: vec![640, 1280, 1920, 2560, 3840],
            quality: 82,
            max_cache_size: 10 * 1024 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawFileSearchConfig {
    enabled: Option<serde_json::Value>,
    watch_mode: Option<serde_json::Value>,
    max_recursive_watchers: Option<serde_json::Value>,
    max_fs_concurrency: Option<serde_json::Value>,
    reconcile_directories_per_second: Option<serde_json::Value>,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub roots: Vec<MediaRoot>,
    pub library_key: String,
    pub share_link_domain: Option<String>,
    pub auth: AuthConfig,
    pub data_path: PathBuf,
    pub file_search: FileSearchConfig,
    pub image_optimization: ImageOptimizationConfig,
    pub tls: Option<TlsConfig>,
    pub hermes: Option<HermesConfig>,
}

fn hermes_config(raw: Option<RawHermesConfig>) -> Result<Option<HermesConfig>, String> {
    let Some(raw) = raw else { return Ok(None) };
    if raw.token.is_some() && raw.token_env.is_some() {
        return Err("hermes.token and hermes.tokenEnv cannot both be configured".into());
    }
    let mut gateway_url = url::Url::parse(raw.gateway_url.trim())
        .map_err(|_| "hermes.gatewayUrl must be a valid HTTP or HTTPS URL".to_string())?;
    if !matches!(gateway_url.scheme(), "http" | "https") || gateway_url.host_str().is_none() {
        return Err("hermes.gatewayUrl must be a valid HTTP or HTTPS URL".into());
    }
    gateway_url.set_query(None);
    gateway_url.set_fragment(None);
    if !gateway_url.path().ends_with('/') {
        gateway_url.set_path(&format!("{}/", gateway_url.path()));
    }
    let token = match raw.token_env {
        Some(name) => Some(
            env::var(&name)
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
    }))
}

fn parse_cache_size(value: &str) -> Result<u64, String> {
    let value = value.trim();
    let split = value
        .find(|character: char| !character.is_ascii_digit() && character != '.')
        .ok_or_else(|| "imageOptimization.maxCacheSize requires a size suffix".to_string())?;
    let number = value[..split]
        .parse::<f64>()
        .map_err(|_| "imageOptimization.maxCacheSize has an invalid number".to_string())?;
    if !number.is_finite() || number <= 0.0 {
        return Err("imageOptimization.maxCacheSize must be positive".into());
    }
    let suffix = value[split..].trim().to_ascii_lowercase();
    let multiplier = match suffix.as_str() {
        "kb" => 1_000_u64.pow(1),
        "mb" => 1_000_u64.pow(2),
        "gb" => 1_000_u64.pow(3),
        "kib" => 1_024_u64.pow(1),
        "mib" => 1_024_u64.pow(2),
        "gib" => 1_024_u64.pow(3),
        _ => {
            return Err(
                "imageOptimization.maxCacheSize suffix must be KB, MB, GB, KiB, MiB, or GiB".into(),
            );
        }
    };
    let bytes = number * multiplier as f64;
    if bytes > u64::MAX as f64 {
        return Err("imageOptimization.maxCacheSize is too large".into());
    }
    Ok(bytes.floor() as u64)
}

fn image_optimization(value: Option<serde_json::Value>) -> Result<ImageOptimizationConfig, String> {
    let mut config = ImageOptimizationConfig::default();
    let Some(value) = value else {
        return Ok(config);
    };
    let object = value
        .as_object()
        .ok_or_else(|| "imageOptimization must be an object".to_string())?;
    for key in object.keys() {
        if !matches!(
            key.as_str(),
            "enabled" | "widths" | "quality" | "maxCacheSize"
        ) {
            return Err(format!("Unknown imageOptimization option: {key}"));
        }
    }
    if let Some(value) = object.get("enabled") {
        config.enabled = value
            .as_bool()
            .ok_or_else(|| "imageOptimization.enabled must be a boolean".to_string())?;
    }
    if let Some(value) = object.get("widths") {
        let values = value
            .as_array()
            .ok_or_else(|| "imageOptimization.widths must be an array".to_string())?;
        if values.is_empty() {
            return Err("imageOptimization.widths must not be empty".into());
        }
        let mut widths = Vec::with_capacity(values.len());
        for value in values {
            let width = value.as_u64().ok_or_else(|| {
                "imageOptimization.widths must contain positive integers".to_string()
            })?;
            if !(1..=16_384).contains(&width) {
                return Err("imageOptimization.widths values must be between 1 and 16384".into());
            }
            widths.push(width as u32);
        }
        if !widths.windows(2).all(|pair| pair[0] < pair[1]) {
            return Err("imageOptimization.widths must be unique and strictly ascending".into());
        }
        config.widths = widths;
    }
    if let Some(value) = object.get("quality") {
        let quality = value
            .as_u64()
            .ok_or_else(|| "imageOptimization.quality must be an integer".to_string())?;
        if !(1..=100).contains(&quality) {
            return Err("imageOptimization.quality must be between 1 and 100".into());
        }
        config.quality = quality as u8;
    }
    if let Some(value) = object.get("maxCacheSize") {
        config.max_cache_size = parse_cache_size(value.as_str().ok_or_else(|| {
            "imageOptimization.maxCacheSize must be a human-readable string".to_string()
        })?)?;
    }
    Ok(config)
}

fn root_name(path: &Path, explicit: Option<serde_json::Value>) -> Result<String, String> {
    let name = explicit
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        });
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(format!("mediaDirs entry for {:?} requires a name", path));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(format!(
            "mediaDirs name \"{name}\" must not contain path separators"
        ));
    }
    if ["favorites", "most played", "shares"].contains(&name.to_lowercase().as_str()) {
        return Err(format!(
            "mediaDirs name \"{name}\" conflicts with a virtual folder"
        ));
    }
    Ok(name)
}

fn deserialize_optional_path<'de, D>(deserializer: D) -> Result<Option<PathBuf>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value
        .and_then(|value| value.as_str().map(str::trim).map(str::to_string))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from))
}

fn deserialize_auth<'de, D>(deserializer: D) -> Result<Option<AuthConfig>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        Some(serde_json::Value::Object(object)) => {
            serde_json::from_value(serde_json::Value::Object(object))
                .map(Some)
                .map_err(serde::de::Error::custom)
        }
        Some(serde_json::Value::Array(_)) => Ok(Some(AuthConfig::default())),
        _ => Ok(None),
    }
}

fn deserialize_tls<'de, D>(deserializer: D) -> Result<Option<TlsConfig>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        Some(serde_json::Value::Object(object)) => {
            serde_json::from_value(serde_json::Value::Object(object))
                .map(Some)
                .map_err(serde::de::Error::custom)
        }
        _ => Ok(None),
    }
}

fn deserialize_media_dirs<'de, D>(deserializer: D) -> Result<Option<Vec<MediaDirConfig>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    let Some(entries) = value.and_then(|value| value.as_array().cloned()) else {
        return Ok(None);
    };
    entries
        .into_iter()
        .map(|entry| {
            let object = entry.as_object().ok_or_else(|| {
                serde::de::Error::custom("Each mediaDirs entry must be an object with a path")
            })?;
            let path = object
                .get("path")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .ok_or_else(|| serde::de::Error::custom("Each mediaDirs entry requires a path"))?;
            let name = object
                .get("name")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(|name| serde_json::Value::String(name.to_string()));
            let editable_folders = object
                .get("editableFolders")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default();
            Ok(MediaDirConfig {
                path: PathBuf::from(path),
                name,
                editable_folders,
            })
        })
        .collect::<Result<Vec<_>, D::Error>>()
        .map(Some)
}

fn deserialize_value_array<'de, D>(deserializer: D) -> Result<Vec<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default())
}

fn deserialize_file_search<'de, D>(deserializer: D) -> Result<Option<RawFileSearchConfig>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    match value {
        Some(serde_json::Value::Object(object)) => {
            serde_json::from_value(serde_json::Value::Object(object))
                .map(Some)
                .map_err(serde::de::Error::custom)
        }
        Some(serde_json::Value::Array(_)) => Ok(Some(RawFileSearchConfig::default())),
        _ => Ok(None),
    }
}

fn js_string(value: serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => value,
        serde_json::Value::Null => "null".into(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::Array(values) => values
            .into_iter()
            .map(|value| match value {
                serde_json::Value::Null => String::new(),
                value => js_string(value),
            })
            .collect::<Vec<_>>()
            .join(","),
        serde_json::Value::Object(_) => "[object Object]".into(),
    }
}

fn editable_folders(values: Vec<serde_json::Value>) -> Vec<String> {
    values
        .into_iter()
        .map(js_string)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn normalize_share_domain(value: String) -> String {
    let trimmed = value.trim();
    let s = trimmed.strip_suffix('/').unwrap_or(trimmed);
    if s.starts_with("http://") || s.starts_with("https://") {
        s.into()
    } else {
        format!("https://{s}")
    }
}

fn clamped_integer(
    value: Option<&serde_json::Value>,
    fallback: u32,
    minimum: u32,
    maximum: u32,
) -> u32 {
    let Some(number) = value.and_then(serde_json::Value::as_f64) else {
        return fallback;
    };
    if !number.is_finite() || number.fract() != 0.0 {
        return fallback;
    }
    (number as i64).clamp(minimum as i64, maximum as i64) as u32
}

fn parse_js_positive_integer(value: &str) -> Option<u64> {
    let value = value.trim_start();
    let (negative, value) = match value.as_bytes().first() {
        Some(b'+') => (false, &value[1..]),
        Some(b'-') => (true, &value[1..]),
        _ => (false, value),
    };
    let digits = value
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    if negative {
        return None;
    }
    digits.parse::<u64>().ok().filter(|seconds| *seconds > 0)
}

const DURABLE_DATA: [&str; 4] = ["settings.json", "stats.json", "shares.json", "mounts.json"];
const REBUILDABLE_DATA: [(&str, &str); 3] = [
    (".search-index", "search-index"),
    (".thumbnails", "thumbnails"),
    (".image-variants", "image-variants"),
];

fn migrate_legacy_data(
    config_dir: &Path,
    working_dir: &Path,
    data_path: &Path,
) -> Result<(), String> {
    fs::create_dir_all(data_path).map_err(|error| {
        format!(
            "Failed to create app data directory {}: {error}",
            data_path.display()
        )
    })?;

    for name in DURABLE_DATA {
        let source = config_dir.join(name);
        let destination = data_path.join(name);
        if source.exists() && destination.exists() {
            return Err(format!(
                "Cannot migrate {}: both {} and {} exist",
                name,
                source.display(),
                destination.display()
            ));
        }
    }
    for name in DURABLE_DATA {
        let source = config_dir.join(name);
        if !source.exists() {
            continue;
        }
        let destination = data_path.join(name);
        fs::rename(&source, &destination).map_err(|error| {
            format!(
                "Failed to migrate {} to {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
        println!(
            "Migrated app data from {} to {}",
            source.display(),
            destination.display()
        );
    }

    for (legacy_name, destination_name) in REBUILDABLE_DATA {
        let source_dir = if legacy_name == ".search-index" {
            config_dir
        } else {
            working_dir
        };
        let source = source_dir.join(legacy_name);
        if !source.exists() {
            continue;
        }
        let destination = data_path.join(destination_name);
        if destination.exists() {
            eprintln!(
                "Warning: not migrating rebuildable data from {} because {} already exists",
                source.display(),
                destination.display()
            );
            continue;
        }
        match fs::rename(&source, &destination) {
            Ok(()) => println!(
                "Migrated app data from {} to {}",
                source.display(),
                destination.display()
            ),
            Err(error) => eprintln!(
                "Warning: failed to migrate rebuildable data from {} to {}: {error}",
                source.display(),
                destination.display()
            ),
        }
    }
    Ok(())
}

impl Config {
    pub fn load() -> Result<Self, String> {
        let cwd = env::current_dir().map_err(|e| e.to_string())?;
        let mut config_path = env::var("CONFIG_PATH")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                let args: Vec<_> = env::args().collect();
                args.windows(2)
                    .find(|x| x[0] == "--config-path")
                    .map(|x| PathBuf::from(&x[1]))
                    .or_else(|| {
                        args.iter()
                            .find_map(|x| x.strip_prefix("--config-path=").map(PathBuf::from))
                    })
                    .unwrap_or_else(|| cwd.join("config.jsonc"))
            });
        if config_path.is_relative() {
            config_path = cwd.join(config_path);
        }
        if !config_path.exists()
            && config_path.file_name().and_then(|x| x.to_str()) == Some("config.jsonc")
        {
            let fallback = config_path.with_file_name("config.json");
            if fallback.exists() {
                config_path = fallback;
            }
        }
        let raw: RawConfig = if config_path.exists() {
            json5::from_str(&fs::read_to_string(&config_path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Invalid config: {e}"))?
        } else {
            RawConfig::default()
        };
        let config_dir = config_path.parent().unwrap_or(&cwd);
        let mut port = raw
            .port
            .as_ref()
            .and_then(serde_json::Value::as_f64)
            .filter(|port| {
                port.is_finite() && port.fract() == 0.0 && *port > 0.0 && *port <= u16::MAX as f64
            })
            .map(|port| port as u16)
            .unwrap_or(3000);
        if let Ok(value) = env::var("PORT") {
            let value = value.trim();
            let parsed = value
                .strip_prefix("0x")
                .or_else(|| value.strip_prefix("0X"))
                .and_then(|value| u32::from_str_radix(value, 16).ok())
                .map(f64::from)
                .or_else(|| value.parse::<f64>().ok());
            if let Some(parsed) = parsed.filter(|value| {
                value.is_finite()
                    && value.fract() == 0.0
                    && *value > 0.0
                    && *value <= u16::MAX as f64
            }) {
                port = parsed as u16;
            }
        }
        let env_media = env::var("MEDIA_DIR")
            .ok()
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let primary = env_media
            .clone()
            .or(raw.media_dir.clone())
            .unwrap_or_else(|| cwd.clone());
        let editable = env::var("EDITABLE_FOLDERS")
            .ok()
            .filter(|value| !value.is_empty())
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect()
            })
            .unwrap_or_else(|| editable_folders(raw.editable_folders));
        let entries = if env_media.is_none() {
            raw.media_dirs
        } else {
            None
        };
        let mut roots = Vec::new();
        if let Some(entries) = entries.filter(|e| !e.is_empty()) {
            for entry in entries {
                let name = root_name(&entry.path, entry.name)?;
                roots.push(MediaRoot {
                    id: format!("config:{}", name.to_lowercase()),
                    name,
                    path: entry.path,
                    editable_folders: editable_folders(entry.editable_folders),
                    read_only: false,
                    source: "config".into(),
                    created_at: None,
                });
            }
        } else {
            let name = root_name(&primary, None).unwrap_or_else(|_| "Media".into());
            roots.push(MediaRoot {
                id: "config:primary".into(),
                name,
                path: primary.clone(),
                editable_folders: editable,
                read_only: false,
                source: "config".into(),
                created_at: None,
            });
        }
        let mut names = std::collections::HashSet::new();
        for root in &roots {
            if !names.insert(root.name.to_lowercase()) {
                return Err(format!(
                    "Duplicate mediaDirs name \"{}\". Add explicit unique names.",
                    root.name
                ));
            }
        }
        let library_key = if roots.len() == 1 {
            roots[0].path.to_string_lossy().into_owned()
        } else {
            roots
                .iter()
                .map(|r| {
                    format!(
                        "{}:{}",
                        r.name,
                        std::path::absolute(&r.path)
                            .unwrap_or(r.path.clone())
                            .display()
                    )
                })
                .collect::<Vec<_>>()
                .join("|")
        };
        for root in &mut roots {
            root.path = std::path::absolute(&root.path).map_err(|error| error.to_string())?;
        }
        let uses_default_data_path = raw.data_path.is_none();
        let data_path = raw
            .data_path
            .map(|p| {
                if p.is_absolute() {
                    p
                } else {
                    config_dir.join(p)
                }
            })
            .unwrap_or_else(|| config_dir.join("app-data"));
        if uses_default_data_path {
            migrate_legacy_data(config_dir, &cwd, &data_path)?;
        } else {
            fs::create_dir_all(&data_path).map_err(|error| {
                format!(
                    "Failed to create app data directory {}: {error}",
                    data_path.display()
                )
            })?;
        }
        let mut auth = raw.auth.unwrap_or_default();
        if let Ok(v) = env::var("AUTH_ENABLED") {
            auth.enabled = v == "true" || v == "1";
        }
        if let Ok(v) = env::var("AUTH_PASSWORD") {
            auth.password = if v.is_empty() { None } else { Some(v) };
        }
        if let Ok(v) = env::var("AUTH_ADMIN_ACCESS_DOMAINS")
            && !v.is_empty()
        {
            auth.admin_access_domains = Some(
                v.split(',')
                    .map(|domain| domain.trim().to_ascii_lowercase())
                    .filter(|domain| !domain.is_empty())
                    .collect(),
            );
        } else if let Some(domains) = &mut auth.admin_access_domains {
            *domains = domains
                .drain(..)
                .map(|domain| domain.trim().to_ascii_lowercase())
                .filter(|domain| !domain.is_empty())
                .collect();
        }
        if let Ok(v) = env::var("AUTH_SESSION_MAX_AGE")
            && let Some(seconds) = parse_js_positive_integer(&v)
        {
            auth.session_max_age_seconds = Some(seconds);
        }
        if let Ok(v) = env::var("AUTH_SECURE_COOKIES") {
            auth.secure_cookies = Some(v == "true" || v == "1");
        }
        let share_link_domain = env::var("SHARE_LINK_DOMAIN")
            .ok()
            .filter(|value| !value.is_empty())
            .or(raw.share_link_domain)
            .filter(|value| !value.trim().is_empty())
            .map(normalize_share_domain);
        let image_optimization = image_optimization(raw.image_optimization)?;
        let raw_search = raw.file_search.unwrap_or_default();
        let file_search = FileSearchConfig {
            enabled: raw_search
                .enabled
                .as_ref()
                .and_then(serde_json::Value::as_bool)
                != Some(false),
            index_path: data_path.join("search-index").join("files-v1.sqlite"),
            watch_mode: if raw_search
                .watch_mode
                .as_ref()
                .and_then(serde_json::Value::as_str)
                == Some("off")
            {
                "off".into()
            } else {
                "auto".into()
            },
            max_recursive_watchers: clamped_integer(
                raw_search.max_recursive_watchers.as_ref(),
                32,
                0,
                32,
            ),
            max_fs_concurrency: clamped_integer(raw_search.max_fs_concurrency.as_ref(), 4, 1, 16),
            reconcile_directories_per_second: clamped_integer(
                raw_search.reconcile_directories_per_second.as_ref(),
                128,
                1,
                4096,
            ),
        };
        let mut tls = raw.tls;
        if let Ok(path) = env::var("TLS_PFX_PATH")
            && !path.is_empty()
        {
            tls = Some(TlsConfig {
                pfx_path: Some(std::path::absolute(path).map_err(|error| error.to_string())?),
                passphrase: env::var("TLS_PFX_PASSPHRASE").ok(),
                ..Default::default()
            });
        } else {
            let cert = env::var("TLS_CERT_PATH")
                .ok()
                .filter(|value| !value.is_empty());
            let key = env::var("TLS_KEY_PATH")
                .ok()
                .filter(|value| !value.is_empty());
            if cert.is_some() != key.is_some() {
                return Err("TLS_CERT_PATH and TLS_KEY_PATH must be set together".into());
            }
            if let (Some(cert), Some(key)) = (cert, key) {
                tls = Some(TlsConfig {
                    cert_path: Some(std::path::absolute(cert).map_err(|error| error.to_string())?),
                    key_path: Some(std::path::absolute(key).map_err(|error| error.to_string())?),
                    ..Default::default()
                });
            }
        }
        if let Some(value) = &mut tls {
            for path in [
                &mut value.cert_path,
                &mut value.key_path,
                &mut value.pfx_path,
            ] {
                if let Some(current) = path.take() {
                    *path = Some(if current.is_absolute() {
                        current
                    } else {
                        config_dir.join(current)
                    });
                }
            }
            if value.pfx_path.is_some() && (value.cert_path.is_some() || value.key_path.is_some()) {
                return Err("TLS config must use either pfxPath or certPath/keyPath".into());
            }
            if value.cert_path.is_some() != value.key_path.is_some() {
                return Err("TLS certPath and keyPath must be configured together".into());
            }
        }
        if tls.as_ref().is_some_and(|value| {
            value.pfx_path.is_none() && value.cert_path.is_none() && value.key_path.is_none()
        }) {
            tls = None;
        }
        let hermes = hermes_config(raw.hermes)?;
        Ok(Self {
            port,
            roots,
            library_key,
            share_link_domain,
            auth,
            data_path,
            file_search,
            image_optimization,
            tls,
            hermes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hermes_config_validates_and_defaults() {
        let raw: RawConfig =
            json5::from_str(r#"{ hermes: { gatewayUrl: "http://127.0.0.1:4000" } }"#).unwrap();
        let config = hermes_config(raw.hermes).unwrap().unwrap();
        assert_eq!(config.gateway_url.as_str(), "http://127.0.0.1:4000/");
        assert_eq!(config.filesystem_mode, HermesFilesystemMode::Upload);

        let secret = HermesConfig {
            token: Some("never-print-this".into()),
            ..config.clone()
        };
        assert!(!format!("{secret:?}").contains("never-print-this"));

        let raw: RawConfig = json5::from_str(
            r#"{ hermes: { gatewayUrl: "http://localhost:4000", token: "a", tokenEnv: "B" } }"#,
        )
        .unwrap();
        assert!(hermes_config(raw.hermes).is_err());

        let raw: RawConfig = json5::from_str(
            r#"{ hermes: { gatewayUrl: "ftp://invalid", filesystemMode: "shared" } }"#,
        )
        .unwrap();
        assert!(hermes_config(raw.hermes).is_err());
    }

    #[test]
    fn auth_config_matches_javascript_coercion_and_sanitizing() {
        let raw: RawConfig = json5::from_str(
            r#"{ auth: { enabled: "yes", password: 42, adminAccessDomains: [" Example.COM ", 7], sessionMaxAgeSeconds: 12.9, secureCookies: "yes" } }"#,
        )
        .unwrap();
        let auth = raw.auth.unwrap();
        assert!(auth.enabled);
        assert_eq!(auth.password, None);
        assert_eq!(
            auth.admin_access_domains,
            Some(vec!["example.com".into(), "7".into()])
        );
        assert_eq!(auth.session_max_age_seconds, Some(12));
        assert_eq!(auth.secure_cookies, None);
    }

    #[test]
    fn empty_or_malformed_tls_does_not_require_certificates() {
        let empty: RawConfig = json5::from_str(r#"{ tls: {} }"#).unwrap();
        assert!(empty.tls.is_some_and(|tls| tls.cert_path.is_none()));
        let array: RawConfig = json5::from_str(r#"{ tls: [] }"#).unwrap();
        assert!(array.tls.is_none());
    }

    #[test]
    fn malformed_optional_collections_fall_back_like_javascript() {
        let raw: RawConfig =
            json5::from_str(r#"{ editableFolders: "not-an-array", fileSearch: "not-an-object" }"#)
                .unwrap();
        assert!(raw.editable_folders.is_empty());
        assert!(raw.file_search.is_none());

        let array: RawConfig = json5::from_str(r#"{ fileSearch: [] }"#).unwrap();
        assert!(array.file_search.is_some());
    }

    #[test]
    fn javascript_string_and_parse_int_edges_match() {
        assert_eq!(
            editable_folders(vec![serde_json::json!([null, "x"])]),
            vec![",x"]
        );
        assert_eq!(parse_js_positive_integer("  +12seconds"), Some(12));
        assert_eq!(parse_js_positive_integer("-12"), None);
        assert_eq!(parse_js_positive_integer("words"), None);
    }

    #[test]
    fn image_optimization_defaults_and_human_sizes() {
        let defaults = image_optimization(None).unwrap();
        assert!(defaults.enabled);
        assert_eq!(defaults.widths, vec![640, 1280, 1920, 2560, 3840]);
        assert_eq!(defaults.quality, 82);
        assert_eq!(defaults.max_cache_size, 10 * 1024 * 1024 * 1024);
        assert_eq!(parse_cache_size("10Gb").unwrap(), 10_000_000_000);
        assert_eq!(parse_cache_size("1.5GiB").unwrap(), 1_610_612_736);
        assert!(parse_cache_size("1000").is_err());
    }

    #[test]
    fn image_optimization_rejects_invalid_values() {
        assert!(image_optimization(Some(serde_json::json!({"widths":[640,640]}))).is_err());
        assert!(image_optimization(Some(serde_json::json!({"quality":0}))).is_err());
        assert!(image_optimization(Some(serde_json::json!({"maxCacheSize":"10TB"}))).is_err());
        assert!(image_optimization(Some(serde_json::json!({"maxBytes":"10GiB"}))).is_err());
    }

    #[test]
    fn migrates_legacy_app_data() {
        let base =
            std::env::temp_dir().join(format!("derp-data-migration-{}", uuid::Uuid::new_v4()));
        let config_dir = base.join("config");
        let working_dir = base.join("working");
        let data_path = config_dir.join("app-data");
        fs::create_dir_all(&config_dir).unwrap();
        fs::create_dir_all(&working_dir).unwrap();
        for name in DURABLE_DATA {
            fs::write(config_dir.join(name), name).unwrap();
        }
        fs::create_dir(config_dir.join(".search-index")).unwrap();
        fs::create_dir(working_dir.join(".thumbnails")).unwrap();
        fs::create_dir(working_dir.join(".image-variants")).unwrap();

        migrate_legacy_data(&config_dir, &working_dir, &data_path).unwrap();

        for name in DURABLE_DATA {
            assert!(!config_dir.join(name).exists());
            assert_eq!(fs::read_to_string(data_path.join(name)).unwrap(), name);
        }
        for name in ["search-index", "thumbnails", "image-variants"] {
            assert!(data_path.join(name).is_dir());
        }
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn durable_migration_conflict_stops_before_moving_files() {
        let base =
            std::env::temp_dir().join(format!("derp-data-conflict-{}", uuid::Uuid::new_v4()));
        let data_path = base.join("app-data");
        fs::create_dir_all(&data_path).unwrap();
        fs::write(base.join("settings.json"), "legacy").unwrap();
        fs::write(data_path.join("settings.json"), "current").unwrap();
        fs::write(base.join("stats.json"), "legacy stats").unwrap();

        let error = migrate_legacy_data(&base, &base, &data_path).unwrap_err();

        assert!(error.contains("both"));
        assert!(base.join("settings.json").exists());
        assert!(base.join("stats.json").exists());
        assert!(!data_path.join("stats.json").exists());
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rebuildable_migration_conflict_keeps_both_directories() {
        let base =
            std::env::temp_dir().join(format!("derp-cache-conflict-{}", uuid::Uuid::new_v4()));
        let data_path = base.join("app-data");
        fs::create_dir_all(base.join(".search-index")).unwrap();
        fs::create_dir_all(data_path.join("search-index")).unwrap();

        migrate_legacy_data(&base, &base, &data_path).unwrap();

        assert!(base.join(".search-index").is_dir());
        assert!(data_path.join("search-index").is_dir());
        fs::remove_dir_all(base).unwrap();
    }
}
