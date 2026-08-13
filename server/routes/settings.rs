use crate::{
    app::{AppState, Shared, default_settings, emit_admin, settings_path},
    error::{AppError, AppResult},
    store, workspace_persistence,
};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde_json::{Value, json};

pub(crate) fn sanitized(state: &AppState) -> Value {
    let value = store::section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
    );
    let mut result = serde_json::Map::new();
    for key in [
        "viewModes",
        "favorites",
        "knowledgeBases",
        "customIcons",
        "autoSave",
    ] {
        if let Some(field) = value.get(key) {
            result.insert(key.into(), field.clone());
        }
    }
    result.insert(
        "workspaceTaskbarPins".into(),
        workspace_persistence::admin_pins(&value["workspaceTaskbarPins"]),
    );
    result.insert(
        "workspaceLayoutPresets".into(),
        workspace_persistence::presets(&value["workspaceLayoutPresets"]),
    );
    Value::Object(result)
}

async fn get_settings(State(state): State<Shared>) -> Json<Value> {
    Json(sanitized(&state))
}

async fn mutate(
    state: &AppState,
    update: impl FnOnce(&mut Value) -> AppResult<Value>,
) -> AppResult<Json<Value>> {
    let result = store::mutate_section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
        update,
    )?;
    emit_admin(state, "settings-changed");
    Ok(Json(result))
}

async fn view_mode(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    mutate(&state, |value| {
        value["viewModes"][body["path"].as_str().unwrap_or("")] = body["viewMode"].clone();
        Ok(json!({"success":true}))
    })
    .await
}

async fn favorite(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let path = body["filePath"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    mutate(&state, |value| {
        if js_falsy(&value["favorites"]) {
            value["favorites"] = json!([]);
        }
        let items = value["favorites"]
            .as_array_mut()
            .ok_or_else(|| AppError::internal("Invalid favorites settings"))?;
        let index = items.iter().position(|item| item == path);
        if let Some(index) = index {
            items.remove(index);
        } else {
            items.push(json!(path));
        }
        Ok(json!({"success":true,"isFavorite":index.is_none(),"favorites":items}))
    })
    .await
}

async fn knowledge_base(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let path = body["filePath"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    mutate(&state, |value| {
        if js_falsy(&value["knowledgeBases"]) {
            value["knowledgeBases"] = json!([]);
        }
        let items = value["knowledgeBases"]
            .as_array_mut()
            .ok_or_else(|| AppError::internal("Invalid knowledge base settings"))?;
        let index = items.iter().position(|item| item == path);
        if let Some(index) = index {
            items.remove(index);
        } else {
            items.push(json!(path));
        }
        Ok(json!({"success":true,"isKnowledgeBase":index.is_none(),"knowledgeBases":items}))
    })
    .await
}

async fn generic(
    State(state): State<Shared>,
    Path(kind): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    mutate(&state, |value| match kind.as_str() {
        "icon" => {
            let path = body["path"].as_str().unwrap_or("");
            let icon = body["iconName"].as_str().unwrap_or("");
            if icon.is_empty() {
                return Err(AppError::bad("Valid icon name is required"));
            }
            if js_falsy(&value["customIcons"]) {
                value["customIcons"] = json!({});
            }
            value["customIcons"][path] = json!(icon);
            Ok(json!({"success":true,"customIcons":value["customIcons"]}))
        }
        "icon/remove" => {
            if js_falsy(&value["customIcons"]) {
                value["customIcons"] = json!({});
            }
            if let (Some(items), Some(path)) =
                (value["customIcons"].as_object_mut(), body["path"].as_str())
            {
                items.remove(path);
            }
            Ok(json!({"success":true,"customIcons":value["customIcons"]}))
        }
        "autoSave" => {
            let path = body["filePath"].as_str().unwrap_or("");
            if path.is_empty() {
                return Err(AppError::bad("File path is required"));
            }
            if js_falsy(&value["autoSave"]) {
                value["autoSave"] = json!({});
            }
            let mut setting = json!({"enabled":body["enabled"]});
            if let Some(read_only) = body.get("readOnly") {
                setting["readOnly"] = read_only.clone();
            }
            value["autoSave"][path] = setting;
            Ok(json!({"success":true,"autoSave":value["autoSave"]}))
        }
        "workspaceTaskbarPins" => {
            value["workspaceTaskbarPins"] =
                workspace_persistence::admin_pins(body.get("items").unwrap_or(&Value::Null));
            Ok(json!({"success":true,"workspaceTaskbarPins":value["workspaceTaskbarPins"]}))
        }
        "workspaceLayoutPresets" => {
            value["workspaceLayoutPresets"] =
                workspace_persistence::presets(body.get("presets").unwrap_or(&Value::Null));
            Ok(json!({"success":true,"workspaceLayoutPresets":value["workspaceLayoutPresets"]}))
        }
        _ => Err(AppError::not_found("Not found")),
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
        .route("/api/settings", get(get_settings))
        .route("/api/settings/viewMode", post(view_mode))
        .route("/api/settings/favorite", post(favorite))
        .route("/api/settings/knowledgeBase", post(knowledge_base))
        .route("/api/settings/{*kind}", post(generic))
}
