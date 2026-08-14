use crate::{
    app::{AppState, default_settings},
    contracts::{
        IntegrationDescriptorDto, MediaRootDto, QUERY_AUDIO_METADATA, QUERY_CONTENT,
        QUERY_INTEGRATIONS, QUERY_SERVER_CONFIG, QUERY_SETTINGS, QUERY_STATS, ServerConfigDto,
        SettingsDto, ViewModeDto,
    },
    error::{AppError, AppResult},
    media, store, workspace_persistence,
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

pub(crate) fn settings_query_key() -> Value {
    json!([QUERY_SETTINGS])
}

pub(crate) fn server_config_query_key() -> Value {
    json!([QUERY_SERVER_CONFIG])
}

pub(crate) fn stats_query_key() -> Value {
    json!([QUERY_STATS])
}

pub(crate) fn text_content_query_key(path: &str) -> Value {
    json!([QUERY_CONTENT, "application", "text", path])
}

pub(crate) fn audio_metadata_query_key(path: &str) -> Value {
    json!([QUERY_AUDIO_METADATA, "v2", path])
}

pub(crate) fn integrations_query_key() -> Value {
    json!([QUERY_INTEGRATIONS])
}

pub(crate) fn integrations(state: &AppState) -> Vec<IntegrationDescriptorDto> {
    state.integrations.descriptors()
}

pub(crate) fn server_config(state: &AppState) -> ServerConfigDto {
    let roots = &state.config.roots;
    let editable_folders = if roots.len() == 1 {
        roots[0].editable_folders.clone()
    } else {
        let mut values = roots[0].editable_folders.clone();
        values.extend(roots.iter().flat_map(|root| {
            root.editable_folders
                .iter()
                .map(move |folder| format!("{}/{}", root.name, folder.replace('\\', "/")))
        }));
        values
    };
    ServerConfigDto {
        editable_folders,
        media_roots: roots
            .iter()
            .map(|root| MediaRootDto {
                id: root.id.clone(),
                name: root.name.clone(),
                editable_folders: root.editable_folders.clone(),
            })
            .collect(),
    }
}

pub(crate) fn settings(state: &AppState) -> AppResult<SettingsDto> {
    let value = store::read(
        &state.config,
        store::StateDocument::SettingsV1,
        default_settings(),
    )?;
    let view_modes = value["viewModes"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(path, mode)| {
            let mode = match mode.as_str()? {
                "list" => ViewModeDto::List,
                "grid" => ViewModeDto::Grid,
                _ => return None,
            };
            Some((path.clone(), mode))
        })
        .collect();
    Ok(SettingsDto {
        view_modes,
        favorites: contract_value(
            value.get("favorites").cloned().unwrap_or_else(|| json!([])),
            "favorites settings",
        )?,
        knowledge_bases: contract_value(
            value
                .get("knowledgeBases")
                .cloned()
                .unwrap_or_else(|| json!([])),
            "knowledge base settings",
        )?,
        custom_icons: contract_value(
            value
                .get("customIcons")
                .cloned()
                .unwrap_or_else(|| json!({})),
            "custom icon settings",
        )?,
        auto_save: contract_value(
            value.get("autoSave").cloned().unwrap_or_else(|| json!({})),
            "auto-save settings",
        )?,
        workspace_taskbar_pins: contract_value(
            workspace_persistence::workspace_pins(&value["workspaceTaskbarPins"]),
            "workspace taskbar pin settings",
        )?,
        workspace_layout_presets: contract_value(
            workspace_persistence::presets(&value["workspaceLayoutPresets"]),
            "workspace layout preset settings",
        )?,
    })
}

pub(crate) fn stats(state: &AppState) -> AppResult<Value> {
    let value = store::read(
        &state.config,
        store::StateDocument::PlaybackStatsV1,
        json!({"views":{}}),
    )?;
    Ok(json!({"views": value["views"].as_object().cloned().unwrap_or_default()}))
}

pub(crate) fn text_content(state: &AppState, path: &str) -> AppResult<String> {
    let resolved = media::resolve(&state.config, path)?;
    std::fs::read_to_string(resolved.full).map_err(AppError::io)
}

fn contract_value<T: DeserializeOwned>(value: Value, name: &str) -> AppResult<T> {
    serde_json::from_value(value)
        .map_err(|error| AppError::internal(format!("Invalid {name} response: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_keys_match_client_contract() {
        assert_eq!(settings_query_key(), json!(["settings"]));
        assert_eq!(server_config_query_key(), json!(["server-config"]));
        assert_eq!(stats_query_key(), json!(["stats"]));
        assert_eq!(
            text_content_query_key("Notes/one.md"),
            json!(["content", "application", "text", "Notes/one.md"])
        );
        assert_eq!(
            audio_metadata_query_key("Music/one.mp3"),
            json!(["audio-metadata", "v2", "Music/one.mp3"])
        );
    }
}
