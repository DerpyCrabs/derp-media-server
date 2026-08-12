use crate::{app::Shared, spaces::SpaceError};
use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use serde_json::{Value, json};

async fn list(State(state): State<Shared>) -> Result<Json<Value>, SpaceError> {
    Ok(Json(json!({"canvases": state.spaces.legacy_canvases()?})))
}

async fn sync(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, SpaceError> {
    let incoming = body.get("canvases").unwrap_or(&Value::Null);
    Ok(Json(
        json!({"canvases": state.spaces.sync_legacy_canvases(incoming)?}),
    ))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/canvases", get(list))
        .route("/api/canvases/sync", post(sync))
}
