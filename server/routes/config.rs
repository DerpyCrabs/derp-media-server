use crate::app::Shared;
use axum::{Json, Router, extract::State, routing::get};

async fn config(State(state): State<Shared>) -> Json<serde_json::Value> {
    Json(crate::app::server_config(&state))
}

pub fn router() -> Router<Shared> {
    Router::new().route("/api/config", get(config))
}
