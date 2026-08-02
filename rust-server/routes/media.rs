use crate::{
    app::{AppState, Shared, roots},
    error::{AppError, AppResult},
    media, thumbnails,
};
use axum::{
    Router,
    body::Body,
    extract::{Path, State},
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
use serde_json::{Value, json};
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
    let Ok(resolved) = media::resolve(&state.config, &roots(state), logical) else {
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
        let full = media::resolve(&state.config, &roots(&state), &path)?.full;
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

pub(crate) async fn extract_audio_path(full: &FsPath, headers: &HeaderMap) -> AppResult<Response> {
    let extension = full
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if media::media_type(&extension) != "video" {
        return Err(AppError::bad("Not a video file"));
    }
    let mut command = Command::new("ffmpeg");
    command
        .arg("-i")
        .arg(full)
        .args([
            "-vn", "-c:a", "libopus", "-b:a", "128k", "-f", "webm", "pipe:1",
        ])
        .kill_on_drop(true);
    let output = command.output().await.map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError(
                StatusCode::NOT_IMPLEMENTED,
                "FFmpeg not found. Please install ffmpeg on the server.".into(),
            )
        } else {
            AppError::io(error)
        }
    })?;
    if !output.status.success() {
        return Err(AppError::internal("Audio extraction failed"));
    }
    let size = output.stdout.len();
    if size == 0 {
        if headers.contains_key(header::RANGE) {
            return Err(AppError(
                StatusCode::RANGE_NOT_SATISFIABLE,
                "Invalid range".into(),
            ));
        }
        let mut response = Response::new(Body::empty());
        let values = response.headers_mut();
        values.insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/webm"));
        values.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=3600"),
        );
        values.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        values.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        return Ok(response);
    }
    let (start, end, partial) = parse_byte_range(headers, size as u64)?
        .map(|(start, end)| (start as usize, end as usize, true))
        .unwrap_or((0, size.saturating_sub(1), false));
    let mut response = Response::new(Body::from(output.stdout[start..=end].to_vec()));
    *response.status_mut() = if partial {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let values = response.headers_mut();
    values.insert(header::CONTENT_TYPE, HeaderValue::from_static("audio/webm"));
    values.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );
    values.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    values.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&(end - start + 1).to_string()).unwrap(),
    );
    if partial {
        values.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")).unwrap(),
        );
    }
    Ok(response)
}

async fn extract_audio(
    State(state): State<Shared>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let full = media::resolve(&state.config, &roots(&state), &path)?.full;
    if !full.exists() {
        return Err(AppError::not_found("File not found"));
    }
    if !full.is_file() {
        return Err(AppError::bad("Not a file"));
    }
    extract_audio_path(&full, &headers).await
}

pub(crate) async fn media_path(
    state: &AppState,
    logical: &str,
    headers: &HeaderMap,
) -> AppResult<Response> {
    let resolved = media::resolve(&state.config, &roots(state), logical)?;
    let metadata = fs::metadata(&resolved.full).await.map_err(AppError::io)?;
    if !metadata.is_file() {
        return Err(AppError::bad("Not a file"));
    }
    let size = metadata.len();
    let extension = resolved
        .full
        .extension()
        .unwrap_or_default()
        .to_string_lossy();
    let mime = media::mime_type(&extension);
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
            HeaderValue::from_static(
                if media::media_type(&extension) == "text"
                    || media::editable(&state.config, &roots(state), logical)
                {
                    "no-cache, no-store, must-revalidate"
                } else {
                    "public, max-age=31536000"
                },
            ),
        );
        return Ok(response);
    }
    let (start, end, partial) = parse_byte_range(headers, size)?
        .map(|(start, end)| (start, end, true))
        .unwrap_or((0, size.saturating_sub(1), false));
    let mut file = fs::File::open(&resolved.full).await.map_err(AppError::io)?;
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
    if partial {
        values.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{size}")).unwrap(),
        );
    }
    values.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(
            if media::media_type(&extension) == "text"
                || media::editable(&state.config, &roots(state), logical)
            {
                "no-cache, no-store, must-revalidate"
            } else {
                "public, max-age=31536000"
            },
        ),
    );
    Ok(response)
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
        .route("/api/thumbnail/{*path}", get(thumbnail))
        .route("/api/audio/metadata/{*path}", get(audio_metadata))
        .route("/api/audio/extract/{*path}", get(extract_audio))
}
