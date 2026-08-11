use crate::{
    access::AuthenticatedGrant,
    app::{AppState, Shared, cookies, find_share, rate_limit, roots, stats_path},
    content_commands::{
        ChildName, CommandError, CommandErrorCode, ContentCommand, ContentOperation,
        CreatePathMode, request_digest,
    },
    error::{AppError, AppResult},
    resources::{ReadSurface, ResourceKind, ResourceSummary, ResourceVersion},
    shares, store, workspace_persistence,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub(crate) fn validate(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
) -> AppResult<shares::Share> {
    let share = find_share(state, token)?;
    if share.unavailable == Some(true) {
        return Err(AppError(
            StatusCode::GONE,
            "Share mount is unavailable".into(),
        ));
    }
    if !shares::authorized(&state.config, &share, &cookies(headers)) {
        return Err(AppError(
            StatusCode::UNAUTHORIZED,
            "Passcode required".into(),
        ));
    }
    Ok(share)
}

pub(crate) async fn authenticate(
    state: &AppState,
    token: &str,
    headers: &HeaderMap,
) -> AppResult<AuthenticatedGrant> {
    state
        .access
        .authenticate_grant(token, &cookies(headers))
        .await
        .map_err(|error| error.into_app_error())
}

async fn info(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let share = find_share(&state, &token)?;
    if share.unavailable == Some(true) {
        return Err(AppError(
            StatusCode::GONE,
            "Share mount is unavailable".into(),
        ));
    }
    let authorized = shares::authorized(&state.config, &share, &cookies(&headers));
    let result = crate::application_queries::share_info(&state, &share, &token, authorized).await;
    Ok(Json(result))
}

async fn verify(
    State(state): State<Shared>,
    Path(token): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Response> {
    let share = find_share(&state, &token)?;
    if share.unavailable == Some(true) {
        return Err(AppError(
            StatusCode::GONE,
            "Share mount is unavailable".into(),
        ));
    }
    if share.passcode.is_none() {
        return Ok(Json(json!({"success":true})).into_response());
    }
    if !rate_limit(&state.share_verify_attempts, token.clone()).await {
        return Err(AppError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many attempts. Try again in 15 minutes.".into(),
        ));
    }
    if body["passcode"].as_str().unwrap_or("") != share.passcode.as_deref().unwrap_or("") {
        return Err(AppError(
            StatusCode::UNAUTHORIZED,
            "Invalid passcode".into(),
        ));
    }
    state.share_verify_attempts.lock().await.remove(&token);
    let cookie = format!(
        "{}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
        shares::cookie_name(&token),
        shares::session(&state.config, &token),
        if !state.dev { "; Secure" } else { "" }
    );
    let mut response = Json(json!({"success":true})).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    Ok(response)
}

async fn pins(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    if !share.is_directory {
        return Err(AppError::bad("Share is not a directory"));
    }
    let pins = workspace_persistence::share_pins(
        body.get("items").unwrap_or(&Value::Null),
        &share.path,
        &token,
    );
    shares::update_workspace(
        &state.config,
        &roots(&state),
        &token,
        Some(pins.clone()),
        None,
    )?
    .ok_or_else(|| AppError::not_found("Share not found"))?;
    Ok(Json(json!({"success":true,"workspaceTaskbarPins":pins})))
}

async fn presets(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    if !share.is_directory {
        return Err(AppError::bad("Share is not a directory"));
    }
    let presets = workspace_persistence::presets(
        body.get("presets").unwrap_or(&Value::Null),
        Some((&share.path, &token)),
    );
    shares::update_workspace(
        &state.config,
        &roots(&state),
        &token,
        None,
        Some(presets.clone()),
    )?
    .ok_or_else(|| AppError::not_found("Share not found"))?;
    Ok(Json(
        json!({"success":true,"workspaceLayoutPresets":presets}),
    ))
}

async fn view(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let logical = if share.is_directory {
        shares::resolve_authorized_subpath(
            &state.config,
            &roots(&state),
            &share,
            body["filePath"].as_str().unwrap_or(""),
        )?
        .logical
    } else {
        share.path
    };
    store::mutate_section(
        &stats_path(&state),
        &state.config.library_key,
        json!({"views":{},"shareViews":{}}),
        |stats| {
            stats["shareViews"][&logical] =
                json!(stats["shareViews"][&logical].as_u64().unwrap_or(0) + 1);
            Ok(())
        },
    )?;
    Ok(Json(json!({"success":true})))
}

#[derive(Deserialize)]
struct DirQuery {
    #[serde(default)]
    dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceInspectQuery {
    library_id: String,
    resource_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyResourceResolveQuery {
    legacy_locator: String,
}

async fn inspect_resource(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(query): Query<ResourceInspectQuery>,
) -> Result<Json<crate::resources::ResourceDetail>, Response> {
    let share = validate(&state, &token, &headers).map_err(IntoResponse::into_response)?;
    let detail = crate::application_queries::inspect_grant(
        &state,
        &share.path,
        share.is_directory,
        &crate::resources::ResourceRef {
            library_id: crate::resources::LibraryId::new(query.library_id),
            resource_id: crate::resources::ResourceId::new(query.resource_id),
        },
    )
    .await
    .map_err(|error| {
        let status = error.status_code();
        (status, Json(error)).into_response()
    })?;
    Ok(Json(detail))
}

async fn resolve_resource(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(query): Query<LegacyResourceResolveQuery>,
) -> Result<Json<crate::resources::ResourceDetail>, Response> {
    let share = validate(&state, &token, &headers).map_err(IntoResponse::into_response)?;
    let detail = crate::application_queries::resolve_grant(
        &state,
        &share.path,
        share.is_directory,
        &query.legacy_locator,
    )
    .await
    .map_err(|error| {
        let status = error.status_code();
        (status, Json(error)).into_response()
    })?;
    Ok(Json(detail))
}
async fn files(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(query): Query<DirQuery>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    if !share.is_directory {
        return Err(AppError::bad("Share is not a directory"));
    }
    let logical =
        shares::resolve_authorized_subpath(&state.config, &roots(&state), &share, &query.dir)?
            .logical;
    let listing = crate::application_queries::browse_grant(&state, &share.path, &logical).await?;
    Ok(Json(json!({"files":listing.files})))
}

fn decoded_content(body: &Value, required: &str) -> AppResult<(Vec<u8>, u64, Option<String>)> {
    if let Some(encoded) = body["base64Content"]
        .as_str()
        .filter(|value| !value.is_empty())
    {
        let data = crate::app::decode_node_base64(encoded);
        let estimated = ((encoded.encode_utf16().count() * 3).div_ceil(4)) as u64;
        return Ok((data, estimated, None));
    }
    if let Some(content) = body["content"].as_str() {
        return Ok((
            content.as_bytes().to_vec(),
            content.len() as u64,
            Some(content.into()),
        ));
    }
    if body["base64Content"].as_str() == Some("") {
        return Ok((Vec::new(), 0, None));
    }
    Err(AppError::bad(required))
}

fn idempotency_key(headers: &HeaderMap) -> AppResult<String> {
    let value = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("share-{}", uuid::Uuid::new_v4()));
    if value.len() > 200
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(AppError::bad(
            "Idempotency key must be 1-200 visible non-whitespace characters",
        ));
    }
    Ok(value)
}

fn payload_digest(content: &[u8]) -> String {
    Sha256::digest(content)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn request_path(path: &str) -> String {
    path.replace('\\', "/").trim_matches('/').to_string()
}

fn split_child_path(logical: &str) -> AppResult<(String, ChildName)> {
    let normalized = logical.replace('\\', "/");
    let normalized = normalized.trim_end_matches('/');
    let (parent, name) = normalized.rsplit_once('/').unwrap_or(("", normalized));
    let child = ChildName::parse(name).map_err(|error| error.into_app_error())?;
    Ok((parent.to_string(), child))
}

async fn resolve_logical_summary(state: &AppState, logical: &str) -> AppResult<ResourceSummary> {
    state
        .resources
        .compatibility()
        .resolve_filesystem(logical, ReadSurface::Share)
        .await
        .map_err(|error| error.into_app_error())
}

async fn finish_markdown_save(
    state: &AppState,
    share: &shares::Share,
    content: Option<&str>,
    save_started_at: u64,
) -> AppResult<()> {
    let grant_id = share
        .grant_id
        .as_ref()
        .ok_or_else(|| AppError::internal("Grant internal ID is missing"))?;
    if !share.is_directory
        && share.path.to_ascii_lowercase().ends_with(".md")
        && let Some(content) = content
    {
        state
            .share_images
            .finish_markdown_save(
                grant_id,
                &share.path,
                content,
                &crate::app::knowledge_bases(state),
                save_started_at,
            )
            .await;
    }
    Ok(())
}

fn destination_logical_parts(
    state: &AppState,
    share: &shares::Share,
    relative: &str,
) -> AppResult<(String, ChildName)> {
    let logical =
        shares::resolve_authorized_subpath(&state.config, &roots(state), share, relative)?.logical;
    split_child_path(&logical)
}

async fn resolve_destination(
    state: &AppState,
    share: &shares::Share,
    relative: &str,
) -> AppResult<(ResourceSummary, ChildName)> {
    let (parent_path, child) = destination_logical_parts(state, share, relative)?;
    let parent = resolve_logical_summary(state, &parent_path).await?;
    Ok((parent, child))
}

fn current_version(
    summary: &ResourceSummary,
    expected_legacy: Option<f64>,
    changed_message: &str,
) -> Result<ResourceVersion, CommandError> {
    if let Some(expected) = expected_legacy {
        let current = summary.legacy.numeric_version().unwrap_or(0.0);
        if (current - expected).abs() >= 1.0 {
            return Err(CommandError::new(
                CommandErrorCode::VersionMismatch,
                changed_message,
            ));
        }
    }
    summary.version.clone().ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::Conflict,
            "Resource version is unavailable",
        )
    })
}

