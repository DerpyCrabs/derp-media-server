use crate::{
    config::HermesConfig,
    error::{AppError, AppResult},
};
use futures_util::{SinkExt, StreamExt, future::BoxFuture};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;

type PendingRpc = Arc<Mutex<HashMap<u64, oneshot::Sender<AppResult<Value>>>>>;

fn gateway_status_error(status: reqwest::StatusCode) -> AppError {
    let message = format!("Hermes gateway returned {status}");
    match status.as_u16() {
        400 => AppError::bad(message),
        404 => AppError::not_found(message),
        409 => AppError::conflict(message),
        _ => AppError::internal(message),
    }
}

pub(crate) trait HermesTransport: Send + Sync {
    fn profile(&self) -> Option<&str>;
    fn get<'a>(
        &'a self,
        path: &'a str,
        query: &'a [(&'a str, String)],
    ) -> BoxFuture<'a, AppResult<Value>>;
    fn patch<'a>(&'a self, path: &'a str, body: Value) -> BoxFuture<'a, AppResult<Value>>;
    fn post<'a>(&'a self, path: &'a str, body: Value) -> BoxFuture<'a, AppResult<Value>>;
    fn delete<'a>(&'a self, path: &'a str) -> BoxFuture<'a, AppResult<()>>;
    fn ensure_events<'a>(&'a self) -> BoxFuture<'a, AppResult<()>>;
    fn rpc<'a>(&'a self, method: &'a str, params: Value) -> BoxFuture<'a, AppResult<Value>>;
}

pub(crate) struct HermesHub {
    config: HermesConfig,
    client: reqwest::Client,
    events: tokio::sync::broadcast::Sender<Value>,
    sequence: AtomicU64,
    outbound: Mutex<Option<mpsc::UnboundedSender<Message>>>,
    pending: PendingRpc,
}

