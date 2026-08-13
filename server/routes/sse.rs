use crate::{
    app::{Shared, timestamp_ms},
};
use axum::{
    Router,
    extract::State,
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

pub fn router() -> Router<Shared> {
    Router::new().route("/api/events/stream", get(events))
}
