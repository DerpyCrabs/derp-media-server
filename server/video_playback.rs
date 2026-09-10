use crate::{
    app::{Shared, emit_admin},
    config::Config,
    error::{AppError, AppResult},
    media,
    playback_cache::{CacheLease, PlaybackCache},
    routes::media::ranged_file_response,
};
use axum::{
    Json, Router,
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
    routing::get,
};
use bytes::Bytes;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{io::AsyncReadExt, process::Command};

#[derive(Clone)]
pub(crate) struct PlaybackRuntime {
    pub cache: PlaybackCache,
    probes: Arc<Mutex<HashMap<String, Value>>>,
    statuses: Arc<Mutex<HashMap<String, (Instant, Option<String>)>>>,
}

impl PlaybackRuntime {
    pub fn new(config: &Config) -> Self {
        Self {
            cache: PlaybackCache::new(&config.data_path, config.playback.max_cache_size),
            probes: Default::default(),
            statuses: Default::default(),
        }
    }

    async fn probe(&self, full: &Path) -> AppResult<Value> {
        let key = PlaybackCache::key(full, "probe")?;
        if let Some(value) = self.probes.lock().unwrap().get(&key) {
            return Ok(value.clone());
        }
        let _lock = self.cache.lock(&key).await;
        if let Some(value) = self.probes.lock().unwrap().get(&key) {
            return Ok(value.clone());
        }
        let output = tokio::time::timeout(Duration::from_secs(20), Command::new("ffprobe")
            .args(["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries",
                "format=format_name,duration,bit_rate:stream=index,codec_name,codec_type,profile,level,codec_tag_string,pix_fmt,width,height,r_frame_rate,bit_rate,sample_rate,channels,color_transfer,color_primaries,color_space,color_range:stream_tags=language,title:stream_disposition=default,forced,attached_pic",
                "-of", "json"])
            .arg(full).kill_on_drop(true).output()).await
            .map_err(|_| AppError::internal("Media inspection timed out"))?
            .map_err(tool_error)?;
        if !output.status.success() {
            return Err(AppError::bad(
                "This file could not be inspected. It may be incomplete or damaged.",
            ));
        }
        let value: Value = serde_json::from_slice(&output.stdout)
            .map_err(|_| AppError::internal("Invalid ffprobe response"))?;
        let mut probes = self.probes.lock().unwrap();
        if probes.len() >= 256 {
            probes.clear();
        }
        probes.insert(key, value.clone());
        Ok(value)
    }

    fn status(&self, id: &str, error: Option<String>) {
        if id.is_empty() {
            return;
        }
        let mut statuses = self.statuses.lock().unwrap();
        statuses.retain(|_, (time, _)| time.elapsed() < Duration::from_secs(300));
        if statuses.len() >= 512 {
            statuses.clear();
        }
        statuses.insert(id.into(), (Instant::now(), error));
    }
}

fn tool_error(error: std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::NotFound {
        AppError(StatusCode::NOT_IMPLEMENTED, "Install FFmpeg and ffprobe on the server to use track selection and compatibility playback.".into())
    } else {
        AppError::io(error)
    }
}

fn number(value: &Value) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .filter(|value| value.is_finite())
        .unwrap_or(0.0)
}

