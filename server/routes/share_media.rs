use crate::{
    app::{
        Shared, cookies, knowledge_base_root, knowledge_bases, parent_logical, roots,
        safe_upload_name,
    },
    content_commands::{
        CommandError, CommandErrorCode, ContentCommand, ContentOperation, CreatePathMode,
        request_digest,
    },
    error::{AppError, AppResult},
    markdown_images, media,
    resources::{ReadSurface, ResourceSummary},
    routes::{files, media as media_routes, share_access::validate},
    shares,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path as FsPath;

async fn authenticated_grant(
    state: &crate::app::AppState,
    token: &str,
    headers: &HeaderMap,
) -> AppResult<crate::access::AuthenticatedGrant> {
    state
        .access
        .authenticate_grant(token, &cookies(headers))
        .await
        .map_err(crate::access::AccessError::into_app_error)
}

async fn resolve_resource(
    state: &crate::app::AppState,
    logical: &str,
) -> Result<ResourceSummary, crate::resources::CatalogError> {
    state
        .resources
        .compatibility()
        .resolve_filesystem(logical, ReadSurface::Share)
        .await
}

fn request_idempotency_key(headers: &HeaderMap) -> String {
    headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("request-{}", uuid::Uuid::new_v4()))
}

fn command_key(base: &str, scope: &str) -> String {
    let suffix = format!(":{scope}");
    if base.len() + suffix.len() <= 200 {
        return format!("{base}{suffix}");
    }
    let digest = Sha256::digest(format!("{base}\0{scope}").as_bytes());
    let encoded = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("request-{encoded}")
}

fn image_scope_root(state: &crate::app::AppState, share: &shares::Share) -> String {
    knowledge_base_root(state, &share.path).unwrap_or_else(|| {
        if share.is_directory {
            share.path.clone()
        } else {
            parent_logical(&share.path)
        }
    })
}

fn grant_id(share: &shares::Share) -> AppResult<&shares::GrantId> {
    share
        .grant_id
        .as_ref()
        .ok_or_else(|| AppError::internal("Grant internal ID is missing"))
}

async fn shared_media_logical(
    state: &Shared,
    token: &str,
    path: &str,
    headers: &HeaderMap,
) -> AppResult<String> {
    let authenticated = authenticated_grant(state, token, headers).await?;
    let share = authenticated.share;
    let canonical_path = markdown_images::canonical(&path);
    let canonical_resource = match canonical_path.as_deref() {
        Some(path) => resolve_resource(state, path)
            .await
            .ok()
            .map(|summary| summary.reference),
        None => None,
    };
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
    let preview_authorized = state
        .share_images
        .preview_authorized(
            grant_id(&share)?,
            canonical_path.as_deref(),
            canonical_resource.as_ref(),
            authorized_reference,
            share.is_directory,
        )
        .await;
    let logical = if share.is_directory {
        shares::resolve_authorized_subpath(&state.config, &roots(state), &share, path)?.logical
    } else if path == share.path || path == "." {
        share.path.clone()
    } else if authorized_reference || preview_authorized {
        canonical_path.ok_or_else(|| AppError::forbidden("Path outside share boundary"))?
    } else {
        return Err(AppError::forbidden("Path outside share boundary"));
    };
    if !share.is_directory && logical != share.path {
        shares::authorize_grant_logical_path(
            &state.config,
            &roots(state),
            &image_scope_root(state, &share),
            &logical,
        )?;
    }
    Ok(logical)
}

