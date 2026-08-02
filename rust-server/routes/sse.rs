use crate::{
    app::{Shared, timestamp_ms},
    error::AppResult,
    routes::share_access::validate,
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
    let shared = validate(&state, &token, &headers)?;
    let root = shared.path.replace('\\', "/");
    let is_directory = shared.is_directory;
    let mut receiver = state.events.subscribe();
    let stream = async_stream::stream! { yield Ok::<Event,std::convert::Infallible>(Event::default().json_data(json!({"type":"connected","timestamp":timestamp_ms()})).unwrap()); loop { match receiver.recv().await { Ok(event)=>{let directory=event.directory.replace('\\',"/");let changed=event.path.clone().map(|path|path.replace('\\',"/"));let within=|path:&str|path==root||path.starts_with(&(root.clone()+"/"));if is_directory&&within(&directory)&&changed.as_deref().map(within).unwrap_or(true){let relative_directory=directory.strip_prefix(&(root.clone()+"/")).unwrap_or(if directory==root{""}else{&directory});let relative_path=changed.as_deref().map(|path|path.strip_prefix(&(root.clone()+"/")).unwrap_or(if path==root{""}else{path}));let mut payload=json!({"type":"files-changed","directory":relative_directory,"timestamp":timestamp_ms()});if let Some(path)=relative_path{payload["path"]=json!(path);}yield Ok(Event::default().json_data(payload).unwrap());}else if !is_directory&&changed.as_deref()==Some(root.as_str()){yield Ok(Event::default().json_data(json!({"type":"files-changed","directory":"","path":"","timestamp":timestamp_ms()})).unwrap());}},Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=>continue,Err(_)=>break } } };
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
