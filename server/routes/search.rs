use crate::{
    app::{Shared, knowledge_bases, roots, search_snippet},
    error::{AppError, AppResult},
    media,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::UNIX_EPOCH;

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    limit: Option<String>,
}

async fn files(
    State(state): State<Shared>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<Value>> {
    let limit = query
        .limit
        .and_then(|value| javascript_number(&value))
        .filter(|value| value.is_finite())
        .map(|value| value.floor().clamp(1.0, 100.0) as usize)
        .unwrap_or(50);
    let term = query.q.ok_or_else(|| AppError::bad("q must be a string"))?;
    if !(3..=200).contains(&crate::file_search::normalized_length(term.trim())) {
        return Err(AppError::bad("Query must contain 3-200 characters"));
    }
    Ok(Json(
        state
            .file_search
            .search(term.trim(), limit)
            .await
            .map_err(|error| AppError(StatusCode::SERVICE_UNAVAILABLE, error.1))?,
    ))
}

fn javascript_number(value: &str) -> Option<f64> {
    let value = value.trim();
    if value.is_empty() {
        return Some(0.0);
    }
    let unsigned = value.strip_prefix('+').unwrap_or(value);
    if let Some(hex) = unsigned
        .strip_prefix("0x")
        .or_else(|| unsigned.strip_prefix("0X"))
    {
        return u64::from_str_radix(hex, 16).ok().map(|value| value as f64);
    }
    if let Some(binary) = unsigned
        .strip_prefix("0b")
        .or_else(|| unsigned.strip_prefix("0B"))
    {
        return u64::from_str_radix(binary, 2)
            .ok()
            .map(|value| value as f64);
    }
    if let Some(octal) = unsigned
        .strip_prefix("0o")
        .or_else(|| unsigned.strip_prefix("0O"))
    {
        return u64::from_str_radix(octal, 8).ok().map(|value| value as f64);
    }
    value.parse().ok()
}

async fn status(State(state): State<Shared>) -> AppResult<Json<Value>> {
    Ok(Json(state.file_search.status().await.map_err(|error| {
        AppError(StatusCode::SERVICE_UNAVAILABLE, error.1)
    })?))
}

async fn reindex(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<(StatusCode, Json<Value>)> {
    if body["mode"] != "reconcile" && body["mode"] != "full" {
        return Err(AppError::bad("mode must be \"reconcile\" or \"full\""));
    }
    if body.get("rootId").is_some() && !body["rootId"].is_string() {
        return Err(AppError::bad("rootId must be a string"));
    }
    let root = body["rootId"].as_str().map(str::to_string);
    state
        .file_search
        .reindex(body["mode"].as_str().unwrap(), root)
        .await
        .map_err(|error| AppError(StatusCode::SERVICE_UNAVAILABLE, error.1))?;
    Ok((StatusCode::ACCEPTED, Json(json!({"accepted":true}))))
}

#[derive(Deserialize)]
struct KbQuery {
    q: Option<String>,
    root: Option<String>,
}

fn validate_root(state: &crate::app::AppState, root: &str, exact: bool) -> AppResult<()> {
    let normalized = root.replace('\\', "/");
    let valid = knowledge_bases(state).iter().any(|item| {
        let item = item.replace('\\', "/");
        normalized == item || (!exact && normalized.starts_with(&(item + "/")))
    });
    if valid {
        Ok(())
    } else {
        Err(AppError::bad(if exact {
            "Not a knowledge base"
        } else {
            "Not within a knowledge base"
        }))
    }
}

fn logical_path(
    state: &crate::app::AppState,
    resolved: &media::ResolvedPath,
    path: &std::path::Path,
) -> String {
    let relative = path
        .strip_prefix(&resolved.root.path)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    if state.config.roots.len() + roots(state).len() > 1 {
        format!("{}/{}", resolved.root.name, relative)
    } else {
        relative
    }
}

fn visible(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !name.starts_with('.')
        && ![
            "node_modules",
            "$RECYCLE.BIN",
            "System Volume Information",
            ".git",
            ".svn",
            ".hg",
            "__pycache__",
            ".DS_Store",
        ]
        .contains(&name.as_ref())
}

async fn kb_search(
    State(state): State<Shared>,
    Query(query): Query<KbQuery>,
) -> AppResult<Json<Value>> {
    let needle = query.q.unwrap_or_default().trim().to_lowercase();
    let root = query.root.unwrap_or_default();
    if needle.is_empty() || root.is_empty() {
        return Ok(Json(json!({"results":[]})));
    }
    validate_root(&state, &root, true)?;
    let resolved = media::resolve(&state.config, &roots(&state), &root)?;
    let mut results = Vec::new();
    for entry in walkdir::WalkDir::new(&resolved.full)
        .into_iter()
        .filter_entry(visible)
        .filter_map(Result::ok)
    {
        if results.len() >= 50 {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let extension = entry
            .path()
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        if extension != "md" && extension != "txt" {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if !content.to_lowercase().contains(&needle) {
            continue;
        }
        let snippet = search_snippet(&content, &needle);
        results.push(json!({"path":logical_path(&state, &resolved, entry.path()),"name":entry.file_name().to_string_lossy(),"snippet":snippet}));
    }
    Ok(Json(json!({"results":results})))
}

async fn kb_recent(
    State(state): State<Shared>,
    Query(query): Query<KbQuery>,
) -> AppResult<Json<Value>> {
    let root = query.root.unwrap_or_default();
    if root.is_empty() {
        return Ok(Json(json!({"results":[]})));
    }
    validate_root(&state, &root, false)?;
    let resolved = media::resolve(&state.config, &roots(&state), &root)?;
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(&resolved.full)
        .into_iter()
        .filter_entry(visible)
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file()
            || entry
                .path()
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase()
                != "md"
        {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|value| value.modified().ok())
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0);
        files.push((modified, logical_path(&state, &resolved, entry.path())));
    }
    files.sort_by_key(|item| std::cmp::Reverse(item.0));
    files.truncate(10);
    Ok(Json(
        json!({"results":files.into_iter().map(|(modified,path)|json!({"name":media::name(&path),"path":path,"modifiedAt":chrono::DateTime::from_timestamp_millis(modified as i64).map(|date|date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))})).collect::<Vec<_>>() }),
    ))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/files/search", get(files))
        .route("/api/files/search/status", get(status))
        .route("/api/files/search/reindex", post(reindex))
        .route("/api/kb/search", get(kb_search))
        .route("/api/kb/recent", get(kb_recent))
}
