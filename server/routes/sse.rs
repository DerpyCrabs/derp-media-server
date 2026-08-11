use crate::{
    app::{Shared, roots, timestamp_ms},
    error::AppResult,
    routes::share_access::authenticate,
    shares,
};
use axum::{
    Router,
    extract::{Path, State},
    http::HeaderMap,
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::get,
};
use serde_json::json;
use std::time::Duration;

async fn events(State(state): State<Shared>) -> Response {
    let mut receiver = state.admin_events.subscribe();
    let stream = async_stream::stream! { yield Ok::<Event,std::convert::Infallible>(Event::default().json_data(json!({"type":"connected","timestamp":timestamp_ms()})).unwrap()); loop { match receiver.recv().await { Ok(event)=>yield Ok(Event::default().json_data(event).unwrap()), Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=>continue, Err(_)=>break } } };
    Sse::new(stream)
        .keep_alive(
            KeepAlive::default()
                .interval(Duration::from_secs(30))
                .text("keep-alive"),
        )
        .into_response()
}

async fn share(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let authenticated = authenticate(&state, &token, &headers).await?;
    let grant_id = authenticated
        .share
        .grant_id
        .ok_or_else(|| crate::error::AppError::internal("Grant internal ID is missing"))?;
    let mut receiver = state.command_events.subscribe();
    let stream = async_stream::stream! {
        yield Ok::<Event, std::convert::Infallible>(
            Event::default()
                .json_data(json!({"type":"connected","timestamp":timestamp_ms()}))
                .unwrap(),
        );
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    if !event.scope.grant_ids.contains(&grant_id) {
                        continue;
                    }
                    let runtime = roots(&state);
                    let Ok(Some(shared)) = shares::find_by_id(&state.config, &runtime, &grant_id)
                    else {
                        break;
                    };
                    let root = shared.path.replace('\\', "/");
                    let within = |path: &str| path == root || path.starts_with(&(root.clone() + "/"));
                    let changed = event
                        .new_paths
                        .iter()
                        .chain(&event.old_paths)
                        .map(|path| path.replace('\\', "/"))
                        .find(|path| within(path));
                    let relative = changed
                        .as_deref()
                        .and_then(|path| path.strip_prefix(&(root.clone() + "/")))
                        .unwrap_or("");
                    let directory = relative
                        .rsplit_once('/')
                        .map(|(directory, _)| directory)
                        .unwrap_or("");
                    yield Ok(
                        Event::default()
                            .json_data(json!({
                                "type":"files-changed",
                                "directory":directory,
                                "path":if shared.is_directory { relative } else { "" },
                                "commandId":event.command_id,
                                "timestamp":timestamp_ms(),
                            }))
                            .unwrap(),
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    yield Ok(
                        Event::default()
                            .json_data(json!({
                                "type":"files-changed",
                                "directory":"",
                                "resync":true,
                                "timestamp":timestamp_ms(),
                            }))
                            .unwrap(),
                    );
                }
                Err(_) => break,
            }
        }
    };
    Ok(Sse::new(stream)
        .keep_alive(
            KeepAlive::default()
                .interval(Duration::from_secs(30))
                .text("keep-alive"),
        )
        .into_response())
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/events/stream", get(events))
        .route("/api/share/{token}/stream", get(share))
}
