use crate::{
    app::{
        AppState, Shared, emit, list_directory, parent_logical, roots, safe_upload_name,
        settings_path, stats_path,
    },
    error::{AppError, AppResult},
    media, store,
};
use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, DefaultBodyLimit, Multipart, Query, State},
    http::{HeaderMap, HeaderValue, header},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{io::Write, net::SocketAddr, path::Path, time::UNIX_EPOCH};
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

fn report_metadata_failure(operation: &str, path: &str, error: AppError) {
    eprintln!(
        "File {operation} completed, but metadata cleanup failed for {path}: {}",
        error.1
    );
}

async fn list(
    State(state): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<DirQuery>,
) -> AppResult<Json<Value>> {
    if query.dir == crate::virtual_directory::HERMES_ROOT
        || query
            .dir
            .starts_with(&format!("{}/", crate::virtual_directory::HERMES_ROOT))
    {
        crate::routes::hermes_chat::require_hermes_access(&state, Some(peer), &headers)?;
        if query.surface.as_deref() != Some("workspace") {
            return Err(AppError::not_found("Directory not found"));
        }
        return Ok(Json(
            serde_json::to_value(
                crate::virtual_directory::list_hermes(&state, &query.dir, query.offset).await?,
            )
            .map_err(|error| AppError::internal(error.to_string()))?,
        ));
    }
    let mut files = list_items(&state, &query.dir)?;
    let mut entries = serde_json::Map::new();
    if query.dir.is_empty()
        && query.surface.as_deref() == Some("workspace")
        && state.hermes.is_some()
        && crate::routes::hermes_chat::hermes_access_allowed(
            state.config.auth.enabled,
            Some(peer),
            &headers,
        )
    {
        let path = crate::virtual_directory::HERMES_ROOT.to_string();
        files.push(media::FileItem {
            name: path.clone(),
            path: path.clone(),
            media_type: "folder".into(),
            size: 0,
            extension: String::new(),
            is_directory: true,
            is_virtual: Some(true),
            view_count: None,
            thumbnail_generated: None,
            version: None,
        });
        entries.insert(
            path,
            json!({"provider":"hermes","kind":"root","capabilities":["open"],
                "appearance":{"icon":"agent-directory","tone":"violet"}}),
        );
    }
    let directory = crate::virtual_directory::is_builtin_path(&query.dir).then(|| {
        json!({"provider":"builtin","kind":"collection","path":query.dir,"capabilities":[],
            "offset":0,"pageSize":files.len(),"total":files.len()})
    });
    Ok(Json(
        json!({"files":files,"virtualEntries":entries,"virtualDirectory":directory}),
    ))
}

async fn virtual_action(
    State(state): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<crate::virtual_directory::ActionBody>,
) -> AppResult<Json<Value>> {
    crate::routes::hermes_chat::require_hermes_access(&state, Some(peer), &headers)?;
    Ok(Json(crate::virtual_directory::action(&state, body).await?))
}

async fn virtual_open(
    State(state): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    crate::routes::hermes_chat::require_hermes_access(&state, Some(peer), &headers)?;
    Ok(Json(
        crate::virtual_directory::session_detail(&state, &query.path).await?,
    ))
}

async fn virtual_export(
    State(state): State<Shared>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    crate::routes::hermes_chat::require_hermes_access(&state, Some(peer), &headers)?;
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
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    crate::routes::hermes_chat::require_hermes_access(&state, Some(peer), &headers)?;
    let hub = state
        .hermes
        .as_ref()
        .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?;
    Ok(Json(hub.get("api/fs/list", &[("path", query.path)]).await?))
}

pub(crate) fn list_items(state: &AppState, dir: &str) -> AppResult<Vec<media::FileItem>> {
    if let Some(result) = crate::virtual_directory::list_builtin(state, dir) {
        return result;
    }
    list_directory(state, dir)
}

