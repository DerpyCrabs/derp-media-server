use crate::{
    app::{Shared, roots, timestamp_ms},
    error::{AppError, AppResult},
    media, reader_state,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::UNIX_EPOCH;

#[derive(Deserialize)]
struct StateQuery {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateBody {
    path: String,
    state: Value,
    base_revision: i64,
    fingerprint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreferencesBody {
    preferences: Value,
    base_revision: i64,
}

fn database(state: &crate::app::AppState) -> std::path::PathBuf {
    state.config.data_path.join("app.sqlite3")
}

fn fingerprint(state: &crate::app::AppState, logical: &str) -> AppResult<String> {
    let resolved = media::resolve(&state.config, &roots(state), logical)?;
    let metadata = std::fs::metadata(resolved.full).map_err(AppError::io)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis())
        .unwrap_or(0);
    Ok(format!("{}:{modified}", metadata.len()))
}

fn response(state: &crate::app::AppState, scope: &str, logical: &str) -> AppResult<Json<Value>> {
    let current_fingerprint = fingerprint(state, logical)?;
    let stored = reader_state::get(&database(state), scope, logical)?;
    if stored
        .as_ref()
        .is_some_and(|value| value.fingerprint != current_fingerprint)
    {
        reader_state::remove_exact(&database(state), scope, logical)?;
        return Ok(Json(
            json!({"state":null,"revision":0,"fingerprint":current_fingerprint}),
        ));
    }
    Ok(Json(match stored {
        Some(value) => {
            json!({"state":value.value,"revision":value.revision,"fingerprint":current_fingerprint})
        }
        None => json!({"state":null,"revision":0,"fingerprint":current_fingerprint}),
    }))
}

fn save(
    state: &crate::app::AppState,
    scope: &str,
    logical: &str,
    body: StateBody,
) -> AppResult<Json<Value>> {
    let current_fingerprint = fingerprint(state, logical)?;
    if body.fingerprint != current_fingerprint {
        return Err(AppError::conflict("Document changed"));
    }
    let revision = reader_state::put(
        &database(state),
        scope,
        logical,
        &body.state,
        &current_fingerprint,
        body.base_revision,
        timestamp_ms(),
    )?;
    Ok(Json(
        json!({"success":true,"revision":revision,"fingerprint":current_fingerprint}),
    ))
}

async fn admin_get(
    State(state): State<Shared>,
    Query(query): Query<StateQuery>,
) -> AppResult<Json<Value>> {
    let _database = state.reader_state_db.lock().await;
    response(&state, "admin", &query.path)
}

async fn admin_save(
    State(state): State<Shared>,
    Json(body): Json<StateBody>,
) -> AppResult<Json<Value>> {
    let logical = body.path.clone();
    let _database = state.reader_state_db.lock().await;
    save(&state, "admin", &logical, body)
}

async fn preferences_get(State(state): State<Shared>) -> AppResult<Json<Value>> {
    let _database = state.reader_state_db.lock().await;
    let (preferences, revision) = reader_state::preferences(&database(&state), "admin")?;
    Ok(Json(json!({"preferences":preferences,"revision":revision})))
}

async fn preferences_save(
    State(state): State<Shared>,
    Json(body): Json<PreferencesBody>,
) -> AppResult<Json<Value>> {
    let _database = state.reader_state_db.lock().await;
    let revision = reader_state::put_preferences(
        &database(&state),
        "admin",
        &body.preferences,
        body.base_revision,
        timestamp_ms(),
    )?;
    Ok(Json(json!({"success":true,"revision":revision})))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/reader-state", get(admin_get).post(admin_save))
        .route(
            "/api/reader-preferences",
            get(preferences_get).post(preferences_save),
        )
}
