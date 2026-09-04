use crate::{
    app::{AppState, Shared},
    error::{AppError, AppResult},
    image_variants::{Demand, Priority},
    media, thumbnails,
};
use axum::{
    Router,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::Engine;
use lofty::{
    file::TaggedFileExt,
    prelude::{Accessor, AudioFile},
    probe::Probe,
    tag::ItemKey,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{path::Path as FsPath, time::UNIX_EPOCH};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
    process::Command,
};
use tokio_util::io::ReaderStream;

pub(crate) fn thumbnail_response(
    data: Vec<u8>,
    success: bool,
    permanent_failure: bool,
) -> Response {
    (
        [
            (
                header::CONTENT_TYPE,
                if success { "image/jpeg" } else { "image/png" },
            ),
            (
                header::CACHE_CONTROL,
                if success || permanent_failure {
                    "public, max-age=31536000"
                } else {
                    "public, max-age=3600"
                },
            ),
        ],
        data,
    )
        .into_response()
}

pub(crate) async fn thumbnail_path(state: &AppState, logical: &str) -> Response {
    let Ok(resolved) = media::resolve(&state.config, logical) else {
        return thumbnail_response(thumbnails::PLACEHOLDER.to_vec(), false, false);
    };
    let Ok(metadata) = fs::metadata(&resolved.full).await else {
        return thumbnail_response(thumbnails::PLACEHOLDER.to_vec(), false, true);
    };
    if !metadata.is_file() {
        return thumbnail_response(thumbnails::PLACEHOLDER.to_vec(), false, true);
    }
    match state
        .thumbnails
        .read(&resolved.full, metadata.modified().unwrap_or(UNIX_EPOCH))
        .await
    {
        Ok(data) => thumbnail_response(data, true, false),
        Err(_) => thumbnail_response(thumbnails::PLACEHOLDER.to_vec(), false, false),
    }
}

async fn thumbnail(State(state): State<Shared>, Path(path): Path<String>) -> Response {
    thumbnail_path(&state, &path).await
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageQuery {
    width: f64,
    height: f64,
    dpr: f64,
    scale: f64,
    priority: String,
}

impl ImageQuery {
    fn demand(&self) -> AppResult<Demand> {
        let priority = match self.priority.as_str() {
            "active" => Priority::Active,
            "next" => Priority::Next,
            "prefetch" => Priority::Prefetch,
            _ => return Err(AppError::bad("Invalid image priority")),
        };
        let demand = Demand {
            viewport_width: self.width,
            viewport_height: self.height,
            dpr: self.dpr,
            scale: self.scale,
            priority,
        };
        if !self.width.is_finite()
            || !self.height.is_finite()
            || !self.dpr.is_finite()
            || !self.scale.is_finite()
            || self.width <= 0.0
            || self.height <= 0.0
            || self.width > 32_768.0
            || self.height > 32_768.0
            || self.dpr <= 0.0
            || !(0.25..=4.0).contains(&self.scale)
        {
            return Err(AppError::bad("Invalid image dimensions"));
        }
        Ok(demand)
    }
}

fn not_modified(headers: &HeaderMap, etag: &str) -> bool {
    headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(',').any(|candidate| candidate.trim() == etag))
}

fn not_modified_response(etag: &str) -> Response {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NOT_MODIFIED;
    let headers = response.headers_mut();
    headers.insert(header::ETAG, HeaderValue::from_str(etag).unwrap());
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    response
}

pub(crate) async fn image_path(
    state: &AppState,
    logical: &str,
    query: &ImageQuery,
    headers: &HeaderMap,
) -> AppResult<Response> {
    let resolved = media::resolve(&state.config, logical)?;
    let metadata = fs::metadata(&resolved.full).await.map_err(AppError::io)?;
    if !metadata.is_file() {
        return Err(AppError::bad("Not a file"));
    }
    let modified = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let source_etag = format!("\"source-m{modified}-s{}\"", metadata.len());
    if let Some(variant) = state
        .image_variants
        .read(&resolved.full, query.demand()?)
        .await
    {
        if not_modified(headers, &variant.etag) {
            return Ok(not_modified_response(&variant.etag));
        }
        let mut response = Response::new(Body::from(variant.data));
        let values = response.headers_mut();
        values.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/webp"));
        values.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("private, no-cache"),
        );
        values.insert(header::ETAG, HeaderValue::from_str(&variant.etag).unwrap());
        return Ok(response);
    }
    if not_modified(headers, &source_etag) {
        return Ok(not_modified_response(&source_etag));
    }
    let mut response = media_path(state, logical, headers).await?;
    let values = response.headers_mut();
    values.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-cache"),
    );
    values.insert(header::ETAG, HeaderValue::from_str(&source_etag).unwrap());
    Ok(response)
}

