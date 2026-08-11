use crate::{
    access::{RequestContext, parent_logical},
    app::{Shared, roots, safe_upload_name},
    content_commands::{
        ChildName, CommandError, CommandErrorCode, ContentCommand, ContentOperation,
        CreatePathMode, request_digest,
    },
    error::{AppError, AppResult},
    media,
    resources::{ReadSurface, ResourceKind, ResourceSummary, ResourceVersion},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Extension, Multipart, Query, State},
    http::{HeaderMap, HeaderValue, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path};
use tokio::fs;
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
struct DirQuery {
    #[serde(default)]
    dir: String,
    surface: Option<String>,
    #[serde(default)]
    offset: usize,
}

#[derive(Deserialize)]
struct VirtualPathQuery {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceInspectQuery {
    library_id: String,
    resource_id: String,
    surface: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyResourceResolveQuery {
    legacy_locator: String,
    surface: Option<String>,
}

async fn list(
    State(state): State<Shared>,
    Query(query): Query<DirQuery>,
) -> AppResult<Json<Value>> {
    let listing = crate::application_queries::browse_owner(
        &state,
        &query.dir,
        crate::application_queries::read_surface(query.surface.as_deref()),
        query.offset,
    )
    .await?;
    Ok(Json(
        serde_json::to_value(listing).map_err(|error| AppError::internal(error.to_string()))?,
    ))
}

async fn virtual_action(
    State(state): State<Shared>,
    Json(body): Json<crate::virtual_directory::ActionBody>,
) -> AppResult<Json<Value>> {
    Ok(Json(crate::virtual_directory::action(&state, body).await?))
}

async fn inspect_resource(
    State(state): State<Shared>,
    Query(query): Query<ResourceInspectQuery>,
) -> Result<Json<crate::resources::ResourceDetail>, Response> {
    let detail = crate::application_queries::inspect_owner(
        &state,
        &crate::resources::ResourceRef {
            library_id: crate::resources::LibraryId::new(query.library_id),
            resource_id: crate::resources::ResourceId::new(query.resource_id),
        },
        crate::application_queries::read_surface(query.surface.as_deref()),
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
    Query(query): Query<LegacyResourceResolveQuery>,
) -> Result<Json<crate::resources::ResourceDetail>, Response> {
    let detail = crate::application_queries::resolve_owner(
        &state,
        &query.legacy_locator,
        crate::application_queries::read_surface(query.surface.as_deref()),
    )
    .await
    .map_err(|error| {
        let status = error.status_code();
        (status, Json(error)).into_response()
    })?;
    Ok(Json(detail))
}

async fn virtual_open(
    State(state): State<Shared>,
    Query(query): Query<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    Ok(Json(
        crate::virtual_directory::session_detail(&state, &query.path).await?,
    ))
}

async fn virtual_export(
    State(state): State<Shared>,
    Query(query): Query<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    let id = crate::virtual_directory::session_id_from_path(&query.path)?;
    let hub = state
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    let query = hub
        .profile()
        .map(|profile| vec![("profile", profile.to_string())])
        .unwrap_or_default();
    Ok(Json(
        hub.get(&format!("api/sessions/{id}/export"), &query)
            .await?,
    ))
}

async fn virtual_fs(
    State(state): State<Shared>,
    Query(query): Query<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    let hub = state
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    Ok(Json(hub.get("api/fs/list", &[("path", query.path)]).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateBody {
    #[serde(rename = "type")]
    kind: Option<String>,
    path: String,
    content: Option<String>,
    base64_content: Option<String>,
}

fn command_key(headers: &HeaderMap, suffix: &str) -> String {
    let base = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("request-{}", uuid::Uuid::new_v4()));
    let value = if suffix.is_empty() {
        base.clone()
    } else {
        format!("{base}:{suffix}")
    };
    if value.len() <= 200 {
        value
    } else {
        let digest = Sha256::digest(value.as_bytes());
        format!("request-{}", hex(&digest))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn destination_parts(path: &str) -> Result<(String, ChildName), CommandError> {
    let normalized = path.replace('\\', "/").trim_matches('/').to_string();
    let name = normalized
        .rsplit('/')
        .next()
        .ok_or_else(|| CommandError::new(CommandErrorCode::InvalidRequest, "Path is required"))?;
    Ok((parent_logical(&normalized), ChildName::parse(name)?))
}

async fn owner_summary(
    state: &crate::app::AppState,
    path: &str,
) -> Result<ResourceSummary, CommandError> {
    state
        .resources
        .compatibility()
        .resolve_filesystem(path, ReadSurface::Library)
        .await
        .map_err(Into::into)
}

fn expected_opaque_version(
    summary: &ResourceSummary,
    expected_numeric: Option<f64>,
) -> Result<ResourceVersion, CommandError> {
    if let Some(expected) = expected_numeric {
        let current = summary.legacy.numeric_version().unwrap_or(0.0);
        if (current - expected).abs() >= 1.0 {
            return Err(CommandError::new(
                CommandErrorCode::VersionMismatch,
                "File changed since the replacement was prepared",
            ));
        }
    }
    summary.version.clone().ok_or_else(|| {
        CommandError::new(
            CommandErrorCode::Conflict,
            "Filesystem resource has no comparable version",
        )
    })
}

async fn create(
    State(state): State<Shared>,
    Extension(context): Extension<RequestContext>,
    headers: HeaderMap,
    Json(body): Json<CreateBody>,
) -> Result<Json<Value>, CommandError> {
    if body.path.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Path is required",
        ));
    }
    let folder = body.kind.as_deref() == Some("folder");
    let mode = if folder {
        CreatePathMode::Folder
    } else {
        if body.content.is_none() && body.base64_content.is_none() {
            return Err(CommandError::new(
                CommandErrorCode::InvalidRequest,
                "Content is required for files",
            ));
        }
        let data = match (body.base64_content, body.content) {
            (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value),
            (_, Some(content)) => content.into_bytes(),
            (Some(_), None) => Vec::new(),
            (None, None) => unreachable!(),
        };
        CreatePathMode::CreateFile {
            content: data,
            accounted_bytes: 0,
        }
    };
    let result = state
        .content_commands
        .create_path(
            &context,
            command_key(&headers, ""),
            &body.path,
            &body.path,
            mode,
            None,
        )
        .await?;
    Ok(Json(json!({
        "success":true,
        "message":if folder { "Folder created" } else { "File saved" },
        "receipt":result.receipt,
        "receipts":result.receipts,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditBody {
    path: String,
    content: Option<String>,
    base64_content: Option<String>,
    expected_version: Option<f64>,
}

async fn edit(
    State(state): State<Shared>,
    Extension(context): Extension<RequestContext>,
    headers: HeaderMap,
    Json(body): Json<EditBody>,
) -> Result<Json<Value>, CommandError> {
    if body.path.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Path is required",
        ));
    }
    if body.content.is_none() && body.base64_content.is_none() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Content is required",
        ));
    }
    let data = match (body.base64_content, body.content) {
        (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value),
        (_, Some(content)) => content.into_bytes(),
        (Some(_), None) => Vec::new(),
        (None, None) => unreachable!(),
    };
    let key = command_key(&headers, "");
    let transport_digest = request_digest(&json!({
        "type":"replaceFile","path":body.path.replace('\\', "/").trim_matches('/'),
        "payloadDigest":hex(&Sha256::digest(&data)),"payloadLength":data.len(),
        "expectedVersion":body.expected_version,
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&context, &key, &transport_digest, Some(&data))
        .await?
    {
        return Ok(Json(
            json!({"success":true,"message":"File saved","receipt":receipt}),
        ));
    }
    let target = owner_summary(&state, &body.path).await?;
    if target.kind != ResourceKind::File {
        return Err(CommandError::new(
            CommandErrorCode::Conflict,
            "A folder cannot be replaced with a file",
        ));
    }
    let expected_version = expected_opaque_version(&target, body.expected_version)?;
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &context,
            ContentCommand {
                idempotency_key: key,
                operation: ContentOperation::ReplaceFile {
                    target: target.reference,
                    expected_version,
                    content: data,
                    accounted_bytes: 0,
                },
            },
            transport_digest,
        )
        .await?;
    Ok(Json(
        json!({"success":true,"message":"File saved","receipt":receipt}),
    ))
}

#[derive(Deserialize)]
struct PathBody {
    path: String,
}
async fn delete(
    State(state): State<Shared>,
    Extension(context): Extension<RequestContext>,
    headers: HeaderMap,
    Json(body): Json<PathBody>,
) -> Result<Json<Value>, CommandError> {
    if body.path.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Path is required",
        ));
    }
    let key = command_key(&headers, "");
    let normalized_path = body.path.replace('\\', "/").trim_matches('/').to_string();
    let transport_digest = request_digest(&json!({"type":"delete","path":normalized_path}))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&context, &key, &transport_digest, None)
        .await?
    {
        return Ok(Json(json!({
            "success":true,"message":"Deleted successfully","receipt":receipt,
        })));
    }
    let target = owner_summary(&state, &body.path).await?;
    let folder = target.kind == ResourceKind::Folder;
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &context,
            ContentCommand {
                idempotency_key: key,
                operation: ContentOperation::Delete {
                    target: target.reference,
                    expected_version: target.version,
                    attachment_anchor: None,
                    quota_refund: 0,
                },
            },
            transport_digest,
        )
        .await?;
    Ok(Json(json!({
        "success":true,
        "message":if folder { "Folder deleted" } else { "File deleted" },
        "receipt":receipt,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBody {
    old_path: String,
    new_path: String,
}
async fn rename(
    State(state): State<Shared>,
    Extension(context): Extension<RequestContext>,
    headers: HeaderMap,
    Json(body): Json<RenameBody>,
) -> Result<Json<Value>, CommandError> {
    if body.old_path.is_empty() || body.new_path.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Both oldPath and newPath are required",
        ));
    }
    let key = command_key(&headers, "");
    let transport_digest = request_digest(&json!({
        "type":"move",
        "sourcePath":body.old_path.replace('\\', "/").trim_matches('/'),
        "destinationPath":body.new_path.replace('\\', "/").trim_matches('/'),
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&context, &key, &transport_digest, None)
        .await?
    {
        return Ok(Json(json!({
            "success":true,"message":"Renamed successfully","receipt":receipt,
        })));
    }
    let source = owner_summary(&state, &body.old_path).await?;
    let (parent_path, target_name) = destination_parts(&body.new_path)?;
    let parent = owner_summary(&state, &parent_path).await?;
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &context,
            ContentCommand {
                idempotency_key: key,
                operation: ContentOperation::Move {
                    source: source.reference,
                    destination_parent: parent.reference,
                    target_name,
                    expected_source_version: source.version,
                    expected_destination_parent_version: None,
                },
            },
            transport_digest,
        )
        .await?;
    Ok(Json(json!({
        "success":true,"message":"Renamed successfully","receipt":receipt,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyBody {
    source_path: String,
    destination_dir: String,
}
async fn copy(
    State(state): State<Shared>,
    Extension(context): Extension<RequestContext>,
    headers: HeaderMap,
    Json(body): Json<CopyBody>,
) -> Result<Json<Value>, CommandError> {
    if body.source_path.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "sourcePath is required",
        ));
    }
    let key = command_key(&headers, "");
    let transport_digest = request_digest(&json!({
        "type":"copy","sourcePath":body.source_path.replace('\\', "/").trim_matches('/'),
        "destinationDir":body.destination_dir.replace('\\', "/").trim_matches('/'),
    }))?;
    if let Some(receipt) = state
        .content_commands
        .replay_request(&context, &key, &transport_digest, None)
        .await?
    {
        return Ok(Json(json!({
            "success":true,"message":"Copied successfully","receipt":receipt,
        })));
    }
    let source = owner_summary(&state, &body.source_path).await?;
    let source_name = body
        .source_path
        .replace('\\', "/")
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .ok_or_else(|| CommandError::new(CommandErrorCode::InvalidRequest, "Invalid source path"))?
        .to_string();
    let parent = owner_summary(&state, &body.destination_dir).await?;
    let receipt = state
        .content_commands
        .execute_with_request_digest(
            &context,
            ContentCommand {
                idempotency_key: key,
                operation: ContentOperation::Copy {
                    source: source.reference,
                    destination_parent: parent.reference,
                    target_name: ChildName::parse(source_name)?,
                    expected_source_version: source.version,
                    expected_destination_parent_version: None,
                },
            },
            transport_digest,
        )
        .await?;
    Ok(Json(json!({
        "success":true,"message":"Copied successfully","receipt":receipt,
    })))
}

async fn upload(
    State(state): State<Shared>,
    Extension(context): Extension<RequestContext>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<Value>, CommandError> {
    let mut target = String::new();
    let mut files = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| CommandError::new(CommandErrorCode::InvalidRequest, error.to_string()))?
    {
        if field.name() == Some("targetDir") {
            target = field.text().await.map_err(|error| {
                CommandError::new(CommandErrorCode::InvalidRequest, error.to_string())
            })?;
        } else if let Some(name) = field.file_name().map(safe_upload_name) {
            files.push((
                name,
                field.bytes().await.map_err(|error| {
                    CommandError::new(CommandErrorCode::InvalidRequest, error.to_string())
                })?,
            ));
        }
    }
    if files.is_empty() {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "No files provided",
        ));
    }
    let mut count = 0;
    let mut receipts = Vec::new();
    for (index, (name, data)) in files.into_iter().enumerate() {
        let path = if target.trim_matches(['/', '\\']).is_empty() {
            name
        } else {
            format!("{}/{}", target.trim_matches(['/', '\\']), name)
        };
        let result = state
            .content_commands
            .create_path(
                &context,
                command_key(&headers, &index.to_string()),
                &path,
                &path,
                CreatePathMode::UploadFile {
                    content: data.to_vec(),
                    accounted_bytes: 0,
                },
                None,
            )
            .await;
        match result {
            Ok(result) => {
                receipts.extend(result.receipts);
                count += 1;
            }
            Err(error) if error.code == CommandErrorCode::Forbidden => {}
            Err(error) => return Err(error),
        }
    }
    if count == 0 {
        return Err(CommandError::new(
            CommandErrorCode::Forbidden,
            "No files were uploaded — target path is not editable",
        ));
    }
    Ok(Json(
        json!({"success":true,"uploaded":count,"receipts":receipts}),
    ))
}

async fn retry_command(
    State(state): State<Shared>,
    Extension(context): Extension<RequestContext>,
    axum::extract::Path(command_id): axum::extract::Path<String>,
) -> Result<Json<Value>, CommandError> {
    let receipt = state.content_commands.retry(&context, &command_id).await?;
    Ok(Json(json!({"success":true,"receipt":receipt})))
}

#[derive(Deserialize)]
struct DownloadQuery {
    path: Option<String>,
}
async fn download(
    State(state): State<Shared>,
    Query(query): Query<DownloadQuery>,
) -> AppResult<Response> {
    let logical = query
        .path
        .ok_or_else(|| AppError::bad("Path is required"))?;
    download_logical(&state, &logical).await
}

pub(crate) async fn download_logical(
    state: &crate::app::AppState,
    logical: &str,
) -> AppResult<Response> {
    let full = media::resolve(&state.config, &roots(state), logical)?.full;
    let metadata = fs::metadata(&full).await.map_err(AppError::io)?;
    if metadata.is_dir() {
        let name = full.file_name().unwrap_or_default().to_string_lossy();
        let mut response = Response::new(zip_body(full.clone()));
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/zip"),
        );
        response.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!(
                "attachment; filename*=UTF-8''{}.zip",
                url::form_urlencoded::byte_serialize(name.as_bytes()).collect::<String>()
            ))
            .unwrap(),
        );
        Ok(response)
    } else {
        let name = full.file_name().unwrap_or_default().to_string_lossy();
        let file = fs::File::open(&full).await.map_err(AppError::io)?;
        let mut response = Response::new(Body::from_stream(ReaderStream::new(file)));
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        );
        response.headers_mut().insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!(
                "attachment; filename*=UTF-8''{}",
                url::form_urlencoded::byte_serialize(name.as_bytes()).collect::<String>()
            ))
            .unwrap(),
        );
        response.headers_mut().insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&metadata.len().to_string()).unwrap(),
        );
        Ok(response)
    }
}

