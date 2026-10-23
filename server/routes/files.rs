use crate::{
    app::{AppState, Shared, emit, list_directory, parent_logical, safe_upload_name},
    error::{AppError, AppResult},
    file_mutation::{FileMutation, content_hash},
    media,
};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Query, State},
    http::{HeaderValue, header},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{io::Write, path::Path};
use tokio::fs;
use tokio_util::io::ReaderStream;

#[derive(Deserialize)]
struct DirQuery {
    #[serde(default)]
    dir: String,
    surface: Option<String>,
    #[serde(default)]
    virtual_browser: bool,
    #[serde(default)]
    offset: usize,
}

#[derive(Deserialize)]
struct VirtualPathQuery {
    path: String,
}

async fn text_document(
    State(state): State<Shared>,
    Query(query): Query<VirtualPathQuery>,
) -> AppResult<Json<Value>> {
    let content = FileMutation::new(&state).read_file(&query.path).await?;
    let text = String::from_utf8(content.clone())
        .map_err(|_| AppError::bad("File is not valid UTF-8 text"))?;
    Ok(Json(
        json!({"content":text,"version":content_hash(&content)}),
    ))
}

async fn list(
    State(state): State<Shared>,
    Query(query): Query<DirQuery>,
) -> AppResult<Json<Value>> {
    if query.virtual_browser || query.surface.as_deref() == Some("workspace") {
        return Ok(Json(
            list_for_browser(&state, &query.dir, query.offset).await?,
        ));
    }
    if query.dir == crate::virtual_directory::HERMES_ROOT
        || query
            .dir
            .starts_with(&format!("{}/", crate::virtual_directory::HERMES_ROOT))
    {
        return Err(AppError::not_found("Directory not found"));
    }
    let files = list_items_async(&state, &query.dir).await?;
    let directory = crate::virtual_directory::is_builtin_path(&query.dir).then(|| {
        json!({"provider":"builtin","kind":"collection","path":query.dir,"capabilities":[],
            "offset":0,"pageSize":files.len(),"total":files.len()})
    });
    Ok(Json(
        json!({"files":files,"virtualEntries":{},"virtualDirectory":directory}),
    ))
}