async fn image_file(
    State(state): State<Shared>,
    Path(path): Path<String>,
    Query(query): Query<ImageQuery>,
    headers: HeaderMap,
) -> AppResult<Response> {
    image_path(&state, &path, &query, &headers)
        .await
        .map_err(|error| {
            if error.1.contains("Invalid path") {
                AppError::forbidden("Invalid path")
            } else if error.0 == StatusCode::NOT_FOUND {
                AppError::not_found("File not found")
            } else {
                error
            }
        })
}

async fn image_config(State(state): State<Shared>) -> JsonValue {
    axum::Json(json!({ "enabled": state.image_variants.enabled() }))
}

pub(crate) async fn audio_metadata_path(full: &FsPath) -> AppResult<JsonValue> {
    let path = full.to_path_buf();
    let metadata = tokio::task::spawn_blocking(move || {
        let tagged = Probe::open(path)
            .map_err(|error| error.to_string())?
            .read()
            .map_err(|error| error.to_string())?;
        let duration = tagged.properties().duration().as_secs_f64();
        let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
        let cover = tag.and_then(|tag| tag.pictures().first()).map(|picture| {
            format!(
                "data:{};base64,{}",
                picture
                    .mime_type()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "application/octet-stream".into()),
                base64::engine::general_purpose::STANDARD.encode(picture.data())
            )
        });
        let genres = tag
            .map(|tag| tag.get_strings(ItemKey::Genre).map(str::to_string).collect::<Vec<_>>())
            .unwrap_or_default();
        let nonempty = |value: Option<std::borrow::Cow<'_, str>>| {
            value.map(|value| value.into_owned()).filter(|value| !value.is_empty())
        };
        Ok::<_, String>(json!({
            "title":nonempty(tag.and_then(|tag|tag.title())),
            "artist":nonempty(tag.and_then(|tag|tag.artist())),
            "album":nonempty(tag.and_then(|tag|tag.album())),
            "year":tag.and_then(|tag|tag.date()).map(|date|date.year).filter(|value|*value>0),
            "genre":(!genres.is_empty()).then_some(genres),
            "duration":(duration > 0.0).then_some(duration),
            "coverArt":cover,
            "trackNumber":tag.and_then(|tag|tag.track()).filter(|value|*value>0),
            "albumArtist":tag.and_then(|tag|tag.get_string(ItemKey::AlbumArtist)).filter(|value|!value.is_empty()).map(str::to_string)
        }))
    })
    .await
    .map_err(|error| AppError::internal(error.to_string()))?
    .map_err(|_| AppError::internal("Failed to read audio metadata"))?;
    Ok(axum::Json(metadata))
}

type JsonValue = axum::Json<Value>;

async fn audio_metadata(
    State(state): State<Shared>,
    Path(path): Path<String>,
) -> AppResult<JsonValue> {
    let result = async {
        let full = media::resolve(&state.config, &path)?.full;
        audio_metadata_path(&full).await
    }
    .await;
    result.map_err(|_| AppError::internal("Failed to read audio metadata"))
}

