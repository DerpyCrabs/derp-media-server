use crate::app::{Shared, timestamp_ms};
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
use tokio::sync::broadcast;

async fn next_admin_event(
    receiver: &mut broadcast::Receiver<serde_json::Value>,
) -> Option<serde_json::Value> {
    match receiver.recv().await {
        Ok(event) => Some(event),
        Err(broadcast::error::RecvError::Lagged(skipped)) => Some(json!({
            "type": "resync-required",
            "skipped": skipped,
            "timestamp": timestamp_ms(),
        })),
        Err(broadcast::error::RecvError::Closed) => None,
    }
}

async fn events(State(state): State<Shared>) -> Response {
    let mut receiver = state.admin_events.subscribe();
    let stream = async_stream::stream! {
        yield Ok::<Event, std::convert::Infallible>(
            Event::default()
                .json_data(json!({"type":"connected","timestamp":timestamp_ms()}))
                .expect("JSON event serialization"),
        );
        while let Some(event) = next_admin_event(&mut receiver).await {
            yield Ok(
                Event::default()
                    .json_data(event)
                    .expect("JSON event serialization"),
            );
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
    Router::new().route("/api/events/stream", get(events))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lagged_receiver_gets_resync_signal_before_latest_event() {
        let (sender, mut receiver) = broadcast::channel(1);
        sender.send(json!({"type":"first"})).unwrap();
        sender.send(json!({"type":"latest"})).unwrap();

        let resync = next_admin_event(&mut receiver).await.unwrap();
        assert_eq!(resync["type"], "resync-required");
        assert_eq!(resync["skipped"], 1);

        let latest = next_admin_event(&mut receiver).await.unwrap();
        assert_eq!(latest["type"], "latest");
    }
}
