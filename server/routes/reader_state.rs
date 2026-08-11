use crate::{
    app::{Shared, roots, timestamp_ms},
    error::{AppError, AppResult},
    media, reader_state,
    routes::share_access::validate,
    shares,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
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
        reader_state::remove_prefix(&database(state), Some(scope), logical)?;
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

async fn share_get(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(query): Query<StateQuery>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let logical =
        shares::resolve_authorized_subpath(&state.config, &roots(&state), &share, &query.path)?
            .logical;
    let _database = state.reader_state_db.lock().await;
    response(&state, &format!("share:{token}"), &logical)
}

async fn share_save(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<StateBody>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let now = timestamp_ms();
    let mut writes = state.reader_state_writes.lock().await;
    let entry = writes.entry(token.clone()).or_insert((0, now + 60_000));
    if now > entry.1 {
        *entry = (0, now + 60_000);
    }
    if entry.0 >= 120 {
        return Err(AppError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many reader state updates".into(),
        ));
    }
    entry.0 += 1;
    drop(writes);
    let logical =
        shares::resolve_authorized_subpath(&state.config, &roots(&state), &share, &body.path)?
            .logical;
    let _database = state.reader_state_db.lock().await;
    save(&state, &format!("share:{token}"), &logical, body)
}

async fn preferences_get(State(state): State<Shared>) -> AppResult<Json<Value>> {
    let _database = state.reader_state_db.lock().await;
    let (preferences, revision) = reader_state::preferences(&database(&state), "admin")?;
    Ok(Json(json!({"preferences":preferences,"revision":revision})))
}

async fn preferences_save(
    State(state): State<Shared>,
    Json(value): Json<Value>,
) -> AppResult<Json<Value>> {
    let preferences = value.get("preferences").cloned().unwrap_or(Value::Null);
    let _database = state.reader_state_db.lock().await;
    let revision =
        reader_state::put_preferences(&database(&state), "admin", &preferences, timestamp_ms())?;
    Ok(Json(json!({"success":true,"revision":revision})))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/reader-state", get(admin_get).post(admin_save))
        .route(
            "/api/reader-preferences",
            get(preferences_get).post(preferences_save),
        )
        .route(
            "/api/share/{token}/reader-state",
            get(share_get).post(share_save),
        )
}