pub(crate) fn parse_byte_range(headers: &HeaderMap, size: u64) -> AppResult<Option<(u64, u64)>> {
    let Some(range) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes="))
    else {
        return Ok(None);
    };
    if size == 0 || range.contains(',') {
        return Err(AppError(
            StatusCode::RANGE_NOT_SATISFIABLE,
            "Invalid range".into(),
        ));
    }
    let (first, last) = range
        .split_once('-')
        .ok_or_else(|| AppError(StatusCode::RANGE_NOT_SATISFIABLE, "Invalid range".into()))?;
    let (start, end) = if first.is_empty() {
        let suffix = last
            .parse::<u64>()
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError(StatusCode::RANGE_NOT_SATISFIABLE, "Invalid range".into()))?;
        (size.saturating_sub(suffix.min(size)), size - 1)
    } else {
        let start = first
            .parse::<u64>()
            .map_err(|_| AppError(StatusCode::RANGE_NOT_SATISFIABLE, "Invalid range".into()))?;
        let end = if last.is_empty() {
            size - 1
        } else {
            last.parse::<u64>()
                .map_err(|_| AppError(StatusCode::RANGE_NOT_SATISFIABLE, "Invalid range".into()))?
                .min(size - 1)
        };
        (start, end)
    };
    if start >= size || start > end {
        return Err(AppError(
            StatusCode::RANGE_NOT_SATISFIABLE,
            "Invalid range".into(),
        ));
    }
    Ok(Some((start, end)))
}

fn cache_etag(metadata: &std::fs::Metadata) -> String {
    let modified = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("\"m{modified}-s{}\"", metadata.len())
}

fn audio_extract_cache_path(
    data_path: &FsPath,
    full: &FsPath,
    metadata: &std::fs::Metadata,
) -> std::path::PathBuf {
    let canonical = std::fs::canonicalize(full).unwrap_or_else(|_| full.to_owned());
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    let source_hash = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let modified = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    data_path.join("audio-extracts").join(format!(
        "{source_hash}-m{modified}-s{}-opus-v1.webm",
        metadata.len()
    ))
}

async fn ensure_audio_extract<F>(cache: &FsPath, command: F) -> AppResult<()>
where
    F: FnOnce(&FsPath) -> Command,
{
    if fs::metadata(cache).await.is_ok() {
        return Ok(());
    }
    let parent = cache
        .parent()
        .ok_or_else(|| AppError::internal("Invalid audio cache path"))?;
    fs::create_dir_all(parent).await.map_err(AppError::io)?;
    let temporary = cache.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut command = command(&temporary);
    let status = command.status().await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError(
                StatusCode::NOT_IMPLEMENTED,
                "FFmpeg not found. Please install ffmpeg on the server.".into(),
            )
        } else {
            AppError::io(error)
        }
    })?;
    if !status.success() {
        let _ = fs::remove_file(&temporary).await;
        return Err(AppError::internal("Audio extraction failed"));
    }
    let metadata = fs::metadata(&temporary).await.map_err(AppError::io)?;
    if metadata.len() == 0 {
        let _ = fs::remove_file(&temporary).await;
        return Err(AppError::internal("Audio extraction produced no audio"));
    }
    fs::rename(&temporary, cache).await.map_err(AppError::io)
}

async fn ranged_file_response(
    full: &FsPath,
    mime: &'static str,
    headers: &HeaderMap,
    cache_control: &'static str,
    etag: &str,
) -> AppResult<Response> {
    if not_modified(headers, etag) {
        return Ok(not_modified_response(etag));
    }
    let metadata = fs::metadata(full).await.map_err(AppError::io)?;
    let size = metadata.len();
    if size == 0 {
        if headers.contains_key(header::RANGE) {
            return Err(AppError(
                StatusCode::RANGE_NOT_SATISFIABLE,
                "Invalid range".into(),
            ));
        }
        let mut response = Response::new(Body::empty());
        let values = response.headers_mut();
        values.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
        values.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        values.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        values.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static(cache_control),
        );
        values.insert(header::ETAG, HeaderValue::from_str(etag).unwrap());
        return Ok(response);
    }
    let (start, end, partial) = parse_byte_range(headers, size)?
        .map(|(start, end)| (start, end, true))
        .unwrap_or((0, size - 1, false));
    let mut file = fs::File::open(full).await.map_err(AppError::io)?;
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(AppError::io)?;
    let stream = ReaderStream::new(file.take(end - start + 1));
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = if partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let values = response.headers_mut();
    values.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    values.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&(end - start + 1).to_string()).unwrap(),
    );
    values.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    values.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(cache_control),
    );
    values.insert(header::ETAG, HeaderValue::from_str(etag).unwrap());
    if partial {
        values.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")).unwrap(),
        );
    }
    Ok(response)
}

