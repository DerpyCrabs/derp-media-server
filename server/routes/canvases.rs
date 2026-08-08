use crate::{
    app::{Shared, canvases_path},
    canvas_persistence,
    error::AppResult,
    store,
};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde_json::{Value, json};

fn read(state: &Shared) -> Value {
    store::section(&canvases_path(state), &state.config.library_key, json!([]))
}

async fn list(State(state): State<Shared>) -> Json<Value> {
    Json(json!({"canvases":canvas_persistence::merge(&json!([]), &read(&state))}))
}

async fn sync(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let _guard = state.store_lock.lock().await;
    let merged =
        canvas_persistence::merge(&read(&state), body.get("canvases").unwrap_or(&Value::Null));
    store::update_section(
        &canvases_path(&state),
        &state.config.library_key,
        merged.clone(),
    )?;
    Ok(Json(json!({"canvases":merged})))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/canvases", get(list))
        .route("/api/canvases/sync", post(sync))
}