async fn media_file(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let logical = shared_media_logical(&state, &token, &path, &headers).await?;
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

async fn image_file(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    Query(query): Query<media_routes::ImageQuery>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let logical = shared_media_logical(&state, &token, &path, &headers).await?;
    media_routes::image_path(&state, &logical, &query, &headers)
        .await
        .map_err(|error| {
            if error.0 == StatusCode::NOT_FOUND {
                AppError::not_found("File not found")
            } else {
                error
            }
        })
}

async fn image_config(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    validate(&state, &token, &headers)?;
    Ok(Json(json!({ "enabled": state.image_variants.enabled() })))
}

async fn thumbnail(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    let logical = if share.is_directory {
        shares::resolve_authorized_subpath(&state.config, &roots(&state), &share, &path)?.logical
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
    let authorized = shared_file_path(&state, &share, &path)?;
    let result = media_routes::audio_metadata_path(&authorized.resolved.full).await;
    result.map_err(|_| AppError::internal("Failed to read audio metadata"))
}
async fn extract_audio(
    State(state): State<Shared>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let share = validate(&state, &token, &headers)?;
    let full = shared_file_path(&state, &share, &path)?.resolved.full;
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
) -> Result<Response, CommandError> {
    let authenticated = authenticated_grant(&state, &token, &headers).await?;
    let share = &authenticated.share;
    let base_key = request_idempotency_key(&headers);
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
        return Err(AppError::bad("No files provided").into());
    }
    let total: u64 = uploads.iter().map(|(_, data)| data.len() as u64).sum();
    state
        .access
        .preauthorize_upload(&authenticated.context, total)
        .await
        .map_err(|error| CommandError::from(error.into_app_error()))?;
    let mut count = 0;
    let mut receipts = Vec::new();
    let runtime = roots(&state);
    for (index, (name, data)) in uploads.into_iter().enumerate() {
        let sub = if target.is_empty() {
            name
        } else {
            format!("{target}/{name}")
        };
        let authorized = shares::resolve_authorized_subpath(&state.config, &runtime, &share, &sub)?;
        let logical = authorized.logical;
        let file_key = command_key(&base_key, &format!("upload-{index}"));
        let result = state
            .content_commands
            .create_path(
                &authenticated.context,
                file_key,
                &logical,
                &sub,
                CreatePathMode::UploadFile {
                    accounted_bytes: data.len() as u64,
                    content: data.to_vec(),
                },
                None,
            )
            .await?;
        receipts.extend(result.receipts);
        count += 1;
    }
    Ok(Json(json!({"success":true,"uploaded":count,"receipts":receipts})).into_response())
}

fn shared_file_path(
    state: &crate::app::AppState,
    share: &shares::Share,
    path: &str,
) -> AppResult<shares::AuthorizedSharePath> {
    if share.is_directory {
        shares::resolve_authorized_subpath(&state.config, &roots(state), share, path)
    } else if path == "." || path == share.path {
        let logical = share.path.clone();
        let resolved = shares::authorize_grant_logical_path(
            &state.config,
            &roots(state),
            &share.path,
            &logical,
        )?;
        Ok(shares::AuthorizedSharePath { logical, resolved })
    } else {
        Err(AppError::forbidden("Invalid path"))
    }
}

fn generated_image_name(idempotency_key: &str, encoded: &str, extension: &str) -> String {
    const CHARS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let digest = Sha256::digest(format!("{idempotency_key}\0{encoded}").as_bytes());
    let number =
        u64::from_be_bytes(digest[..8].try_into().unwrap()) % 9_000_000_000_000 + 1_000_000_000_000;
    let suffix = digest[8..14]
        .iter()
        .map(|byte| CHARS[*byte as usize % CHARS.len()] as char)
        .collect::<String>();
    format!("image-{number}-{suffix}.{extension}")
}

async fn upload_image(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, CommandError> {
    let authenticated = authenticated_grant(&state, &token, &headers).await?;
    let share = &authenticated.share;
    let base_key = request_idempotency_key(&headers);
    let encoded = body["base64Content"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::bad("base64Content is required"))?;
    let data = crate::app::decode_node_base64(encoded);
    let accounted = ((encoded.encode_utf16().count() * 3).div_ceil(4)) as u64;
    let share_path = share.path.replace('\\', "/");
    let kb_root = knowledge_base_root(&state, &share_path);
    let images_dir = if let Some(root) = &kb_root {
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
        generated_image_name(
            &base_key,
            encoded,
            if safe_extension == "jpeg" {
                "jpg"
            } else {
                &safe_extension
            },
        )
    };
    let anchor = resolve_resource(&state, &share.path)
        .await
        .map_err(crate::resources::CatalogError::into_app_error)?
        .reference;
    let requested_name = name.clone();
    let mut attempt = 0usize;
    let (logical, result) = loop {
        if attempt > 0 {
            let stem = FsPath::new(&requested_name)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let suffix = FsPath::new(&requested_name)
                .extension()
                .unwrap_or_default()
                .to_string_lossy();
            name = format!("{stem}_{attempt}.{suffix}");
        }
        let logical = format!("{images_dir}/{name}");
        let request_path = format!("image/{name}");
        match state
            .content_commands
            .create_path(
                &authenticated.context,
                command_key(&base_key, &format!("image-{attempt}")),
                &logical,
                &request_path,
                CreatePathMode::CreateFile {
                    content: data.clone(),
                    accounted_bytes: accounted,
                },
                Some(anchor.clone()),
            )
            .await
        {
            Ok(result) => break (logical, result),
            Err(error) if error.code == CommandErrorCode::Conflict => attempt += 1,
            Err(error) => return Err(error),
        }
    };
    let replayed = result.replayed;
    let receipt = result.receipt;
    let receipts = result.receipts;
    let uploaded_version = receipt.resulting_versions.first().ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::Internal,
            "Image upload receipt is missing its resulting Resource version",
        )
    })?;
    let version = uploaded_version.version.clone().ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::Internal,
            "Image upload Resource has no comparable version",
        )
    })?;
    let rollback = state
        .share_images
        .register_upload(
            grant_id(share)?,
            share.is_directory,
            &logical,
            accounted,
            uploaded_version.reference.clone(),
            version,
            &receipt.command_id,
            !replayed,
        )
        .await
        .rollback_id;
    Ok(Json(
        json!({"success":true,"path":logical,"fileName":shares::name(&logical),"rollbackId":rollback,"receipt":receipt,"receipts":receipts}),
    ))
}

