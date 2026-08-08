use crate::{
    app::{
        AppState, Shared, cookies, emit, find_share, knowledge_base_root, list_directory,
        rate_limit, roots, stats_path,
    },
    error::{AppError, AppResult},
    markdown_images, media,
    routes::settings,
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
use std::{path::Path as FsPath, sync::atomic::Ordering, time::UNIX_EPOCH};
use tokio::fs;

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

pub(crate) fn restriction(share: &shares::Share, field: &str) -> bool {
    let value = shares::effective(share);
    match field {
        "upload" => value.allow_upload.unwrap_or(true),
        "edit" => value.allow_edit.unwrap_or(true),
        "delete" => value.allow_delete.unwrap_or(true),
        _ => false,
    }
}

pub(crate) fn ensure_quota(share: &shares::Share, requested: u64) -> AppResult<()> {
    let maximum = shares::effective(share)
        .max_upload_bytes
        .unwrap_or(2.0 * 1024.0 * 1024.0 * 1024.0);
    if maximum == 0.0 {
        return Ok(());
    }
    let remaining = (maximum - share.used_bytes.unwrap_or(0) as f64).max(0.0);
    if requested as f64 > remaining {
        return Err(AppError(
            StatusCode::PAYLOAD_TOO_LARGE,
            "Upload quota exceeded for this share".into(),
        ));
    }
    Ok(())
}

pub(crate) async fn account_bytes(state: &AppState, token: &str, delta: i64) -> AppResult<()> {
    let _guard = state.store_lock.lock().await;
    shares::add_used_bytes(&state.config, token, delta)?;
    Ok(())
}

fn require_editable_path(state: &AppState, logical: &str, operation: &str) -> AppResult<()> {
    if media::editable(&state.config, &roots(state), logical) {
        Ok(())
    } else {
        Err(AppError::forbidden(format!(
            "Cannot {operation}: Path is not in an editable folder"
        )))
    }
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
    let extension = if share.is_directory {
        String::new()
    } else {
        FsPath::new(&share.path)
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase()
    };
    let mut result = json!({"name":shares::name(&share.path),"isDirectory":share.is_directory,"editable":share.editable,"mediaType":if share.is_directory{"folder"}else{media::media_type(&extension)},"extension":extension,"needsPasscode":share.passcode.is_some(),"authorized":authorized});
    if authorized {
        result["path"] = json!(share.path);
        let kb_root = knowledge_base_root(&state, &share.path);
        result["isKnowledgeBase"] = json!(share.is_directory && kb_root.is_some());
        if let Some(root) = kb_root {
            result["knowledgeBaseRoot"] = json!(root);
        }
        if share.is_directory {
            result["adminViewMode"] = settings::sanitized(&state)["viewModes"]
                .get(&share.path)
                .cloned()
                .unwrap_or_else(|| json!("list"));
            result["workspaceTaskbarPins"] = workspace_persistence::share_pins(
                share
                    .workspace_taskbar_pins
                    .as_ref()
                    .unwrap_or(&Value::Null),
                &share.path,
                &token,
            );
            result["workspaceLayoutPresets"] = workspace_persistence::presets(
                share
                    .workspace_layout_presets
                    .as_ref()
                    .unwrap_or(&Value::Null),
                Some((&share.path, &token)),
            );
        }
    }
    if share.editable {
        result["restrictions"] = serde_json::to_value(shares::effective(&share)).unwrap();
        result["usedBytes"] = json!(share.used_bytes.unwrap_or(0));
    }
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
    let _guard = state.store_lock.lock().await;
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
    let _guard = state.store_lock.lock().await;
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
        shares::resolve_subpath(&share, body["filePath"].as_str().unwrap_or(""))?
    } else {
        share.path
    };
    let _guard = state.store_lock.lock().await;
    let mut stats = store::section(
        &stats_path(&state),
        &state.config.library_key,
        json!({"views":{},"shareViews":{}}),
    );
    stats["shareViews"][&logical] = json!(stats["shareViews"][&logical].as_u64().unwrap_or(0) + 1);
    store::update_section(&stats_path(&state), &state.config.library_key, stats)?;
    Ok(Json(json!({"success":true})))
}

#[derive(Deserialize)]
struct DirQuery {
    #[serde(default)]
    dir: String,
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
    let logical = shares::resolve_subpath(&share, &query.dir)?;
    let files = list_directory(&state, &logical)?
        .into_iter()
        .filter(|item| item.is_virtual != Some(true))
        .collect::<Vec<_>>();
    Ok(Json(json!({"files":files})))
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

async fn create(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    if !share.editable {
        return Err(AppError::forbidden("Share is not editable"));
    }
    if !restriction(&share, "upload") {
        return Err(AppError::forbidden(
            "Creating files/folders is not allowed for this share",
        ));
    }
    let logical = shares::resolve_subpath(&share, body["path"].as_str().unwrap_or(""))?;
    let full = media::resolve(&state.config, &roots(&state), &logical)?.full;
    if full.exists() {
        return Err(AppError::conflict(format!(
            "A {} with this name already exists",
            if body["type"] == "folder" {
                "folder"
            } else {
                "file"
            }
        )));
    }
    if body["type"] == "folder" {
        if !media::editable(
            &state.config,
            &roots(&state),
            &crate::app::parent_logical(&logical),
        ) {
            require_editable_path(&state, &logical, "create directory")?;
        }
        fs::create_dir_all(full).await.map_err(AppError::io)?;
        emit(&state, &logical);
        return Ok(Json(json!({"success":true,"message":"Folder created"})));
    }
    let (data, size, _) = decoded_content(&body, "Content is required for files")?;
    ensure_quota(&share, size)?;
    require_editable_path(&state, &logical, "write file")?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).await.map_err(AppError::io)?;
    }
    fs::write(full, data).await.map_err(AppError::io)?;
    if size > 0 {
        account_bytes(&state, &token, size as i64).await?;
    }
    emit(&state, &logical);
    Ok(Json(json!({"success":true,"message":"File saved"})))
}

