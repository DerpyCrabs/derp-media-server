use crate::{
    app::{Shared, timestamp_ms},
    contracts::{API_EVENTS_PATH, AppEvent},
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
use std::time::Duration;

async fn events(State(state): State<Shared>) -> Response {
    let mut receiver = state.application_events.subscribe();
    let stream = async_stream::stream! {
        yield Ok::<Event, std::convert::Infallible>(
            Event::default()
                .json_data(AppEvent::Connected { timestamp: timestamp_ms() })
                .expect("connected event serializes"),
        );
        loop {
            match receiver.recv().await {
                Ok(event) => yield Ok(
                    Event::default().json_data(event).expect("app event serializes"),
                ),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    };
    Sse::new(stream)
        .keep_alive(
            KeepAlive::default()
                .interval(Duration::from_secs(30))
                .text("keep-alive"),
        )
        .into_response()
}

pub fn router() -> Router<Shared> {
    Router::new().route(API_EVENTS_PATH, get(events))
}
