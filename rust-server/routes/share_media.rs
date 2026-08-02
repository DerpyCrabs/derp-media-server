use crate::{
    app::{
        Shared, emit, knowledge_base_root, knowledge_bases, parent_logical, roots,
        safe_upload_name, timestamp_ms,
    },
    error::{AppError, AppResult},
    markdown_images, media,
    routes::{
        files, media as media_routes,
        share_access::{account_bytes, ensure_quota, restriction, validate},
    },
    shares,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use rand::RngExt;
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::Path as FsPath;
use std::sync::atomic::Ordering;
use tokio::fs;

async fn media_file(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    let canonical_path = markdown_images::canonical(&path);
    let authorized_reference =
        if !share.is_directory && share.path.to_ascii_lowercase().ends_with(".md") {
            media::resolve(&state.config, &roots(&state), &share.path)
                .ok()
                .and_then(|resolved| std::fs::read_to_string(resolved.full).ok())
                .is_some_and(|source| {
                    canonical_path.as_ref().is_some_and(|path| {
                        markdown_images::referenced(&source, &share.path, &knowledge_bases(&state))
                            .contains(path)
                    })
                })
        } else {
            false
        };
    let preview_authorized = if share.is_directory {
        false
    } else {
        let now = timestamp_ms();
        let mut previews = state.share_images.lock().await;
        previews.retain(|_, preview| preview.finalized_at.is_some() || preview.expires_at > now);
        let key = canonical_path
            .as_ref()
            .map(|path| (token.clone(), share.path.clone(), path.clone()));
        if authorized_reference {
            if let Some(key) = &key {
                previews.remove(key);
            }
            false
        } else {
            key.is_some_and(|key| previews.contains_key(&key))
        }
    };
    let logical = if share.is_directory {
        shares::resolve_subpath(&share, &path)?
    } else if path == share.path || path == "." {
        share.path.clone()
    } else if authorized_reference || preview_authorized {
        canonical_path.ok_or_else(|| AppError::forbidden("Path outside share boundary"))?
    } else {
        return Err(AppError::forbidden("Path outside share boundary"));
    };
    let mut response = media_routes::media_path(&state, &logical, &headers)
        .await
        .map_err(|error| {
            if error.0 == StatusCode::NOT_FOUND {
                AppError::not_found("File not found")
            } else {
                error
            }
        })?;
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-cache"),
    );
    Ok(response)
}

async fn thumbnail(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    let logical = if share.is_directory {
        shares::resolve_subpath(&share, &path)?
    } else if path == "." || path == share.path {
        share.path
    } else {
        return Ok(media_routes::thumbnail_response(
            crate::thumbnails::PLACEHOLDER.to_vec(),
            false,
            true,
        ));
    };
    Ok(media_routes::thumbnail_path(&state, &logical).await)
}
async fn audio_metadata(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let logical = shared_file_path(&share, &path)?;
    let result = async {
        let full = media::resolve(&state.config, &roots(&state), &logical)?.full;
        media_routes::audio_metadata_path(&full).await
    }
    .await;
    result.map_err(|_| AppError::internal("Failed to read audio metadata"))
}
async fn extract_audio(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    let logical = shared_file_path(&share, &path)?;
    let full = media::resolve(&state.config, &roots(&state), &logical)?.full;
    if !full.exists() {
        return Err(AppError::not_found("File not found"));
    }
    if !full.is_file() {
        return Err(AppError::bad("Not a file"));
    }
    media_routes::extract_audio_path(&full, &headers).await
}

