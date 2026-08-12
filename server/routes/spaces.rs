use crate::{
    app::Shared,
    spaces::{ApplySpaceCommand, SpaceError, WorkspaceImportRequest},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};

const SPACE_API_BODY_LIMIT: usize = 256 * 1024 * 1024;

fn space_api_body_limit() -> DefaultBodyLimit {
    DefaultBodyLimit::max(SPACE_API_BODY_LIMIT)
}

#[derive(Deserialize)]
struct CanvasImportBody {
    canvases: Value,
}

fn route_id(token: String) -> Result<String, SpaceError> {
    let id = token
        .strip_prefix('~')
        .ok_or_else(|| SpaceError::invalid("Invalid Space route token"))?;
    crate::spaces::validate_route_id(id)?;
    Ok(id.to_string())
}

async fn list(State(state): State<Shared>) -> Result<Json<Value>, SpaceError> {
    Ok(Json(json!({"spaces": state.spaces.list()?})))
}

async fn load(
    State(state): State<Shared>,
    Path(token): Path<String>,
) -> Result<Json<Value>, SpaceError> {
    let id = route_id(token)?;
    Ok(Json(json!({"space": state.spaces.load(&id)?})))
}

async fn history(
    State(state): State<Shared>,
    Path(token): Path<String>,
) -> Result<Json<Value>, SpaceError> {
    let id = route_id(token)?;
    Ok(Json(json!({
        "spaceId": id,
        "history": state.spaces.history(&id)?,
    })))
}

async fn revision(
    State(state): State<Shared>,
    Path((token, revision)): Path<(String, i64)>,
) -> Result<Json<Value>, SpaceError> {
    let id = route_id(token)?;
    Ok(Json(
        json!({"space": state.spaces.revision(&id, revision)?}),
    ))
}

async fn command(
    State(state): State<Shared>,
    Json(body): Json<ApplySpaceCommand>,
) -> Result<Json<Value>, SpaceError> {
    Ok(Json(json!({"space": state.spaces.apply(body)?})))
}

async fn import_export(State(state): State<Shared>) -> Result<Json<Value>, SpaceError> {
    Ok(Json(json!({"imports": state.spaces.import_export()?})))
}

async fn import_canvases(
    State(state): State<Shared>,
    Json(body): Json<CanvasImportBody>,
) -> Result<Json<Value>, SpaceError> {
    let (spaces, imports) = state.spaces.import_canvases(&body.canvases)?;
    Ok(Json(json!({"spaces": spaces, "imports": imports})))
}

async fn import_workspace(
    State(state): State<Shared>,
    Json(body): Json<WorkspaceImportRequest>,
) -> Result<Json<Value>, SpaceError> {
    let (space, import) = state.spaces.import_workspace(body)?;
    Ok(Json(json!({"space": space, "import": import})))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/spaces", get(list))
        .route("/api/spaces/commands", post(command))
        .route("/api/spaces/import-export", get(import_export))
        .route("/api/spaces/import/canvases", post(import_canvases))
        .route("/api/spaces/import/workspaces", post(import_workspace))
        .route("/api/spaces/by-id/{id}", get(load))
        .route("/api/spaces/by-id/{id}/history", get(history))
        .route("/api/spaces/by-id/{id}/revisions/{revision}", get(revision))
        .layer(space_api_body_limit())
}

#[cfg(test)]
mod tests {
    use super::space_api_body_limit;
    use axum::{
        Json, Router,
        body::{Body, to_bytes},
        extract::{DefaultBodyLimit, Path},
        http::{Request, StatusCode, header},
        routing::{get, post},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    async fn echo(Path(id): Path<String>) -> String {
        id
    }

    async fn json_size(Json(value): Json<Value>) -> Json<Value> {
        Json(json!({
            "size": value["padding"].as_str().map(str::len).unwrap_or_default(),
        }))
    }

    #[tokio::test]
    async fn encoded_slash_and_backslash_remain_one_opaque_space_id() {
        let response = Router::new()
            .route("/api/spaces/by-id/{id}", get(echo))
            .oneshot(
                Request::builder()
                    .uri("/api/spaces/by-id/~canvas%2Fphone%5Cprimary")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(response.into_body(), usize::MAX).await.unwrap(),
            "~canvas/phone\\primary"
        );
    }

    #[tokio::test]
    async fn space_routes_accept_json_larger_than_the_global_default() {
        let app = Router::new()
            .merge(
                Router::new()
                    .route("/space", post(json_size))
                    .layer(space_api_body_limit()),
            )
            .route("/ordinary", post(json_size))
            .layer(DefaultBodyLimit::max(1_048_576));
        let payload = json!({"padding": "x".repeat(1_100_000)}).to_string();
        let request = |uri: &'static str| {
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(payload.clone()))
                .unwrap()
        };

        let accepted = app.clone().oneshot(request("/space")).await.unwrap();
        assert_eq!(accepted.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&to_bytes(accepted.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(body["size"], 1_100_000);

        let rejected = app.oneshot(request("/ordinary")).await.unwrap();
        assert_eq!(rejected.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }
}