pub(crate) async fn extract_audio_path(
    state: &AppState,
    full: &FsPath,
    headers: &HeaderMap,
) -> AppResult<Response> {
    let extension = full
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if media::media_type(&extension) != "video" {
        return Err(AppError::bad("Not a video file"));
    }
    let metadata = fs::metadata(full).await.map_err(AppError::io)?;
    let cache = audio_extract_cache_path(&state.config.data_path, full, &metadata);
    let _guard = state.audio_extracts.lock().await;
    ensure_audio_extract(&cache, |temporary| {
        let mut command = Command::new("ffmpeg");
        command
            .args(["-hide_banner", "-loglevel", "error"])
            .arg("-i")
            .arg(full)
            .args(["-map", "0:a:0", "-vn", "-c:a", "libopus", "-b:a", "128k"])
            .arg("-f")
            .arg("webm")
            .arg(temporary)
            .kill_on_drop(true);
        command
    })
    .await?;
    drop(_guard);
    let cache_metadata = fs::metadata(&cache).await.map_err(AppError::io)?;
    ranged_file_response(
        &cache,
        "audio/webm",
        headers,
        "private, no-cache",
        &cache_etag(&cache_metadata),
    )
    .await
}

#[cfg(test)]
mod playback_regression_tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        time::Duration,
    };

    #[cfg(unix)]
    #[tokio::test]
    async fn cached_audio_range_does_not_run_the_transcoder_again() {
        let directory = std::env::temp_dir().join(format!("derp-audio-{}", uuid::Uuid::new_v4()));
        let cache = directory.join("cached.webm");
        fs::create_dir_all(&directory).await.unwrap();
        fs::write(&cache, b"cached audio").await.unwrap();
        let invoked = AtomicBool::new(false);

        tokio::time::timeout(
            Duration::from_millis(100),
            ensure_audio_extract(&cache, |_| {
                invoked.store(true, Ordering::SeqCst);
                let mut command = Command::new("sh");
                command.args(["-c", "sleep 1"]);
                command
            }),
        )
        .await
        .expect("cached audio waited for the transcoder")
        .unwrap();

        assert!(!invoked.load(Ordering::SeqCst));
        let mut headers = HeaderMap::new();
        headers.insert(header::RANGE, HeaderValue::from_static("bytes=0-0"));
        let metadata = fs::metadata(&cache).await.unwrap();
        let response = ranged_file_response(
            &cache,
            "audio/webm",
            &headers,
            "private, no-cache",
            &cache_etag(&metadata),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()[header::CONTENT_RANGE], "bytes 0-0/12");
        let _ = fs::remove_dir_all(directory).await;
    }
}

async fn extract_audio(
    State(state): State<Shared>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let full = media::resolve(&state.config, &path)?.full;
    if !full.exists() {
        return Err(AppError::not_found("File not found"));
    }
    if !full.is_file() {
        return Err(AppError::bad("Not a file"));
    }
    extract_audio_path(&state, &full, &headers).await
}

pub(crate) async fn media_path(
    state: &AppState,
    logical: &str,
    headers: &HeaderMap,
) -> AppResult<Response> {
    let resolved = media::resolve(&state.config, logical)?;
    let metadata = fs::metadata(&resolved.full).await.map_err(AppError::io)?;
    if !metadata.is_file() {
        return Err(AppError::bad("Not a file"));
    }
    let extension = media::extension(&resolved.full);
    let mime = media::mime_type(&extension);
    let cache_control =
        if media::media_type(&extension) == "text" || media::editable(&state.config, logical) {
            "no-cache, no-store, must-revalidate"
        } else {
            "private, no-cache"
        };
    ranged_file_response(
        &resolved.full,
        mime,
        headers,
        cache_control,
        &cache_etag(&metadata),
    )
    .await
}

async fn media_file(
    State(state): State<Shared>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    media_path(&state, &path, &headers).await.map_err(|error| {
        if error.1.contains("Invalid path") {
            AppError::forbidden("Invalid path")
        } else if error.0 == StatusCode::NOT_FOUND {
            AppError::not_found("File not found")
        } else {
            error
        }
    })
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/media/{*path}", get(media_file))
        .route("/api/image-config", get(image_config))
        .route("/api/image/{*path}", get(image_file))
        .route("/api/thumbnail/{*path}", get(thumbnail))
        .route("/api/audio/metadata/{*path}", get(audio_metadata))
        .route("/api/audio/extract/{*path}", get(extract_audio))
}