async fn upload(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    if !share.editable {
        return Err(AppError::forbidden("Share is not editable"));
    }
    if !restriction(&share, "upload") {
        return Err(AppError::forbidden(
            "Uploads are not allowed for this share",
        ));
    }
    let mut target = String::new();
    let mut uploads = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::bad(error.to_string()))?
    {
        if field.name() == Some("targetDir") {
            target = field
                .text()
                .await
                .map_err(|error| AppError::bad(error.to_string()))?
        } else if let Some(name) = field.file_name().map(safe_upload_name) {
            uploads.push((
                name,
                field
                    .bytes()
                    .await
                    .map_err(|error| AppError::bad(error.to_string()))?,
            ))
        }
    }
    if uploads.is_empty() {
        return Err(AppError::bad("No files provided"));
    }
    let total: u64 = uploads.iter().map(|(_, data)| data.len() as u64).sum();
    let maximum = shares::effective(&share)
        .max_upload_bytes
        .unwrap_or(2.0 * 1024.0 * 1024.0 * 1024.0);
    let remaining = if maximum == 0.0 {
        f64::INFINITY
    } else {
        (maximum - share.used_bytes.unwrap_or(0) as f64).max(0.0)
    };
    if maximum != 0.0 && total as f64 > remaining {
        return Ok((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({
                "error":format!("Upload exceeds quota ({} remaining, {} requested)",format_size(remaining),format_size(total as f64)),
                "remaining":remaining,
                "requested":total,
            })),
        )
            .into_response());
    }
    let mut count = 0;
    let mut broadcasts = std::collections::HashMap::new();
    for (name, data) in uploads {
        let sub = if target.is_empty() {
            name
        } else {
            format!("{target}/{name}")
        };
        let logical = shares::resolve_subpath(&share, &sub)?;
        let full = media::resolve(&state.config, &roots(&state), &logical)?.full;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).await.map_err(AppError::io)?
        }
        fs::write(full, data).await.map_err(AppError::io)?;
        broadcasts.insert(parent_logical(&logical), logical);
        count += 1;
    }
    if total > 0 {
        account_bytes(&state, &token, total as i64).await?;
    }
    for logical in broadcasts.values() {
        emit(&state, logical);
    }
    Ok(Json(json!({"success":true,"uploaded":count})).into_response())
}

fn format_size(bytes: f64) -> String {
    if bytes == 0.0 {
        return "0 Bytes".into();
    }
    let sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    let index = (bytes.ln() / 1024_f64.ln()).floor() as usize;
    let index = index.min(sizes.len() - 1);
    let rounded = ((bytes / 1024_f64.powi(index as i32)) * 100.0).round() / 100.0;
    format!("{rounded} {}", sizes[index])
}

fn shared_file_path(share: &shares::Share, path: &str) -> AppResult<String> {
    if share.is_directory {
        shares::resolve_subpath(share, path)
    } else if path == "." || path == share.path {
        Ok(share.path.clone())
    } else {
        Err(AppError::forbidden("Invalid path"))
    }
}

