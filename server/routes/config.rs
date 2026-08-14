use crate::{
    app::Shared,
    application_queries,
    contracts::{API_CONFIG_PATH, ServerConfigDto},
};
use axum::{Json, Router, extract::State, routing::get};

async fn config(State(state): State<Shared>) -> Json<ServerConfigDto> {
    Json(application_queries::server_config(&state))
}

pub fn router() -> Router<Shared> {
    Router::new().route(API_CONFIG_PATH, get(config))
}
