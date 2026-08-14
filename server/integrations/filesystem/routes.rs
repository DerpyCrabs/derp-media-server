use super::{COLLECTION_ROOT_ID, FilesystemIntegration, PROVIDER_ID, decode_key};
use crate::{
    app::{Shared, emit, parent_logical, safe_upload_name},
    error::{AppError, AppResult},
    extractors::{ApiMultipart, ApiQuery},
    integrations::contracts::ResourceKeyDto,
    media,
};
use axum::{
    Extension, Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, State},
    http::{HeaderValue, header},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
};
use tokio::fs;
use tokio_util::io::ReaderStream;

pub(super) const DOWNLOAD_PATH: &str = "/api/integrations/filesystem/download";

pub(super) fn download_url(key: &ResourceKeyDto) -> String {
    let id = url::form_urlencoded::byte_serialize(key.id.as_bytes()).collect::<String>();
    format!("{DOWNLOAD_PATH}?id={id}")
}

async fn upload(
    State(state): State<Shared>,
    Extension(filesystem): Extension<std::sync::Arc<FilesystemIntegration>>,
    ApiMultipart(mut multipart): ApiMultipart,
) -> AppResult<Json<Value>> {
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
        if field.name() == Some("targetId") {
            if count > 0 || target.is_some() {
                return Err(AppError::bad(
                    "targetId must appear once before uploaded files",
                ));
            }
            let id = field
                .text()
                .await
                .map_err(|error| AppError::bad(error.to_string()))?;
            let (root_id, path) = decode_key(&ResourceKeyDto::new(PROVIDER_ID, id))?;
            if root_id == COLLECTION_ROOT_ID {
                return Err(AppError::bad("Application collections are read-only"));
            }
            let logical = filesystem.logical_path(&root_id, &path)?;
            let resolved = media::resolve(&state.config, &logical)?;
            if !fs::metadata(&resolved.full)
                .await
                .map_err(AppError::io)?
                .is_dir()
            {
                return Err(AppError::bad("Upload target must be a directory"));
            }
            target = Some(logical);
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
                .ok_or_else(|| AppError::bad("targetId must precede uploaded files"))?;
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
    Ok(Json(json!({"success":true,"uploaded":count})))
}

#[derive(Deserialize)]
struct DownloadQuery {
    id: String,
}

async fn download(
    State(state): State<Shared>,
    Extension(filesystem): Extension<std::sync::Arc<FilesystemIntegration>>,
    ApiQuery(query): ApiQuery<DownloadQuery>,
) -> AppResult<Response> {
    let key = ResourceKeyDto::new(PROVIDER_ID, query.id);
    let (root_id, path) = decode_key(&key)?;
    if root_id == COLLECTION_ROOT_ID {
        return Err(AppError::bad(
            "Application collections cannot be downloaded",
        ));
    }
    let logical = filesystem.logical_path(&root_id, &path)?;
    let full = media::resolve(&state.config, &logical)?.full;
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
            .expect("encoded download filename is a valid header"),
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
            .expect("encoded download filename is a valid header"),
        );
        response.headers_mut().insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&metadata.len().to_string())
                .expect("download size is a valid header"),
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

pub fn router(runtime: std::sync::Arc<FilesystemIntegration>) -> Router<Shared> {
    Router::new()
        .route(
            "/api/integrations/filesystem/upload",
            post(upload).layer(DefaultBodyLimit::max(10_000_000_000usize)),
        )
        .route(DOWNLOAD_PATH, get(download))
        .layer(Extension(runtime))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integrations::filesystem::encode_key;

    #[test]
    fn provider_owned_download_url_preserves_opaque_resource_id() {
        let key = encode_key("vault-🦀", "Фото/лето.png");
        let url = download_url(&key);
        let encoded_id = url
            .strip_prefix(&format!("{DOWNLOAD_PATH}?id="))
            .expect("download URL uses provider-owned route");
        let decoded_id = url::form_urlencoded::parse(format!("id={encoded_id}").as_bytes())
            .next()
            .map(|(_, value)| value.into_owned())
            .unwrap();
        assert_eq!(decoded_id, key.id);
    }
}
