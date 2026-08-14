#[cfg(test)]
use crate::integrations::hermes::config::HermesFilesystemMode;
use crate::integrations::hermes::config::{HermesConfig, RawHermesConfig, parse as hermes_config};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

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
    #[serde(default, deserialize_with = "deserialize_optional_path")]
    data_path: Option<PathBuf>,
    #[serde(default, deserialize_with = "deserialize_file_search")]
    file_search: Option<RawFileSearchConfig>,
    image_optimization: Option<serde_json::Value>,
    hermes: Option<RawHermesConfig>,
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
    pub data_path: PathBuf,
    pub file_search: FileSearchConfig,
    pub image_optimization: ImageOptimizationConfig,
    pub hermes: Option<HermesConfig>,
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
    if ["favorites", "most played"].contains(&name.to_lowercase().as_str()) {
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
                });
            }
        } else {
            let name = root_name(&primary, None).unwrap_or_else(|_| "Media".into());
            roots.push(MediaRoot {
                id: "config:primary".into(),
                name,
                path: primary.clone(),
                editable_folders: editable,
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
        fs::create_dir_all(&data_path).map_err(|error| {
            format!(
                "Failed to create app data directory {}: {error}",
                data_path.display()
            )
        })?;
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
        let hermes = hermes_config(raw.hermes)?;
        Ok(Self {
            port,
            roots,
            library_key,
            data_path,
            file_search,
            image_optimization,
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
        assert!(!config.auto_start);

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
}
