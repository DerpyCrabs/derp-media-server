use crate::{
    app::{Shared, emit_admin, timestamp_ms, workspaces_path},
    error::{AppError, AppResult},
    store, workspace_persistence,
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde_json::{Value, json};

const LEASE_MS: u128 = 15_000;

fn empty_registry() -> Value {
    json!({"version":1,"order":[],"records":{}})
}

fn read(state: &Shared) -> Value {
    workspace_persistence::registry(store::section(
        &workspaces_path(state),
        &state.config.library_key,
        empty_registry(),
    ))
}

fn public_registry(value: &Value, now: u128, client_id: Option<&str>) -> Value {
    let mut value = value.clone();
    if let Some(records) = value.get_mut("records").and_then(Value::as_object_mut) {
        for record in records.values_mut() {
            let active = record
                .get("leaseExpiresAt")
                .and_then(Value::as_u64)
                .is_some_and(|expires| expires as u128 > now);
            let owned = client_id.is_some()
                && record.get("leaseClientId").and_then(Value::as_str) == client_id;
            record["locked"] = Value::Bool(active && !owned);
            record.as_object_mut().map(|object| {
                object.remove("leaseClientId");
                object.remove("leaseExpiresAt");
            });
        }
    }
    value
}

async fn list(
    State(state): State<Shared>,
    Query(query): Query<std::collections::HashMap<String, String>>,
) -> Json<Value> {
    Json(public_registry(
        &read(&state),
        timestamp_ms(),
        query.get("clientId").map(String::as_str),
    ))
}

async fn import_workspaces(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let incoming = body
        .get("workspaces")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::bad("Workspaces are required"))?;
    let now = timestamp_ms();
    let imported = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            let mut imported = 0;
            for item in incoming {
                let Some(id) = item
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty() && id.len() <= 128)
                else {
                    continue;
                };
                let Some(snapshot) = item
                    .get("snapshot")
                    .and_then(workspace_persistence::persistent_snapshot)
                else {
                    continue;
                };
                if registry["records"].get(id).is_some() {
                    continue;
                }
                registry["records"][id] = json!({
                    "id":id,
                    "snapshot":snapshot,
                    "revision":0,
                    "updatedAt":now,
                    "lastOpenedAt":0,
                });
                registry["order"]
                    .as_array_mut()
                    .expect("sanitized order")
                    .push(Value::String(id.into()));
                imported += 1;
            }
            Ok(imported)
        },
    )?;
    if imported > 0 {
        emit_admin(&state, "workspaces-changed");
    }
    Ok(Json(json!({"success":true,"imported":imported})))
}

async fn open(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let id = workspace_persistence::required_id(&body, "id")?.to_string();
    let client_id = workspace_persistence::required_id(&body, "clientId")?.to_string();
    let takeover = body
        .get("takeover")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let initial_snapshot = body.get("snapshot").cloned();
    let now = timestamp_ms();
    let result = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            let exists = registry["records"]
                .as_object()
                .expect("sanitized records")
                .contains_key(&id);
            if !exists {
                let snapshot = initial_snapshot
                    .as_ref()
                    .and_then(workspace_persistence::persistent_snapshot)
                    .ok_or_else(|| AppError::bad("Workspace snapshot is required"))?;
                registry["records"]
                    .as_object_mut()
                    .expect("sanitized records")
                    .insert(
                        id.clone(),
                        json!({
                            "id":id,
                            "snapshot":snapshot,
                            "revision":0,
                            "updatedAt":now,
                            "lastOpenedAt":now,
                        }),
                    );
                registry["order"]
                    .as_array_mut()
                    .expect("sanitized order")
                    .push(Value::String(id.clone()));
            }
            let records = registry["records"]
                .as_object_mut()
                .expect("sanitized records");
            let record = records.get_mut(&id).expect("workspace exists");
            let leased_by_other = record
                .get("leaseExpiresAt")
                .and_then(Value::as_u64)
                .is_some_and(|expires| expires as u128 > now)
                && record.get("leaseClientId").and_then(Value::as_str) != Some(&client_id);
            let editable = !leased_by_other || takeover;
            if editable {
                record["leaseClientId"] = Value::String(client_id.clone());
                record["leaseExpiresAt"] = Value::from((now + LEASE_MS) as u64);
                record["lastOpenedAt"] = Value::from(now as u64);
            }
            Ok(json!({"record":record,"editable":editable,"leaseDurationMs":LEASE_MS}))
        },
    )?;
    emit_admin(&state, "workspaces-changed");
    Ok(Json(result))
}