async fn edit(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let save_started_at = state.preview_sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let share = validate(&state, &token, &headers)?;
    if !share.editable {
        return Err(AppError::forbidden("Share is not editable"));
    }
    if !restriction(&share, "edit") {
        return Err(AppError::forbidden(
            "Editing files is not allowed for this share",
        ));
    }
    let logical = shares::resolve_subpath(&share, body["path"].as_str().unwrap_or(""))?;
    let full = media::resolve(&state.config, &roots(&state), &logical)?.full;
    let metadata = fs::metadata(&full).await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::not_found("File not found")
        } else {
            AppError::io(error)
        }
    })?;
    if metadata.is_dir() {
        return Err(AppError::conflict(
            "A folder cannot be replaced with a file",
        ));
    }
    if let Some(expected) = body["expectedVersion"].as_f64() {
        let current = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        if (current - expected).abs() >= 1.0 {
            return Err(AppError::conflict(
                "File changed since the replacement was prepared",
            ));
        }
    }
    let (data, size, text) = decoded_content(&body, "Content is required")?;
    ensure_quota(&share, size)?;
    require_editable_path(&state, &logical, "write file")?;
    fs::write(full, data).await.map_err(AppError::io)?;
    if !share.is_directory
        && share.path.to_ascii_lowercase().ends_with(".md")
        && let Some(content) = text
    {
        let _image_operation = state.image_operations.lock().await;
        let referenced = markdown_images::referenced(
            &content,
            &share.path,
            &crate::app::knowledge_bases(&state),
        );
        state
            .share_images
            .lock()
            .await
            .retain(|(grant_token, grant_path, image_path), preview| {
                grant_token != &token
                    || grant_path != &share.path
                    || (!referenced.contains(image_path)
                        && preview
                            .finalized_at
                            .is_none_or(|sequence| sequence > save_started_at))
            });
        state.image_grants.lock().await.retain(|_, grant| {
            grant.token != token
                || grant.share_path != share.path
                || !referenced.contains(&grant.image_path)
        });
    }
    if size > 0 {
        account_bytes(&state, &token, size as i64).await?;
    }
    emit(&state, &logical);
    Ok(Json(json!({"success":true,"message":"File saved"})))
}

async fn delete(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    if !share.editable {
        return Err(AppError::forbidden("Share is not editable"));
    }
    if !restriction(&share, "delete") {
        return Err(AppError::forbidden(
            "Deletion is not allowed for this share",
        ));
    }
    let logical = shares::resolve_subpath(&share, body["path"].as_str().unwrap_or(""))?;
    if logical == share.path {
        return Err(AppError::forbidden("Cannot delete share root"));
    }
    require_editable_path(&state, &logical, "delete")?;
    let full = media::resolve(&state.config, &roots(&state), &logical)?.full;
    let metadata = fs::metadata(&full).await.map_err(AppError::io)?;
    if metadata.is_dir() {
        fs::remove_dir_all(full).await.map_err(AppError::io)?
    } else {
        fs::remove_file(full).await.map_err(AppError::io)?
    }
    emit(&state, &logical);
    Ok(Json(
        json!({"success":true,"message":if metadata.is_dir(){"Folder deleted"}else{"File deleted"}}),
    ))
}

async fn rename(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    if !share.editable {
        return Err(AppError::forbidden("Share is not editable"));
    }
    if !restriction(&share, "edit") {
        return Err(AppError::forbidden("Editing is not allowed for this share"));
    }
    let old_logical = shares::resolve_subpath(&share, body["oldPath"].as_str().unwrap_or(""))?;
    let new_logical = shares::resolve_subpath(&share, body["newPath"].as_str().unwrap_or(""))?;
    require_editable_path(&state, &old_logical, "rename source")?;
    require_editable_path(&state, &new_logical, "rename destination")?;
    let runtime = roots(&state);
    let old = media::resolve(&state.config, &runtime, &old_logical)?.full;
    let new = media::resolve(&state.config, &runtime, &new_logical)?.full;
    if new.exists() {
        return Err(AppError::conflict(
            "Destination file or directory already exists",
        ));
    }
    fs::rename(old, new).await.map_err(AppError::io)?;
    emit(&state, &old_logical);
    if crate::app::parent_logical(&old_logical) != crate::app::parent_logical(&new_logical) {
        emit(&state, &new_logical);
    }
    Ok(Json(
        json!({"success":true,"message":"Renamed successfully"}),
    ))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/share/{token}/info", get(info))
        .route("/api/share/{token}/verify", post(verify))
        .route("/api/share/{token}/workspaceTaskbarPins", post(pins))
        .route("/api/share/{token}/workspaceLayoutPresets", post(presets))
        .route("/api/share/{token}/files", get(files))
        .route("/api/share/{token}/view", post(view))
        .route("/api/share/{token}/create", post(create))
        .route("/api/share/{token}/edit", post(edit))
        .route("/api/share/{token}/delete", post(delete))
        .route("/api/share/{token}/rename", post(rename))
}
