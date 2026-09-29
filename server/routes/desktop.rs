use crate::{
    app::Shared,
    config::Config,
    error::{AppError, AppResult},
    media,
};
use axum::{Json, Router, extract::State, routing::post};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{fs, path::Path};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResolveRequest {
    path: String,
    #[serde(default)]
    absolute: bool,
}

fn resolve_path(config: &Config, request: ResolveRequest) -> AppResult<Value> {
    let logical = if request.absolute {
        let input = Path::new(&request.path);
        if !input.is_absolute() {
            return Err(AppError::bad("Expected an absolute filesystem path"));
        }
        let canonical = fs::canonicalize(input).map_err(AppError::io)?;
        let mut matched = None;
        for root in &config.roots {
            let Ok(root_path) = fs::canonicalize(&root.path) else {
                continue;
            };
            if let Ok(relative) = canonical.strip_prefix(root_path) {
                let relative = relative.to_string_lossy().into_owned();
                matched = Some(if config.roots.len() > 1 {
                    if relative.is_empty() {
                        root.name.clone()
                    } else {
                        format!("{}/{relative}", root.name)
                    }
                } else {
                    relative
                });
                break;
            }
        }
        matched.ok_or_else(|| AppError::forbidden("Outside configured media directories"))?
    } else {
        request.path
    };
    let resolved = media::resolve(config, &logical)?;
    let metadata = fs::metadata(&resolved.full).map_err(AppError::io)?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(AppError::bad(
            "Only regular files and directories can be opened",
        ));
    }
    Ok(json!({
        "path": logical,
        "absolutePath": resolved.full,
        "isDirectory": metadata.is_dir(),
        "editable": media::editable(config, &logical),
        "mediaType": if metadata.is_dir() { "folder" } else { media::media_type(&media::extension(&resolved.full)) },
    }))
}

async fn resolve(
    State(state): State<Shared>,
    Json(request): Json<ResolveRequest>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || resolve_path(&state.config, request))
        .await
        .map_err(|error| AppError::internal(error.to_string()))?
        .map(Json)
}

pub fn router() -> Router<Shared> {
    Router::new().route("/api/desktop/resolve", post(resolve))
}
