use crate::{
    app::{
        AppState, Shared, cookies, find_share, knowledge_base_root, roots, stats_path, timestamp_ms,
    },
    media,
    route_contract::{self, OwnerRoute, RouteKind},
    routes::{media as media_routes, settings},
    shares, store,
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

fn auth_config(state: &AppState) -> Value {
    let runtime = roots(state);
    let mut all = state.config.roots.clone();
    all.extend(runtime);
    let editable = if all.len() == 1 {
        all[0].editable_folders.clone()
    } else {
        let mut values = state.config.roots[0].editable_folders.clone();
        values.extend(all.iter().flat_map(|root| {
            root.editable_folders
                .iter()
                .map(move |folder| format!("{}/{}", root.name, folder.replace('\\', "/")))
        }));
        values
    };
    json!({"enabled":state.config.auth.enabled,"shareLinkDomain":state.config.share_link_domain,"editableFolders":editable,"mediaRoots":all.iter().map(|root|json!({"name":root.name,"editableFolders":root.editable_folders})).collect::<Vec<_>>()})
}

fn parent(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

fn visible(entry: &walkdir::DirEntry) -> bool {
    entry.depth() == 0
        || !entry.file_type().is_dir()
        || !entry.file_name().to_string_lossy().starts_with('.')
            && ![
                "node_modules",
                "$RECYCLE.BIN",
                "System Volume Information",
                ".git",
                ".svn",
                ".hg",
                "__pycache__",
                ".DS_Store",
            ]
            .contains(&entry.file_name().to_string_lossy().as_ref())
}

fn kb_recent(state: &AppState, scope: &str) -> Value {
    let Ok(resolved) = media::resolve(&state.config, &roots(state), scope) else {
        return json!({"results":[]});
    };
    let mut files = walkdir::WalkDir::new(&resolved.full)
        .into_iter()
        .filter_entry(visible)
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            let relative = entry
                .path()
                .strip_prefix(&resolved.root.path)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            let path = if state.config.roots.len() + roots(state).len() > 1 {
                format!("{}/{}", resolved.root.name, relative)
            } else {
                relative
            };
            Some((modified, path))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|item| std::cmp::Reverse(item.0));
    json!({"results":files.into_iter().take(10).map(|(modified,path)|json!({
        "name":shares::name(&path),
        "path":path,
        "modifiedAt":chrono::DateTime::<chrono::Utc>::from(modified)
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    })).collect::<Vec<_>>()})
}

fn share_file_path(state: &AppState, share: &shares::Share, requested: &str) -> Option<String> {
    let share_path = share.path.replace('\\', "/");
    let requested = requested.replace('\\', "/");
    if !share.is_directory {
        return (requested == share_path).then_some(share_path);
    }
    if requested == share_path || requested.starts_with(&(share_path.clone() + "/")) {
        return shares::authorize_grant_logical_path(
            &state.config,
            &roots(state),
            &share_path,
            &requested,
        )
        .ok()
        .map(|_| requested);
    }
    shares::resolve_authorized_subpath(&state.config, &roots(state), share, &requested)
        .ok()
        .map(|authorized| authorized.logical)
}

fn share_listing_dir(
    state: &AppState,
    share: &shares::Share,
    dir: Option<&String>,
    path: &str,
) -> String {
    if let Some(dir) = dir {
        return dir.replace('\\', "/");
    }
    let Some(resolved) = share_file_path(state, share, path) else {
        return String::new();
    };
    let root = share.path.replace('\\', "/");
    let relative = resolved.strip_prefix(&(root + "/")).unwrap_or("");
    parent(relative)
}

async fn shared_files(state: &AppState, share: &shares::Share, dir: &str) -> Option<Value> {
    let logical = shares::resolve_authorized_subpath(&state.config, &roots(state), share, dir)
        .ok()?
        .logical;
    let listing = crate::application_queries::browse_grant(state, &share.path, &logical)
        .await
        .ok()?;
    Some(json!({"files":listing.files}))
}

async fn share_info(
    state: &AppState,
    token: &str,
    headers: &axum::http::HeaderMap,
) -> Option<Value> {
    let share = find_share(state, token).ok()?;
    if share.unavailable == Some(true) {
        return None;
    }
    let authorized = shares::authorized(&state.config, &share, &cookies(headers));
    Some(crate::application_queries::share_info(state, &share, token, authorized).await)
}

async fn dehydrated(
    state: &AppState,
    uri: &axum::http::Uri,
    headers: &axum::http::HeaderMap,
) -> Value {
    let path = uri.path();
    let params = url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .into_owned()
        .collect::<HashMap<_, _>>();
    let mut queries = Vec::new();
    let route = route_contract::classify_path(path);
    if let RouteKind::Owner(owner_route) = route {
        let dir = params
            .get("dir")
            .or_else(|| params.get("path"))
            .cloned()
            .unwrap_or_default();
        if owner_route == OwnerRoute::Library
            && dir != "Favorites"
            && dir != "Most Played"
            && dir != "Shares"
            && let Ok(files) = crate::application_queries::browse_owner(
                state,
                &dir,
                crate::resources::ReadSurface::Ssr,
                0,
            )
            .await
        {
            queries.push(query(
                json!(["files", dir]),
                serde_json::to_value(files).unwrap_or(Value::Null),
            ));
        }
        queries.push(query(json!(["settings"]), settings::sanitized(state)));
        queries.push(query(
            json!(["shares"]),
            json!({"shares":shares::read(&state.config,&roots(state))}),
        ));
        let stats = store::section(
            &stats_path(state),
            &state.config.library_key,
            json!({"views":{},"shareViews":{}}),
        );
        queries.push(query(
            json!(["stats"]),
            json!({
                "views":stats["views"].as_object().cloned().unwrap_or_default(),
                "shareViews":stats["shareViews"].as_object().cloned().unwrap_or_default()
            }),
        ));
        queries.push(query(json!(["auth-config"]), auth_config(state)));
        if owner_route == OwnerRoute::Library && knowledge_base_root(state, &dir).is_some() {
            queries.push(query(
                json!(["content", "admin", "kb-recent", dir]),
                kb_recent(state, &dir),
            ));
        }
        if let Some(viewing) = params.get("viewing") {
            let extension = Path::new(viewing)
                .extension()
                .unwrap_or_default()
                .to_string_lossy();
            if media::media_type(&extension) == "text" {
                if let Ok(resolved) = media::resolve(&state.config, &roots(state), viewing)
                    && let Ok(content) = std::fs::read_to_string(resolved.full)
                {
                    queries.push(query(
                        json!(["content", "admin", "text", viewing]),
                        json!(content),
                    ));
                }
            } else if media::media_type(&extension) != "pdf" {
                let listing = params
                    .get("dir")
                    .or_else(|| params.get("path"))
                    .cloned()
                    .unwrap_or_else(|| parent(viewing));
                if let Ok(files) = crate::application_queries::browse_owner(
                    state,
                    &listing,
                    crate::resources::ReadSurface::Ssr,
                    0,
                )
                .await
                {
                    queries.push(query(
                        json!(["files", listing]),
                        serde_json::to_value(files).unwrap_or(Value::Null),
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
                && let Ok(resolved) = media::resolve(&state.config, &roots(state), playing)
                && let Ok(metadata) = media_routes::audio_metadata_path(&resolved.full).await
            {
                queries.push(query(json!(["audio-metadata", "v2", playing]), metadata.0));
            }
            if matches!(kind, "audio" | "video") {
                let listing = params
                    .get("dir")
                    .or_else(|| params.get("path"))
                    .cloned()
                    .unwrap_or_else(|| parent(playing));
                if let Ok(files) = crate::application_queries::browse_owner(
                    state,
                    &listing,
                    crate::resources::ReadSurface::Ssr,
                    0,
                )
                .await
                {
                    queries.push(query(
                        json!(["files", listing]),
                        serde_json::to_value(files).unwrap_or(Value::Null),
                    ));
                }
            }
        }
    } else if let RouteKind::Share { token, .. } = route
        && let Some(info) = share_info(state, token, headers).await
    {
        let authorized = info["authorized"].as_bool().unwrap_or(false);
        let directory = info["isDirectory"].as_bool().unwrap_or(false);
        queries.push(query(json!(["share-info", token]), info));
        if authorized
            && directory
            && let Ok(share) = find_share(state, token)
        {
            let dir = params
                .get("dir")
                .or_else(|| params.get("path"))
                .cloned()
                .unwrap_or_default();
            if let Some(files) = shared_files(state, &share, &dir).await {
                queries.push(query(json!(["share-files", token, dir]), files));
            }
            if knowledge_base_root(state, &share.path).is_some()
                && let Ok(scope) =
                    shares::resolve_authorized_subpath(&state.config, &roots(state), &share, &dir)
            {
                queries.push(query(
                    json!(["content", "share", token, "kb-recent", params.get("dir")]),
                    kb_recent(state, &scope.logical),
                ));
            }
        }
        if authorized && let Ok(share) = find_share(state, token) {
            if let Some(viewing_path) = params.get("viewing") {
                let viewing_kind = Path::new(viewing_path)
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy();
                if media::media_type(&viewing_kind) == "text"
                    && let Some(logical) = share_file_path(state, &share, viewing_path)
                    && let Ok(resolved) = media::resolve(&state.config, &roots(state), &logical)
                    && let Ok(content) = std::fs::read_to_string(resolved.full)
                {
                    queries.push(query(
                        json!([
                            "content",
                            "share",
                            token,
                            "text-target",
                            share.path,
                            viewing_path
                        ]),
                        json!(content),
                    ));
                } else if share.is_directory && media::media_type(&viewing_kind) != "pdf" {
                    let dir = share_listing_dir(
                        state,
                        &share,
                        params.get("dir").or_else(|| params.get("path")),
                        viewing_path,
                    );
                    if let Some(files) = shared_files(state, &share, &dir).await {
                        queries.push(query(json!(["share-files", token, dir]), files));
                    }
                }
            }
            if let Some(playing) = params.get("playing") {
                let playing_kind = Path::new(playing)
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy();
                let kind = media::media_type(&playing_kind);
                if kind == "audio"
                    && let Some(logical) = share_file_path(state, &share, playing)
                    && let Ok(resolved) = media::resolve(&state.config, &roots(state), &logical)
                    && let Ok(metadata) = media_routes::audio_metadata_path(&resolved.full).await
                {
                    queries.push(query(json!(["audio-metadata", "v2", playing]), metadata.0));
                }
                if share.is_directory && matches!(kind, "audio" | "video") {
                    let dir = share_listing_dir(
                        state,
                        &share,
                        params.get("dir").or_else(|| params.get("path")),
                        playing,
                    );
                    if let Some(files) = shared_files(state, &share, &dir).await {
                        queries.push(query(json!(["share-files", token, dir]), files));
                    }
                }
            }
        }
    }
    json!({"mutations":[],"queries":queries})
}

async fn inject(
    html: String,
    state: &AppState,
    uri: &axum::http::Uri,
    headers: &axum::http::HeaderMap,
) -> String {
    html.replace(
        "<!--DEHYDRATED-->",
        &format!(
            "<script>window.__DEHYDRATED_STATE__={}</script>",
            dehydrated(state, uri, headers).await
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

fn app_document_status(path: &str) -> StatusCode {
    if route_contract::classify_path(path) == RouteKind::NotFound {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::OK
    }
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
                            &headers,
                        )
                        .await,
                    )
                } else {
                    Body::from(bytes)
                };
                let mut output = Response::new(body);
                *output.status_mut() = if html && status.is_success() {
                    app_document_status(request_uri.path())
                } else {
                    status
                };
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
            Ok(html) => {
                let mut response = Html(inject(html, &state, &request_uri, &request_headers).await)
                    .into_response();
                *response.status_mut() = app_document_status(request_uri.path());
                response
            }
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        }
    }
}
