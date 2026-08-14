use serde::{Deserialize, Deserializer, Serialize};
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
pub(crate) const API_CANVASES_PATH: &str = "/api/canvases";
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
pub(crate) const CANVAS_DOCUMENT_SCHEMA_VERSION: u64 = 2;

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

struct RequiredNullableString(Option<String>);

impl<'de> Deserialize<'de> for RequiredNullableString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct RequiredNullableStringVisitor;

        impl<'de> serde::de::Visitor<'de> for RequiredNullableStringVisitor {
            type Value = RequiredNullableString;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a string or null")
            }

            fn visit_unit<E>(self) -> Result<Self::Value, E> {
                Ok(RequiredNullableString(None))
            }

            fn visit_none<E>(self) -> Result<Self::Value, E> {
                Ok(RequiredNullableString(None))
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Ok(RequiredNullableString(Some(value.into())))
            }

            fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
                Ok(RequiredNullableString(Some(value)))
            }
        }

        deserializer.deserialize_any(RequiredNullableStringVisitor)
    }
}

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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PersistedContentEnvelopeDto {
    #[ts(type = "1")]
    pub(crate) schema_version: u64,
    pub(crate) codec: String,
    pub(crate) codec_version: u64,
    #[ts(type = "unknown")]
    pub(crate) payload: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PersistedCanvasWindowDefinitionDto {
    pub(crate) id: String,
    pub(crate) title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string | null")]
    pub(crate) icon_name: Option<String>,
    pub(crate) content: PersistedContentEnvelopeDto,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CanvasRectDto {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PersistedCanvasWindowDto {
    pub(crate) id: String,
    pub(crate) definition: PersistedCanvasWindowDefinitionDto,
    pub(crate) bounds: CanvasRectDto,
    pub(crate) z_index: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CanvasCameraDto {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) zoom: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CanvasWindowSizeDto {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CanvasWindowSizeMapDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub(crate) browser: Option<CanvasWindowSizeDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub(crate) viewer: Option<CanvasWindowSizeDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub(crate) integration: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-audio",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub(crate) viewer_audio: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-video",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub(crate) viewer_video: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-image",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub(crate) viewer_image: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-text",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub(crate) viewer_text: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-pdf",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub(crate) viewer_pdf: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-other",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    #[ts(optional)]
    pub(crate) viewer_other: Option<CanvasWindowSizeDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanvasWindowSizeMapWire {
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    browser: Option<CanvasWindowSizeDto>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    viewer: Option<CanvasWindowSizeDto>,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    integration: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-audio",
        default,
        deserialize_with = "deserialize_optional_non_null"
    )]
    viewer_audio: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-video",
        default,
        deserialize_with = "deserialize_optional_non_null"
    )]
    viewer_video: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-image",
        default,
        deserialize_with = "deserialize_optional_non_null"
    )]
    viewer_image: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-text",
        default,
        deserialize_with = "deserialize_optional_non_null"
    )]
    viewer_text: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-pdf",
        default,
        deserialize_with = "deserialize_optional_non_null"
    )]
    viewer_pdf: Option<CanvasWindowSizeDto>,
    #[serde(
        rename = "viewer-other",
        default,
        deserialize_with = "deserialize_optional_non_null"
    )]
    viewer_other: Option<CanvasWindowSizeDto>,
}

impl<'de> Deserialize<'de> for CanvasWindowSizeMapDto {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = CanvasWindowSizeMapWire::deserialize(deserializer)?;
        Ok(Self {
            browser: wire.browser,
            viewer: wire.viewer,
            integration: wire.integration,
            viewer_audio: wire.viewer_audio,
            viewer_video: wire.viewer_video,
            viewer_image: wire.viewer_image,
            viewer_text: wire.viewer_text,
            viewer_pdf: wire.viewer_pdf,
            viewer_other: wire.viewer_other,
        })
    }
}

