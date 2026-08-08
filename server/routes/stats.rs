use crate::{
    app::{Shared, stats_path},
    error::{AppError, AppResult},
    store,
};
use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

async fn get_stats(State(state): State<Shared>) -> Json<Value> {
    let value = store::section(
        &stats_path(&state),
        &state.config.library_key,
        json!({"views":{},"shareViews":{}}),
    );
    Json(json!({
        "views": value["views"].as_object().cloned().unwrap_or_default(),
        "shareViews": value["shareViews"].as_object().cloned().unwrap_or_default(),
    }))
}

async fn add_view(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let path = body["filePath"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    let _guard = state.store_lock.lock().await;
    let mut value = store::section(
        &stats_path(&state),
        &state.config.library_key,
        json!({"views":{},"shareViews":{}}),
    );
    let count = value["views"][path].as_u64().unwrap_or(0) + 1;
    value["views"][path] = json!(count);
    store::update_section(&stats_path(&state), &state.config.library_key, value)?;
    Ok(Json(json!({"success":true,"viewCount":count})))
}

pub fn router() -> Router<Shared> {
    Router::new().route("/api/stats/views", get(get_stats).post(add_view))
}