fn image_suffix() -> String {
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut rng = rand::rng();
    (0..6)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

async fn restore_image_grant(
    state: &crate::app::AppState,
    id: &str,
    mut grant: crate::app::ImageGrant,
) {
    if grant.expires_at <= timestamp_ms() {
        return;
    }
    grant.recorded_at = state.preview_sequence.fetch_add(1, Ordering::SeqCst) + 1;
    state
        .image_grants
        .lock()
        .await
        .insert(id.to_string(), grant);
}

async fn upload_image(
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
            "Uploads are not allowed for this share",
        ));
    }
    let encoded = body["base64Content"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::bad("base64Content is required"))?;
    let data = crate::app::decode_node_base64(encoded);
    let accounted = ((encoded.encode_utf16().count() * 3).div_ceil(4)) as u64;
    ensure_quota(&share, accounted)?;
    let share_path = share.path.replace('\\', "/");
    let kb_root = knowledge_base_root(&state, &share_path);
    let images_dir = if let Some(root) = kb_root {
        format!("{root}/images")
    } else if share.is_directory {
        format!("{share_path}/images")
    } else {
        let parent = parent_logical(&share_path);
        if parent.is_empty() {
            "images".into()
        } else {
            format!("{parent}/images")
        }
    };
    if !media::editable(&state.config, &roots(&state), &images_dir) {
        return Err(AppError::forbidden(
            "Images folder is not in an editable directory",
        ));
    }
    let requested = body["fileName"].as_str().unwrap_or("").trim();
    let extension = body["mimeType"]
        .as_str()
        .unwrap_or("image/png")
        .split('/')
        .nth(1)
        .filter(|value| !value.is_empty())
        .unwrap_or("png")
        .to_string();
    let safe_extension = if matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp") {
        extension
    } else {
        "png".into()
    };
    let valid = !requested.is_empty()
        && requested.len() <= 180
        && !requested.contains(['/', '\\'])
        && !requested.contains("..")
        && requested.rsplit_once('.').is_some_and(|(stem, extension)| {
            !stem.is_empty()
                && stem.chars().all(|character| {
                    character.is_ascii_alphanumeric() || "_ ().-".contains(character)
                })
                && matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "png" | "jpg" | "jpeg" | "gif" | "webp"
                )
        });
    let mut name = if valid {
        requested.to_string()
    } else {
        format!(
            "image-{}-{}.{}",
            timestamp_ms(),
            image_suffix(),
            if safe_extension == "jpeg" {
                "jpg"
            } else {
                &safe_extension
            }
        )
    };
    let mut logical = format!("{images_dir}/{name}");
    let mut index = 1;
    while media::resolve(&state.config, &roots(&state), &logical)?
        .full
        .exists()
    {
        let stem = FsPath::new(&name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let suffix = FsPath::new(&name)
            .extension()
            .unwrap_or_default()
            .to_string_lossy();
        name = format!("{stem}_{index}.{suffix}");
        logical = format!("{images_dir}/{name}");
        index += 1;
    }
    let full = media::resolve(&state.config, &roots(&state), &logical)?.full;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).await.map_err(AppError::io)?
    }
    fs::write(full, data).await.map_err(AppError::io)?;
    account_bytes(&state, &token, accounted as i64).await?;
    let _image_operation = state.image_operations.lock().await;
    let rollback = uuid::Uuid::new_v4().to_string();
    let expires = timestamp_ms() + 5 * 60 * 1000;
    if !share.is_directory {
        let mut previews = state.share_images.lock().await;
        let recorded_at = state.preview_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        previews.insert(
            (token.clone(), share.path.clone(), logical.clone()),
            crate::app::ImagePreview {
                expires_at: expires,
                finalized_at: None,
                recorded_at,
            },
        );
        while previews
            .keys()
            .filter(|(scope_token, scope_path, _)| {
                scope_token == &token && scope_path == &share.path
            })
            .count()
            > 128
        {
            let oldest = previews
                .iter()
                .filter(|((scope_token, scope_path, _), _)| {
                    scope_token == &token && scope_path == &share.path
                })
                .min_by_key(|(_, preview)| preview.recorded_at)
                .map(|(key, _)| key.clone());
            if let Some(key) = oldest {
                previews.remove(&key);
            } else {
                break;
            }
        }
        while previews
            .keys()
            .map(|(scope_token, scope_path, _)| (scope_token, scope_path))
            .collect::<std::collections::HashSet<_>>()
            .len()
            > 128
        {
            let mut scope_activity = std::collections::HashMap::new();
            for ((scope_token, scope_path, _), preview) in previews.iter() {
                scope_activity
                    .entry((scope_token.clone(), scope_path.clone()))
                    .and_modify(|latest: &mut u64| *latest = (*latest).max(preview.recorded_at))
                    .or_insert(preview.recorded_at);
            }
            let oldest_scope = scope_activity
                .into_iter()
                .min_by_key(|(_, latest)| *latest)
                .map(|(scope, _)| scope);
            if let Some((scope_token, scope_path)) = oldest_scope {
                previews.retain(|(candidate_token, candidate_path, _), _| {
                    candidate_token != &scope_token || candidate_path != &scope_path
                });
            } else {
                break;
            }
        }
    }
    let mut grants = state.image_grants.lock().await;
    grants.retain(|_, grant| grant.expires_at > timestamp_ms());
    while grants.len() >= 512 {
        let Some(oldest) = grants
            .iter()
            .min_by_key(|(_, grant)| grant.recorded_at)
            .map(|(id, _)| id.clone())
        else {
            break;
        };
        grants.remove(&oldest);
    }
    grants.insert(
        rollback.clone(),
        crate::app::ImageGrant {
            token: token.clone(),
            share_path: share.path.clone(),
            image_path: logical.clone(),
            accounted_bytes: accounted,
            expires_at: expires,
            recorded_at: state.preview_sequence.fetch_add(1, Ordering::SeqCst) + 1,
        },
    );
    drop(grants);
    emit(&state, &logical);
    Ok(Json(
        json!({"success":true,"path":logical,"fileName":shares::name(&logical),"rollbackId":rollback}),
    ))
}

