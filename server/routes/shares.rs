use crate::{
    app::{Shared, roots},
    error::{AppError, AppResult},
    media, shares,
};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, header},
    routing::{get, post},
};
use serde_json::{Value, json};

fn restrictions(value: Option<&Value>) -> Option<shares::Restrictions> {
    let value = value?.as_object()?;
    let parsed = shares::Restrictions {
        allow_delete: value.get("allowDelete").and_then(Value::as_bool),
        allow_upload: value.get("allowUpload").and_then(Value::as_bool),
        allow_edit: value.get("allowEdit").and_then(Value::as_bool),
        max_upload_bytes: value
            .get("maxUploadBytes")
            .and_then(Value::as_f64)
            .filter(|value| *value >= 0.0),
    };
    (parsed.allow_delete.is_some()
        || parsed.allow_upload.is_some()
        || parsed.allow_edit.is_some()
        || parsed.max_upload_bytes.is_some())
    .then_some(parsed)
}

async fn list(State(state): State<Shared>) -> AppResult<Json<Value>> {
    Ok(Json(
        json!({"shares":shares::read(&state.config, &roots(&state))?}),
    ))
}

async fn create(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let path = body["path"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("Path is required"));
    }
    let is_directory = body["isDirectory"].as_bool().unwrap_or(false);
    let runtime = roots(&state);
    let editable = body["editable"].as_bool().unwrap_or(false)
        && is_directory
        && media::editable(&state.config, &runtime, path);
    let restrictions = if editable {
        restrictions(body.get("restrictions"))
    } else {
        None
    };
    let share = shares::create(
        &state.config,
        &runtime,
        path.into(),
        is_directory,
        editable,
        restrictions,
    )?;
    let base = state.config.share_link_domain.clone().unwrap_or_else(|| {
        let host = headers
            .get(header::HOST)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("localhost");
        let scheme = headers
            .get("x-forwarded-proto")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .filter(|value| matches!(*value, "http" | "https"))
            .unwrap_or(if state.config.tls.is_some() {
                "https"
            } else {
                "http"
            });
        format!("{scheme}://{host}")
    });
    Ok(Json(
        json!({"url":format!("{base}/share/{}",share.token),"share":share}),
    ))
}

async fn update(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let token = body["token"].as_str().unwrap_or("");
    if token.is_empty() {
        return Err(AppError::bad("Token is required"));
    }
    let restrictions = if body.get("restrictions").is_some() {
        restrictions(body.get("restrictions"))
    } else {
        None
    };
    let editable = body.get("editable").and_then(Value::as_bool);
    if restrictions.is_none() && editable.is_none() {
        return Err(AppError::bad("No valid updates provided"));
    }
    let runtime = roots(&state);
    let existing = shares::find(&state.config, &runtime, token)?;
    let editable = match (editable, existing.as_ref()) {
        (Some(true), Some(share)) => Some(media::editable(&state.config, &runtime, &share.path)),
        (value, _) => value,
    };
    let share = shares::update(&state.config, &runtime, token, editable, restrictions)?
        .ok_or_else(|| AppError::not_found("Share not found"))?;
    Ok(Json(json!({"share":share})))
}

async fn remove(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let token = body["token"].as_str().unwrap_or("");
    if token.is_empty() {
        return Err(AppError::bad("Token is required"));
    }
    if !shares::delete(&state.config, token)? {
        return Err(AppError::not_found("Share not found"));
    }
    crate::path_metadata::cleanup_share_for_config(&state.config, token)?;
    Ok(Json(json!({"success":true})))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/shares", get(list).post(create).put(update))
        .route("/api/shares/delete", post(remove))
}
