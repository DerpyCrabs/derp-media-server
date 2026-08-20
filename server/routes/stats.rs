use crate::{
    app::{Shared, emit_admin},
    error::{AppError, AppResult},
};
use axum::{Json, Router, extract::State, routing::get};
use serde_json::{Value, json};

async fn get_stats(State(state): State<Shared>) -> AppResult<Json<Value>> {
    Ok(Json(json!({"views":state.stats.views()?})))
}

async fn add_view(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let path = body["filePath"].as_str().unwrap_or("");
    if path.is_empty() {
        return Err(AppError::bad("File path is required"));
    }
    let count = state.stats.increment(path)?;
    emit_admin(&state, "stats-changed");
    Ok(Json(json!({"success":true,"viewCount":count})))
}

pub fn router() -> Router<Shared> {
    Router::new().route("/api/stats/views", get(get_stats).post(add_view))
}
