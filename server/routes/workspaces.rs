use crate::{
    app::{Shared, timestamp_ms},
    error::{AppError, AppResult},
    workspace_persistence::{WorkspaceCommand, WorkspaceRepository},
};
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Deserializer, de::DeserializeOwned};
use serde_json::{Value, json};
use tokio::sync::broadcast;

#[derive(Clone)]
pub(crate) struct WorkspaceRouteState {
    repository: WorkspaceRepository,
    admin_events: broadcast::Sender<Value>,
}

impl FromRef<Shared> for WorkspaceRouteState {
    fn from_ref(state: &Shared) -> Self {
        Self {
            repository: state.workspaces.clone(),
            admin_events: state.admin_events.clone(),
        }
    }
}

impl WorkspaceRouteState {
    fn notify_changed(&self) {
        let _ = self
            .admin_events
            .send(json!({"type":"workspaces-changed","timestamp":timestamp_ms()}));
    }
}

#[derive(Default)]
struct RequestString(Option<String>);

impl<'de> Deserialize<'de> for RequestString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(Self(value.as_str().map(str::to_owned)))
    }
}

#[derive(Default)]
struct RequestU64(Option<u64>);

impl<'de> Deserialize<'de> for RequestU64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(Self(value.as_u64()))
    }
}

#[derive(Default)]
struct RequestBool(bool);

impl<'de> Deserialize<'de> for RequestBool {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Ok(Self(value.as_bool().unwrap_or(false)))
    }
}

#[derive(Default)]
enum JsonField {
    #[default]
    Missing,
    Present(Value),
}

impl<'de> Deserialize<'de> for JsonField {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Value::deserialize(deserializer).map(Self::Present)
    }
}

impl JsonField {
    fn optional(self) -> Option<Value> {
        match self {
            Self::Missing => None,
            Self::Present(value) => Some(value),
        }
    }

    fn or_null(self) -> Value {
        self.optional().unwrap_or(Value::Null)
    }
}

fn required_id(value: RequestString, key: &str) -> AppResult<String> {
    let Some(value) = value.0 else {
        return Err(AppError::bad(format!("{key} is required")));
    };
    if value.is_empty() || value.len() > 128 {
        return Err(AppError::bad(format!("{key} is required")));
    }
    Ok(value)
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LeaseRequest {
    #[serde(default)]
    id: RequestString,
    #[serde(default)]
    client_id: RequestString,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenRequest {
    #[serde(default)]
    id: RequestString,
    #[serde(default)]
    client_id: RequestString,
    #[serde(default)]
    takeover: RequestBool,
    #[serde(default)]
    snapshot: JsonField,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    #[serde(default)]
    id: RequestString,
    #[serde(default)]
    client_id: RequestString,
    #[serde(default)]
    revision: RequestU64,
    #[serde(default)]
    snapshot: JsonField,
    #[serde(default)]
    metadata: JsonField,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertRequest {
    #[serde(default)]
    id: RequestString,
    #[serde(default)]
    client_id: RequestString,
    #[serde(default)]
    revision: RequestU64,
    #[serde(default)]
    snapshot: JsonField,
}

#[derive(Default, Deserialize)]
struct ReorderRequest {
    #[serde(default)]
    order: JsonField,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveWindowsRequest {
    #[serde(default)]
    source_id: RequestString,
    #[serde(default)]
    destination_id: RequestString,
    #[serde(default)]
    client_id: RequestString,
    #[serde(default)]
    source_revision: RequestU64,
    #[serde(default)]
    destination_revision: RequestU64,
    #[serde(default)]
    source_snapshot: JsonField,
    #[serde(default)]
    destination_snapshot: JsonField,
    #[serde(default)]
    delete_source: RequestBool,
}

fn execute(state: &WorkspaceRouteState, command: WorkspaceCommand) -> AppResult<Json<Value>> {
    let mutation = state.repository.execute(command)?;
    if mutation.notify {
        state.notify_changed();
    }
    Ok(Json(mutation.response))
}

fn required_revision(value: RequestU64, message: &str) -> AppResult<u64> {
    value.0.ok_or_else(|| AppError::bad(message))
}

fn request_body<T: DeserializeOwned + Default>(value: Value) -> T {
    serde_json::from_value(value).unwrap_or_default()
}

async fn list(
    State(state): State<WorkspaceRouteState>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    Ok(Json(state.repository.public_registry(
        timestamp_ms(),
        query.get("clientId").map(String::as_str),
    )?))
}

async fn open(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: OpenRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::Open {
            id: required_id(body.id, "id")?,
            client_id: required_id(body.client_id, "clientId")?,
            takeover: body.takeover.0,
            initial_snapshot: body.snapshot.optional(),
            now: timestamp_ms(),
        },
    )
}

async fn heartbeat(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: LeaseRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::Heartbeat {
            id: required_id(body.id, "id")?,
            client_id: required_id(body.client_id, "clientId")?,
            now: timestamp_ms(),
        },
    )
}

async fn release(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: LeaseRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::Release {
            id: required_id(body.id, "id")?,
            client_id: required_id(body.client_id, "clientId")?,
        },
    )
}

async fn save(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: SaveRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::Save {
            id: required_id(body.id, "id")?,
            client_id: required_id(body.client_id, "clientId")?,
            revision: required_revision(body.revision, "Workspace revision is required")?,
            snapshot: body.snapshot.or_null(),
            metadata: body.metadata.optional(),
            now: timestamp_ms(),
        },
    )
}

