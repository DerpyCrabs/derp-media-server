use crate::{
    app::{Shared, emit_admin, timestamp_ms},
    error::{AppError, AppResult},
    workspace_persistence::WorkspaceCommand,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde_json::Value;

fn required_id(body: &Value, key: &str) -> AppResult<String> {
    body.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .map(str::to_owned)
        .ok_or_else(|| AppError::bad(format!("{key} is required")))
}

fn required_revision(body: &Value, key: &str, message: &str) -> AppResult<u64> {
    body.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::bad(message))
}

fn execute(state: &Shared, command: WorkspaceCommand) -> AppResult<Json<Value>> {
    let mutation = state.workspaces.execute(command)?;
    if mutation.notify {
        emit_admin(state, "workspaces-changed");
    }
    Ok(Json(mutation.response))
}

async fn list(
    State(state): State<Shared>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    Ok(Json(state.workspaces.public_registry(
        timestamp_ms(),
        query.get("clientId").map(String::as_str),
    )?))
}

async fn open(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::Open {
            id: required_id(&body, "id")?,
            client_id: required_id(&body, "clientId")?,
            takeover: body
                .get("takeover")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            initial_snapshot: body.get("snapshot").cloned(),
            now: timestamp_ms(),
        },
    )
}

async fn heartbeat(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::Heartbeat {
            id: required_id(&body, "id")?,
            client_id: required_id(&body, "clientId")?,
            now: timestamp_ms(),
        },
    )
}

async fn release(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::Release {
            id: required_id(&body, "id")?,
            client_id: required_id(&body, "clientId")?,
        },
    )
}

async fn save(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::Save {
            id: required_id(&body, "id")?,
            client_id: required_id(&body, "clientId")?,
            revision: required_revision(&body, "revision", "Workspace revision is required")?,
            snapshot: body.get("snapshot").cloned().unwrap_or(Value::Null),
            metadata: body.get("metadata").cloned(),
            now: timestamp_ms(),
        },
    )
}

async fn reorder(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::Reorder {
            order: body.get("order").cloned().unwrap_or(Value::Null),
        },
    )
}

async fn convert(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::Convert {
            id: required_id(&body, "id")?,
            client_id: required_id(&body, "clientId")?,
            revision: required_revision(&body, "revision", "Workspace revision is required")?,
            snapshot: body.get("snapshot").cloned().unwrap_or(Value::Null),
            now: timestamp_ms(),
        },
    )
}

async fn delete(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::Delete {
            id: required_id(&body, "id")?,
            client_id: required_id(&body, "clientId")?,
            now: timestamp_ms(),
        },
    )
}

