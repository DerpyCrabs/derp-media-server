use crate::{
    app::{AppState, Shared, emit_admin},
    error::{AppError, AppResult},
    settings_persistence::SettingsCommand,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde_json::Value;

pub(crate) fn sanitized(state: &AppState) -> AppResult<Value> {
    state.settings.admin_view()
}

fn execute(state: &AppState, command: SettingsCommand) -> AppResult<Json<Value>> {
    let result = state.settings.execute(command)?;
    emit_admin(state, "settings-changed");
    Ok(Json(result))
}

async fn get_settings(State(state): State<Shared>) -> AppResult<Json<Value>> {
    Ok(Json(sanitized(&state)?))
}

async fn view_mode(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        SettingsCommand::SetViewMode {
            path: body["path"].as_str().unwrap_or("").into(),
            view_mode: body["viewMode"]
                .as_str()
                .ok_or_else(|| AppError::bad("Invalid view mode"))?
                .into(),
        },
    )
}

async fn sort_order(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let path = body["path"]
        .as_str()
        .ok_or_else(|| AppError::bad("Folder path is required"))?;
    let field = body["field"]
        .as_str()
        .ok_or_else(|| AppError::bad("Invalid sort field"))?;
    let direction = body["direction"]
        .as_str()
        .ok_or_else(|| AppError::bad("Invalid sort direction"))?;
    execute(
        &state,
        SettingsCommand::SetSortOrder {
            path: path.into(),
            field: field.into(),
            direction: direction.into(),
        },
    )
}

async fn file_columns(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let created_date = body["createdDate"]
        .as_bool()
        .ok_or_else(|| AppError::bad("createdDate must be a boolean"))?;
    let size = body["size"]
        .as_bool()
        .ok_or_else(|| AppError::bad("size must be a boolean"))?;
    execute(
        &state,
        SettingsCommand::SetFileColumns { created_date, size },
    )
}

async fn favorite(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let path = body["filePath"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    execute(
        &state,
        SettingsCommand::ToggleFavorite { path: path.into() },
    )
}

async fn knowledge_base(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let path = body["filePath"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    execute(
        &state,
        SettingsCommand::ToggleKnowledgeBase { path: path.into() },
    )
}

async fn generic(
    State(state): State<Shared>,
    Path(kind): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let command = match kind.as_str() {
        "icon" => SettingsCommand::SetIcon {
            path: body["path"].as_str().unwrap_or("").into(),
            icon: body["iconName"].as_str().unwrap_or("").into(),
        },
        "icon/remove" => SettingsCommand::RemoveIcon {
            path: body["path"].as_str().map(str::to_owned),
        },
        "autoSave" => SettingsCommand::SetAutoSave {
            path: body["filePath"].as_str().unwrap_or("").into(),
            enabled: body["enabled"]
                .as_bool()
                .ok_or_else(|| AppError::bad("enabled must be a boolean"))?,
            read_only: body
                .get("readOnly")
                .map(|value| {
                    value
                        .as_bool()
                        .ok_or_else(|| AppError::bad("readOnly must be a boolean"))
                })
                .transpose()?,
        },
        "workspaceTaskbarPins/add" => SettingsCommand::UpsertTaskbarPin {
            candidate: body
                .get("pin")
                .cloned()
                .ok_or_else(|| AppError::bad("Taskbar pin is required"))?,
        },
        "workspaceTaskbarPins/remove" => SettingsCommand::RemoveTaskbarPin {
            id: body["id"]
                .as_str()
                .ok_or_else(|| AppError::bad("Taskbar pin id is required"))?
                .into(),
        },
        "workspaceTaskbarPins/reorder" => SettingsCommand::ReorderTaskbarPins {
            ids: body["ids"]
                .as_array()
                .ok_or_else(|| AppError::bad("Taskbar pin ids are required"))?
                .iter()
                .map(|id| {
                    id.as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| AppError::bad("Invalid taskbar pin id"))
                })
                .collect::<AppResult<Vec<_>>>()?,
        },
        "workspaceTransition" => SettingsCommand::SetWorkspaceTransition {
            transition: body["value"].as_str().unwrap_or("").into(),
        },
        _ => return Err(AppError::not_found("Not found")),
    };
    execute(&state, command)
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/settings", get(get_settings))
        .route("/api/settings/viewMode", post(view_mode))
        .route("/api/settings/sortOrder", post(sort_order))
        .route("/api/settings/fileColumns", post(file_columns))
        .route("/api/settings/favorite", post(favorite))
        .route("/api/settings/knowledgeBase", post(knowledge_base))
        .route("/api/settings/{*kind}", post(generic))
}