async fn create(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, CommandError> {
    let grant = authenticate(&state, &token, &headers).await?;
    let base_key = idempotency_key(&headers)?;
    let relative = body["path"].as_str().unwrap_or("");
    let logical =
        shares::resolve_authorized_subpath(&state.config, &roots(&state), &grant.share, relative)?
            .logical;
    let is_folder = body["type"] == "folder";
    let mode = if is_folder {
        CreatePathMode::Folder
    } else {
        let (content, accounted_bytes, _) =
            decoded_content(&body, "Content is required for files")?;
        CreatePathMode::CreateFile {
            content,
            accounted_bytes,
        }
    };
    let result = state
        .content_commands
        .create_path(&grant.context, base_key, &logical, relative, mode, None)
        .await?;
    Ok(Json(json!({
        "success":true,
        "message":if is_folder {"Folder created"} else {"File saved"},
        "receipt":result.receipt,
        "receipts":result.receipts,
    })))
}

async fn edit(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, CommandError> {
    let save_started_at = state.share_images.begin_markdown_save();
    let grant = authenticate(&state, &token, &headers).await?;
    let relative = body["path"].as_str().unwrap_or("");
    let logical =
        shares::resolve_authorized_subpath(&state.config, &roots(&state), &grant.share, relative)?
            .logical;
    let (content, accounted_bytes, text) = decoded_content(&body, "Content is required")?;
    let key = idempotency_key(&headers)?;
    let transport_digest = request_digest(&json!({
        "type":"replaceFile","path":request_path(relative),
        "payloadDigest":payload_digest(&content),"payloadLength":content.len(),
        "accountedBytes":accounted_bytes,"expectedVersion":body["expectedVersion"],
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&grant.context, &key, &transport_digest, Some(&content))
        .await?
    {
        finish_markdown_save(&state, &grant.share, text.as_deref(), save_started_at).await?;
        return Ok(Json(
            json!({"success":true,"message":"File saved","receipt":receipt}),
        ));
    }
    let target = resolve_logical_summary(&state, &logical).await?;
    if target.kind != ResourceKind::File {
        return Err(CommandError::new(
            CommandErrorCode::Conflict,
            "A folder cannot be replaced with a file",
        ));
    }
    let expected_version = current_version(
        &target,
        body["expectedVersion"].as_f64(),
        "File changed since the replacement was prepared",
    )?;
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &grant.context,
            ContentCommand {
                idempotency_key: key,
                operation: ContentOperation::ReplaceFile {
                    target: target.reference,
                    expected_version,
                    content,
                    accounted_bytes,
                },
            },
            transport_digest,
        )
        .await?;
    finish_markdown_save(&state, &grant.share, text.as_deref(), save_started_at).await?;
    Ok(Json(
        json!({"success":true,"message":"File saved","receipt":receipt}),
    ))
}

async fn delete(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, CommandError> {
    let grant = authenticate(&state, &token, &headers).await?;
    let relative = body["path"].as_str().unwrap_or("");
    let logical =
        shares::resolve_authorized_subpath(&state.config, &roots(&state), &grant.share, relative)?
            .logical;
    let key = idempotency_key(&headers)?;
    let transport_digest = request_digest(&json!({
        "type":"delete","path":request_path(relative),
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&grant.context, &key, &transport_digest, None)
        .await?
    {
        return Ok(Json(json!({
            "success":true,"message":"Deleted successfully","receipt":receipt,
        })));
    }
    let target = resolve_logical_summary(&state, &logical).await?;
    let is_directory = target.kind == ResourceKind::Folder;
    let operation = ContentOperation::Delete {
        expected_version: target.version.clone(),
        target: target.reference,
        attachment_anchor: None,
        quota_refund: 0,
    };
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &grant.context,
            ContentCommand {
                idempotency_key: key,
                operation,
            },
            transport_digest,
        )
        .await?;
    Ok(Json(json!({
        "success":true,
        "message":if is_directory {"Folder deleted"} else {"File deleted"},
        "receipt":receipt,
    })))
}

async fn rename(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, CommandError> {
    let grant = authenticate(&state, &token, &headers).await?;
    let key = idempotency_key(&headers)?;
    let transport_digest = request_digest(&json!({
        "type":"move",
        "sourcePath":request_path(body["oldPath"].as_str().unwrap_or("")),
        "destinationPath":request_path(body["newPath"].as_str().unwrap_or("")),
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&grant.context, &key, &transport_digest, None)
        .await?
    {
        return Ok(Json(json!({
            "success":true,"message":"Renamed successfully","receipt":receipt,
        })));
    }
    let source_path = shares::resolve_authorized_subpath(
        &state.config,
        &roots(&state),
        &grant.share,
        body["oldPath"].as_str().unwrap_or(""),
    )?
    .logical;
    let source = resolve_logical_summary(&state, &source_path).await?;
    let (destination_parent, target_name) =
        resolve_destination(&state, &grant.share, body["newPath"].as_str().unwrap_or("")).await?;
    let operation = ContentOperation::Move {
        expected_source_version: source.version.clone(),
        source: source.reference,
        expected_destination_parent_version: None,
        destination_parent: destination_parent.reference,
        target_name,
    };
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &grant.context,
            ContentCommand {
                idempotency_key: key,
                operation,
            },
            transport_digest,
        )
        .await?;
    Ok(Json(
        json!({"success":true,"message":"Renamed successfully","receipt":receipt}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyBody {
    source_path: String,
    destination_dir: String,
}

async fn copy(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<CopyBody>,
) -> Result<Json<Value>, CommandError> {
    if body.source_path.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "sourcePath is required",
        ));
    }
    let grant = authenticate(&state, &token, &headers).await?;
    let source_path = shares::resolve_authorized_subpath(
        &state.config,
        &roots(&state),
        &grant.share,
        &body.source_path,
    )?
    .logical;
    let destination_path = shares::resolve_authorized_subpath(
        &state.config,
        &roots(&state),
        &grant.share,
        &body.destination_dir,
    )?
    .logical;
    let key = idempotency_key(&headers)?;
    let transport_digest = request_digest(&json!({
        "type":"copy","sourcePath":request_path(&body.source_path),
        "destinationDir":request_path(&body.destination_dir),
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&grant.context, &key, &transport_digest, None)
        .await?
    {
        return Ok(Json(json!({
            "success":true,"message":"Copied successfully","receipt":receipt,
        })));
    }
    let source = resolve_logical_summary(&state, &source_path).await?;
    let destination_parent = resolve_logical_summary(&state, &destination_path).await?;
    if destination_parent.kind != ResourceKind::Folder
        && destination_parent.kind != ResourceKind::Source
    {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Destination is not a folder",
        ));
    }
    let target_name = ChildName::parse(source.name.clone())?;
    let operation = ContentOperation::Copy {
        expected_source_version: source.version.clone(),
        source: source.reference,
        expected_destination_parent_version: None,
        destination_parent: destination_parent.reference,
        target_name,
    };
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &grant.context,
            ContentCommand {
                idempotency_key: key,
                operation,
            },
            transport_digest,
        )
        .await?;
    Ok(Json(
        json!({"success":true,"message":"Copied successfully","receipt":receipt}),
    ))
}

async fn retry_command(
    State(state): State<Shared>,
    Path((token, command_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<Value>, CommandError> {
    let grant = authenticate(&state, &token, &headers).await?;
    let receipt = state
        .content_commands
        .retry(&grant.context, &command_id)
        .await?;
    Ok(Json(json!({"success":true,"receipt":receipt})))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/share/{token}/info", get(info))
        .route("/api/share/{token}/verify", post(verify))
        .route("/api/share/{token}/workspaceTaskbarPins", post(pins))
        .route("/api/share/{token}/workspaceLayoutPresets", post(presets))
        .route("/api/share/{token}/files", get(files))
        .route(
            "/api/share/{token}/resources/inspect",
            get(inspect_resource),
        )
        .route(
            "/api/share/{token}/resources/resolve",
            get(resolve_resource),
        )
        .route("/api/share/{token}/view", post(view))
        .route("/api/share/{token}/create", post(create))
        .route("/api/share/{token}/edit", post(edit))
        .route("/api/share/{token}/delete", post(delete))
        .route("/api/share/{token}/rename", post(rename))
        .route("/api/share/{token}/copy", post(copy))
        .route(
            "/api/share/{token}/content-commands/{command_id}/retry",
            post(retry_command),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_adapter_uses_supplied_idempotency_key() {
        let mut headers = HeaderMap::new();
        headers.insert("idempotency-key", HeaderValue::from_static("grant-save-1"));
        assert_eq!(idempotency_key(&headers).unwrap(), "grant-save-1");
        assert!(
            idempotency_key(&HeaderMap::new())
                .unwrap()
                .starts_with("share-")
        );
        assert_eq!(payload_digest(b"same"), payload_digest(b"same"));
        assert_ne!(payload_digest(b"same"), payload_digest(b"different"));

        headers.insert("idempotency-key", HeaderValue::from_static("bad key"));
        assert!(idempotency_key(&headers).is_err());
    }

    #[test]
    fn destination_adapter_accepts_library_root_and_validates_child_name() {
        let (parent, child) = split_child_path("Shared/folder/note.md").unwrap();
        assert_eq!(parent, "Shared/folder");
        assert_eq!(child.as_str(), "note.md");
        let (parent, child) = split_child_path("root-only").unwrap();
        assert_eq!(parent, "");
        assert_eq!(child.as_str(), "root-only");
        assert!(split_child_path("Shared/..").is_err());
        assert!(split_child_path("").is_err());
    }
}