impl CanvasWindowSizeMapDto {
    pub(crate) fn values(&self) -> impl Iterator<Item = &CanvasWindowSizeDto> {
        [
            self.browser.as_ref(),
            self.viewer.as_ref(),
            self.integration.as_ref(),
            self.viewer_audio.as_ref(),
            self.viewer_video.as_ref(),
            self.viewer_image.as_ref(),
            self.viewer_text.as_ref(),
            self.viewer_pdf.as_ref(),
            self.viewer_other.as_ref(),
        ]
        .into_iter()
        .flatten()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PersistedCanvasStateDto {
    #[ts(type = "1")]
    pub(crate) version: u64,
    pub(crate) windows: Vec<PersistedCanvasWindowDto>,
    pub(crate) maximized_window_id: Option<String>,
    pub(crate) camera: CanvasCameraDto,
    pub(crate) window_size_by_type: CanvasWindowSizeMapDto,
    pub(crate) next_item_id: u64,
    pub(crate) next_z_index: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedCanvasStateWire {
    version: u64,
    windows: Vec<PersistedCanvasWindowDto>,
    maximized_window_id: RequiredNullableString,
    camera: CanvasCameraDto,
    window_size_by_type: CanvasWindowSizeMapDto,
    next_item_id: u64,
    next_z_index: u64,
}

impl<'de> Deserialize<'de> for PersistedCanvasStateDto {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = PersistedCanvasStateWire::deserialize(deserializer)?;
        Ok(Self {
            version: wire.version,
            windows: wire.windows,
            maximized_window_id: wire.maximized_window_id.0,
            camera: wire.camera,
            window_size_by_type: wire.window_size_by_type,
            next_item_id: wire.next_item_id,
            next_z_index: wire.next_z_index,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CanvasRecordDto {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) state: PersistedCanvasStateDto,
    pub(crate) updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CanvasDocumentDto {
    #[ts(type = "2")]
    pub(crate) schema_version: u64,
    pub(crate) revision: u64,
    pub(crate) active_id: Option<String>,
    pub(crate) canvases: Vec<CanvasRecordDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanvasDocumentWire {
    schema_version: u64,
    revision: u64,
    active_id: RequiredNullableString,
    canvases: Vec<CanvasRecordDto>,
}

impl<'de> Deserialize<'de> for CanvasDocumentDto {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = CanvasDocumentWire::deserialize(deserializer)?;
        Ok(Self {
            schema_version: wire.schema_version,
            revision: wire.revision,
            active_id: wire.active_id.0,
            canvases: wire.canvases,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveCanvasDocumentDto {
    #[ts(type = "2")]
    pub(crate) schema_version: u64,
    pub(crate) expected_revision: u64,
    pub(crate) active_id: Option<String>,
    pub(crate) canvases: Vec<CanvasRecordDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveCanvasDocumentWire {
    schema_version: u64,
    expected_revision: u64,
    active_id: RequiredNullableString,
    canvases: Vec<CanvasRecordDto>,
}

impl<'de> Deserialize<'de> for SaveCanvasDocumentDto {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let wire = SaveCanvasDocumentWire::deserialize(deserializer)?;
        Ok(Self {
            schema_version: wire.schema_version,
            expected_revision: wire.expected_revision,
            active_id: wire.active_id.0,
            canvases: wire.canvases,
        })
    }
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
        PersistedContentEnvelopeDto,
        PersistedCanvasWindowDefinitionDto,
        CanvasRectDto,
        PersistedCanvasWindowDto,
        CanvasCameraDto,
        CanvasWindowSizeDto,
        CanvasWindowSizeMapDto,
        PersistedCanvasStateDto,
        CanvasRecordDto,
        CanvasDocumentDto,
        SaveCanvasDocumentDto,
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
        "export const canvasDocumentSchemaVersion = {} as const\n\
         export const apiRoutes = {{ config: {}, canvases: {}, settings: {}, \
         settingsViewMode: {}, settingsFavorite: {}, settingsKnowledgeBase: {}, settingsIcon: {}, \
         settingsIconRemove: {}, settingsAutoSave: {}, settingsTaskbarPins: {}, \
        settingsLayoutPresets: {}, events: {}, integrations: {}, integrationSearch: {} }} as const\n",
        CANVAS_DOCUMENT_SCHEMA_VERSION,
        serde_json::to_string(API_CONFIG_PATH).unwrap(),
        serde_json::to_string(API_CANVASES_PATH).unwrap(),
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
            "PersistedContentEnvelopeDto",
            "PersistedCanvasWindowDefinitionDto",
            "CanvasRectDto",
            "PersistedCanvasWindowDto",
            "CanvasCameraDto",
            "CanvasWindowSizeDto",
            "CanvasWindowSizeMapDto",
            "PersistedCanvasStateDto",
            "CanvasRecordDto",
            "CanvasDocumentDto",
            "SaveCanvasDocumentDto",
        ] {
            assert!(output.contains(&format!("type {name} =")), "missing {name}");
        }
        assert!(output.contains("recentItems?: Array<ResourceSummaryDto>"));
        assert!(output.contains("canvasDocumentSchemaVersion = 2 as const"));
        assert!(output.contains("canvases: \"/api/canvases\""));
        assert!(!output.contains("InfiniteCanvasState"));
        assert!(output.contains("state: PersistedCanvasStateDto"));
        assert!(output.contains("maximizedWindowId: string | null"));
        assert!(output.contains("activeId: string | null"));
    }
}
