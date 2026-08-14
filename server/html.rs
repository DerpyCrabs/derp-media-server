use crate::{
    app::{AppState, Shared, knowledge_base_root, timestamp_ms},
    application_queries, media,
    routes::media as media_routes,
};
use axum::{
    body::Body,
    extract::{
        FromRequestParts, Request, State,
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
};
use tokio::fs;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{self, client::IntoClientRequest},
};
use tower::ServiceExt;
use tower_http::services::ServeFile;

fn query(key: Value, data: Value) -> Value {
    let now = timestamp_ms();
    json!({"dehydratedAt":now,"queryKey":key,"queryHash":serde_json::to_string(&key).unwrap(),"state":{"data":data,"dataUpdateCount":1,"dataUpdatedAt":now,"error":null,"errorUpdateCount":0,"errorUpdatedAt":0,"fetchFailureCount":0,"fetchFailureReason":null,"fetchMeta":null,"isInvalidated":false,"status":"success","fetchStatus":"idle"}})
}

fn parent(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

pub(crate) async fn dehydrated(state: &AppState, uri: &axum::http::Uri) -> Value {
    let path = uri.path();
    let params = url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .into_owned()
        .collect::<HashMap<_, _>>();
    let mut queries = Vec::new();
    if path == "/" || path == "/workspace" || path == "/canvas" {
        let dir = params.get("dir").cloned().unwrap_or_default();
        if path == "/"
            && let Ok(listing) = application_queries::file_listing(state, &dir, 0).await
        {
            queries.push(query(
                application_queries::files_query_key(&dir, None, 0),
                json!(listing),
            ));
        }
        if let Ok(settings) = application_queries::settings(state) {
            queries.push(query(
                application_queries::settings_query_key(),
                json!(settings),
            ));
        }
        queries.push(query(
            application_queries::stats_query_key(),
            application_queries::stats(state),
        ));
        queries.push(query(
            application_queries::server_config_query_key(),
            json!(application_queries::server_config(state)),
        ));
        if path == "/" && knowledge_base_root(state, &dir).is_some() {
            if let Ok(recent) = application_queries::kb_recent(state, &dir) {
                queries.push(query(
                    application_queries::kb_recent_query_key(&dir),
                    recent,
                ));
            }
        }
        if let Some(viewing) = params.get("viewing") {
            let extension = Path::new(viewing)
                .extension()
                .unwrap_or_default()
                .to_string_lossy();
            if media::media_type(&extension) == "text" {
                if let Ok(content) = application_queries::text_content(state, viewing) {
                    queries.push(query(
                        application_queries::text_content_query_key(viewing),
                        json!(content),
                    ));
                }
            } else if media::media_type(&extension) != "pdf" {
                let listing = params
                    .get("dir")
                    .cloned()
                    .unwrap_or_else(|| parent(viewing));
                if let Ok(files) = application_queries::file_listing(state, &listing, 0).await {
                    queries.push(query(
                        application_queries::files_query_key(&listing, None, 0),
                        json!(files),
                    ));
                }
            }
        }
        if let Some(playing) = params.get("playing") {
            let extension = Path::new(playing)
                .extension()
                .unwrap_or_default()
                .to_string_lossy();
            let kind = media::media_type(&extension);
            if kind == "audio"
                && let Ok(resolved) = media::resolve(&state.config, playing)
                && let Ok(metadata) = media_routes::audio_metadata_path(&resolved.full).await
            {
                queries.push(query(
                    application_queries::audio_metadata_query_key(playing),
                    metadata.0,
                ));
            }
            if matches!(kind, "audio" | "video") {
                let listing = params
                    .get("dir")
                    .cloned()
                    .unwrap_or_else(|| parent(playing));
                if let Ok(files) = application_queries::file_listing(state, &listing, 0).await {
                    queries.push(query(
                        application_queries::files_query_key(&listing, None, 0),
                        json!(files),
                    ));
                }
            }
        }
    }
    json!({"mutations":[],"queries":queries})
}

async fn inject(html: String, state: &AppState, uri: &axum::http::Uri) -> String {
    html.replace(
        "<!--DEHYDRATED-->",
        &format!(
            "<script>window.__DEHYDRATED_STATE__={}</script>",
            dehydrated(state, uri).await
        ),
    )
}

fn safe_static(path: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(path)
        .decode_utf8()
        .ok()?;
    let relative = Path::new(decoded.as_ref());
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(PathBuf::from("dist/client").join(relative))
}

async fn proxy_vite_websocket(client: WebSocket, url: String) {
    let Ok(mut request) = url.into_client_request() else {
        return;
    };
    request.headers_mut().insert(
        header::SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static("vite-hmr"),
    );
    let Ok((vite, _)) = connect_async(request).await else {
        return;
    };
    let (mut client_write, mut client_read) = client.split();
    let (mut vite_write, mut vite_read) = vite.split();
    let client_to_vite = async {
        while let Some(Ok(message)) = client_read.next().await {
            if vite_write.send(to_vite_message(message)).await.is_err() {
                break;
            }
        }
    };
    let vite_to_client = async {
        while let Some(Ok(message)) = vite_read.next().await {
            let Some(message) = from_vite_message(message) else {
                continue;
            };
            if client_write.send(message).await.is_err() {
                break;
            }
        }
    };
    tokio::select! {
        _ = client_to_vite => {},
        _ = vite_to_client => {},
    }
}

fn to_vite_message(message: Message) -> tungstenite::Message {
    match message {
        Message::Text(value) => tungstenite::Message::Text(value.to_string().into()),
        Message::Binary(value) => tungstenite::Message::Binary(value),
        Message::Ping(value) => tungstenite::Message::Ping(value),
        Message::Pong(value) => tungstenite::Message::Pong(value),
        Message::Close(frame) => {
            tungstenite::Message::Close(frame.map(|frame| tungstenite::protocol::CloseFrame {
                code: frame.code.into(),
                reason: frame.reason.to_string().into(),
            }))
        }
    }
}

fn from_vite_message(message: tungstenite::Message) -> Option<Message> {
    match message {
        tungstenite::Message::Text(value) => Some(Message::Text(value.to_string().into())),
        tungstenite::Message::Binary(value) => Some(Message::Binary(value)),
        tungstenite::Message::Ping(value) => Some(Message::Ping(value)),
        tungstenite::Message::Pong(value) => Some(Message::Pong(value)),
        tungstenite::Message::Close(frame) => Some(Message::Close(frame.map(|frame| CloseFrame {
            code: frame.code.into(),
            reason: frame.reason.to_string().into(),
        }))),
        tungstenite::Message::Frame(_) => None,
    }
}

pub async fn fallback(State(state): State<Shared>, request: Request) -> Response {
    let (mut parts, body) = request.into_parts();
    let websocket = WebSocketUpgrade::from_request_parts(&mut parts, &state)
        .await
        .ok();
    let request = Request::from_parts(parts, body);
    let request_uri = request.uri().clone();
    let request_headers = request.headers().clone();
    if state.dev
        && let Some(websocket) = websocket
    {
        let uri = request_uri
            .path_and_query()
            .map(|value| value.as_str())
            .unwrap_or("/");
        let url = format!("ws://127.0.0.1:{}{}", state.vite_port, uri);
        return websocket
            .protocols(["vite-hmr"])
            .on_upgrade(move |socket| proxy_vite_websocket(socket, url));
    }
    if state.dev {
        let uri = request
            .uri()
            .path_and_query()
            .map(|value| value.as_str())
            .unwrap_or("/");
        let url = format!("http://127.0.0.1:{}{}", state.vite_port, uri);
        let method = request.method().clone();
        let headers = request_headers.clone();
        let body = axum::body::to_bytes(request.into_body(), usize::MAX)
            .await
            .unwrap_or_default();
        let mut outgoing = state.client.request(method, &url).body(body);
        for (key, value) in &headers {
            outgoing = outgoing.header(key, value)
        }
        match outgoing.send().await {
            Ok(response) => {
                let status = response.status();
                let response_headers = response.headers().clone();
                let html = response_headers
                    .get(header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.contains("text/html"));
                let bytes = response.bytes().await.unwrap_or_default();
                let body = if html {
                    Body::from(
                        inject(
                            String::from_utf8_lossy(&bytes).into_owned(),
                            &state,
                            &request_uri,
                        )
                        .await,
                    )
                } else {
                    Body::from(bytes)
                };
                let mut output = Response::new(body);
                *output.status_mut() = status;
                for (key, value) in &response_headers {
                    if !matches!(
                        key.as_str(),
                        "connection" | "transfer-encoding" | "content-length"
                    ) {
                        output.headers_mut().insert(key, value.clone());
                    }
                }
                output
            }
            Err(error) => (
                StatusCode::BAD_GATEWAY,
                format!("Vite proxy failed: {error}"),
            )
                .into_response(),
        }
    } else {
        if request.method() != axum::http::Method::GET
            && request.method() != axum::http::Method::HEAD
        {
            return StatusCode::NOT_FOUND.into_response();
        }
        let path = request.uri().path().trim_start_matches('/');
        if !path.is_empty()
            && let Some(candidate) = safe_static(path)
            && candidate.is_file()
        {
            let mut static_request = Request::builder()
                .method(request.method().clone())
                .body(Body::empty())
                .unwrap();
            *static_request.headers_mut() = request_headers.clone();
            return ServeFile::new(candidate)
                .oneshot(static_request)
                .await
                .unwrap_or_else(|error| match error {})
                .map(Body::new);
        }
        match fs::read_to_string("dist/client/index.html").await {
            Ok(html) => Html(inject(html, &state, &request_uri).await).into_response(),
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    }
}