struct BodyWriter(tokio::sync::mpsc::Sender<Result<bytes::Bytes, std::io::Error>>);

impl Write for BodyWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        self.0
            .blocking_send(Ok(bytes::Bytes::copy_from_slice(data)))
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "download closed"))?;
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn zip_body(source: std::path::PathBuf) -> Body {
    let (sender, mut receiver) = tokio::sync::mpsc::channel(8);
    tokio::task::spawn_blocking(move || {
        let errors = sender.clone();
        let result = (|| -> Result<(), Box<dyn std::error::Error>> {
            let mut zip = zip::ZipWriter::new_stream(BodyWriter(sender));
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .compression_level(Some(1));
            for entry in walkdir::WalkDir::new(&source)
                .into_iter()
                .filter_entry(|entry| zip_path_visible(entry.path()))
            {
                let entry = entry?;
                if entry.depth() == 0 {
                    continue;
                }
                let relative = entry
                    .path()
                    .strip_prefix(&source)?
                    .to_string_lossy()
                    .replace('\\', "/");
                if entry.file_type().is_dir() {
                    zip.add_directory(format!("{relative}/"), options)?;
                    continue;
                }
                if !entry.file_type().is_file() {
                    continue;
                }
                zip.start_file(relative, options)?;
                let mut file = std::fs::File::open(entry.path())?;
                std::io::copy(&mut file, &mut zip)?;
            }
            zip.finish()?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = errors.blocking_send(Err(std::io::Error::other(error.to_string())));
        }
    });
    Body::from_stream(async_stream::stream! {
        while let Some(chunk) = receiver.recv().await {
            yield chunk;
        }
    })
}

pub(crate) fn zip_path_visible(path: &Path) -> bool {
    !crate::media::command_staging_owned(path)
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/files", get(list))
        .route("/api/resources/inspect", get(inspect_resource))
        .route("/api/resources/resolve", get(resolve_resource))
        .route("/api/files/create", post(create))
        .route("/api/files/edit", post(edit))
        .route("/api/files/delete", post(delete))
        .route("/api/files/rename", post(rename))
        .route("/api/files/copy", post(copy))
        .route(
            "/api/files/upload",
            post(upload).layer(DefaultBodyLimit::max(10_000_000_000usize)),
        )
        .route(
            "/api/content-commands/{command_id}/retry",
            post(retry_command),
        )
        .route("/api/files/download", get(download))
        .route("/api/virtual-directory/action", post(virtual_action))
        .route("/api/virtual-directory/open", get(virtual_open))
        .route("/api/virtual-directory/export", get(virtual_export))
        .route("/api/virtual-directory/fs", get(virtual_fs))
}
