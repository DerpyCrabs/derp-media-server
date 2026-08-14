use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::Path};
use ts_rs::{Config, TS};

pub(crate) use crate::integrations::contracts::{
    IntegrationActionOutcomeDto, IntegrationActionRequestDto, IntegrationCapabilityDto,
    IntegrationDescriptorDto, IntegrationOpenTargetDto, IntegrationSearchFailureDto,
    IntegrationSearchResponseDto, IntegrationSearchResultDto, ResourceAppearanceDto,
    ResourceKeyDto, ResourcePageDto, ResourceSummaryDto,
};

pub(crate) const API_CONFIG_PATH: &str = "/api/config";
pub(crate) const API_SETTINGS_PATH: &str = "/api/settings";
pub(crate) const API_SETTINGS_VIEW_MODE_PATH: &str = "/api/settings/viewMode";
pub(crate) const API_SETTINGS_FAVORITE_PATH: &str = "/api/settings/favorite";
pub(crate) const API_SETTINGS_KNOWLEDGE_BASE_PATH: &str = "/api/settings/knowledgeBase";
pub(crate) const API_SETTINGS_ICON_PATH: &str = "/api/settings/icon";
pub(crate) const API_SETTINGS_ICON_REMOVE_PATH: &str = "/api/settings/icon/remove";
pub(crate) const API_SETTINGS_AUTO_SAVE_PATH: &str = "/api/settings/autoSave";
pub(crate) const API_SETTINGS_TASKBAR_PINS_PATH: &str = "/api/settings/workspaceTaskbarPins";
pub(crate) const API_SETTINGS_LAYOUT_PRESETS_PATH: &str = "/api/settings/workspaceLayoutPresets";
pub(crate) const API_EVENTS_PATH: &str = "/api/events/stream";

pub(crate) const QUERY_FILES: &str = "files";
pub(crate) const QUERY_SETTINGS: &str = "settings";
pub(crate) const QUERY_SERVER_CONFIG: &str = "server-config";
pub(crate) const QUERY_STATS: &str = "stats";
pub(crate) const QUERY_CONTENT: &str = "content";
pub(crate) const QUERY_AUDIO_METADATA: &str = "audio-metadata";
pub(crate) const QUERY_INTEGRATIONS: &str = "integrations";

