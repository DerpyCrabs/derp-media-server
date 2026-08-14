use crate::{
    app::Shared,
    application_queries,
    error::{AppError, AppResult},
    store,
};
use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

async fn get_stats(State(state): State<Shared>) -> AppResult<Json<Value>> {
    Ok(Json(application_queries::stats(&state)?))
}

async fn add_view(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let path = body["filePath"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    let count = store::update(
        &state.config,
        store::StateDocument::PlaybackStatsV1,
        json!({"views":{}}),
        |value| {
            let count = value["views"][path].as_u64().unwrap_or(0) + 1;
            value["views"][path] = json!(count);
            Ok(count)
        },
    )?;
    Ok(Json(json!({"success":true,"viewCount":count})))
}

pub fn router() -> Router<Shared> {
    Router::new().route("/api/stats/views", get(get_stats).post(add_view))
}
