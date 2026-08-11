use crate::{
    app::{Shared, knowledge_base_root, roots, search_snippet},
    error::{AppError, AppResult},
    media,
    routes::share_access::validate,
    shares,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::get,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::UNIX_EPOCH;

#[derive(Deserialize)]
struct QueryParams {
    q: Option<String>,
    dir: Option<String>,
}
fn scope(
    share: &shares::Share,
    state: &crate::app::AppState,
    dir: Option<&str>,
) -> AppResult<media::ResolvedPath> {
    if !share.is_directory {
        return Err(AppError::bad("Share is not a directory"));
    }
    if knowledge_base_root(state, &share.path).is_none() {
        return Err(AppError::bad("Share is not a knowledge base"));
    }
    Ok(
        shares::resolve_authorized_subpath(&state.config, &roots(state), share, dir.unwrap_or(""))?
            .resolved,
    )
}

fn logical(
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

async fn search(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(query): Query<QueryParams>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let resolved = scope(&share, &state, query.dir.as_deref())?;
    let needle = query.q.unwrap_or_default().trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Json(json!({"results":[]})));
    }
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
        let relative = logical(&state, &resolved, entry.path());
        results.push(
            json!({"path":relative,"name":entry.file_name().to_string_lossy(),"snippet":search_snippet(&content,&needle)}),
        );
    }
    Ok(Json(json!({"results":results})))
}

async fn recent(
    State(state): State<Shared>,
    Path(token): Path<String>,
    headers: HeaderMap,
    Query(query): Query<QueryParams>,
) -> AppResult<Json<Value>> {
    let share = validate(&state, &token, &headers)?;
    let resolved = scope(&share, &state, query.dir.as_deref())?;
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
        let relative = logical(&state, &resolved, entry.path());
        files.push((modified, relative));
    }
    files.sort_by_key(|item| std::cmp::Reverse(item.0));
    files.truncate(10);
    Ok(Json(
        json!({"results":files.into_iter().map(|(modified,path)|json!({"name":shares::name(&path),"path":path,"modifiedAt":chrono::DateTime::from_timestamp_millis(modified as i64).map(|date|date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))})).collect::<Vec<_>>() }),
    ))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/share/{token}/kb/search", get(search))
        .route("/api/share/{token}/kb/recent", get(recent))
}