async fn heartbeat(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let id = workspace_persistence::required_id(&body, "id")?.to_string();
    let client_id = workspace_persistence::required_id(&body, "clientId")?.to_string();
    let now = timestamp_ms();
    let result = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            let record = registry["records"]
                .get_mut(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            if record.get("leaseClientId").and_then(Value::as_str) != Some(&client_id) {
                return Err(AppError::conflict("Workspace is open elsewhere"));
            }
            record["leaseExpiresAt"] = Value::from((now + LEASE_MS) as u64);
            Ok(json!({"success":true,"leaseDurationMs":LEASE_MS}))
        },
    )?;
    Ok(Json(result))
}

async fn save(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let id = workspace_persistence::required_id(&body, "id")?.to_string();
    let client_id = workspace_persistence::required_id(&body, "clientId")?.to_string();
    let revision = body
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::bad("Workspace revision is required"))?;
    let snapshot = body
        .get("snapshot")
        .and_then(workspace_persistence::persistent_snapshot)
        .ok_or_else(|| AppError::bad("Invalid workspace snapshot"))?;
    let now = timestamp_ms();
    let result = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            let record = registry["records"]
                .get_mut(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            workspace_persistence::require_lease(record, &client_id, now)?;
            if record.get("revision").and_then(Value::as_u64) != Some(revision) {
                return Err(AppError::conflict("Workspace changed on server"));
            }
            let next = revision + 1;
            record["snapshot"] = snapshot;
            record["revision"] = Value::from(next);
            record["updatedAt"] = Value::from(now as u64);
            record["leaseExpiresAt"] = Value::from((now + LEASE_MS) as u64);
            Ok(json!({"success":true,"revision":next,"updatedAt":now}))
        },
    )?;
    emit_admin(&state, "workspaces-changed");
    Ok(Json(result))
}

async fn metadata(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let id = workspace_persistence::required_id(&body, "id")?.to_string();
    let client_id = workspace_persistence::required_id(&body, "clientId")?.to_string();
    let now = timestamp_ms();
    let result = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            let record = registry["records"]
                .get_mut(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            workspace_persistence::require_lease_or_available(record, &client_id, now)?;
            workspace_persistence::apply_metadata(record, &body)?;
            record["updatedAt"] = Value::from(now as u64);
            Ok(json!({"success":true,"record":record}))
        },
    )?;
    emit_admin(&state, "workspaces-changed");
    Ok(Json(result))
}

async fn reorder(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let order = body
        .get("order")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::bad("Workspace order is required"))?
        .clone();
    let result = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            let current = registry["order"].as_array().expect("sanitized order");
            let mut requested = order.iter().filter_map(Value::as_str).collect::<Vec<_>>();
            let mut expected = current.iter().filter_map(Value::as_str).collect::<Vec<_>>();
            requested.sort_unstable();
            expected.sort_unstable();
            if requested != expected {
                return Err(AppError::conflict("Workspace list changed"));
            }
            registry["order"] = Value::Array(order.clone());
            Ok(json!({"success":true,"order":order}))
        },
    )?;
    emit_admin(&state, "workspaces-changed");
    Ok(Json(result))
}

async fn delete(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let id = workspace_persistence::required_id(&body, "id")?.to_string();
    let client_id = workspace_persistence::required_id(&body, "clientId")?.to_string();
    let now = timestamp_ms();
    let result = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            let record = registry["records"]
                .get(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            workspace_persistence::require_lease_or_available(record, &client_id, now)?;
            registry["records"]
                .as_object_mut()
                .expect("sanitized records")
                .remove(&id);
            registry["order"]
                .as_array_mut()
                .expect("sanitized order")
                .retain(|value| value.as_str() != Some(&id));
            Ok(json!({"success":true}))
        },
    )?;
    emit_admin(&state, "workspaces-changed");
    Ok(Json(result))
}

