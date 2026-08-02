use crate::{
    app::{AppState, Shared, all_roots, emit_admin, roots, timestamp_ms},
    config::{Config, MediaRoot},
    error::{AppError, AppResult},
    shares, store,
};
use axum::{
    Json, Router,
    extract::{Path as AxPath, State},
    http::StatusCode,
    routing::{get, patch},
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub(crate) fn load(config: &Config) -> Vec<MediaRoot> {
    let value = store::read(&config.data_path.join("mounts.json"));
    value["mounts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|mount| {
            Some(MediaRoot {
                id: mount["id"].as_str()?.into(),
                name: mount["name"].as_str()?.into(),
                path: PathBuf::from(mount["path"].as_str()?),
                editable_folders: vec![],
                read_only: true,
                source: "mount".into(),
                created_at: mount["createdAt"].as_u64().map(u128::from),
            })
        })
        .collect()
}

fn persist(state: &AppState, mounts: &[MediaRoot]) -> AppResult<()> {
    store::write(
        &state.config.data_path.join("mounts.json"),
        &json!({"version":1,"mounts":mounts.iter().map(|root| json!({"id":root.id,"name":root.name,"path":root.path,"createdAt":root.created_at.unwrap_or_else(timestamp_ms)})).collect::<Vec<_>>() }),
    )
}

fn validate(
    configured: &[MediaRoot],
    runtime: &[MediaRoot],
    name: &str,
    raw_path: &str,
    except_id: Option<&str>,
) -> AppResult<(String, PathBuf)> {
    if raw_path.trim().is_empty() {
        return Err(AppError::bad("name and path are required"));
    }
    let supplied = Path::new(raw_path.trim());
    let derived = std::path::absolute(supplied)
        .ok()
        .and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_default();
    let name = if name.trim().is_empty() {
        derived.trim()
    } else {
        name.trim()
    };
    if name.is_empty() {
        return Err(AppError::bad(format!(
            "mediaDirs entry for \"{}\" requires a name",
            raw_path.trim()
        )));
    }
    if name.contains(['/', '\\']) {
        return Err(AppError::bad(format!(
            "Media root name \"{name}\" must not contain path separators"
        )));
    }
    if ["favorites", "most played", "shares"]
        .iter()
        .any(|reserved| name.eq_ignore_ascii_case(reserved))
    {
        return Err(AppError::bad(format!(
            "Media root name \"{name}\" conflicts with a virtual folder"
        )));
    }
    if !supplied.is_absolute() {
        return Err(AppError::bad("Mount path must be absolute"));
    }
    let path = std::fs::canonicalize(supplied).map_err(|error| AppError::bad(error.to_string()))?;
    if !path.is_dir() {
        return Err(AppError::bad("Mount path must be a directory"));
    }
    for root in configured.iter().chain(runtime) {
        if except_id == Some(root.id.as_str()) {
            continue;
        }
        if root.name.eq_ignore_ascii_case(name) {
            return Err(AppError::bad(format!(
                "Media root name \"{name}\" already exists"
            )));
        }
        let existing = std::fs::canonicalize(&root.path).unwrap_or_else(|_| root.path.clone());
        let same = if cfg!(windows) {
            path.to_string_lossy().to_ascii_lowercase()
                == existing.to_string_lossy().to_ascii_lowercase()
        } else {
            path == existing
        };
        if same {
            return Err(AppError::bad(
                "This directory is already configured as a media root",
            ));
        }
        let overlaps = if cfg!(windows) {
            let candidate = path.to_string_lossy().to_ascii_lowercase();
            let configured = existing.to_string_lossy().to_ascii_lowercase();
            candidate.starts_with(&(configured.clone() + "\\"))
                || configured.starts_with(&(candidate + "\\"))
        } else {
            path.starts_with(&existing) || existing.starts_with(&path)
        };
        if overlaps {
            return Err(AppError::bad("Media roots must not overlap"));
        }
    }
    Ok((name.into(), path))
}

async fn list(State(state): State<Shared>) -> Json<Value> {
    let runtime = roots(&state);
    let existing_shares = shares::read(&state.config, &runtime);
    Json(
        json!({"mounts":runtime.iter().map(|root| json!({"id":root.id,"name":root.name,"path":root.path,"createdAt":root.created_at.unwrap_or(0),"readOnly":true,"status":if root.path.is_dir(){"online"}else{"offline"},"shareCount":existing_shares.iter().filter(|share|share.root_id.as_deref()==Some(&root.id)).count()})).collect::<Vec<_>>() }),
    )
}

async fn add(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<(StatusCode, Json<Value>)> {
    let mut runtime = state.runtime_roots.write().await;
    let (name, path) = validate(
        &state.config.roots,
        &runtime,
        body["name"].as_str().unwrap_or(""),
        body["path"].as_str().unwrap_or(""),
        None,
    )?;
    let root = MediaRoot {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        path,
        editable_folders: vec![],
        read_only: true,
        source: "mount".into(),
        created_at: Some(timestamp_ms()),
    };
    let mut next = runtime.clone();
    next.push(root.clone());
    persist(&state, &next).map_err(|error| AppError::bad(error.1))?;
    *runtime = next;
    drop(runtime);
    state.file_search.sync_roots(all_roots(&state));
    emit_admin(&state, "mounts-changed");
    Ok((
        StatusCode::CREATED,
        Json(
            json!({"mount":{"id":root.id,"name":root.name,"path":root.path,"createdAt":root.created_at,"readOnly":true}}),
        ),
    ))
}

async fn update(
    State(state): State<Shared>,
    AxPath(id): AxPath<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let mut runtime = state.runtime_roots.write().await;
    let index = runtime
        .iter()
        .position(|root| root.id == id)
        .ok_or_else(|| AppError::not_found("Mount not found"))?;
    let (name, path) = validate(
        &state.config.roots,
        &runtime,
        body["name"].as_str().unwrap_or(""),
        body["path"].as_str().unwrap_or(""),
        Some(&id),
    )?;
    let mut next = runtime.clone();
    next[index].name = name;
    next[index].path = path;
    let root = next[index].clone();
    persist(&state, &next).map_err(|error| AppError::bad(error.1))?;
    *runtime = next;
    drop(runtime);
    state.file_search.sync_roots(all_roots(&state));
    emit_admin(&state, "mounts-changed");
    Ok(Json(
        json!({"mount":{"id":root.id,"name":root.name,"path":root.path,"createdAt":root.created_at,"readOnly":true}}),
    ))
}

async fn remove(State(state): State<Shared>, AxPath(id): AxPath<String>) -> AppResult<Json<Value>> {
    let mut runtime = state.runtime_roots.write().await;
    let mut next = runtime.clone();
    let before = next.len();
    next.retain(|root| root.id != id);
    if next.len() == before {
        return Err(AppError::not_found("Mount not found"));
    }
    persist(&state, &next)?;
    *runtime = next;
    drop(runtime);
    state.file_search.sync_roots(all_roots(&state));
    emit_admin(&state, "mounts-changed");
    Ok(Json(json!({"success":true})))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/admin/mounts", get(list).post(add))
        .route("/api/admin/mounts/{id}", patch(update).delete(remove))
}
