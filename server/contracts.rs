use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::Path};
use ts_rs::{Config, TS};

pub(crate) const API_CONFIG_PATH: &str = "/api/config";
pub(crate) const API_FILES_PATH: &str = "/api/files";
pub(crate) const API_FILES_CREATE_PATH: &str = "/api/files/create";
pub(crate) const API_FILES_EDIT_PATH: &str = "/api/files/edit";
pub(crate) const API_FILES_DELETE_PATH: &str = "/api/files/delete";
pub(crate) const API_FILES_RENAME_PATH: &str = "/api/files/rename";
pub(crate) const API_FILES_COPY_PATH: &str = "/api/files/copy";
pub(crate) const API_FILES_UPLOAD_PATH: &str = "/api/files/upload";
pub(crate) const API_FILES_DOWNLOAD_PATH: &str = "/api/files/download";
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

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MediaTypeDto {
    Video,
    Audio,
    Image,
    Text,
    Pdf,
    Book,
    Folder,
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileItemDto {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub media_type: MediaTypeDto,
    pub size: u64,
    pub extension: String,
    pub is_directory: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_virtual: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub view_count: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub thumbnail_generated: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub version: Option<f64>,
}

impl From<crate::media::FileItem> for FileItemDto {
    fn from(value: crate::media::FileItem) -> Self {
        Self {
            name: value.name,
            path: value.path,
            media_type: match value.media_type.as_str() {
                "video" => MediaTypeDto::Video,
                "audio" => MediaTypeDto::Audio,
                "image" => MediaTypeDto::Image,
                "text" => MediaTypeDto::Text,
                "pdf" => MediaTypeDto::Pdf,
                "book" => MediaTypeDto::Book,
                "folder" => MediaTypeDto::Folder,
                _ => MediaTypeDto::Other,
            },
            size: value.size,
            extension: value.extension,
            is_directory: value.is_directory,
            is_virtual: value.is_virtual,
            view_count: value.view_count,
            thumbnail_generated: value.thumbnail_generated,
            version: value.version,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VirtualCapabilityDto {
    Open,
    CreateFile,
    CreateFolder,
    Rename,
    Archive,
    Restore,
    DeletePermanently,
    DeleteProject,
    Download,
    CopyId,
    Branch,
    MoveToProject,
    AddProjectFolder,
    RemoveProjectFolder,
    SetPrimaryFolder,
    SetAppearance,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VirtualOpenTargetTypeDto {
    HermesSession,
    HermesDraft,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VirtualOpenTargetDto {
    #[serde(rename = "type")]
    pub target_type: VirtualOpenTargetTypeDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string | null")]
    pub project_path: Option<String>,
    pub read_only: bool,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum VirtualAppearanceToneDto {
    Violet,
    Indigo,
    Muted,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VirtualAppearanceDto {
    pub icon: String,
    pub tone: VirtualAppearanceToneDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VirtualEntryDto {
    pub provider: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub archived: Option<bool>,
    pub capabilities: Vec<VirtualCapabilityDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub open_target: Option<VirtualOpenTargetDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, unknown>")]
    pub metadata: Option<HashMap<String, Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub appearance: Option<VirtualAppearanceDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VirtualDirectoryDto {
    pub provider: String,
    pub kind: String,
    pub path: String,
    pub capabilities: Vec<VirtualCapabilityDto>,
    pub offset: usize,
    pub page_size: usize,
    pub total: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_offset: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileListResponse {
    pub files: Vec<FileItemDto>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub virtual_entries: HashMap<String, VirtualEntryDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub virtual_directory: Option<VirtualDirectoryDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoSaveSettingDto {
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub read_only: Option<bool>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceTaskbarPinSourceKindDto {
    Local,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTaskbarPinSourceDto {
    pub kind: WorkspaceTaskbarPinSourceKindDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string | null")]
    pub root_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTaskbarPinDto {
    pub id: String,
    pub path: String,
    pub is_directory: bool,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "string | null")]
    pub custom_icon_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_virtual: Option<bool>,
    pub source: WorkspaceTaskbarPinSourceDto,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum WorkspaceLayoutScopeDto {
    Admin,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceLayoutPresetDto {
    pub id: String,
    pub name: String,
    pub scope: WorkspaceLayoutScopeDto,
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

#[derive(Clone, Copy, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CreateFileKindDto {
    File,
    Folder,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateFileRequest {
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kind: Option<CreateFileKindDto>,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub base64_content: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditFileRequest {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub base64_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub expected_version: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub(crate) struct FilePathRequest {
    pub path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameFileRequest {
    pub old_path: String,
    pub new_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CopyFileRequest {
    pub source_path: String,
    pub destination_dir: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub(crate) struct FileMutationResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
pub(crate) struct UploadResponse {
    pub success: bool,
    pub uploaded: usize,
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

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsMutationResponse {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_favorite: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub is_knowledge_base: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub favorites: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub knowledge_bases: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub custom_icons: Option<HashMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub auto_save: Option<HashMap<String, AutoSaveSettingDto>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workspace_taskbar_pins: Option<Vec<WorkspaceTaskbarPinDto>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workspace_layout_presets: Option<Vec<WorkspaceLayoutPresetDto>>,
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
        MediaTypeDto,
        FileItemDto,
        VirtualCapabilityDto,
        VirtualOpenTargetTypeDto,
        VirtualOpenTargetDto,
        VirtualAppearanceToneDto,
        VirtualAppearanceDto,
        VirtualEntryDto,
        VirtualDirectoryDto,
        FileListResponse,
        AutoSaveSettingDto,
        WorkspaceTaskbarPinSourceKindDto,
        WorkspaceTaskbarPinSourceDto,
        WorkspaceTaskbarPinDto,
        WorkspaceLayoutScopeDto,
        WorkspaceLayoutPresetDto,
        ViewModeDto,
        SettingsDto,
        CreateFileKindDto,
        CreateFileRequest,
        EditFileRequest,
        FilePathRequest,
        RenameFileRequest,
        CopyFileRequest,
        FileMutationResponse,
        UploadResponse,
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
        "export const apiRoutes = {{ config: {}, files: {}, filesCreate: {}, filesEdit: {}, \
         filesDelete: {}, filesRename: {}, filesCopy: {}, filesUpload: {}, filesDownload: {}, settings: {}, \
         settingsViewMode: {}, settingsFavorite: {}, settingsKnowledgeBase: {}, settingsIcon: {}, \
         settingsIconRemove: {}, settingsAutoSave: {}, settingsTaskbarPins: {}, \
         settingsLayoutPresets: {}, events: {} }} as const\n",
        serde_json::to_string(API_CONFIG_PATH).unwrap(),
        serde_json::to_string(API_FILES_PATH).unwrap(),
        serde_json::to_string(API_FILES_CREATE_PATH).unwrap(),
        serde_json::to_string(API_FILES_EDIT_PATH).unwrap(),
        serde_json::to_string(API_FILES_DELETE_PATH).unwrap(),
        serde_json::to_string(API_FILES_RENAME_PATH).unwrap(),
        serde_json::to_string(API_FILES_COPY_PATH).unwrap(),
        serde_json::to_string(API_FILES_UPLOAD_PATH).unwrap(),
        serde_json::to_string(API_FILES_DOWNLOAD_PATH).unwrap(),
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
    ));
    output.push_str(&format!(
        "export const apiQueryRoots = {{ files: {}, settings: {}, serverConfig: {}, stats: {}, content: {}, audioMetadata: {} }} as const\n",
        serde_json::to_string(QUERY_FILES).unwrap(),
        serde_json::to_string(QUERY_SETTINGS).unwrap(),
        serde_json::to_string(QUERY_SERVER_CONFIG).unwrap(),
        serde_json::to_string(QUERY_STATS).unwrap(),
        serde_json::to_string(QUERY_CONTENT).unwrap(),
        serde_json::to_string(QUERY_AUDIO_METADATA).unwrap(),
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
            "FileListResponse",
            "ServerConfigDto",
            "SettingsDto",
        ] {
            assert!(output.contains(&format!("type {name} =")), "missing {name}");
        }
    }
}