async fn finalize_image(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let id = body["rollbackId"]
        .as_str()
        .ok_or_else(|| AppError::bad("Image rollback capability is required"))?;
    let _image_operation = state.image_operations.lock().await;
    let mut grants = state.image_grants.lock().await;
    let grant = grants.get(id).cloned();
    if !grant.as_ref().is_some_and(|grant| {
        grant.token == token && grant.share_path == share.path && grant.expires_at > timestamp_ms()
    }) {
        return Err(AppError::forbidden("Image upload is no longer pending"));
    }
    let grant = grants.remove(id).unwrap();
    drop(grants);
    if !share.is_directory
        && let Some(preview) =
            state
                .share_images
                .lock()
                .await
                .get_mut(&(token, share.path, grant.image_path))
    {
        preview.finalized_at = Some(state.preview_sequence.fetch_add(1, Ordering::SeqCst) + 1);
        preview.expires_at = u128::MAX;
    }
    Ok(Json(json!({"success":true})))
}
async fn cancel_image(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let id = body["rollbackId"]
        .as_str()
        .ok_or_else(|| AppError::bad("Image rollback capability is required"))?;
    let mut grants = state.image_grants.lock().await;
    let Some(grant) = grants.get(id).cloned() else {
        return Err(AppError::forbidden("Image upload cannot be cancelled"));
    };
    if grant.token != token || grant.share_path != share.path || grant.expires_at <= timestamp_ms()
    {
        return Err(AppError::forbidden("Image upload cannot be cancelled"));
    }
    grants.remove(id);
    drop(grants);
    if !media::editable(&state.config, &roots(&state), &grant.image_path) {
        restore_image_grant(&state, id, grant).await;
        return Err(AppError::forbidden(
            "Cannot delete file: Path is not in an editable folder",
        ));
    }
    let full = match media::resolve(&state.config, &roots(&state), &grant.image_path) {
        Ok(resolved) => resolved.full,
        Err(error) => {
            restore_image_grant(&state, id, grant).await;
            return Err(error);
        }
    };
    if let Err(error) = fs::remove_file(full).await {
        restore_image_grant(&state, id, grant.clone()).await;
        return Err(AppError::io(error));
    }
    if let Err(error) = account_bytes(&state, &grant.token, -(grant.accounted_bytes as i64)).await {
        restore_image_grant(&state, id, grant).await;
        return Err(error);
    }
    state
        .share_images
        .lock()
        .await
        .remove(&(token, share.path, grant.image_path.clone()));
    emit(&state, &grant.image_path);
    Ok(Json(json!({"success":true})))
}

async fn kb_image(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    let target = path.replace('\\', "/");
    let root = knowledge_base_root(&state, &share.path);
    let allowed = share.is_directory
        && root.is_some_and(|root| {
            let image_dir = format!("{root}/images");
            let extension = FsPath::new(&target)
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            parent_logical(&target) == image_dir
                && matches!(
                    extension.as_str(),
                    "png"
                        | "jpg"
                        | "jpeg"
                        | "gif"
                        | "webp"
                        | "svg"
                        | "bmp"
                        | "ico"
                        | "tif"
                        | "tiff"
                        | "avif"
                )
        });
    if !allowed {
        return Err(AppError::forbidden("Invalid path"));
    }
    let mut response = media_routes::media_path(&state, &target, &headers).await?;
    response.headers_mut().insert(
        axum::http::header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-cache"),
    );
    Ok(response)
}

#[derive(Deserialize)]
struct DownloadQuery {
    path: Option<String>,
}
async fn download(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(query): Query<DownloadQuery>,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    let logical = if share.is_directory {
        shares::resolve_subpath(&share, query.path.as_deref().unwrap_or(""))?
    } else {
        share.path
    };
    files::download_logical(&state, &logical).await
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/share/{token}/media/{*path}", get(media_file))
        .route("/api/share/{token}/thumbnail/{*path}", get(thumbnail))
        .route(
            "/api/share/{token}/audio/metadata/{*path}",
            get(audio_metadata),
        )
        .route(
            "/api/share/{token}/audio/extract/{*path}",
            get(extract_audio),
        )
        .route(
            "/api/share/{token}/upload",
            post(upload).layer(DefaultBodyLimit::max(10_000_000_000usize)),
        )
        .route("/api/share/{token}/upload-image", post(upload_image))
        .route(
            "/api/share/{token}/finalize-image-upload",
            post(finalize_image),
        )
        .route("/api/share/{token}/cancel-image-upload", post(cancel_image))
        .route(
            "/api/share/{token}/knowledge-base-image/{*path}",
            get(kb_image),
        )
        .route("/api/share/{token}/download", get(download))
}
