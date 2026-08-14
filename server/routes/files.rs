use crate::{
    app::{Shared, emit, parent_logical, safe_upload_name},
    application_queries,
    contracts::{
        API_FILES_COPY_PATH, API_FILES_CREATE_PATH, API_FILES_DELETE_PATH, API_FILES_DOWNLOAD_PATH,
        API_FILES_EDIT_PATH, API_FILES_PATH, API_FILES_RENAME_PATH, API_FILES_UPLOAD_PATH,
        CopyFileRequest, CreateFileKindDto, CreateFileRequest, EditFileRequest, FileListResponse,
        FileMutationResponse, FilePathRequest, RenameFileRequest, UploadResponse,
    },
    error::{AppError, AppResult},
    extractors::{ApiJson, ApiMultipart, ApiQuery},
    file_commands::CreateContent,
    media,
};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, header},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::Path,
};
use tokio::fs;
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
struct DirQuery {
    #[serde(default)]
    dir: String,
    #[serde(default)]
    offset: usize,
}

#[derive(Deserialize)]
struct VirtualPathQuery {
    path: String,
}

async fn list(
    State(state): State<Shared>,
    ApiQuery(query): ApiQuery<DirQuery>,
) -> AppResult<Json<FileListResponse>> {
    Ok(Json(
        application_queries::file_listing(&state, &query.dir, query.offset).await?,
    ))
}

async fn virtual_action(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<crate::virtual_directory::ActionBody>,
) -> AppResult<Json<Value>> {
    Ok(Json(crate::virtual_directory::action(&state, body).await?))
}

async fn virtual_open(
    State(state): State<Shared>,
    ApiQuery(query): ApiQuery<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    Ok(Json(
        crate::virtual_directory::session_detail(&state, &query.path).await?,
    ))
}

async fn virtual_export(
    State(state): State<Shared>,
    ApiQuery(query): ApiQuery<VirtualPathQuery>,
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
    let path = crate::hermes::session_api_path(id, "/export")?;
    Ok(Json(hub.get(&path, &query).await?))
}

async fn virtual_fs(
    State(state): State<Shared>,
    ApiQuery(query): ApiQuery<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    let hub = state
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    Ok(Json(hub.get("api/fs/list", &[("path", query.path)]).await?))
}

async fn create(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<CreateFileRequest>,
) -> AppResult<Json<FileMutationResponse>> {
    if matches!(body.kind, Some(CreateFileKindDto::Folder)) {
        state
            .file_commands
            .create(&body.path, CreateContent::Folder)
            .await?;
        emit(&state, &body.path);
        return Ok(Json(FileMutationResponse {
            success: true,
            message: "Folder created".into(),
        }));
    }
    if body.content.is_none() && body.base64_content.is_none() {
        return Err(AppError::bad("Content is required for files"));
    }
    let data = match (body.base64_content, body.content) {
        (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value),
        (_, Some(content)) => content.into_bytes(),
        (Some(_), None) => Vec::new(),
        (None, None) => unreachable!(),
    };
    state
        .file_commands
        .create(&body.path, CreateContent::File(&data))
        .await?;
    emit(&state, &body.path);
    Ok(Json(FileMutationResponse {
        success: true,
        message: "File saved".into(),
    }))
}

async fn edit(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<EditFileRequest>,
) -> AppResult<Json<FileMutationResponse>> {
    if body.content.is_none() && body.base64_content.is_none() {
        return Err(AppError::bad("Content is required"));
    }
    let data = match (body.base64_content, body.content) {
        (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value),
        (_, Some(content)) => content.into_bytes(),
        (Some(_), None) => Vec::new(),
        (None, None) => unreachable!(),
    };
    state
        .file_commands
        .edit(&body.path, &data, body.expected_version)
        .await?;
    emit(&state, &body.path);
    Ok(Json(FileMutationResponse {
        success: true,
        message: "File saved".into(),
    }))
}

async fn delete(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<FilePathRequest>,
) -> AppResult<Json<FileMutationResponse>> {
    let outcome = state.file_commands.delete(&body.path).await?;
    crate::app::emit_path_removed(&state, &body.path);
    emit(&state, &body.path);
    Ok(Json(FileMutationResponse {
        success: true,
        message: if outcome.is_directory {
            "Folder deleted"
        } else {
            "File deleted"
        }
        .into(),
    }))
}

async fn rename(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<RenameFileRequest>,
) -> AppResult<Json<FileMutationResponse>> {
    state
        .file_commands
        .move_path(&body.old_path, &body.new_path)
        .await?;
    crate::app::emit_path_moved(&state, &body.old_path, &body.new_path);
    emit(&state, &body.old_path);
    if parent_logical(&body.old_path) != parent_logical(&body.new_path) {
        emit(&state, &body.new_path);
    }
    Ok(Json(FileMutationResponse {
        success: true,
        message: "Renamed successfully".into(),
    }))
}

async fn copy(
    State(state): State<Shared>,
    ApiJson(body): ApiJson<CopyFileRequest>,
) -> AppResult<Json<FileMutationResponse>> {
    if body.source_path.is_empty() {
        return Err(AppError::bad("sourcePath is required"));
    }
    let source = media::resolve(&state.config, &body.source_path)?.full;
    let name = source
        .file_name()
        .ok_or_else(|| AppError::bad("Invalid source path"))?
        .to_owned();
    let logical = if body.destination_dir.is_empty() {
        name.to_string_lossy().into_owned()
    } else {
        format!("{}/{}", body.destination_dir, name.to_string_lossy())
    };
    if !media::editable(&state.config, &logical) {
        return Err(AppError::forbidden(
            "Cannot copy: Destination is not in an editable folder",
        ));
    }
    let destination = media::resolve(&state.config, &logical)?.full;
    if destination.exists() {
        return Err(AppError::conflict(
            "Destination file or directory already exists",
        ));
    }
    copy_recursive(&source, &destination).await?;
    emit(&state, &logical);
    Ok(Json(FileMutationResponse {
        success: true,
        message: "Copied successfully".into(),
    }))
}

