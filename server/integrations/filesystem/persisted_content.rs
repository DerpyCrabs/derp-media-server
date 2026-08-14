use super::{DEFAULT_ROOT_ID, normalize_path};
use crate::{
    config::Config,
    error::{AppError, AppResult},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const CONTENT_CODEC: &str = "filesystem.content";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PathMutation {
    Unchanged,
    Changed,
    RemoveHost,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Address {
    root_id: String,
    path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Payload {
    Explorer {
        id: String,
        address: Address,
    },
    Resource {
        id: String,
        address: Address,
        renderer: String,
        #[serde(rename = "contextAddress")]
        #[serde(skip_serializing_if = "Option::is_none")]
        context_address: Option<Address>,
    },
}

fn corrupt() -> AppError {
    AppError::internal("Stored filesystem content is corrupt and was preserved")
}

fn exact_envelope(content: &Value) -> bool {
    content.as_object().is_some_and(|object| {
        object.len() == 4
            && ["schemaVersion", "codec", "codecVersion", "payload"]
                .iter()
                .all(|key| object.contains_key(*key))
    })
}

fn valid_text(value: &str) -> bool {
    !value.trim().is_empty() && !value.contains(['\0', '\n', '\r'])
}

fn valid_address(address: &Address) -> bool {
    valid_text(&address.root_id)
        && normalize_path(&address.path).is_ok_and(|normalized| normalized == address.path)
}

fn decode(content: &Value) -> AppResult<Option<Payload>> {
    if content.get("codec").and_then(Value::as_str) != Some(CONTENT_CODEC) {
        return Ok(None);
    }
    if !exact_envelope(content)
        || content.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || content.get("codecVersion").and_then(Value::as_u64) != Some(1)
    {
        return Err(corrupt());
    }
    let payload_value = content.get("payload").ok_or_else(corrupt)?;
    if payload_value
        .as_object()
        .is_some_and(|payload| payload.get("contextAddress").is_some_and(Value::is_null))
    {
        return Err(corrupt());
    }
    let payload: Payload = serde_json::from_value(payload_value.clone()).map_err(|_| corrupt())?;
    let valid = match &payload {
        Payload::Explorer { id, address } => valid_text(id) && valid_address(address),
        Payload::Resource {
            id,
            address,
            renderer,
            context_address,
        } => {
            valid_text(id)
                && valid_text(renderer)
                && valid_address(address)
                && context_address.as_ref().is_none_or(valid_address)
        }
    };
    if !valid {
        return Err(corrupt());
    }
    Ok(Some(payload))
}

fn logical_path(config: &Config, address: &Address) -> Option<String> {
    if address.root_id == DEFAULT_ROOT_ID || config.roots.len() == 1 {
        return Some(address.path.clone());
    }
    let root = config
        .roots
        .iter()
        .find(|root| root.id == address.root_id)?;
    Some(if address.path.is_empty() {
        root.name.clone()
    } else {
        format!("{}/{}", root.name, address.path)
    })
}

fn address_path(config: &Config, root_id: &str, logical_path: &str) -> Option<String> {
    if root_id == DEFAULT_ROOT_ID || config.roots.len() == 1 {
        return Some(logical_path.to_owned());
    }
    let root = config.roots.iter().find(|root| root.id == root_id)?;
    logical_path
        .strip_prefix(&format!("{}/", root.name))
        .or_else(|| (logical_path == root.name).then_some(""))
        .map(str::to_owned)
}

fn matches(path: &str, prefix: &str) -> bool {
    path == prefix || path.starts_with(&format!("{prefix}/"))
}

fn move_address(config: &Config, address: &mut Address, old: &str, new: &str) -> bool {
    let Some(logical) = logical_path(config, address) else {
        return false;
    };
    if !matches(&logical, old) {
        return false;
    }
    let moved = format!("{new}{}", &logical[old.len()..]);
    let Some(path) = address_path(config, &address.root_id, &moved) else {
        return false;
    };
    address.path = path;
    true
}

fn address_matches(config: &Config, address: &Address, path: &str) -> bool {
    logical_path(config, address).is_some_and(|logical| matches(&logical, path))
}

fn encode(content: &mut Value, payload: Payload) -> AppResult<()> {
    content["payload"] =
        serde_json::to_value(payload).map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub(crate) fn move_paths(
    config: &Config,
    content: &mut Value,
    old: &str,
    new: &str,
) -> AppResult<PathMutation> {
    let Some(mut payload) = decode(content)? else {
        return Ok(PathMutation::Unchanged);
    };
    let changed = match &mut payload {
        Payload::Explorer { address, .. } => move_address(config, address, old, new),
        Payload::Resource {
            address,
            context_address,
            ..
        } => {
            let primary = move_address(config, address, old, new);
            let context = context_address
                .as_mut()
                .is_some_and(|address| move_address(config, address, old, new));
            primary || context
        }
    };
    if !changed {
        return Ok(PathMutation::Unchanged);
    }
    encode(content, payload)?;
    Ok(PathMutation::Changed)
}

pub(crate) fn remove_paths(
    config: &Config,
    content: &mut Value,
    path: &str,
) -> AppResult<PathMutation> {
    let Some(mut payload) = decode(content)? else {
        return Ok(PathMutation::Unchanged);
    };
    match &mut payload {
        Payload::Explorer { address, .. } => {
            if address_matches(config, address, path) {
                return Ok(PathMutation::RemoveHost);
            }
        }
        Payload::Resource {
            address,
            context_address,
            ..
        } => {
            if address_matches(config, address, path) {
                return Ok(PathMutation::RemoveHost);
            }
            if context_address
                .as_ref()
                .is_some_and(|address| address_matches(config, address, path))
            {
                *context_address = None;
                encode(content, payload)?;
                return Ok(PathMutation::Changed);
            }
        }
    }
    Ok(PathMutation::Unchanged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{FileSearchConfig, ImageOptimizationConfig, MediaRoot};
    use serde_json::json;

    fn config() -> Config {
        Config {
            port: 3000,
            roots: vec![
                MediaRoot {
                    id: "media".into(),
                    name: "Media".into(),
                    path: std::env::temp_dir(),
                    editable_folders: Vec::new(),
                },
                MediaRoot {
                    id: "archive".into(),
                    name: "Archive".into(),
                    path: std::env::temp_dir(),
                    editable_folders: Vec::new(),
                },
            ],
            library_key: "library".into(),
            data_path: std::env::temp_dir(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: std::env::temp_dir().join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            hermes: None,
        }
    }

    fn resource_content() -> Value {
        json!({
            "schemaVersion":1,
            "codec":"filesystem.content",
            "codecVersion":1,
            "payload":{
                "kind":"resource",
                "id":"window-1",
                "address":{"rootId":"media","path":"Old/chapter.md"},
                "renderer":"text-viewer",
                "contextAddress":{"rootId":"media","path":"Old"}
            }
        })
    }

    #[test]
    fn moves_current_payload_addresses_in_multi_root_library() {
        let mut content = resource_content();

        let mutation = move_paths(&config(), &mut content, "Media/Old", "Media/New").unwrap();

        assert_eq!(mutation, PathMutation::Changed);
        assert_eq!(content["payload"]["address"]["path"], "New/chapter.md");
        assert_eq!(content["payload"]["contextAddress"]["path"], "New");
        assert!(content["payload"].get("context_address").is_none());
    }

    #[test]
    fn deletion_removes_primary_host_or_only_matching_context() {
        let mut primary = resource_content();
        assert_eq!(
            remove_paths(&config(), &mut primary, "Media/Old").unwrap(),
            PathMutation::RemoveHost
        );

        let mut context = resource_content();
        context["payload"]["address"]["path"] = json!("Keep/chapter.md");
        assert_eq!(
            remove_paths(&config(), &mut context, "Media/Old").unwrap(),
            PathMutation::Changed
        );
        assert!(context["payload"].get("contextAddress").is_none());
        assert_eq!(context["payload"]["address"]["path"], "Keep/chapter.md");
    }

    #[test]
    fn rejects_non_current_filesystem_payload_without_rewriting_it() {
        let mut content = resource_content();
        content["payload"]["extra"] = json!(true);
        let before = content.clone();

        let error = move_paths(&config(), &mut content, "Media/Old", "Media/New").unwrap_err();

        assert!(error.1.contains("corrupt and was preserved"));
        assert_eq!(content, before);

        let mut unsafe_path = resource_content();
        unsafe_path["payload"]["address"]["path"] = json!("../escape");
        assert!(move_paths(&config(), &mut unsafe_path, "Media/Old", "Media/New").is_err());

        let mut null_context = resource_content();
        null_context["payload"]["contextAddress"] = Value::Null;
        assert!(move_paths(&config(), &mut null_context, "Media/Old", "Media/New").is_err());
    }

    #[test]
    fn ignores_other_provider_envelopes() {
        let mut content = json!({
            "schemaVersion":1,
            "codec":"fixture.content",
            "codecVersion":1,
            "payload":{"path":"../provider-owned"}
        });
        let before = content.clone();

        assert_eq!(
            move_paths(&config(), &mut content, "Media/Old", "Media/New").unwrap(),
            PathMutation::Unchanged
        );
        assert_eq!(content, before);
    }
}