async fn move_windows(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    execute(
        &state,
        WorkspaceCommand::MoveWindows {
            source_id: required_id(&body, "sourceId")?,
            destination_id: required_id(&body, "destinationId")?,
            client_id: required_id(&body, "clientId")?,
            source_revision: required_revision(
                &body,
                "sourceRevision",
                "Source revision is required",
            )?,
            destination_revision: required_revision(
                &body,
                "destinationRevision",
                "Destination revision is required",
            )?,
            source_snapshot: body.get("sourceSnapshot").cloned().unwrap_or(Value::Null),
            destination_snapshot: body
                .get("destinationSnapshot")
                .cloned()
                .unwrap_or(Value::Null),
            delete_source: body
                .get("deleteSource")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            now: timestamp_ms(),
        },
    )
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/workspaces", get(list))
        .route("/api/workspaces/open", post(open))
        .route("/api/workspaces/heartbeat", post(heartbeat))
        .route("/api/workspaces/release", post(release))
        .route("/api/workspaces/save", post(save))
        .route("/api/workspaces/convert", post(convert))
        .route("/api/workspaces/reorder", post(reorder))
        .route("/api/workspaces/delete", post(delete))
        .route("/api/workspaces/move", post(move_windows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        app::AppState,
        config::{Config, FileSearchConfig, ImageOptimizationConfig},
        image_variants, state_db, thumbnails,
    };
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use std::{
        collections::{HashMap, HashSet},
        path::PathBuf,
        sync::Arc,
    };
    use tokio::sync::{Mutex, broadcast};
    use tower::ServiceExt;

    fn test_state() -> (Shared, PathBuf) {
        let data_path = std::env::temp_dir().join(format!(
            "derp-workspace-route-{}",
            uuid::Uuid::new_v4()
        ));
        let config = Config {
            port: 0,
            roots: Vec::new(),
            library_key: "library".into(),
            data_path: data_path.clone(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data_path.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            hermes: None,
        };
        state_db::initialize(&config).unwrap();
        let (events, _) = broadcast::channel(4);
        let (admin_events, _) = broadcast::channel(4);
        let (hermes_events, _) = broadcast::channel(4);
        let state = Arc::new(AppState {
            config: config.clone(),
            dev: false,
            vite_port: 0,
            client: reqwest::Client::new(),
            events,
            admin_events,
            hermes_events,
            database: state_db::AppDatabase::from_config(&config),
            settings: crate::settings_persistence::SettingsRepository::from_config(&config),
            stats: crate::stats_persistence::StatsRepository::from_config(&config),
            workspaces: crate::workspace_persistence::WorkspaceRepository::from_config(&config),
            reader_state_db: Mutex::new(()),
            thumbnails: thumbnails::Thumbnailer::new(data_path.join("thumbnails")),
            image_variants: image_variants::ImageVariants::new(
                data_path.join("image-variants"),
                config.image_optimization.clone(),
            ),
            file_search: crate::file_search::FileSearch::new(
                config.file_search.clone(),
                config.roots.clone(),
            ),
            hermes: None,
            hermes_project_operations: Mutex::new(()),
            file_mutations: Mutex::new(()),
            hermes_runtime_ids: Mutex::new(HashMap::new()),
            hermes_active_ids: Mutex::new(HashSet::new()),
        });
        (state, data_path)
    }

    fn snapshot(with_window: bool) -> Value {
        let windows = if with_window {
            json!([{
                "id":"browser-1",
                "type":"browser",
                "source":{"kind":"local"},
                "initialState":{"dir":"Documents"}
            }])
        } else {
            json!([])
        };
        json!({
            "workspaceType":"desktop",
            "windows":windows,
            "activeWindowId":if with_window {json!("browser-1")} else {Value::Null},
            "activeTabMap":{},
            "nextWindowId":if with_window {2} else {1}
        })
    }

    async fn request(state: Shared, method: Method, uri: &str, body: Value) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = router()
            .with_state(state)
            .oneshot(request)
            .await
            .unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        (status, value)
    }

    #[tokio::test]
    async fn public_workspace_routes_preserve_single_writer_and_revision_cas() {
        let (state, data_path) = test_state();
        let id = format!("route-{}", uuid::Uuid::new_v4());

        let (status, opened) = request(
            state.clone(),
            Method::POST,
            "/api/workspaces/open",
            json!({"id":id,"clientId":"owner","snapshot":snapshot(false)}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(opened["editable"], true);
        assert_eq!(opened["leaseDurationMs"], 15_000);
        let revision = opened["record"]["revision"].as_u64().unwrap();

        let (status, duplicate) = request(
            state.clone(),
            Method::POST,
            "/api/workspaces/open",
            json!({"id":id,"clientId":"observer"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(duplicate["editable"], false);

        let (status, listed) = request(
            state.clone(),
            Method::GET,
            "/api/workspaces?clientId=owner",
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed["records"][&id]["locked"], false);
        let (status, observer_list) = request(
            state.clone(),
            Method::GET,
            "/api/workspaces?clientId=observer",
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(observer_list["records"][&id]["locked"], true);

        let (status, saved) = request(
            state.clone(),
            Method::POST,
            "/api/workspaces/save",
            json!({
                "id":id,
                "clientId":"owner",
                "revision":revision,
                "snapshot":snapshot(true),
                "metadata":{"name":"Named workspace","icon":null,"iconColor":null}
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(saved["revision"], 1);

        let (status, listed) = request(
            state.clone(),
            Method::GET,
            "/api/workspaces?clientId=owner",
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed["records"][&id]["name"], "Named workspace");
        assert_eq!(listed["records"][&id]["revision"], 1);

        let mut canvas = snapshot(true);
        canvas["workspaceType"] = json!("canvas");
        canvas["canvas"] = json!({
            "camera":{"x":0,"y":0,"zoom":1},
            "maximizedWindowId":null,
            "windowSizeByType":{},
            "nextZIndex":2
        });
        let (status, converted) = request(
            state.clone(),
            Method::POST,
            "/api/workspaces/convert",
            json!({
                "id":id,
                "clientId":"owner",
                "revision":1,
                "snapshot":canvas
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(converted["revision"], 2);

        let (status, listed) = request(
            state.clone(),
            Method::GET,
            "/api/workspaces?clientId=owner",
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed["records"][&id]["snapshot"]["workspaceType"], "canvas");
        assert_eq!(listed["records"][&id]["name"], "Named workspace");
        assert_eq!(listed["records"][&id]["revision"], 2);

        let (status, stale) = request(
            state.clone(),
            Method::POST,
            "/api/workspaces/save",
            json!({"id":id,"clientId":"owner","revision":revision,"snapshot":snapshot(false)}),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(stale["error"], "Workspace changed on server");

        let (status, heartbeat) = request(
            state.clone(),
            Method::POST,
            "/api/workspaces/heartbeat",
            json!({"id":id,"clientId":"owner"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(heartbeat["success"], true);
        let (status, released) = request(
            state,
            Method::POST,
            "/api/workspaces/release",
            json!({"id":id,"clientId":"owner"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(released["released"], true);

        drop(data_path);
    }
}