pub(crate) fn legacy_virtual_items(
    state: &AppState,
    dir: &str,
) -> Option<AppResult<Vec<media::FileItem>>> {
    if dir == "Favorites" || dir == "Most Played" {
        let section = if dir == "Favorites" {
            store::section(
                &settings_path(state),
                &state.config.library_key,
                crate::app::default_settings(),
            )
        } else {
            store::section(
                &stats_path(state),
                &state.config.library_key,
                json!({"views":{}}),
            )
        };
        let paths: Vec<(String, Option<u64>)> = if dir == "Favorites" {
            section["favorites"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(|path| (path.into(), None)))
                .collect()
        } else {
            let mut values = section["views"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(path, value)| (path.clone(), value.as_u64()))
                .collect::<Vec<_>>();
            values.sort_by_key(|item| std::cmp::Reverse(item.1));
            values.truncate(50);
            values
        };
        let runtime = roots(state);
        let mut items = Vec::new();
        for (path, view_count) in paths {
            let Ok(resolved) = media::resolve(&state.config, &runtime, &path) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(&resolved.full) else {
                continue;
            };
            if dir == "Most Played" && metadata.is_dir() {
                continue;
            }
            let name = media::name(&path);
            let extension = Path::new(&name)
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            let thumbnail_generated = if !metadata.is_dir()
                && matches!(media::media_type(&extension), "image" | "video")
            {
                metadata
                    .modified()
                    .ok()
                    .map(|modified| state.thumbnails.cached(&resolved.full, modified))
            } else {
                None
            };
            items.push(media::FileItem {
                name,
                path,
                media_type: if metadata.is_dir() {
                    "folder".into()
                } else {
                    media::media_type(&extension).into()
                },
                size: if metadata.is_dir() { 0 } else { metadata.len() },
                extension,
                is_directory: metadata.is_dir(),
                is_virtual: None,
                view_count,
                thumbnail_generated,
                version: None,
            });
        }
        return Some(Ok(items));
    }
    None
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

async fn create(
    State(state): State<Shared>,
    Json(body): Json<CreateBody>,
) -> AppResult<Json<Value>> {
    if body.path.is_empty() {
        return Err(AppError::bad("Path is required"));
    }
    let runtime = roots(&state);
    if !media::editable(&state.config, &runtime, &parent_logical(&body.path))
        && !media::editable(&state.config, &runtime, &body.path)
    {
        return Err(AppError::forbidden("Path is not in an editable folder"));
    }
    let full = media::resolve(&state.config, &runtime, &body.path)?.full;
    if full.exists() {
        return Err(AppError::conflict(format!(
            "A {} with this name already exists",
            if body.kind.as_deref() == Some("folder") {
                "folder"
            } else {
                "file"
            }
        )));
    }
    if body.kind.as_deref() == Some("folder") {
        fs::create_dir_all(full).await.map_err(AppError::io)?;
        emit(&state, &body.path);
        return Ok(Json(json!({"success":true,"message":"Folder created"})));
    }
    if body.content.is_none() && body.base64_content.is_none() {
        return Err(AppError::bad("Content is required for files"));
    }
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).await.map_err(AppError::io)?;
    }
    let data = match (body.base64_content, body.content) {
        (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value),
        (_, Some(content)) => content.into_bytes(),
        (Some(_), None) => Vec::new(),
        (None, None) => unreachable!(),
    };
    fs::write(full, data).await.map_err(AppError::io)?;
    if let Err(error) = crate::path_metadata::content_replaced(&state, &body.path) {
        report_metadata_failure("create", &body.path, error);
    }
    emit(&state, &body.path);
    Ok(Json(json!({"success":true,"message":"File saved"})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditBody {
    path: String,
    content: Option<String>,
    base64_content: Option<String>,
    expected_version: Option<f64>,
}

async fn edit(State(state): State<Shared>, Json(body): Json<EditBody>) -> AppResult<Json<Value>> {
    if body.path.is_empty() {
        return Err(AppError::bad("Path is required"));
    }
    let runtime = roots(&state);
    if !media::editable(&state.config, &runtime, &body.path) {
        return Err(AppError::forbidden("Path is not in an editable folder"));
    }
    if body.content.is_none() && body.base64_content.is_none() {
        return Err(AppError::bad("Content is required"));
    }
    let full = media::resolve(&state.config, &runtime, &body.path)?.full;
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
    if let Some(expected) = body.expected_version {
        let current = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        // Same NTFS timestamp can round slightly differently across the JSON/client boundary.
        // A real replacement changes it by at least one millisecond in this API.
        if (current - expected).abs() >= 1.0 {
            return Err(AppError::conflict(
                "File changed since the replacement was prepared",
            ));
        }
    }
    let data = match (body.base64_content, body.content) {
        (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value),
        (_, Some(content)) => content.into_bytes(),
        (Some(_), None) => Vec::new(),
        (None, None) => unreachable!(),
    };
    fs::write(full, data).await.map_err(AppError::io)?;
    if let Err(error) = crate::path_metadata::content_replaced(&state, &body.path) {
        report_metadata_failure("edit", &body.path, error);
    }
    emit(&state, &body.path);
    Ok(Json(json!({"success":true,"message":"File saved"})))
}

#[derive(Deserialize)]
struct PathBody {
    path: String,
}
async fn delete(State(state): State<Shared>, Json(body): Json<PathBody>) -> AppResult<Json<Value>> {
    if body.path.is_empty() {
        return Err(AppError::bad("Path is required"));
    }
    let runtime = roots(&state);
    if !media::editable(&state.config, &runtime, &body.path) {
        return Err(AppError::forbidden("Path is not in an editable folder"));
    }
    let full = media::resolve(&state.config, &runtime, &body.path)?.full;
    let metadata = fs::metadata(&full).await.map_err(AppError::io)?;
    if metadata.is_dir() {
        fs::remove_dir_all(full).await.map_err(AppError::io)?;
    } else {
        fs::remove_file(full).await.map_err(AppError::io)?;
    }
    if let Err(error) = crate::path_metadata::removed(&state, &body.path).await {
        report_metadata_failure("delete", &body.path, error);
    }
    crate::app::emit_path_removed(&state, &body.path);
    emit(&state, &body.path);
    Ok(Json(
        json!({"success":true,"message":if metadata.is_dir(){"Folder deleted"}else{"File deleted"}}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameBody {
    old_path: String,
    new_path: String,
}
async fn rename(
    State(state): State<Shared>,
    Json(body): Json<RenameBody>,
) -> AppResult<Json<Value>> {
    if body.old_path.is_empty() || body.new_path.is_empty() {
        return Err(AppError::bad("Both oldPath and newPath are required"));
    }
    let runtime = roots(&state);
    if !media::editable(&state.config, &runtime, &body.old_path) {
        return Err(AppError::forbidden(
            "Cannot rename: Source path is not in an editable folder",
        ));
    }
    if !media::editable(&state.config, &runtime, &body.new_path) {
        return Err(AppError::forbidden(
            "Cannot rename: Destination path is not in an editable folder",
        ));
    }
    let old = media::resolve(&state.config, &runtime, &body.old_path)?.full;
    let new = media::resolve(&state.config, &runtime, &body.new_path)?.full;
    if new.exists() {
        return Err(AppError::conflict(
            "Destination file or directory already exists",
        ));
    }
    fs::rename(old, new).await.map_err(AppError::io)?;
    if let Err(error) = crate::path_metadata::moved(&state, &body.old_path, &body.new_path).await {
        report_metadata_failure("rename", &body.old_path, error);
    }
    crate::app::emit_path_moved(&state, &body.old_path, &body.new_path);
    emit(&state, &body.old_path);
    if parent_logical(&body.old_path) != parent_logical(&body.new_path) {
        emit(&state, &body.new_path);
    }
    Ok(Json(
        json!({"success":true,"message":"Renamed successfully"}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyBody {
    source_path: String,
    destination_dir: String,
}
async fn copy(State(state): State<Shared>, Json(body): Json<CopyBody>) -> AppResult<Json<Value>> {
    if body.source_path.is_empty() {
        return Err(AppError::bad("sourcePath is required"));
    }
    let runtime = roots(&state);
    let source = media::resolve(&state.config, &runtime, &body.source_path)?.full;
    let name = source
        .file_name()
        .ok_or_else(|| AppError::bad("Invalid source path"))?
        .to_owned();
    let logical = if body.destination_dir.is_empty() {
        name.to_string_lossy().into_owned()
    } else {
        format!("{}/{}", body.destination_dir, name.to_string_lossy())
    };
    if !media::editable(&state.config, &runtime, &logical) {
        return Err(AppError::forbidden(
            "Cannot copy: Destination is not in an editable folder",
        ));
    }
    let destination = media::resolve(&state.config, &runtime, &logical)?.full;
    if destination.exists() {
        return Err(AppError::conflict(
            "Destination file or directory already exists",
        ));
    }
    copy_recursive(&source, &destination).await?;
    emit(&state, &logical);
    Ok(Json(
        json!({"success":true,"message":"Copied successfully"}),
    ))
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

async fn upload(State(state): State<Shared>, mut multipart: Multipart) -> AppResult<Json<Value>> {
    let mut target = String::new();
    let mut files = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| AppError::bad(error.to_string()))?
    {
        if field.name() == Some("targetDir") {
            target = field
                .text()
                .await
                .map_err(|error| AppError::bad(error.to_string()))?;
        } else if let Some(name) = field.file_name().map(safe_upload_name) {
            files.push((
                name,
                field
                    .bytes()
                    .await
                    .map_err(|error| AppError::bad(error.to_string()))?,
            ));
        }
    }
    if files.is_empty() {
        return Err(AppError::bad("No files provided"));
    }
    let runtime = roots(&state);
    let mut count = 0;
    let mut broadcasts = std::collections::HashMap::new();
    for (name, data) in files {
        let logical = if target.is_empty() {
            name
        } else {
            format!("{target}/{name}")
        };
        if !media::editable(&state.config, &runtime, &logical)
            && !media::editable(&state.config, &runtime, &parent_logical(&logical))
        {
            continue;
        }
        let full = media::resolve(&state.config, &runtime, &logical)?.full;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).await.map_err(AppError::io)?;
        }
        fs::write(full, data).await.map_err(AppError::io)?;
        broadcasts.insert(parent_logical(&logical), logical);
        count += 1;
    }
    if count == 0 {
        return Err(AppError::forbidden(
            "No files were uploaded — target path is not editable",
        ));
    }
    for logical in broadcasts.values() {
        emit(&state, logical);
    }
    Ok(Json(json!({"success":true,"uploaded":count})))
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
        .route("/api/files", get(list))
        .route("/api/files/create", post(create))
        .route("/api/files/edit", post(edit))
        .route("/api/files/delete", post(delete))
        .route("/api/files/rename", post(rename))
        .route("/api/files/copy", post(copy))
        .route(
            "/api/files/upload",
            post(upload).layer(DefaultBodyLimit::max(10_000_000_000usize)),
        )
        .route("/api/files/download", get(download))
        .route("/api/virtual-directory/action", post(virtual_action))
        .route("/api/virtual-directory/open", get(virtual_open))
        .route("/api/virtual-directory/export", get(virtual_export))
        .route("/api/virtual-directory/fs", get(virtual_fs))
}