async fn reorder(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: ReorderRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::Reorder {
            order: body.order.or_null(),
        },
    )
}

async fn convert(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: ConvertRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::Convert {
            id: required_id(body.id, "id")?,
            client_id: required_id(body.client_id, "clientId")?,
            revision: required_revision(body.revision, "Workspace revision is required")?,
            snapshot: body.snapshot.or_null(),
            now: timestamp_ms(),
        },
    )
}

async fn delete(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: LeaseRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::Delete {
            id: required_id(body.id, "id")?,
            client_id: required_id(body.client_id, "clientId")?,
            now: timestamp_ms(),
        },
    )
}

async fn move_windows(
    State(state): State<WorkspaceRouteState>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let body: MoveWindowsRequest = request_body(body);
    execute(
        &state,
        WorkspaceCommand::MoveWindows {
            source_id: required_id(body.source_id, "sourceId")?,
            destination_id: required_id(body.destination_id, "destinationId")?,
            client_id: required_id(body.client_id, "clientId")?,
            source_revision: required_revision(
                body.source_revision,
                "Source revision is required",
            )?,
            destination_revision: required_revision(
                body.destination_revision,
                "Destination revision is required",
            )?,
            source_snapshot: body.source_snapshot.or_null(),
            destination_snapshot: body.destination_snapshot.or_null(),
            delete_source: body.delete_source.0,
            now: timestamp_ms(),
        },
    )
}

pub fn router<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    WorkspaceRouteState: FromRef<S>,
{
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
        config::{Config, FileSearchConfig, ImageOptimizationConfig},
        state_db,
    };
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use std::path::PathBuf;
    use tokio::sync::broadcast;
    use tower::ServiceExt;

    fn test_state() -> (WorkspaceRouteState, PathBuf) {
        let data_path =
            std::env::temp_dir().join(format!("derp-workspace-route-{}", uuid::Uuid::new_v4()));
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
        let (admin_events, _) = broadcast::channel(4);
        let state = WorkspaceRouteState {
            repository: WorkspaceRepository::from_config(&config),
            admin_events,
        };
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

    async fn request(
        state: WorkspaceRouteState,
        method: Method,
        uri: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = router().with_state(state).oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        (status, value)
    }

    #[tokio::test]
    async fn malformed_workspace_fields_keep_application_validation_errors() {
        let (state, data_path) = test_state();
        for body in [json!({}), json!([]), json!({"id":42,"clientId":"owner"})] {
            let (status, _) =
                request(state.clone(), Method::POST, "/api/workspaces/open", body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
        }

        let (status, _) = request(
            state,
            Method::POST,
            "/api/workspaces/save",
            json!({"id":"workspace","clientId":"owner","revision":"invalid"}),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(data_path);
    }

    #[test]
    fn optional_json_fields_preserve_explicit_null() {
        let missing: OpenRequest =
            serde_json::from_value(json!({"id":"workspace","clientId":"owner"})).unwrap();
        let explicit_null: OpenRequest =
            serde_json::from_value(json!({"id":"workspace","clientId":"owner","snapshot":null}))
                .unwrap();

        assert!(matches!(missing.snapshot, JsonField::Missing));
        assert!(matches!(
            explicit_null.snapshot,
            JsonField::Present(Value::Null)
        ));
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
        assert_eq!(
            listed["records"][&id]["snapshot"]["workspaceType"],
            "canvas"
        );
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