async fn finalize_image(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let authenticated = authenticated_grant(&state, &token, &headers).await?;
    let share = authenticated.share;
    let id = body["rollbackId"]
        .as_str()
        .ok_or_else(|| AppError::bad("Image rollback capability is required"))?;
    state
        .share_images
        .finalize_upload(grant_id(&share)?, share.is_directory, id)
        .await?;
    Ok(Json(json!({"success":true})))
}
async fn cancel_image(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, CommandError> {
    let authenticated = authenticated_grant(&state, &token, &headers).await?;
    let share = authenticated.share;
    let id = body["rollbackId"]
        .as_str()
        .ok_or_else(|| AppError::bad("Image rollback capability is required"))?;
    let key = command_key(&request_idempotency_key(&headers), "cancel-image");
    let transport_digest = request_digest(&json!({
        "type":"cancelImage","rollbackId":id,
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&authenticated.context, &key, &transport_digest, None)
        .await?
    {
        return Ok(Json(json!({"success":true,"receipt":receipt})));
    }
    let grant = state
        .share_images
        .take_for_cancel(grant_id(&share)?, id)
        .await?;
    let accounted_bytes = grant.accounted_bytes;
    let target = grant.resource.clone();
    let expected_version = grant.version.clone();
    let anchor = match resolve_resource(&state, &share.path).await {
        Ok(summary) => summary.reference,
        Err(error) => {
            state.share_images.restore_cancel(id, grant).await;
            return Err(error.into_app_error().into());
        }
    };
    let receipt = match state
        .content_commands
        .execute_with_request_digest(
            &authenticated.context,
            ContentCommand {
                idempotency_key: key,
                operation: ContentOperation::Delete {
                    target: target.clone(),
                    expected_version: Some(expected_version),
                    attachment_anchor: Some(anchor),
                    quota_refund: accounted_bytes,
                },
            },
            transport_digest,
        )
        .await
    {
        Ok(receipt) => receipt,
        Err(error) => {
            state.share_images.restore_cancel(id, grant).await;
            return Err(error);
        }
    };
    state
        .share_images
        .complete_cancel(grant_id(&share)?, &target)
        .await;
    Ok(Json(json!({"success":true,"receipt":receipt})))
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
        && root.as_ref().is_some_and(|root| {
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
    shares::authorize_grant_logical_path(
        &state.config,
        &roots(&state),
        root.as_deref().unwrap_or(&share.path),
        &target,
    )?;
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
        shares::resolve_authorized_subpath(
            &state.config,
            &roots(&state),
            &share,
            query.path.as_deref().unwrap_or(""),
        )?
        .logical
    } else {
        share.path
    };
    files::download_logical(&state, &logical).await
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/share/{token}/media/{*path}", get(media_file))
        .route("/api/share/{token}/image-config", get(image_config))
        .route("/api/share/{token}/image/{*path}", get(image_file))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grant_media_adapter_contains_no_direct_content_mutations() {
        let source = include_str!("share_media.rs");
        let namespace = ["f", "s"].concat();
        for operation in [
            "write",
            "create_dir",
            "create_dir_all",
            "remove_file",
            "remove_dir",
            "remove_dir_all",
            "rename",
            "copy",
        ] {
            let needle = format!("{namespace}::{operation}(");
            assert!(
                !source.contains(&needle),
                "direct mutation remains: {needle}"
            );
        }
    }

    #[test]
    fn generated_image_names_are_retry_stable() {
        let first = generated_image_name("same-key", "image-data", "png");
        assert_eq!(first, generated_image_name("same-key", "image-data", "png"));
        assert_ne!(
            first,
            generated_image_name("other-key", "image-data", "png")
        );
        assert!(first.ends_with(".png"));
    }
}
