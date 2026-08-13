use crate::{
    app::{Shared, timestamp_ms},
    config::HermesFilesystemMode,
    error::{AppError, AppResult},
    media,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::{get, post},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{collections::HashMap, time::Duration};

fn hub(state: &Shared) -> AppResult<&dyn crate::hermes::HermesTransport> {
    state
        .hermes
        .as_deref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))
}

fn profile_query(hub: &dyn crate::hermes::HermesTransport) -> Vec<(&'static str, String)> {
    hub.profile()
        .map(|p| vec![("profile", p.to_string())])
        .unwrap_or_default()
}

#[derive(Deserialize)]
struct MessagesQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

async fn messages(
    State(state): State<Shared>,
    Path(id): Path<String>,
    Query(input): Query<MessagesQuery>,
) -> AppResult<Json<Value>> {
    let hub = hub(&state)?;
    let path = crate::hermes::session_api_path(&id, "/messages")?;
    let mut query = profile_query(hub);
    query.extend([
        (
            "limit",
            input.limit.unwrap_or(100).clamp(1, 500).to_string(),
        ),
        ("offset", input.offset.unwrap_or(0).to_string()),
        ("order", "latest".into()),
    ]);
    Ok(Json(hub.get(&path, &query).await?))
}

async fn session(State(state): State<Shared>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    let gateway = hub(&state)?;
    let path = crate::hermes::session_api_path(&id, "")?;
    let mut detail = gateway.get(&path, &profile_query(gateway)).await?;
    let owned = state.hermes_active_ids.lock().await.contains(&id);
    let active = detail
        .get("is_active")
        .or_else(|| detail.get("active"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if let Some(object) = detail.as_object_mut() {
        object.insert("externallyActive".into(), Value::Bool(active && !owned));
    }
    Ok(Json(detail))
}

#[derive(Deserialize)]
struct MediaQuery {
    path: String,
}

async fn media(
    State(state): State<Shared>,
    Query(input): Query<MediaQuery>,
) -> AppResult<Response> {
    if input.path.trim().is_empty() || input.path.contains(['\r', '\n']) {
        return Err(AppError::bad("Hermes image path is invalid"));
    }
    let gateway = hub(&state)?;
    let mut query = profile_query(gateway);
    query.push(("path", input.path));
    let result = gateway.get("api/fs/read-data-url", &query).await?;
    let data_url = result
        .as_str()
        .or_else(|| result.get("dataUrl").and_then(Value::as_str))
        .ok_or_else(|| AppError::internal("Hermes returned invalid image data"))?;
    let (mime, encoded) = data_url
        .strip_prefix("data:")
        .and_then(|value| value.split_once(";base64,"))
        .ok_or_else(|| AppError::internal("Hermes returned invalid image data"))?;
    if !matches!(
        mime.to_ascii_lowercase().as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
    ) {
        return Err(AppError::bad("Hermes media is not a supported image"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| AppError::internal("Hermes returned invalid image data"))?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err(AppError::bad("Hermes image is too large"));
    }
    Ok(([(axum::http::header::CONTENT_TYPE, mime)], bytes).into_response())
}

async fn export_session(
    State(state): State<Shared>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    let gateway = hub(&state)?;
    let path = crate::hermes::session_api_path(&id, "/export")?;
    Ok(Json(gateway.get(&path, &profile_query(gateway)).await?))
}

async fn model_options(State(state): State<Shared>) -> AppResult<Json<Value>> {
    let gateway = hub(&state)?;
    Ok(Json(
        gateway
            .get("api/model/options", &profile_query(gateway))
            .await?,
    ))
}

async fn capabilities(State(state): State<Shared>) -> AppResult<Json<Value>> {
    let gateway = hub(&state)?;
    let config = gateway
        .get("api/config", &profile_query(gateway))
        .await
        .unwrap_or(Value::Null);
    let transcription = config
        .pointer("/stt/enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tts_provider = config
        .pointer("/tts/provider")
        .and_then(Value::as_str)
        .unwrap_or("");
    let playback = !tts_provider.is_empty() && !matches!(tts_provider, "none" | "disabled" | "off");
    let max_recording_seconds = config
        .pointer("/voice/max_recording_seconds")
        .and_then(Value::as_u64)
        .unwrap_or(120)
        .clamp(5, 600);
    Ok(Json(
        json!({"compatible":true,"transcription":transcription,"playback":playback,"readerAi":false,"maxRecordingSeconds":max_recording_seconds}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscribeBody {
    data_url: String,
    mime_type: Option<String>,
}

async fn transcribe(
    State(state): State<Shared>,
    Json(body): Json<TranscribeBody>,
) -> AppResult<Json<Value>> {
    if body.data_url.len() > 24 * 1024 * 1024 {
        return Err(AppError::bad("Voice recording is too large"));
    }
    Ok(Json(
        hub(&state)?
            .post(
                "api/audio/transcribe",
                json!({"data_url":body.data_url,"mime_type":body.mime_type}),
            )
            .await?,
    ))
}

#[derive(Deserialize)]
struct SpeakBody {
    text: String,
}

async fn speak(State(state): State<Shared>, Json(body): Json<SpeakBody>) -> AppResult<Json<Value>> {
    let text = body.text.trim();
    if text.is_empty() || text.len() > 20_000 {
        return Err(AppError::bad(
            "Reply playback text must be between 1 and 20,000 characters",
        ));
    }
    Ok(Json(
        hub(&state)?
            .post("api/audio/speak", json!({"text":text}))
            .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnBody {
    session_id: Option<String>,
    cwd: Option<String>,
    text: String,
    #[serde(default)]
    takeover: bool,
    #[serde(default)]
    attachments: Vec<AttachmentBody>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentBody {
    name: String,
    mime_type: String,
    content_base64: String,
}

const MAX_ATTACHMENT_BYTES: usize = 16 * 1024 * 1024;

fn decode_attachment(value: &str) -> AppResult<Vec<u8>> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| AppError::bad("Attachment contains invalid base64"))?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::bad("Hermes attachments cannot exceed 16 MiB"));
    }
    Ok(bytes)
}

fn gateway_session_id(value: Option<&str>, missing: &'static str) -> AppResult<String> {
    let id = value.ok_or_else(|| AppError::internal(missing))?;
    crate::hermes::validate_opaque_id(id)
        .map_err(|_| AppError::internal("Hermes returned an invalid session id"))?;
    Ok(id.to_string())
}

fn prompt_error_allows_resume(error: &AppError) -> bool {
    error.1.to_ascii_lowercase().contains("session not found")
}

fn valid_event_id(value: Option<&str>) -> Option<String> {
    value
        .filter(|id| crate::hermes::validate_opaque_id(id).is_ok())
        .map(str::to_string)
}

async fn normalize_hermes_event(
    runtime_ids: &tokio::sync::Mutex<HashMap<String, String>>,
    active_ids: &tokio::sync::Mutex<std::collections::HashSet<String>>,
    mut value: Value,
) -> Value {
    let kind = value
        .pointer("/params/type")
        .and_then(Value::as_str)
        .map(str::to_string);
    if kind.as_deref() == Some("transport.disconnected") {
        runtime_ids.lock().await.clear();
        active_ids.lock().await.clear();
        return value;
    }

    let runtime = valid_event_id(value.pointer("/params/session_id").and_then(Value::as_str));
    let supplied_durable = valid_event_id(
        value
            .pointer("/params/durable_session_id")
            .and_then(Value::as_str),
    );
    let continuation = valid_event_id(
        value
            .pointer("/params/payload/stored_session_id")
            .or_else(|| value.pointer("/params/stored_session_id"))
            .and_then(Value::as_str),
    );
    let terminal = matches!(kind.as_deref(), Some("message.complete" | "error"))
        || (kind.as_deref() == Some("session.info")
            && value
                .pointer("/params/payload/running")
                .and_then(Value::as_bool)
                == Some(false));

    let mut ids = runtime_ids.lock().await;
    let previous = runtime.as_ref().and_then(|runtime| {
        ids.iter()
            .find_map(|(durable, live)| (live == runtime).then(|| durable.clone()))
    });
    let durable = continuation
        .clone()
        .or(supplied_durable)
        .or_else(|| previous.clone());
    if let (Some(runtime), Some(next)) = (&runtime, &continuation)
        && previous.as_ref() != Some(next)
    {
        ids.retain(|_, live| live != runtime);
        ids.insert(next.clone(), runtime.clone());
        let mut active = active_ids.lock().await;
        if previous.as_ref().is_some_and(|old| active.remove(old)) {
            active.insert(next.clone());
        }
    }
    if terminal {
        let mut active = active_ids.lock().await;
        if let Some(durable) = durable.as_ref() {
            active.remove(durable);
        }
        if let Some(runtime) = runtime.as_ref() {
            let owned = ids
                .iter()
                .filter(|(_, live)| *live == runtime)
                .map(|(durable, _)| durable.clone())
                .collect::<Vec<_>>();
            for durable in owned {
                active.remove(&durable);
            }
        }
    }
    drop(ids);

    if let Some(params) = value.get_mut("params").and_then(Value::as_object_mut) {
        if let Some(previous) = previous {
            params.insert(
                "previous_durable_session_id".into(),
                Value::String(previous),
            );
        }
        if let Some(durable) = durable {
            params.insert("durable_session_id".into(), Value::String(durable));
        }
    }
    value
}

async fn publish_hermes_event(state: &Shared, value: Value) {
    let value =
        normalize_hermes_event(&state.hermes_runtime_ids, &state.hermes_active_ids, value).await;
    let _ = state.hermes_events.send(value);
}

pub(crate) fn start_event_bridge(
    state: &Shared,
    mut receiver: tokio::sync::broadcast::Receiver<Value>,
) {
    let state = std::sync::Arc::downgrade(state);
    tokio::spawn(async move {
        loop {
            match receiver.recv().await {
                Ok(value) => {
                    let Some(state) = state.upgrade() else {
                        break;
                    };
                    publish_hermes_event(&state, value).await;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if let Some(state) = state.upgrade() {
                        state.hermes_runtime_ids.lock().await.clear();
                        state.hermes_active_ids.lock().await.clear();
                    } else {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

async fn is_externally_active(state: &Shared, stored_id: &str) -> AppResult<bool> {
    crate::hermes::validate_opaque_id(stored_id)?;
    if state.hermes_active_ids.lock().await.contains(stored_id) {
        return Ok(false);
    }
    let hub = hub(state)?;
    let path = crate::hermes::session_api_path(stored_id, "")?;
    let detail = hub.get(&path, &profile_query(hub)).await?;
    Ok(detail
        .get("is_active")
        .or_else(|| detail.get("active"))
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

async fn turn(State(state): State<Shared>, Json(body): Json<TurnBody>) -> AppResult<Json<Value>> {
    let text = body.text.trim();
    if text.is_empty() {
        return Err(AppError::bad("Prompt is required"));
    }
    if let Some(stored_id) = body.session_id.as_deref() {
        crate::hermes::validate_opaque_id(stored_id)?;
        if !body.takeover && is_externally_active(&state, stored_id).await? {
            return Err(AppError::conflict(
                "Hermes session is active elsewhere; confirm takeover",
            ));
        }
    }
    let hub = hub(&state)?;
    let profile = hub.profile().map(str::to_string);
    let source = "derp-media-server";
    let (runtime_id, stored_id) = if let Some(stored_id) = body.session_id {
        if let Some(runtime) = state
            .hermes_runtime_ids
            .lock()
            .await
            .get(&stored_id)
            .cloned()
        {
            (runtime, stored_id)
        } else {
            let resumed = hub
                .rpc(
                    "session.resume",
                    json!({
                        "session_id":stored_id, "cols":96, "source":source,
                        "omit_messages":true, "profile":profile,
                    }),
                )
                .await?;
            let runtime = gateway_session_id(
                resumed.get("session_id").and_then(Value::as_str),
                "Hermes resume omitted runtime session id",
            )?;
            let durable = gateway_session_id(
                resumed
                    .get("session_key")
                    .or_else(|| resumed.get("resumed"))
                    .and_then(Value::as_str)
                    .or(Some(stored_id.as_str())),
                "Hermes resume omitted durable session id",
            )?;
            state
                .hermes_runtime_ids
                .lock()
                .await
                .insert(durable.clone(), runtime.clone());
            (runtime, durable)
        }
    } else {
        let created = hub
            .rpc(
                "session.create",
                json!({
                    "cols":96, "source":source, "cwd":body.cwd.unwrap_or_default(),
                    "profile":profile,
                }),
            )
            .await?;
        let runtime = gateway_session_id(
            created.get("session_id").and_then(Value::as_str),
            "Hermes create omitted runtime session id",
        )?;
        let durable = gateway_session_id(
            created
                .get("stored_session_id")
                .or_else(|| created.get("session_key"))
                .and_then(Value::as_str)
                .or(Some(runtime.as_str())),
            "Hermes create omitted durable session id",
        )?;
        state
            .hermes_runtime_ids
            .lock()
            .await
            .insert(durable.clone(), runtime.clone());
        (runtime, durable)
    };
    let mut prompt_text = text.to_string();
    for attachment in body.attachments {
        let _bytes = decode_attachment(&attachment.content_base64)?;
        let is_image = attachment.mime_type.starts_with("image/");
        let result = if is_image {
            hub.rpc(
                "image.attach_bytes",
                json!({
                    "session_id":runtime_id,
                    "filename":attachment.name,
                    "content_base64":attachment.content_base64,
                }),
            )
            .await?
        } else {
            let data_url = format!(
                "data:{};base64,{}",
                attachment.mime_type, attachment.content_base64
            );
            hub.rpc(
                "file.attach",
                json!({
                    "session_id":runtime_id,
                    "name":attachment.name,
                    "data_url":data_url,
                }),
            )
            .await?
        };
        if result.get("attached").and_then(Value::as_bool) == Some(false) {
            return Err(AppError::bad(
                result
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Hermes rejected attachment"),
            ));
        }
        if !is_image && let Some(reference) = result.get("ref_text").and_then(Value::as_str) {
            prompt_text.push('\n');
            prompt_text.push_str(reference);
        }
    }
    state
        .hermes_active_ids
        .lock()
        .await
        .insert(stored_id.clone());
    let gateway = state.hermes.as_ref().expect("checked above").clone();
    let durable_for_event = stored_id.clone();
    let runtime_ids = state.clone();
    let text = prompt_text;
    tokio::spawn(async move {
        let first = gateway
            .rpc(
                "prompt.submit",
                json!({"session_id":runtime_id,"text":text.clone()}),
            )
            .await;
        let result = if first.as_ref().err().is_some_and(prompt_error_allows_resume) {
            match gateway
                .rpc(
                    "session.resume",
                    json!({
                        "session_id":durable_for_event,
                        "cols":96,
                        "source":source,
                        "omit_messages":true,
                        "profile":profile,
                    }),
                )
                .await
            {
                Ok(resumed) => {
                    let runtime = gateway_session_id(
                        resumed.get("session_id").and_then(Value::as_str),
                        "Hermes resume omitted runtime session id",
                    );
                    if let Ok(runtime) = runtime {
                        runtime_ids
                            .hermes_runtime_ids
                            .lock()
                            .await
                            .insert(durable_for_event.clone(), runtime.clone());
                        gateway
                            .rpc("prompt.submit", json!({"session_id":runtime,"text":text}))
                            .await
                    } else {
                        first
                    }
                }
                Err(_) => first,
            }
        } else {
            first
        };
        if let Err(error) = result {
            publish_hermes_event(
                &runtime_ids,
                json!({
                    "jsonrpc":"2.0", "method":"event", "params":{
                        "type":"error", "durable_session_id":durable_for_event,
                        "payload":{"message":error.1},
                    },
                }),
            )
            .await;
        }
    });
    Ok(Json(json!({"sessionId":stored_id,"accepted":true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn attachment_limit_is_exactly_sixteen_mib() {
        let at_limit = STANDARD.encode(vec![0; MAX_ATTACHMENT_BYTES]);
        let over_limit = STANDARD.encode(vec![0; MAX_ATTACHMENT_BYTES + 1]);
        assert_eq!(
            decode_attachment(&at_limit).unwrap().len(),
            MAX_ATTACHMENT_BYTES
        );
        assert!(decode_attachment(&over_limit).is_err());
        assert!(decode_attachment("not base64").is_err());
    }

    #[test]
    fn shared_references_are_typed_quoted_and_reject_ambiguous_backticks() {
        let file = quoted_reference("file", std::path::Path::new("C:/Media/a file.txt")).unwrap();
        assert_eq!(file, "@file:`C:/Media/a file.txt`");
        assert!(quoted_reference("folder", std::path::Path::new("C:/bad`name")).is_err());
    }

    #[test]
    fn timeout_is_not_treated_as_safe_to_retry() {
        assert!(!prompt_error_allows_resume(&AppError::internal(
            "Hermes gateway RPC timed out"
        )));
        assert!(prompt_error_allows_resume(&AppError(
            StatusCode::BAD_REQUEST,
            "Session not found".into()
        )));
    }

    #[tokio::test]
    async fn event_mapping_rotates_once_then_expires_on_completion() {
        let ids =
            tokio::sync::Mutex::new(HashMap::from([("durable-old".into(), "runtime-1".into())]));
        let active =
            tokio::sync::Mutex::new(std::collections::HashSet::from(["durable-old".to_string()]));
        let rotated = normalize_hermes_event(
            &ids,
            &active,
            json!({"method":"event","params":{
                "type":"message.delta","session_id":"runtime-1",
                "payload":{"stored_session_id":"durable-new","text":"a"}
            }}),
        )
        .await;
        assert_eq!(
            rotated.pointer("/params/previous_durable_session_id"),
            Some(&Value::String("durable-old".into()))
        );
        assert_eq!(
            rotated.pointer("/params/durable_session_id"),
            Some(&Value::String("durable-new".into()))
        );
        assert_eq!(
            ids.lock().await.get("durable-new").map(String::as_str),
            Some("runtime-1")
        );
        assert_eq!(
            active.lock().await.iter().next().map(String::as_str),
            Some("durable-new")
        );

        let completed = normalize_hermes_event(
            &ids,
            &active,
            json!({"method":"event","params":{
                "type":"message.complete","session_id":"runtime-1","payload":{}
            }}),
        )
        .await;
        assert_eq!(
            completed.pointer("/params/durable_session_id"),
            Some(&Value::String("durable-new".into()))
        );
        assert_eq!(
            ids.lock().await.get("durable-new").map(String::as_str),
            Some("runtime-1")
        );
        assert!(active.lock().await.is_empty());
    }

    #[tokio::test]
    async fn disconnect_expires_all_owned_sessions() {
        let ids = tokio::sync::Mutex::new(HashMap::from([
            ("one".into(), "runtime-1".into()),
            ("two".into(), "runtime-2".into()),
        ]));
        let active = tokio::sync::Mutex::new(std::collections::HashSet::from([
            "one".to_string(),
            "two".to_string(),
        ]));
        normalize_hermes_event(
            &ids,
            &active,
            json!({"method":"event","params":{"type":"transport.disconnected"}}),
        )
        .await;
        assert!(ids.lock().await.is_empty());
        assert!(active.lock().await.is_empty());
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionBody {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteerBody {
    session_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BranchBody {
    session_id: String,
    name: Option<String>,
    count: Option<usize>,
}

async fn attached_runtime_id(
    state: &Shared,
    durable: &str,
    missing: &'static str,
) -> AppResult<String> {
    crate::hermes::validate_opaque_id(durable)?;
    state
        .hermes_runtime_ids
        .lock()
        .await
        .get(durable)
        .cloned()
        .ok_or_else(|| AppError::conflict(missing))
}

async fn branch(
    State(state): State<Shared>,
    Json(body): Json<BranchBody>,
) -> AppResult<Json<Value>> {
    let runtime = attached_runtime_id(
        &state,
        &body.session_id,
        "Open the Hermes session before branching it",
    )
    .await?;
    let result = hub(&state)?
        .rpc(
            "session.branch",
            json!({"session_id":runtime,"name":body.name,"count":body.count}),
        )
        .await?;
    if let (Some(stored), Some(runtime)) = (
        result.get("stored_session_id").and_then(Value::as_str),
        result.get("session_id").and_then(Value::as_str),
    ) {
        let stored = gateway_session_id(Some(stored), "Hermes branch omitted durable session id")?;
        let runtime =
            gateway_session_id(Some(runtime), "Hermes branch omitted runtime session id")?;
        state
            .hermes_runtime_ids
            .lock()
            .await
            .insert(stored, runtime);
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
struct CompletionQuery {
    kind: String,
    text: String,
    cwd: Option<String>,
}

async fn completions(
    State(state): State<Shared>,
    Query(query): Query<CompletionQuery>,
) -> AppResult<Json<Value>> {
    let (method, params) = match query.kind.as_str() {
        "slash" => ("complete.slash", json!({"text":query.text})),
        "path" => (
            "complete.path",
            json!({"word":query.text,"cwd":query.cwd.unwrap_or_default()}),
        ),
        _ => return Err(AppError::bad("Unknown Hermes completion kind")),
    };
    Ok(Json(hub(&state)?.rpc(method, params).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBody {
    session_id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RewindBody {
    session_id: String,
    text: String,
    user_ordinal: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceBody {
    path: String,
    is_directory: bool,
}

fn quoted_reference(kind: &str, path: &std::path::Path) -> AppResult<String> {
    let value = path.to_string_lossy().replace('\\', "/");
    if value.contains('`') {
        return Err(AppError::bad(
            "Hermes path references cannot contain backticks",
        ));
    }
    Ok(format!("@{kind}:`{value}`"))
}

async fn reference(
    State(state): State<Shared>,
    Json(body): Json<ReferenceBody>,
) -> AppResult<Json<Value>> {
    let config = state
        .config
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    let resolved = media::resolve(&state.config, &crate::app::roots(&state), &body.path)?;
    let metadata = tokio::fs::metadata(&resolved.full)
        .await
        .map_err(AppError::io)?;
    if metadata.is_dir() != body.is_directory {
        return Err(AppError::bad("Dragged path type changed"));
    }
    match config.filesystem_mode {
        HermesFilesystemMode::Shared => {
            let canonical = tokio::fs::canonicalize(&resolved.full)
                .await
                .map_err(AppError::io)?;
            let text = quoted_reference(
                if metadata.is_dir() { "folder" } else { "file" },
                &canonical,
            )?;
            Ok(Json(json!({"mode":"shared","text":text})))
        }
        HermesFilesystemMode::Upload => {
            if metadata.is_dir() {
                return Err(AppError::bad(
                    "Folder references require Hermes shared filesystem mode",
                ));
            }
            if metadata.len() > MAX_ATTACHMENT_BYTES as u64 {
                return Err(AppError::bad("Hermes attachments cannot exceed 16 MiB"));
            }
            let bytes = tokio::fs::read(&resolved.full)
                .await
                .map_err(AppError::io)?;
            let name = resolved
                .full
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("attachment");
            let extension = resolved
                .full
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            Ok(Json(json!({"mode":"upload","attachment":{
                "name":name,"mimeType":media::mime_type(extension),"size":bytes.len(),
                "contentBase64":STANDARD.encode(bytes),
            }})))
        }
    }
}

async fn rewind(
    State(state): State<Shared>,
    Json(body): Json<RewindBody>,
) -> AppResult<Json<Value>> {
    let text = body.text.trim();
    if text.is_empty() {
        return Err(AppError::bad("Replacement prompt is required"));
    }
    let runtime = attached_runtime_id(
        &state,
        &body.session_id,
        "Open the Hermes session before rewinding it",
    )
    .await?;
    let gateway = hub(&state)?;
    state
        .hermes_active_ids
        .lock()
        .await
        .insert(body.session_id.clone());
    let result = gateway
        .rpc(
            "prompt.submit",
            json!({
                "session_id":runtime,
                "text":text,
                "confirm_truncate":true,
                "truncate_before_user_ordinal":body.user_ordinal,
                "confirm_empty_truncate":body.user_ordinal == 0,
            }),
        )
        .await;
    match result {
        Ok(result) => Ok(Json(result)),
        Err(error) => {
            state
                .hermes_active_ids
                .lock()
                .await
                .remove(&body.session_id);
            Err(error)
        }
    }
}

async fn rename(
    State(state): State<Shared>,
    Json(body): Json<RenameBody>,
) -> AppResult<Json<Value>> {
    let title = body.title.trim();
    if title.is_empty() {
        return Err(AppError::bad("Session title is required"));
    }
    let gateway = hub(&state)?;
    let path = crate::hermes::session_api_path(&body.session_id, "")?;
    Ok(Json(
        gateway
            .patch(&path, json!({"title":title,"profile":gateway.profile()}))
            .await?,
    ))
}

async fn steer(State(state): State<Shared>, Json(body): Json<SteerBody>) -> AppResult<Json<Value>> {
    let text = body.text.trim();
    if text.is_empty() {
        return Err(AppError::bad("Steer text is required"));
    }
    let runtime = attached_runtime_id(
        &state,
        &body.session_id,
        "Hermes session is not attached in this server",
    )
    .await?;
    Ok(Json(
        hub(&state)?
            .rpc("session.steer", json!({"session_id":runtime,"text":text}))
            .await?,
    ))
}

async fn stop(
    State(state): State<Shared>,
    Json(body): Json<SessionBody>,
) -> AppResult<Json<Value>> {
    let runtime = attached_runtime_id(
        &state,
        &body.session_id,
        "Hermes session is not attached in this server",
    )
    .await?;
    Ok(Json(
        hub(&state)?
            .rpc("session.interrupt", json!({"session_id":runtime}))
            .await?,
    ))
}

async fn restore(
    State(state): State<Shared>,
    Json(body): Json<SessionBody>,
) -> AppResult<Json<Value>> {
    let gateway = hub(&state)?;
    let path = crate::hermes::session_api_path(&body.session_id, "")?;
    Ok(Json(
        gateway
            .patch(&path, json!({"archived":false,"profile":gateway.profile()}))
            .await?,
    ))
}

async fn archive(
    State(state): State<Shared>,
    Json(body): Json<SessionBody>,
) -> AppResult<Json<Value>> {
    let gateway = hub(&state)?;
    let path = crate::hermes::session_api_path(&body.session_id, "")?;
    let detail = gateway.get(&path, &profile_query(gateway)).await?;
    if detail.get("is_active").and_then(Value::as_bool) == Some(true)
        || detail
            .get("queued_prompt_count")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            > 0
    {
        return Err(AppError::conflict(
            "Busy Hermes sessions cannot be archived",
        ));
    }
    Ok(Json(
        gateway
            .patch(&path, json!({"archived":true,"profile":gateway.profile()}))
            .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecisionBody {
    session_id: String,
    kind: String,
    choice: Value,
    request_id: Option<String>,
}

async fn decision(
    State(state): State<Shared>,
    Json(body): Json<DecisionBody>,
) -> AppResult<Json<Value>> {
    let (method, params) = match body.kind.as_str() {
        "approval" => {
            let runtime = attached_runtime_id(
                &state,
                &body.session_id,
                "Hermes session is not attached in this server",
            )
            .await?;
            (
                "approval.respond",
                json!({"session_id":runtime,"choice":body.choice}),
            )
        }
        "clarify" => (
            "clarify.respond",
            json!({"request_id":body.request_id,"answer":body.choice}),
        ),
        "sudo" => (
            "sudo.respond",
            json!({"request_id":body.request_id,"password":body.choice}),
        ),
        "secret" => (
            "secret.respond",
            json!({"request_id":body.request_id,"value":body.choice}),
        ),
        _ => return Err(AppError::bad("Unknown Hermes decision type")),
    };
    Ok(Json(hub(&state)?.rpc(method, params).await?))
}

async fn events(State(state): State<Shared>) -> Response {
    let mut receiver = state.hermes_events.subscribe();
    if let Some(gateway) = state.hermes.as_ref() {
        let _ = gateway.ensure_events().await;
    }
    let stream = async_stream::stream! {
        yield Ok::<Event, std::convert::Infallible>(Event::default().json_data(json!({"type":"connected","timestamp":timestamp_ms()})).unwrap());
        loop { match receiver.recv().await {
            Ok(value) => yield Ok(Event::default().json_data(value).unwrap()),
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(_) => break,
        }}
    };
    Sse::new(stream)
        .keep_alive(
            KeepAlive::default()
                .interval(Duration::from_secs(20))
                .text("keep-alive"),
        )
        .into_response()
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/hermes/sessions/{id}/messages", get(messages))
        .route("/api/hermes/sessions/{id}", get(session))
        .route("/api/hermes/sessions/{id}/export", get(export_session))
        .route("/api/hermes/media", get(media))
        .route("/api/hermes/model-options", get(model_options))
        .route("/api/hermes/capabilities", get(capabilities))
        .route("/api/hermes/transcribe", post(transcribe))
        .route("/api/hermes/speak", post(speak))
        .route("/api/hermes/turn", post(turn))
        .route("/api/hermes/stop", post(stop))
        .route("/api/hermes/steer", post(steer))
        .route("/api/hermes/branch", post(branch))
        .route("/api/hermes/rename", post(rename))
        .route("/api/hermes/rewind", post(rewind))
        .route("/api/hermes/reference", post(reference))
        .route("/api/hermes/completions", get(completions))
        .route("/api/hermes/restore", post(restore))
        .route("/api/hermes/archive", post(archive))
        .route("/api/hermes/decision", post(decision))
        .route("/api/hermes/events", get(events))
        .layer(DefaultBodyLimit::max(128 * 1024 * 1024))
}