async fn move_windows(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let source_id = workspace_persistence::required_id(&body, "sourceId")?.to_string();
    let destination_id = workspace_persistence::required_id(&body, "destinationId")?.to_string();
    let client_id = workspace_persistence::required_id(&body, "clientId")?.to_string();
    if source_id == destination_id {
        return Err(AppError::bad("Source and destination must differ"));
    }
    let source_revision = body
        .get("sourceRevision")
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::bad("Source revision is required"))?;
    let destination_revision = body
        .get("destinationRevision")
        .and_then(Value::as_u64)
        .ok_or_else(|| AppError::bad("Destination revision is required"))?;
    let source_snapshot = body
        .get("sourceSnapshot")
        .and_then(workspace_persistence::persistent_snapshot)
        .ok_or_else(|| AppError::bad("Invalid source workspace snapshot"))?;
    let destination_snapshot = body
        .get("destinationSnapshot")
        .and_then(workspace_persistence::persistent_snapshot)
        .ok_or_else(|| AppError::bad("Invalid destination workspace snapshot"))?;
    let delete_source = body
        .get("deleteSource")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let now = timestamp_ms();
    let result = store::mutate_section(
        &workspaces_path(&state),
        &state.config.library_key,
        empty_registry(),
        |registry| {
            *registry = workspace_persistence::registry(registry.take());
            {
                let records = registry["records"].as_object().expect("sanitized records");
                let source = records
                    .get(&source_id)
                    .ok_or_else(|| AppError::not_found("Source workspace not found"))?;
                let destination = records
                    .get(&destination_id)
                    .ok_or_else(|| AppError::not_found("Destination workspace not found"))?;
                workspace_persistence::require_lease(source, &client_id, now)?;
                workspace_persistence::require_lease(destination, &client_id, now)?;
                if source.get("revision").and_then(Value::as_u64) != Some(source_revision) {
                    return Err(AppError::conflict("Source workspace changed on server"));
                }
                if destination.get("revision").and_then(Value::as_u64) != Some(destination_revision)
                {
                    return Err(AppError::conflict(
                        "Destination workspace changed on server",
                    ));
                }
                if delete_source && source.get("name").and_then(Value::as_str).is_some() {
                    return Err(AppError::bad(
                        "Named workspace cannot be deleted automatically",
                    ));
                }
            }
            let next_source_revision = source_revision + 1;
            let next_destination_revision = destination_revision + 1;
            if delete_source {
                registry["records"]
                    .as_object_mut()
                    .expect("sanitized records")
                    .remove(&source_id);
                registry["order"]
                    .as_array_mut()
                    .expect("sanitized order")
                    .retain(|value| value.as_str() != Some(&source_id));
            } else {
                let source = registry["records"]
                    .get_mut(&source_id)
                    .expect("source exists");
                source["snapshot"] = source_snapshot;
                source["revision"] = Value::from(next_source_revision);
                source["updatedAt"] = Value::from(now as u64);
            }
            let destination = registry["records"]
                .get_mut(&destination_id)
                .expect("destination exists");
            destination["snapshot"] = destination_snapshot;
            destination["revision"] = Value::from(next_destination_revision);
            destination["updatedAt"] = Value::from(now as u64);
            destination["lastOpenedAt"] = Value::from(now as u64);
            Ok(json!({
                "success":true,
                "sourceRevision":next_source_revision,
                "destinationRevision":next_destination_revision,
            }))
        },
    )?;
    emit_admin(&state, "workspaces-changed");
    Ok(Json(result))
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/workspaces", get(list))
        .route("/api/workspaces/open", post(open))
        .route("/api/workspaces/import", post(import_workspaces))
        .route("/api/workspaces/heartbeat", post(heartbeat))
        .route("/api/workspaces/save", post(save))
        .route("/api/workspaces/metadata", post(metadata))
        .route("/api/workspaces/reorder", post(reorder))
        .route("/api/workspaces/delete", post(delete))
        .route("/api/workspaces/move", post(move_windows))
}
