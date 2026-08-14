use crate::{
    app::{AppState, Shared, default_settings, emit_admin, settings_path},
    application_queries,
    contracts::{
        API_SETTINGS_AUTO_SAVE_PATH, API_SETTINGS_FAVORITE_PATH, API_SETTINGS_ICON_PATH,
        API_SETTINGS_ICON_REMOVE_PATH, API_SETTINGS_KNOWLEDGE_BASE_PATH,
        API_SETTINGS_LAYOUT_PRESETS_PATH, API_SETTINGS_PATH, API_SETTINGS_TASKBAR_PINS_PATH,
        API_SETTINGS_VIEW_MODE_PATH, AppEvent, AutoSaveRequest, CustomIconRequest,
        FileSettingRequest, RemoveCustomIconRequest, SettingsDto, SettingsMutationResponse,
        ViewModeRequest, WorkspaceLayoutPresetsRequest, WorkspaceTaskbarPinsRequest,
    },
    error::{AppError, AppResult},
    extractors::ApiJson,
    store, workspace_persistence,
};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

async fn get_settings(State(state): State<Shared>) -> AppResult<Json<SettingsDto>> {
    Ok(Json(application_queries::settings(&state)?))
}

fn typed<T: DeserializeOwned>(value: Value, field: &str) -> AppResult<T> {
    serde_json::from_value(value)
        .map_err(|error| AppError::internal(format!("Invalid {field} settings: {error}")))
}

fn success() -> SettingsMutationResponse {
    SettingsMutationResponse {
        success: true,
        ..Default::default()
    }
}

async fn mutate(
    state: &AppState,
    update: impl FnOnce(&mut Value) -> AppResult<SettingsMutationResponse>,
) -> AppResult<Json<SettingsMutationResponse>> {
    let result = store::mutate_section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
        update,
    )?;
    emit_admin(
        state,
        AppEvent::SettingsChanged {
            timestamp: crate::app::timestamp_ms(),
        },
    );
    Ok(Json(result))
}

async fn view_mode(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<ViewModeRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    mutate(&state, |value| {
        value["viewModes"][body.path] = json!(body.view_mode);
        Ok(success())
    })
    .await
}

async fn favorite(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<FileSettingRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    if body.file_path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    mutate(&state, |value| {
        if js_falsy(&value["favorites"]) {
            value["favorites"] = json!([]);
        }
        let items = value["favorites"]
            .as_array_mut()
            .ok_or_else(|| AppError::internal("Invalid favorites settings"))?;
        let index = items.iter().position(|item| item == &body.file_path);
        if let Some(index) = index {
            items.remove(index);
        } else {
            items.push(json!(body.file_path));
        }
        Ok(SettingsMutationResponse {
            success: true,
            is_favorite: Some(index.is_none()),
            favorites: Some(typed(Value::Array(items.clone()), "favorites")?),
            ..Default::default()
        })
    })
    .await
}

async fn knowledge_base(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<FileSettingRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    if body.file_path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    mutate(&state, |value| {
        if js_falsy(&value["knowledgeBases"]) {
            value["knowledgeBases"] = json!([]);
        }
        let items = value["knowledgeBases"]
            .as_array_mut()
            .ok_or_else(|| AppError::internal("Invalid knowledge base settings"))?;
        let index = items.iter().position(|item| item == &body.file_path);
        if let Some(index) = index {
            items.remove(index);
        } else {
            items.push(json!(body.file_path));
        }
        Ok(SettingsMutationResponse {
            success: true,
            is_knowledge_base: Some(index.is_none()),
            knowledge_bases: Some(typed(Value::Array(items.clone()), "knowledge base")?),
            ..Default::default()
        })
    })
    .await
}

async fn icon(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<CustomIconRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    if body.icon_name.is_empty() {
        return Err(AppError::bad("Valid icon name is required"));
    }
    mutate(&state, |value| {
        if js_falsy(&value["customIcons"]) {
            value["customIcons"] = json!({});
        }
        value["customIcons"][body.path] = json!(body.icon_name);
        Ok(SettingsMutationResponse {
            success: true,
            custom_icons: Some(typed(value["customIcons"].clone(), "custom icon")?),
            ..Default::default()
        })
    })
    .await
}

async fn remove_icon(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<RemoveCustomIconRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    mutate(&state, |value| {
        if js_falsy(&value["customIcons"]) {
            value["customIcons"] = json!({});
        }
        if let Some(items) = value["customIcons"].as_object_mut() {
            items.remove(&body.path);
        }
        Ok(SettingsMutationResponse {
            success: true,
            custom_icons: Some(typed(value["customIcons"].clone(), "custom icon")?),
            ..Default::default()
        })
    })
    .await
}

async fn auto_save(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<AutoSaveRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    if body.file_path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    mutate(&state, |value| {
        if js_falsy(&value["autoSave"]) {
            value["autoSave"] = json!({});
        }
        let mut setting = json!({"enabled": body.enabled});
        if let Some(read_only) = body.read_only {
            setting["readOnly"] = json!(read_only);
        }
        value["autoSave"][body.file_path] = setting;
        Ok(SettingsMutationResponse {
            success: true,
            auto_save: Some(typed(value["autoSave"].clone(), "auto-save")?),
            ..Default::default()
        })
    })
    .await
}

async fn taskbar_pins(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<WorkspaceTaskbarPinsRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    mutate(&state, |value| {
        let raw = serde_json::to_value(body.items)
            .map_err(|error| AppError::internal(error.to_string()))?;
        value["workspaceTaskbarPins"] = workspace_persistence::admin_pins(&raw);
        Ok(SettingsMutationResponse {
            success: true,
            workspace_taskbar_pins: Some(typed(
                value["workspaceTaskbarPins"].clone(),
                "workspace taskbar pin",
            )?),
            ..Default::default()
        })
    })
    .await
}

async fn layout_presets(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<WorkspaceLayoutPresetsRequest>,
) -> AppResult<Json<SettingsMutationResponse>> {
    mutate(&state, |value| {
        let raw = serde_json::to_value(body.presets)
            .map_err(|error| AppError::internal(error.to_string()))?;
        value["workspaceLayoutPresets"] = workspace_persistence::presets(&raw);
        Ok(SettingsMutationResponse {
            success: true,
            workspace_layout_presets: Some(typed(
                value["workspaceLayoutPresets"].clone(),
                "workspace layout preset",
            )?),
            ..Default::default()
        })
    })
    .await
}

fn js_falsy(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Bool(value) => !value,
        Value::Number(value) => value.as_f64() == Some(0.0),
        Value::String(value) => value.is_empty(),
        Value::Array(_) | Value::Object(_) => false,
    }
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route(API_SETTINGS_PATH, get(get_settings))
        .route(API_SETTINGS_VIEW_MODE_PATH, post(view_mode))
        .route(API_SETTINGS_FAVORITE_PATH, post(favorite))
        .route(API_SETTINGS_KNOWLEDGE_BASE_PATH, post(knowledge_base))
        .route(API_SETTINGS_ICON_PATH, post(icon))
        .route(API_SETTINGS_ICON_REMOVE_PATH, post(remove_icon))
        .route(API_SETTINGS_AUTO_SAVE_PATH, post(auto_save))
        .route(API_SETTINGS_TASKBAR_PINS_PATH, post(taskbar_pins))
        .route(API_SETTINGS_LAYOUT_PRESETS_PATH, post(layout_presets))
}