impl HermesHub {
    pub(crate) fn new(
        config: HermesConfig,
        client: reqwest::Client,
        events: tokio::sync::broadcast::Sender<Value>,
    ) -> Self {
        Self {
            config,
            client,
            events,
            sequence: AtomicU64::new(1),
            outbound: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub(crate) fn profile(&self) -> Option<&str> {
        self.config.profile.as_deref()
    }

    fn http_url(&self, path: &str) -> AppResult<url::Url> {
        self.config
            .gateway_url
            .join(path.trim_start_matches('/'))
            .map_err(|_| AppError::internal("Hermes gateway URL is invalid"))
    }

    fn ws_url(&self) -> AppResult<url::Url> {
        let mut url = self.http_url("api/ws")?;
        url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" })
            .map_err(|_| AppError::internal("Hermes gateway URL is invalid"))?;
        if let Some(token) = &self.config.token {
            url.query_pairs_mut().append_pair("token", token);
        }
        Ok(url)
    }

    pub(crate) async fn get(&self, path: &str, query: &[(&str, String)]) -> AppResult<Value> {
        let mut request = self.client.get(self.http_url(path)?).query(query);
        if let Some(token) = &self.config.token {
            request = request.header("X-Hermes-Session-Token", token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| AppError::internal("Hermes gateway is unavailable"))?;
        if !response.status().is_success() {
            return Err(gateway_status_error(response.status()));
        }
        response
            .json()
            .await
            .map_err(|_| AppError::internal("Hermes gateway returned invalid JSON"))
    }

    pub(crate) async fn patch(&self, path: &str, body: Value) -> AppResult<Value> {
        let mut request = self.client.patch(self.http_url(path)?).json(&body);
        if let Some(token) = &self.config.token {
            request = request.header("X-Hermes-Session-Token", token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| AppError::internal("Hermes gateway is unavailable"))?;
        if !response.status().is_success() {
            return Err(gateway_status_error(response.status()));
        }
        response
            .json()
            .await
            .map_err(|_| AppError::internal("Hermes gateway returned invalid JSON"))
    }

    pub(crate) async fn post(&self, path: &str, body: Value) -> AppResult<Value> {
        let mut request = self.client.post(self.http_url(path)?).json(&body);
        if let Some(token) = &self.config.token {
            request = request.header("X-Hermes-Session-Token", token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| AppError::internal("Hermes gateway is unavailable"))?;
        if !response.status().is_success() {
            return Err(gateway_status_error(response.status()));
        }
        response
            .json()
            .await
            .map_err(|_| AppError::internal("Hermes gateway returned invalid JSON"))
    }

    pub(crate) async fn delete(&self, path: &str) -> AppResult<()> {
        let mut request = self.client.delete(self.http_url(path)?);
        if let Some(profile) = &self.config.profile {
            request = request.query(&[("profile", profile)]);
        }
        if let Some(token) = &self.config.token {
            request = request.header("X-Hermes-Session-Token", token);
        }
        let response = request
            .send()
            .await
            .map_err(|_| AppError::internal("Hermes gateway is unavailable"))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(gateway_status_error(response.status()))
        }
    }

    async fn ensure_rpc_transport(&self) -> AppResult<mpsc::UnboundedSender<Message>> {
        let mut guard = self.outbound.lock().await;
        if let Some(sender) = guard.as_ref().filter(|sender| !sender.is_closed()) {
            return Ok(sender.clone());
        }
        let ws_url = self.ws_url()?.to_string();
        let socket = match tokio_tungstenite::connect_async(&ws_url).await {
            Ok((socket, _)) => socket,
            Err(_) => {
                let _ = self
                    .events
                    .send(json!({"method":"event","params":{"type":"transport.disconnected"}}));
                return Err(AppError::internal(
                    "Hermes gateway WebSocket is unavailable",
                ));
            }
        };
        let (sender, mut receiver) = mpsc::unbounded_channel::<Message>();
        *guard = Some(sender.clone());
        let pending = self.pending.clone();
        let events = self.events.clone();
        tokio::spawn(async move {
            let mut next_socket = Some(socket);
            loop {
                let connected = match next_socket.take() {
                    Some(socket) => socket,
                    None => match tokio_tungstenite::connect_async(&ws_url).await {
                        Ok((socket, _)) => socket,
                        Err(_) => {
                            let _ = events.send(json!({"method":"event","params":{"type":"transport.disconnected"}}));
                            tokio::time::sleep(Duration::from_millis(1500)).await;
                            continue;
                        }
                    },
                };
                let _ =
                    events.send(json!({"method":"event","params":{"type":"transport.connected"}}));
                let (mut writer, mut reader) = connected.split();
                loop {
                    tokio::select! {
                        outbound = receiver.recv() => match outbound {
                            Some(message) => {
                                if writer.send(message).await.is_err() { break }
                            },
                            None => return,
                        },
                        inbound = reader.next() => {
                            let Some(Ok(Message::Text(text))) = inbound else { break };
                            let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
                            if let Some(id) = value.get("id").and_then(Value::as_u64) {
                                if let Some(waiter) = pending.lock().await.remove(&id) {
                                    let result = if let Some(error) = value.get("error") {
                                        Err(AppError::bad(error.get("message").and_then(Value::as_str).unwrap_or("Hermes operation failed")))
                                    } else {
                                        Ok(value.get("result").cloned().unwrap_or(Value::Null))
                                    };
                                    let _ = waiter.send(result);
                                }
                            } else {
                                let _ = events.send(value);
                            }
                        }
                    }
                }
                let _ = events
                    .send(json!({"method":"event","params":{"type":"transport.disconnected"}}));
                for (_, waiter) in pending.lock().await.drain() {
                    let _ = waiter.send(Err(AppError::internal(
                        "Hermes gateway WebSocket disconnected",
                    )));
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        });
        Ok(sender)
    }

    pub(crate) async fn rpc(&self, method: &str, params: Value) -> AppResult<Value> {
        let id = self.sequence.fetch_add(1, Ordering::Relaxed);
        let request = Message::Text(
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
                .to_string()
                .into(),
        );
        let (reply, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, reply);
        let sender = match self.ensure_rpc_transport().await {
            Ok(sender) => sender,
            Err(error) => {
                self.pending.lock().await.remove(&id);
                return Err(error);
            }
        };
        if sender.send(request).is_err() {
            self.pending.lock().await.remove(&id);
            return Err(AppError::internal("Hermes gateway WebSocket disconnected"));
        }
        match tokio::time::timeout(Duration::from_secs(120), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(AppError::internal("Hermes gateway WebSocket disconnected")),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(AppError::internal("Hermes gateway RPC timed out"))
            }
        }
    }
}

impl HermesTransport for HermesHub {
    fn profile(&self) -> Option<&str> {
        self.profile()
    }
    fn get<'a>(
        &'a self,
        path: &'a str,
        query: &'a [(&'a str, String)],
    ) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(self.get(path, query))
    }
    fn patch<'a>(&'a self, path: &'a str, body: Value) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(self.patch(path, body))
    }
    fn post<'a>(&'a self, path: &'a str, body: Value) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(self.post(path, body))
    }
    fn delete<'a>(&'a self, path: &'a str) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(self.delete(path))
    }
    fn ensure_events<'a>(&'a self) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async move { self.ensure_rpc_transport().await.map(|_| ()) })
    }
    fn rpc<'a>(&'a self, method: &'a str, params: Value) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(self.rpc(method, params))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::HermesFilesystemMode;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    async fn next_test_event(receiver: &mut tokio::sync::broadcast::Receiver<Value>) -> Value {
        loop {
            let value = tokio::time::timeout(Duration::from_secs(2), receiver.recv())
                .await
                .expect("event timeout")
                .expect("event channel closed");
            if value.pointer("/params/type").and_then(Value::as_str) == Some("test.event") {
                return value;
            }
        }
    }

    #[tokio::test]
    async fn rpc_reuses_socket_and_keeps_broadcasting_after_response() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let accepts = Arc::new(AtomicUsize::new(0));
        let accepts_for_server = accepts.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            accepts_for_server.fetch_add(1, Ordering::SeqCst);
            let mut socket = accept_async(stream).await.unwrap();
            for index in 0..2 {
                let Message::Text(text) = socket.next().await.unwrap().unwrap() else {
                    panic!("expected text RPC")
                };
                let request: Value = serde_json::from_str(&text).unwrap();
                let id = request.get("id").cloned().unwrap();
                socket
                    .send(Message::Text(
                        json!({"jsonrpc":"2.0","id":id,"result":{"index":index}})
                            .to_string()
                            .into(),
                    ))
                    .await
                    .unwrap();
                if index == 0 {
                    socket
                        .send(Message::Text(
                            json!({"method":"event","params":{"type":"test.event","payload":{"live":true}}})
                                .to_string()
                                .into(),
                        ))
                        .await
                        .unwrap();
                }
            }
        });

        let (events, _) = tokio::sync::broadcast::channel(16);
        let mut first_subscriber = events.subscribe();
        let mut second_subscriber = events.subscribe();
        let hub = HermesHub::new(
            HermesConfig {
                gateway_url: format!("http://{address}/").parse().unwrap(),
                token: None,
                profile: None,
                filesystem_mode: HermesFilesystemMode::Upload,
                auto_start: false,
                home: None,
            },
            reqwest::Client::new(),
            events,
        );

        assert_eq!(hub.rpc("first", json!({})).await.unwrap()["index"], 0);
        assert_eq!(
            next_test_event(&mut first_subscriber).await["params"]["payload"]["live"],
            true
        );
        assert_eq!(
            next_test_event(&mut second_subscriber).await["params"]["payload"]["live"],
            true
        );
        assert_eq!(hub.rpc("second", json!({})).await.unwrap()["index"], 1);
        assert_eq!(accepts.load(Ordering::SeqCst), 1);
    }
}