#[derive(Clone, Copy, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ApiErrorCode {
    BadRequest,
    Forbidden,
    NotFound,
    Conflict,
    RangeNotSatisfiable,
    PayloadTooLarge,
    ServiceUnavailable,
    InternalServerError,
    NeedsReconciliation,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReconciliationDetails {
    pub operation: String,
    pub path: String,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiErrorBody {
    pub code: ApiErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub details: Option<ReconciliationDetails>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MediaRootDto {
    pub id: String,
    pub name: String,
    pub editable_folders: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ServerConfigDto {
    pub editable_folders: Vec<String>,
    pub media_roots: Vec<MediaRootDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoSaveSettingDto {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub read_only: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceTaskbarPinDto {
    pub id: String,
    pub resource: ResourceKeyDto,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string | null")]
    pub custom_icon_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkspaceLayoutPresetDto {
    pub id: String,
    pub name: String,
    #[ts(type = "PersistedWorkspaceState")]
    pub snapshot: Value,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub updated_at: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ViewModeDto {
    List,
    Grid,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsDto {
    pub view_modes: HashMap<String, ViewModeDto>,
    pub favorites: Vec<String>,
    pub knowledge_bases: Vec<String>,
    pub custom_icons: HashMap<String, String>,
    pub auto_save: HashMap<String, AutoSaveSettingDto>,
    pub workspace_taskbar_pins: Vec<WorkspaceTaskbarPinDto>,
    pub workspace_layout_presets: Vec<WorkspaceLayoutPresetDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewModeRequest {
    pub path: String,
    pub view_mode: ViewModeDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSettingRequest {
    pub file_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomIconRequest {
    pub path: String,
    pub icon_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub(crate) struct RemoveCustomIconRequest {
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoSaveRequest {
    pub file_path: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub read_only: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub(crate) struct WorkspaceTaskbarPinsRequest {
    pub items: Vec<WorkspaceTaskbarPinDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub(crate) struct WorkspaceLayoutPresetsRequest {
    pub presets: Vec<WorkspaceLayoutPresetDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsMutationResponse {
    pub success: bool,
}

#[derive(Clone, Debug, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum AppEvent {
    Connected {
        timestamp: u64,
    },
    FilesChanged {
        directory: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        path: Option<String>,
        timestamp: u64,
    },
    SettingsChanged {
        timestamp: u64,
    },
    PathRemoved {
        path: String,
        timestamp: u64,
    },
    PathMoved {
        old_path: String,
        new_path: String,
        timestamp: u64,
    },
}

fn declaration<T: TS>(config: &Config) -> String {
    format!("export {};\n", T::decl(config))
}

pub(crate) fn typescript() -> String {
    let config = Config::new().with_large_int("number");
    let mut output = String::from(
        "// Generated by `bun run contracts:generate`. Do not edit by hand.\n\n\
         import type { PersistedWorkspaceState } from '@/lib/use-workspace'\n\n",
    );
    macro_rules! push {
        ($($kind:ty),+ $(,)?) => {
            $(output.push_str(&declaration::<$kind>(&config));)+
        };
    }
    push!(
        ApiErrorCode,
        ReconciliationDetails,
        ApiErrorBody,
        MediaRootDto,
        ServerConfigDto,
        ResourceKeyDto,
        ResourceAppearanceDto,
        ResourceSummaryDto,
        ResourcePageDto,
        IntegrationCapabilityDto,
        IntegrationDescriptorDto,
        IntegrationActionRequestDto,
        IntegrationOpenTargetDto,
        IntegrationActionOutcomeDto,
        IntegrationSearchResultDto,
        IntegrationSearchFailureDto,
        IntegrationSearchResponseDto,
        AutoSaveSettingDto,
        WorkspaceTaskbarPinDto,
        WorkspaceLayoutPresetDto,
        ViewModeDto,
        SettingsDto,
        ViewModeRequest,
        FileSettingRequest,
        CustomIconRequest,
        RemoveCustomIconRequest,
        AutoSaveRequest,
        WorkspaceTaskbarPinsRequest,
        WorkspaceLayoutPresetsRequest,
        SettingsMutationResponse,
        AppEvent,
    );
    output.push_str(&format!(
        "export const apiRoutes = {{ config: {}, settings: {}, \
         settingsViewMode: {}, settingsFavorite: {}, settingsKnowledgeBase: {}, settingsIcon: {}, \
         settingsIconRemove: {}, settingsAutoSave: {}, settingsTaskbarPins: {}, \
        settingsLayoutPresets: {}, events: {}, integrations: {}, integrationSearch: {} }} as const\n",
        serde_json::to_string(API_CONFIG_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_VIEW_MODE_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_FAVORITE_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_KNOWLEDGE_BASE_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_ICON_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_ICON_REMOVE_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_AUTO_SAVE_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_TASKBAR_PINS_PATH).unwrap(),
        serde_json::to_string(API_SETTINGS_LAYOUT_PRESETS_PATH).unwrap(),
        serde_json::to_string(API_EVENTS_PATH).unwrap(),
        serde_json::to_string(crate::integrations::routes::API_INTEGRATIONS_PATH).unwrap(),
        serde_json::to_string(crate::integrations::routes::API_INTEGRATION_SEARCH_PATH).unwrap(),
    ));
    output.push_str(&format!(
        "export const apiQueryRoots = {{ files: {}, settings: {}, serverConfig: {}, stats: {}, content: {}, audioMetadata: {}, integrations: {} }} as const\n",
        serde_json::to_string(QUERY_FILES).unwrap(),
        serde_json::to_string(QUERY_SETTINGS).unwrap(),
        serde_json::to_string(QUERY_SERVER_CONFIG).unwrap(),
        serde_json::to_string(QUERY_STATS).unwrap(),
        serde_json::to_string(QUERY_CONTENT).unwrap(),
        serde_json::to_string(QUERY_AUDIO_METADATA).unwrap(),
        serde_json::to_string(QUERY_INTEGRATIONS).unwrap(),
    ));
    output
}

pub(crate) fn write_typescript(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, typescript())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_use_stable_tagged_shape() {
        let event = AppEvent::PathMoved {
            old_path: "old.md".into(),
            new_path: "new.md".into(),
            timestamp: 42,
        };
        assert_eq!(
            serde_json::to_value(event).unwrap(),
            serde_json::json!({
                "type": "path-moved",
                "oldPath": "old.md",
                "newPath": "new.md",
                "timestamp": 42,
            })
        );
    }

    #[test]
    fn generated_contracts_include_public_transport_types() {
        let output = typescript();
        for name in [
            "ApiErrorBody",
            "AppEvent",
            "ResourcePageDto",
            "ServerConfigDto",
            "SettingsDto",
        ] {
            assert!(output.contains(&format!("type {name} =")), "missing {name}");
        }
        assert!(output.contains("recentItems?: Array<ResourceSummaryDto>"));
    }
}