fn streams(probe: &Value) -> &[Value] {
    probe["streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}
fn video_stream(probe: &Value) -> Option<&Value> {
    streams(probe).iter().find(|stream| {
        stream["codec_type"] == "video" && stream["disposition"]["attached_pic"] != 1
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Track {
    id: String,
    index: Option<u64>,
    codec: String,
    language: String,
    title: String,
    default: bool,
    supported: bool,
    #[serde(skip)]
    sidecar: Option<PathBuf>,
}

fn embedded_tracks(probe: &Value, kind: &str) -> Vec<Track> {
    streams(probe)
        .iter()
        .filter(|stream| stream["codec_type"] == kind)
        .filter_map(|stream| {
            let index = stream["index"].as_u64()?;
            let codec = stream["codec_name"]
                .as_str()
                .unwrap_or("unknown")
                .to_owned();
            Some(Track {
                id: format!("embedded:{index}"),
                index: Some(index),
                supported: kind == "audio"
                    || matches!(
                        codec.as_str(),
                        "subrip" | "webvtt" | "ass" | "ssa" | "mov_text" | "text"
                    ),
                codec,
                language: stream["tags"]["language"].as_str().unwrap_or("und").into(),
                title: stream["tags"]["title"].as_str().unwrap_or("").into(),
                default: stream["disposition"]["default"] == 1,
                sidecar: None,
            })
        })
        .collect()
}

fn subtitles(full: &Path, probe: &Value) -> Vec<Track> {
    let mut tracks = embedded_tracks(probe, "subtitle");
    let Some(parent) = full.parent() else {
        return tracks;
    };
    let stem = full
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    let mut directories = vec![parent.to_owned()];
    if let Ok(entries) = std::fs::read_dir(parent) {
        directories.extend(
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path()),
        );
    }
    let mut sidecars = Vec::new();
    for directory in directories {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
                continue;
            }
            let path = entry.path();
            let extension = media::extension(&path);
            if !matches!(extension.as_str(), "srt" | "vtt" | "ass" | "ssa") {
                continue;
            }
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase();
            if name != stem
                && !name.starts_with(&format!("{stem}."))
                && !name.starts_with(&format!("{stem} "))
            {
                continue;
            }
            sidecars.push(path);
        }
    }
    sidecars.sort();
    for path in sidecars {
        let relative = path
            .strip_prefix(parent)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        let suffix = path.file_stem().unwrap_or_default().to_string_lossy();
        let language = suffix
            .rsplit('.')
            .next()
            .filter(|suffix| {
                (2..=3).contains(&suffix.len())
                    && suffix.bytes().all(|byte| byte.is_ascii_alphabetic())
            })
            .unwrap_or("und");
        tracks.push(Track {
            id: format!("sidecar:{relative}"),
            index: None,
            codec: media::extension(&path),
            language: language.to_lowercase(),
            title: relative,
            default: false,
            supported: true,
            sidecar: Some(path),
        });
    }
    tracks
}

#[derive(Deserialize)]
struct PathQuery {
    path: String,
}

async fn info(
    State(state): State<Shared>,
    Query(query): Query<PathQuery>,
) -> AppResult<Json<Value>> {
    let full = media::resolve(&state.config, &query.path)?.full;
    let probe = state.playback.probe(&full).await?;
    Ok(Json(json!({
        "fingerprint": PlaybackCache::key(&full, "source")?,
        "duration": number(&probe["format"]["duration"]),
        "container": probe["format"]["format_name"],
        "video": video_stream(&probe),
        "audio": embedded_tracks(&probe, "audio"),
        "subtitles": subtitles(&full, &probe),
        "allowVideoTranscoding": state.config.playback.allow_video_transcoding,
    })))
}

fn preference_key(state: &Shared, path: &str) -> String {
    format!("{}\0{path}", state.config.library_key)
}

fn read_preferences(state: &Shared, path: &str) -> AppResult<Value> {
    let global = state.database.document(
        "playback-preferences",
        &state.config.library_key,
        json!({"audioLanguage":"", "subtitleLanguage":"", "secondarySubtitleLanguage":""}),
    )?;
    let video = state.database.document(
        "video-preferences",
        &preference_key(state, path),
        json!({"speed":1}),
    )?;
    Ok(json!({"global":global, "video":video}))
}

async fn preferences(
    State(state): State<Shared>,
    Query(query): Query<PathQuery>,
) -> AppResult<Json<Value>> {
    media::resolve(&state.config, &query.path)?;
    Ok(Json(read_preferences(&state, &query.path)?))
}

async fn save_preferences(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let path = body["path"]
        .as_str()
        .ok_or_else(|| AppError::bad("A video path is required"))?;
    media::resolve(&state.config, path)?;
    let video = body.get("video").and_then(Value::as_object);
    let global = body.get("global").and_then(Value::as_object);
    if let Some(values) = video {
        for (key, value) in values {
            let valid = match key.as_str() {
                "speed" => value
                    .as_f64()
                    .is_some_and(|speed| speed.is_finite() && (0.25..=3.0).contains(&speed)),
                "audioTrack" | "subtitleTrack" | "secondarySubtitleTrack" => {
                    value.is_null() || value.as_str().is_some_and(|text| text.len() <= 2048)
                }
                _ => false,
            };
            if !valid {
                return Err(AppError::bad(format!("Invalid playback preference: {key}")));
            }
        }
    }
    if let Some(values) = global {
        for (key, value) in values {
            if !matches!(
                key.as_str(),
                "audioLanguage" | "subtitleLanguage" | "secondarySubtitleLanguage"
            ) || !value.as_str().is_some_and(|text| text.len() <= 32)
            {
                return Err(AppError::bad(format!("Invalid language preference: {key}")));
            }
        }
    }
    for (kind, key, values) in [
        (
            "playback-preferences",
            state.config.library_key.clone(),
            global,
        ),
        ("video-preferences", preference_key(&state, path), video),
    ] {
        if let Some(values) = values {
            state.database.update(kind, &key, json!({}), |document| {
                let object = document
                    .as_object_mut()
                    .ok_or_else(|| AppError::internal("Invalid saved playback preferences"))?;
                object.extend(values.clone());
                Ok(())
            })?;
        }
    }
    emit_admin(&state, "playback-preferences-changed");
    Ok(Json(read_preferences(&state, path)?))
}

async fn cached_response(
    lease: CacheLease,
    mime: &'static str,
    headers: &HeaderMap,
) -> AppResult<Response> {
    let etag = format!(
        "\"{}\"",
        lease.path.file_name().unwrap_or_default().to_string_lossy()
    );
    let mut response =
        ranged_file_response(&lease.path, mime, headers, "private, no-cache", &etag).await?;
    let original = std::mem::replace(response.body_mut(), Body::empty());
    let stream = async_stream::stream! {
        let _lease = lease;
        let mut body = original.into_data_stream();
        while let Some(chunk) = body.next().await { yield chunk; }
    };
    *response.body_mut() = Body::from_stream(stream);
    Ok(response)
}

async fn collect_output(
    cache: &PlaybackCache,
    key: &str,
    command: &mut Command,
) -> AppResult<CacheLease> {
    let mut writer = cache.begin(key).await?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(tool_error)?;
    let mut stdout = child.stdout.take().unwrap();
    let mut buffer = vec![0; 64 * 1024];
    loop {
        let read = tokio::time::timeout(Duration::from_secs(60), stdout.read(&mut buffer))
            .await
            .map_err(|_| AppError::internal("Media processing timed out"))?
            .map_err(AppError::io)?;
        if read == 0 {
            break;
        }
        writer.write(&buffer[..read]).await?;
    }
    if !child.wait().await.map_err(AppError::io)?.success() {
        return Err(AppError::internal(
            "Media processing failed. Check that FFmpeg supports this track.",
        ));
    }
    writer.finish().await
}

#[derive(Deserialize)]
struct SubtitleQuery {
    path: String,
    track: String,
}

async fn subtitle(
    State(state): State<Shared>,
    Query(query): Query<SubtitleQuery>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let full = media::resolve(&state.config, &query.path)?.full;
    let probe = state.playback.probe(&full).await?;
    let track = subtitles(&full, &probe)
        .into_iter()
        .find(|track| track.id == query.track && track.supported)
        .ok_or_else(|| {
            AppError::bad("This subtitle track is unavailable or uses unsupported bitmap subtitles")
        })?;
    let input = track.sidecar.as_deref().unwrap_or(&full);
    let key = PlaybackCache::key(input, &format!("subtitle:{}", track.id))?;
    if let Some(lease) = state.playback.cache.get(&key) {
        return cached_response(lease, "text/vtt; charset=utf-8", &headers).await;
    }
    let _lock = state.playback.cache.lock(&key).await;
    if let Some(lease) = state.playback.cache.get(&key) {
        return cached_response(lease, "text/vtt; charset=utf-8", &headers).await;
    }
    let _slot = state
        .playback
        .cache
        .extraction_slots()
        .acquire_owned()
        .await
        .unwrap();
    let mut command = Command::new("ffmpeg");
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
        ])
        .arg(input);
    if let Some(index) = track.index {
        command.args(["-map", &format!("0:{index}")]);
    }
    command.args(["-f", "webvtt", "pipe:1"]);
    let lease = collect_output(&state.playback.cache, &key, &mut command).await?;
    cached_response(lease, "text/vtt; charset=utf-8", &headers).await
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamQuery {
    path: String,
    #[serde(default)]
    audio: Option<u64>,
    #[serde(default)]
    video: bool,
    #[serde(default)]
    audio_only: bool,
    #[serde(default)]
    copy_audio: bool,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    id: String,
}

fn stream_command(
    full: &Path,
    probe: &Value,
    query: &StreamQuery,
    config: &Config,
) -> AppResult<(Command, &'static str)> {
    if !query.start.is_finite() || query.start < 0.0 {
        return Err(AppError::bad("Invalid playback position"));
    }
    if query.video && !config.playback.allow_video_transcoding {
        return Err(AppError::bad(
            "This video needs conversion. Enable playback.allowVideoTranscoding in config.jsonc and restart the server.",
        ));
    }
    let video = video_stream(probe);
    if !query.audio_only && video.is_none() {
        return Err(AppError::bad("No video stream was found"));
    }
    let audio = if let Some(index) = query.audio {
        Some(
            streams(probe)
                .iter()
                .find(|stream| {
                    stream["codec_type"] == "audio" && stream["index"].as_u64() == Some(index)
                })
                .ok_or_else(|| AppError::bad("Audio track not found"))?,
        )
    } else {
        streams(probe)
            .iter()
            .find(|stream| stream["codec_type"] == "audio" && stream["disposition"]["default"] == 1)
            .or_else(|| {
                streams(probe)
                    .iter()
                    .find(|stream| stream["codec_type"] == "audio")
            })
    };
    if query.audio_only && audio.is_none() {
        return Err(AppError::bad("No audio track was found"));
    }
    let webm = query.audio_only
        || (!query.video
            && video
                .is_some_and(|video| matches!(video["codec_name"].as_str(), Some("vp8" | "vp9"))));
    let mut command = Command::new("ffmpeg");
    command.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-threads",
        &config.playback.threads.to_string(),
        "-filter_threads",
        &config.playback.threads.to_string(),
        "-protocol_whitelist",
        "file,pipe",
    ]);
    if query.start > 0.0 {
        command.args(["-ss", &format!("{:.3}", query.start)]);
    }
    command
        .args(["-copyts", "-start_at_zero"])
        .arg("-i")
        .arg(full);
    if !query.audio_only {
        let video = video.unwrap();
        command.args(["-map", &format!("0:{}", video["index"])]);
        if query.video {
            let width = number(&video["width"]) as u32;
            let height = number(&video["height"]) as u32;
            if width % 2 != 0 || height % 2 != 0 {
                return Err(AppError::bad(
                    "This video's dimensions cannot be encoded as compatible 4:2:0 video without resizing. The source resolution will not be changed automatically.",
                ));
            }
            if matches!(
                video["color_transfer"].as_str(),
                Some("smpte2084" | "arib-std-b67")
            ) {
                if video["color_primaries"] != "bt2020" {
                    return Err(AppError::bad(
                        "HDR color information is unsupported; automatic conversion cannot preserve its colors reliably.",
                    ));
                }
                command.args(["-vf", "zscale=transfer=linear:npl=100,format=gbrpf32le,zscale=primaries=bt709,tonemap=tonemap=mobius:desat=0,zscale=transfer=bt709:matrix=bt709:range=limited,format=yuv420p,sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA,sidedata=mode=delete:type=CONTENT_LIGHT_LEVEL", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"]);
            }
            command.args([
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-threads",
                &config.playback.threads.to_string(),
                "-force_key_frames",
                "expr:gte(t,n_forced*2)",
            ]);
        } else {
            command.args(["-c:v", "copy"]);
        }
    }
    if let Some(audio) = audio {
        command.args(["-map", &format!("0:{}", audio["index"])]);
        if query.copy_audio && !query.audio_only {
            command.args(["-c:a", "copy"]);
            if !webm && audio["codec_name"] == "aac" {
                command.args(["-bsf:a", "aac_adtstoasc"]);
            }
        } else {
            command.args([
                "-c:a",
                if webm { "libopus" } else { "aac" },
                "-b:a",
                "192k",
                "-ac",
                "2",
            ]);
        }
    }
    command.args([
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-avoid_negative_ts",
        "disabled",
    ]);
    if webm {
        command.args(["-f", "webm", "-cluster_time_limit", "1000", "-live", "1"]);
    } else {
        // MediaSource needs original timestamps in fragments, without edit-list offsets.
        command.args([
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+delay_moov+default_base_moof+frag_discont",
            "-use_editlist",
            "0",
            "-frag_duration",
            "1000000",
        ]);
    }
    command.arg("pipe:1");
    Ok((
        command,
        if query.audio_only {
            "audio/webm"
        } else if webm {
            "video/webm"
        } else {
            "video/mp4"
        },
    ))
}

async fn stream(
    State(state): State<Shared>,
    Query(query): Query<StreamQuery>,
    headers: HeaderMap,
) -> AppResult<Response> {
    if query.id.len() > 64 {
        return Err(AppError::bad("Invalid playback request"));
    }
    let result = stream_response(&state, &query, &headers).await;
    if let Err(error) = &result {
        state.playback.status(&query.id, Some(error.1.clone()));
    }
    result
}

async fn stream_response(
    state: &Shared,
    query: &StreamQuery,
    headers: &HeaderMap,
) -> AppResult<Response> {
    let full = media::resolve(&state.config, &query.path)?.full;
    let probe = state.playback.probe(&full).await?;
    let (mut command, mime) = stream_command(&full, &probe, query, &state.config)?;
    let key = PlaybackCache::key(
        &full,
        &format!(
            "stream-v7:{:?}:{}:{}:{}:{:.3}",
            query.audio, query.video, query.audio_only, query.copy_audio, query.start
        ),
    )?;
    if let Some(lease) = state.playback.cache.get(&key) {
        return cached_response(lease, mime, headers).await;
    }
    let lock = tokio::time::timeout(Duration::from_secs(30), state.playback.cache.lock(&key)).await
        .map_err(|_| AppError::conflict("This playback is already processing in another tab. Close it or retry when it finishes."))?;
    if let Some(lease) = state.playback.cache.get(&key) {
        return cached_response(lease, mime, headers).await;
    }
    let slots = if query.video {
        state.playback.cache.video_slots()
    } else {
        state.playback.cache.extraction_slots()
    };
    let slot = tokio::time::timeout(Duration::from_secs(30), slots.acquire_owned())
        .await
        .map_err(|_| {
            AppError::conflict(
                "Another playback is converting. Close it or retry when it finishes.",
            )
        })?
        .unwrap();
    let mut writer = state.playback.cache.begin(&key).await?;
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(tool_error)?;
    let mut stdout = child.stdout.take().unwrap();
    let runtime = state.playback.clone();
    let id = query.id.clone();
    runtime.status(&id, None);
    let output = async_stream::stream! {
        let (_lock, _slot) = (lock, slot);
        let mut buffer = vec![0; 64 * 1024];
        loop {
            let read = match tokio::time::timeout(Duration::from_secs(60), stdout.read(&mut buffer)).await {
                Ok(Ok(read)) => read,
                error => {
                    let message = format!("Media conversion stopped: {error:?}");
                    runtime.status(&id, Some(message.clone()));
                    yield Err::<Bytes, std::io::Error>(std::io::Error::other(message));
                    return;
                }
            };
            if read == 0 { break }
            if let Err(error) = writer.write(&buffer[..read]).await {
                runtime.status(&id, Some(error.1.clone()));
                yield Err(std::io::Error::other(error.1));
                return;
            }
            yield Ok(Bytes::copy_from_slice(&buffer[..read]));
        }
        if !child.wait().await.is_ok_and(|status| status.success()) {
            let message = "Media conversion failed. This codec or resolution may not be supported by the server.";
            runtime.status(&id, Some(message.into()));
            yield Err(std::io::Error::other(message));
            return;
        }
        if let Err(error) = writer.finish().await {
            runtime.status(&id, Some(error.1.clone()));
            yield Err(std::io::Error::other(error.1));
        }
    };
    let mut response = Response::new(Body::from_stream(output));
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert(header::ACCEPT_RANGES, HeaderValue::from_static("none"));
    Ok(response)
}

#[derive(Deserialize)]
struct StatusQuery {
    id: String,
}

async fn status(State(state): State<Shared>, Query(query): Query<StatusQuery>) -> Json<Value> {
    let error = state
        .playback
        .statuses
        .lock()
        .unwrap()
        .get(&query.id)
        .and_then(|(_, error)| error.clone());
    Json(json!({"error":error}))
}

pub(crate) async fn extract_audio(
    state: &crate::app::AppState,
    full: &Path,
    headers: &HeaderMap,
) -> AppResult<Response> {
    let probe = state.playback.probe(full).await?;
    let query = StreamQuery {
        path: String::new(),
        audio: None,
        video: false,
        audio_only: true,
        copy_audio: false,
        start: 0.0,
        id: String::new(),
    };
    let key = PlaybackCache::key(full, "listen-only-default-opus-v1")?;
    if let Some(lease) = state.playback.cache.get(&key) {
        return cached_response(lease, "audio/webm", headers).await;
    }
    let _lock = state.playback.cache.lock(&key).await;
    if let Some(lease) = state.playback.cache.get(&key) {
        return cached_response(lease, "audio/webm", headers).await;
    }
    let _slot = state
        .playback
        .cache
        .extraction_slots()
        .acquire_owned()
        .await
        .unwrap();
    let (mut command, mime) = stream_command(full, &probe, &query, &state.config)?;
    let lease = collect_output(&state.playback.cache, &key, &mut command).await?;
    cached_response(lease, mime, headers).await
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/playback/info", get(info))
        .route(
            "/api/playback/preferences",
            get(preferences).post(save_preferences),
        )
        .route("/api/playback/subtitle", get(subtitle))
        .route("/api/playback/stream", get(stream))
        .route("/api/playback/status", get(status))
}