pub(crate) async fn list_for_browser(state: &Shared, dir: &str, offset: usize) -> AppResult<Value> {
    if dir == crate::virtual_directory::HERMES_ROOT
        || dir.starts_with(&format!("{}/", crate::virtual_directory::HERMES_ROOT))
    {
        return serde_json::to_value(
            crate::virtual_directory::list_hermes(state, dir, offset).await?,
        )
        .map_err(|error| AppError::internal(error.to_string()));
    }

    let mut files = list_items_async(state, dir).await?;
    let mut entries = serde_json::Map::new();
    if dir.is_empty() && state.hermes.is_some() {
        let path = crate::virtual_directory::HERMES_ROOT.to_string();
        files.push(media::FileItem {
            name: path.clone(),
            path: path.clone(),
            media_type: "folder".into(),
            size: 0,
            created_date: None,
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
    let directory = crate::virtual_directory::is_builtin_path(dir).then(|| {
        json!({"provider":"builtin","kind":"collection","path":dir,"capabilities":[],
            "offset":0,"pageSize":files.len(),"total":files.len()})
    });
    Ok(json!({"files":files,"virtualEntries":entries,"virtualDirectory":directory}))
}

async fn virtual_action(
    State(state): State<Shared>,
    Json(body): Json<crate::virtual_directory::ActionBody>,
) -> AppResult<Json<Value>> {
    Ok(Json(crate::virtual_directory::action(&state, body).await?))
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
    let path = crate::hermes::session_api_path(id, "/export")?;
    Ok(Json(hub.get(&path, &query).await?))
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

pub(crate) async fn list_items_async(state: &Shared, dir: &str) -> AppResult<Vec<media::FileItem>> {
    let state = state.clone();
    let dir = dir.to_owned();
    tokio::task::spawn_blocking(move || list_items(&state, &dir))
        .await
        .map_err(|error| AppError::internal(error.to_string()))?
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
        let paths: Vec<(String, Option<u64>)> = if dir == "Favorites" {
            match state.settings.favorites() {
                Ok(paths) => paths.into_iter().map(|path| (path, None)).collect(),
                Err(error) => return Some(Err(error)),
            }
        } else {
            let views = match state.stats.views() {
                Ok(views) => views,
                Err(error) => return Some(Err(error)),
            };
            let mut values = views
                .as_object()
                .into_iter()
                .flatten()
                .map(|(path, value)| (path.clone(), value.as_u64()))
                .collect::<Vec<_>>();
            values.sort_by_key(|item| std::cmp::Reverse(item.1));
            values.truncate(50);
            values
        };
        let mut items = Vec::new();
        for (path, view_count) in paths {
            let Ok(resolved) = media::resolve(&state.config, &path) else {
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
                created_date: metadata
                    .created()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs_f64() * 1000.0),
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
    if !media::editable(&state.config, &parent_logical(&body.path))
        && !media::editable(&state.config, &body.path)
    {
        return Err(AppError::forbidden("Path is not in an editable folder"));
    }
    if body.kind.as_deref() == Some("folder") {
        FileMutation::new(&state)
            .create_directory(&body.path)
            .await?;
        emit(&state, &body.path);
        return Ok(Json(json!({"success":true,"message":"Folder created"})));
    }
    if body.content.is_none() && body.base64_content.is_none() {
        return Err(AppError::bad("Content is required for files"));
    }
    let data = match (body.base64_content, body.content) {
        (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value)?,
        (_, Some(content)) => content.into_bytes(),
        (Some(_), None) => Vec::new(),
        (None, None) => unreachable!(),
    };
    FileMutation::new(&state)
        .create_file(&body.path, &data)
        .await?;
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
    expected_hash: Option<String>,
}

async fn edit(State(state): State<Shared>, Json(body): Json<EditBody>) -> AppResult<Json<Value>> {
    if body.path.is_empty() {
        return Err(AppError::bad("Path is required"));
    }
    if !media::editable(&state.config, &body.path) {
        return Err(AppError::forbidden("Path is not in an editable folder"));
    }
    if body.content.is_none() && body.base64_content.is_none() {
        return Err(AppError::bad("Content is required"));
    }
    let data = match (body.base64_content, body.content) {
        (Some(value), _) if !value.is_empty() => crate::app::decode_node_base64(&value)?,
        (_, Some(content)) => content.into_bytes(),
        (Some(_), None) => Vec::new(),
        (None, None) => unreachable!(),
    };
    let version = FileMutation::new(&state)
        .edit_file(
            &body.path,
            &data,
            body.expected_hash.as_deref(),
            body.expected_version,
        )
        .await?;
    emit(&state, &body.path);
    Ok(Json(
        json!({"success":true,"message":"File saved","version":version}),
    ))
}

#[derive(Deserialize)]
struct PathBody {
    path: String,
}

async fn delete(State(state): State<Shared>, Json(body): Json<PathBody>) -> AppResult<Json<Value>> {
    if body.path.is_empty() {
        return Err(AppError::bad("Path is required"));
    }
    if !media::editable(&state.config, &body.path) {
        return Err(AppError::forbidden("Path is not in an editable folder"));
    }
    let is_directory = FileMutation::new(&state).delete(&body.path).await?;
    crate::app::emit_path_removed(&state, &body.path);
    emit(&state, &body.path);
    Ok(Json(
        json!({"success":true,"message":if is_directory{"Folder deleted"}else{"File deleted"}}),
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
    if !media::editable(&state.config, &body.old_path) {
        return Err(AppError::forbidden(
            "Cannot rename: Source path is not in an editable folder",
        ));
    }
    if !media::editable(&state.config, &body.new_path) {
        return Err(AppError::forbidden(
            "Cannot rename: Destination path is not in an editable folder",
        ));
    }
    FileMutation::new(&state)
        .rename(&body.old_path, &body.new_path)
        .await?;
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
    FileMutation::new(&state)
        .copy(&body.source_path, &logical)
        .await?;
    emit(&state, &logical);
    Ok(Json(
        json!({"success":true,"message":"Copied successfully"}),
    ))
}

#[derive(Deserialize, Default)]
struct UploadQuery {
    #[serde(default)]
    create_only: bool,
}

async fn upload(
    State(state): State<Shared>,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> AppResult<Json<Value>> {
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
    let mut count = 0;
    let mut broadcasts = std::collections::HashMap::new();
    for (name, data) in files {
        let logical = if target.is_empty() {
            name
        } else {
            format!("{target}/{name}")
        };
        if !media::editable(&state.config, &logical)
            && !media::editable(&state.config, &parent_logical(&logical))
        {
            continue;
        }
        if query.create_only {
            FileMutation::new(&state)
                .create_file(&logical, &data)
                .await?;
        } else {
            FileMutation::new(&state)
                .upsert_file(&logical, &data)
                .await?;
        }
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
        .route("/api/files", get(list))
        .route("/api/files/text", get(text_document))
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

#[cfg(test)]
mod integrity_tests {
    use super::*;
    use crate::test_support::TestApp;
    use axum::{
        body::to_bytes,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    async fn request(
        app: &TestApp,
        method: &str,
        uri: &str,
        body: Body,
        content_type: &str,
    ) -> Response {
        router()
            .merge(crate::routes::media::router())
            .with_state(app.state.clone())
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .header(header::CONTENT_TYPE, content_type)
                    .body(body)
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    fn multipart(target: &str, files: &[(&str, &[u8])], complete: bool) -> Vec<u8> {
        let mut body = format!("--test-boundary\r\nContent-Disposition: form-data; name=\"targetDir\"\r\n\r\n{target}\r\n").into_bytes();
        for (name, bytes) in files {
            body.extend_from_slice(format!("--test-boundary\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes());
            body.extend_from_slice(bytes);
            body.extend_from_slice(b"\r\n");
        }
        if complete {
            body.extend_from_slice(b"--test-boundary--\r\n");
        }
        body
    }

    const MULTIPART: &str = "multipart/form-data; boundary=test-boundary";

    #[tokio::test]
    async fn uploads_preserve_binary_content_and_create_only_collisions() {
        let app = TestApp::new();
        let bytes: Vec<u8> = (0..=255).cycle().take(4096).collect();
        let response = request(
            &app,
            "POST",
            "/api/files/upload?create_only=true",
            Body::from(multipart("nested", &[("file.bin", &bytes)], true)),
            MULTIPART,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            std::fs::read(app.media.join("nested/file.bin")).unwrap(),
            bytes
        );
        let response = request(
            &app,
            "POST",
            "/api/files/upload?create_only=true",
            Body::from(multipart("nested", &[("file.bin", b"overwrite")], true)),
            MULTIPART,
        )
        .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let response = request(
            &app,
            "GET",
            "/api/files/download?path=nested%2Ffile.bin",
            Body::empty(),
            "",
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(response.into_body(), 8192).await.unwrap().as_ref(),
            bytes
        );
    }

    #[tokio::test]
    async fn truncated_multipart_does_not_commit_even_completed_earlier_parts() {
        let app = TestApp::new();
        app.write("existing.txt", b"original");
        let response = request(
            &app,
            "POST",
            "/api/files/upload",
            Body::from(multipart(
                "",
                &[
                    ("existing.txt", b"replacement"),
                    ("unfinished.txt", b"partial"),
                ],
                false,
            )),
            MULTIPART,
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            std::fs::read(app.media.join("existing.txt")).unwrap(),
            b"original"
        );
        assert!(!app.media.join("unfinished.txt").exists());
    }

    #[tokio::test]
    async fn failed_multi_file_upload_preserves_existing_file_and_can_retry_remaining_files() {
        let app = TestApp::new();
        app.write("existing.txt", b"original");
        let response = request(
            &app,
            "POST",
            "/api/files/upload?create_only=true",
            Body::from(multipart(
                "",
                &[
                    ("first.txt", b"first"),
                    ("existing.txt", b"replacement"),
                    ("last.txt", b"last"),
                ],
                true,
            )),
            MULTIPART,
        )
        .await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(
            std::fs::read(app.media.join("first.txt")).unwrap(),
            b"first"
        );
        assert_eq!(
            std::fs::read(app.media.join("existing.txt")).unwrap(),
            b"original"
        );
        assert!(!app.media.join("last.txt").exists());
        let response = request(
            &app,
            "POST",
            "/api/files/upload?create_only=true",
            Body::from(multipart("", &[("last.txt", b"last")], true)),
            MULTIPART,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(std::fs::read(app.media.join("last.txt")).unwrap(), b"last");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_and_mutation_routes_reject_traversal_and_nested_escaping_symlinks() {
        let app = TestApp::new();
        let outside = app.directory.join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("private.txt"), b"private").unwrap();
        app.write("nested/safe.txt", b"safe");
        std::os::unix::fs::symlink(&outside, app.media.join("nested/escape")).unwrap();
        for path in [
            "../outside/private.txt",
            "nested/escape/private.txt",
            "nested/escape/new/deep.txt",
            "nested/../../outside/private.txt",
        ] {
            let encoded: String = url::form_urlencoded::byte_serialize(path.as_bytes()).collect();
            for uri in [
                format!("/api/files?dir={encoded}"),
                format!("/api/files/text?path={encoded}"),
                format!("/api/files/download?path={encoded}"),
                format!("/api/media/{encoded}"),
            ] {
                let response = request(&app, "GET", &uri, Body::empty(), "").await;
                assert!(
                    matches!(
                        response.status(),
                        StatusCode::BAD_REQUEST | StatusCode::FORBIDDEN
                    ),
                    "{uri}: {}",
                    response.status()
                );
            }
            for (operation, payload) in [
                ("create", json!({"type":"file","path":path,"content":"bad"})),
                ("edit", json!({"path":path,"content":"bad"})),
                ("delete", json!({"path":path})),
                (
                    "rename",
                    json!({"oldPath":"nested/safe.txt","newPath":path}),
                ),
                ("rename", json!({"oldPath":path,"newPath":"stolen.txt"})),
                ("copy", json!({"sourcePath":path,"destinationDir":""})),
                (
                    "copy",
                    json!({"sourcePath":"nested/safe.txt","destinationDir":path}),
                ),
            ] {
                let response = request(
                    &app,
                    "POST",
                    &format!("/api/files/{operation}"),
                    Body::from(payload.to_string()),
                    "application/json",
                )
                .await;
                assert!(
                    matches!(
                        response.status(),
                        StatusCode::BAD_REQUEST | StatusCode::FORBIDDEN
                    ),
                    "{operation}: {path}: {}",
                    response.status()
                );
            }
        }
        let response = request(
            &app,
            "POST",
            "/api/files/upload",
            Body::from(multipart("nested/escape", &[("private.txt", b"bad")], true)),
            MULTIPART,
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            std::fs::read(outside.join("private.txt")).unwrap(),
            b"private"
        );
        assert_eq!(
            std::fs::read(app.media.join("nested/safe.txt")).unwrap(),
            b"safe"
        );
        assert_eq!(std::fs::read_dir(outside).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn zip_download_includes_nested_bytes_and_empty_directories_but_never_symlinks() {
        let app = TestApp::new();
        app.write("folder/nested/данные.bin", &[0, 255, 10, 128]);
        app.write("folder/note.txt", b"note");
        std::fs::create_dir(app.media.join("folder/empty")).unwrap();
        let outside = app.directory.join("private.txt");
        std::fs::write(&outside, b"private").unwrap();
        std::os::unix::fs::symlink(outside, app.media.join("folder/nested/escape")).unwrap();
        let response = request(
            &app,
            "GET",
            "/api/files/download?path=folder",
            Body::empty(),
            "",
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), 100_000).await.unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        assert_eq!(zip.len(), 4);
        assert!(zip.by_name("empty/").unwrap().is_dir());
        assert!(zip.by_name("nested/escape").is_err());
        use std::io::Read;
        let mut contents = Vec::new();
        zip.by_name("nested/данные.bin")
            .unwrap()
            .read_to_end(&mut contents)
            .unwrap();
        assert_eq!(contents, [0, 255, 10, 128]);
    }
}
