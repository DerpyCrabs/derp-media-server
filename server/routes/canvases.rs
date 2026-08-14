use crate::{
    app::Shared,
    canvas_persistence::{self, CanvasDocument, SaveCanvasDocument},
    contracts::API_CANVASES_PATH,
    error::AppResult,
    extractors::ApiJson,
    state_db,
};
use axum::{Json, Router, extract::State, routing::get};

async fn list(State(state): State<Shared>) -> AppResult<Json<CanvasDocument>> {
    Ok(Json(canvas_persistence::load(
        &state_db::database(&state.config),
        &state.config.library_key,
    )?))
}

async fn save(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<SaveCanvasDocument>,
) -> AppResult<Json<CanvasDocument>> {
    Ok(Json(canvas_persistence::save(
        &state_db::database(&state.config),
        &state.config.library_key,
        body,
    )?))
}

pub fn router() -> Router<Shared> {
    Router::new().route(API_CANVASES_PATH, get(list).put(save))
}
