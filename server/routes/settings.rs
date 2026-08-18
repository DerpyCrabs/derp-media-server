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

fn complete_settings(mut value: Value) -> Value {
    let defaults = default_settings();
    if !value.is_object() {
        return defaults;
    }

    let Some(object) = value.as_object_mut() else {
        return defaults;
    };
    let Some(defaults) = defaults.as_object() else {
        return value;
    };

    object.remove("workspaceLayoutPresets");

    for (key, default) in defaults {
        object.entry(key.clone()).or_insert_with(|| default.clone());
    }

    for key in ["viewModes", "sortOrders", "customIcons", "autoSave"] {
        if !object[key].is_object() {
            object[key] = defaults[key].clone();
        }
    }
    for key in ["favorites", "knowledgeBases", "workspaceTaskbarPins"] {
        if !object[key].is_array() {
            object[key] = defaults[key].clone();
        }
    }

    if !object["fileColumns"].is_object() {
        object["fileColumns"] = defaults["fileColumns"].clone();
    } else if let Some(columns) = object["fileColumns"].as_object_mut() {
        for (key, default) in defaults["fileColumns"].as_object().into_iter().flatten() {
            if !columns.get(key).is_some_and(Value::is_boolean) {
                columns.insert(key.clone(), default.clone());
            }
        }
    }

    value
}

pub(crate) fn sanitized(state: &AppState) -> Value {
    let value = complete_settings(store::section(
        &settings_path(state),
        &state.config.library_key,
        default_settings(),
    ));
    let mut result = serde_json::Map::new();
    for key in [
        "viewModes",
        "sortOrders",
        "fileColumns",
        "favorites",
        "knowledgeBases",
        "customIcons",
        "autoSave",
        "workspaceTransition",
    ] {
        if let Some(field) = value.get(key) {
            result.insert(key.into(), field.clone());
        }
    }
    result.insert(
        "workspaceTaskbarPins".into(),
        workspace_persistence::admin_pins(&value["workspaceTaskbarPins"]),
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
        |value| {
            *value = complete_settings(value.take());
            update(value)
        },
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

async fn sort_order(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let path = body["path"]
        .as_str()
        .ok_or_else(|| AppError::bad("Folder path is required"))?;
    let field = body["field"]
        .as_str()
        .filter(|field| ["name", "createdDate", "size"].contains(field))
        .ok_or_else(|| AppError::bad("Invalid sort field"))?;
    let direction = body["direction"]
        .as_str()
        .filter(|direction| ["asc", "desc"].contains(direction))
        .ok_or_else(|| AppError::bad("Invalid sort direction"))?;
    let path = path.to_string();
    let order = json!({"field":field,"direction":direction});
    mutate(&state, |value| {
        if !value["sortOrders"].is_object() {
            value["sortOrders"] = json!({});
        }
        value["sortOrders"][path] = order;
        Ok(json!({"success":true}))
    })
    .await
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
    mutate(&state, |value| {
        value["fileColumns"] = json!({"createdDate":created_date,"size":size});
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
        "workspaceTransition" => {
            let transition = body["value"]
                .as_str()
                .filter(|value| ["instant", "fade"].contains(value))
                .ok_or_else(|| AppError::bad("Invalid workspace transition"))?;
            value["workspaceTransition"] = Value::String(transition.into());
            Ok(json!({"success":true,"workspaceTransition":transition}))
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
        .route("/api/settings/sortOrder", post(sort_order))
        .route("/api/settings/fileColumns", post(file_columns))
        .route("/api/settings/favorite", post(favorite))
        .route("/api/settings/knowledgeBase", post(knowledge_base))
        .route("/api/settings/{*kind}", post(generic))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_settings_fills_and_repairs_display_defaults() {
        let result = complete_settings(json!({
            "viewModes": {},
            "fileColumns": {"size": false},
        }));

        assert_eq!(result["sortOrders"], json!({}));
        assert_eq!(
            result["fileColumns"],
            json!({"createdDate": false, "size": false})
        );
        assert!(result["favorites"].is_array());
    }
}