async fn copy_recursive(source: &Path, destination: &Path) -> AppResult<()> {
    let metadata = fs::symlink_metadata(source).await.map_err(AppError::io)?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::forbidden(
            "Cannot copy symbolic links through a media directory",
        ));
    }
    if metadata.is_file() {
        fs::copy(source, destination).await.map_err(AppError::io)?;
    } else {
        fs::create_dir_all(destination)
            .await
            .map_err(AppError::io)?;
        let mut directory = fs::read_dir(source).await.map_err(AppError::io)?;
        while let Some(entry) = directory.next_entry().await.map_err(AppError::io)? {
            Box::pin(copy_recursive(
                &entry.path(),
                &destination.join(entry.file_name()),
            ))
            .await?;
        }
    }
    Ok(())
}

async fn upload(
    State(state): State<Shared>,
    ApiMultipart(mut multipart): ApiMultipart,
) -> AppResult<Json<UploadResponse>> {
    let mut target = None;
    let mut logical_paths = HashSet::new();
    let mut total_bytes = 0_u64;
    let mut count = 0;
    let mut broadcasts = HashMap::new();
    let mut staged_uploads = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::bad(error.to_string()))?
    {
        let mut field = field;
        if field.name() == Some("targetDir") {
            if count > 0 {
                return Err(AppError::bad("targetDir must precede uploaded files"));
            }
            target = Some(
                field
                    .text()
                    .await
                    .map_err(|error| AppError::bad(error.to_string()))?,
            );
        } else if let Some(name) = field.file_name().map(safe_upload_name) {
            if count >= crate::file_commands::MAX_UPLOAD_FILES {
                return Err(AppError::with_status(
                    axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                    format!(
                        "Upload exceeds {} file limit",
                        crate::file_commands::MAX_UPLOAD_FILES
                    ),
                ));
            }
            if name.is_empty() {
                return Err(AppError::bad("Uploaded file name is empty"));
            }
            let target = target
                .as_deref()
                .ok_or_else(|| AppError::bad("targetDir must precede uploaded files"))?;
            let logical = if target.is_empty() {
                name
            } else {
                format!("{target}/{name}")
            };
            if !logical_paths.insert(logical.clone()) {
                return Err(AppError::conflict("Duplicate uploaded file name"));
            }
            let mut staged = state.file_commands.begin_upload(&logical).await?;
            while let Some(chunk) = field
                .chunk()
                .await
                .map_err(|error| AppError::bad(error.to_string()))?
            {
                total_bytes = total_bytes.checked_add(chunk.len() as u64).ok_or_else(|| {
                    AppError::with_status(
                        axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                        "Upload is too large",
                    )
                })?;
                if total_bytes > crate::file_commands::MAX_UPLOAD_BYTES {
                    return Err(AppError::with_status(
                        axum::http::StatusCode::PAYLOAD_TOO_LARGE,
                        format!(
                            "Upload exceeds {} byte limit",
                            crate::file_commands::MAX_UPLOAD_BYTES
                        ),
                    ));
                }
                staged.write_chunk(&chunk).await?;
            }
            staged.finish_staging().await?;
            broadcasts.insert(parent_logical(&logical), logical);
            staged_uploads.push(staged);
            count += 1;
        }
    }
    if count == 0 {
        return Err(AppError::bad("No files provided"));
    }
    if let Err(error) = state.file_commands.finalize_uploads(staged_uploads).await {
        for logical in broadcasts.values() {
            emit(&state, logical);
        }
        return Err(error);
    }
    for logical in broadcasts.values() {
        emit(&state, logical);
    }
    Ok(Json(UploadResponse {
        success: true,
        uploaded: count,
    }))
}

#[derive(Deserialize)]
struct DownloadQuery {
    path: Option<String>,
}
async fn download(
    State(state): State<Shared>,
    ApiQuery(query): ApiQuery<DownloadQuery>,
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
    let full = media::resolve(&state.config, logical)?.full;
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
            for entry in walkdir::WalkDir::new(&source) {
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

pub fn router() -> Router<Shared> {
    Router::new()
        .route(API_FILES_PATH, get(list))
        .route(API_FILES_CREATE_PATH, post(create))
        .route(API_FILES_EDIT_PATH, post(edit))
        .route(API_FILES_DELETE_PATH, post(delete))
        .route(API_FILES_RENAME_PATH, post(rename))
        .route(API_FILES_COPY_PATH, post(copy))
        .route(
            API_FILES_UPLOAD_PATH,
            post(upload).layer(DefaultBodyLimit::max(10_000_000_000usize)),
        )
        .route(API_FILES_DOWNLOAD_PATH, get(download))
        .route("/api/virtual-directory/action", post(virtual_action))
        .route("/api/virtual-directory/open", get(virtual_open))
        .route("/api/virtual-directory/export", get(virtual_export))
        .route("/api/virtual-directory/fs", get(virtual_fs))
}
