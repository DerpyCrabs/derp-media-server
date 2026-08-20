use crate::{
    config::Config,
    error::{AppError, AppResult},
    logical_path,
    store::DocumentStore,
};
use rusqlite::Transaction;
use serde_json::{Map, Value, json};

const LEASE_MS: u128 = 15_000;

fn empty_registry() -> Value {
    json!({"version":1,"order":[],"records":{}})
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceRepository {
    store: DocumentStore,
}

#[derive(Clone, Debug)]
pub(crate) enum WorkspaceCommand {
    Open {
        id: String,
        client_id: String,
        takeover: bool,
        initial_snapshot: Option<Value>,
        now: u128,
    },
    Heartbeat {
        id: String,
        client_id: String,
        now: u128,
    },
    Release {
        id: String,
        client_id: String,
    },
    Save {
        id: String,
        client_id: String,
        revision: u64,
        snapshot: Value,
        metadata: Option<Value>,
        now: u128,
    },
    Convert {
        id: String,
        client_id: String,
        revision: u64,
        snapshot: Value,
        now: u128,
    },
    Reorder {
        order: Value,
    },
    Delete {
        id: String,
        client_id: String,
        now: u128,
    },
    MoveWindows {
        source_id: String,
        destination_id: String,
        client_id: String,
        source_revision: u64,
        destination_revision: u64,
        source_snapshot: Value,
        destination_snapshot: Value,
        delete_source: bool,
        now: u128,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct WorkspaceMutation {
    pub(crate) response: Value,
    pub(crate) notify: bool,
}

impl WorkspaceRepository {
    pub fn from_config(config: &Config) -> Self {
        Self {
            store: DocumentStore::from_config(config),
        }
    }

    #[cfg(test)]
    fn from_store(store: DocumentStore) -> Self {
        Self { store }
    }

    pub fn read(&self) -> AppResult<Value> {
        canonical_registry(self.store.read("workspaces", empty_registry())?)
    }

    pub fn public_registry(&self, now: u128, client_id: Option<&str>) -> AppResult<Value> {
        let mut registry = self.read()?;
        for record in registry["records"]
            .as_object_mut()
            .expect("validated workspace records")
            .values_mut()
        {
            let active = record
                .get("leaseExpiresAt")
                .and_then(Value::as_u64)
                .is_some_and(|expires| expires as u128 > now);
            let owned = client_id.is_some()
                && record.get("leaseClientId").and_then(Value::as_str) == client_id;
            record["locked"] = Value::Bool(active && !owned);
            let object = record.as_object_mut().expect("validated workspace record");
            object.remove("leaseClientId");
            object.remove("leaseExpiresAt");
        }
        Ok(registry)
    }

    pub fn execute(&self, command: WorkspaceCommand) -> AppResult<WorkspaceMutation> {
        self.mutate(|registry| apply_workspace_command(registry, command))
    }

    pub fn move_paths_in_transaction(
        &self,
        transaction: &Transaction<'_>,
        old_path: &str,
        new_path: &str,
        changed_at: u128,
    ) -> AppResult<()> {
        self.mutate_in_transaction(transaction, |registry| {
            for record in registry["records"]
                .as_object_mut()
                .expect("validated workspace records")
                .values_mut()
            {
                let mut snapshot = record["snapshot"].clone();
                rewrite_snapshot_paths(&mut snapshot, old_path, new_path);
                replace_snapshot(record, snapshot, changed_at)?;
            }
            Ok(())
        })
    }

    pub fn remove_paths_in_transaction(
        &self,
        transaction: &Transaction<'_>,
        path: &str,
        changed_at: u128,
    ) -> AppResult<()> {
        self.mutate_in_transaction(transaction, |registry| {
            for record in registry["records"]
                .as_object_mut()
                .expect("validated workspace records")
                .values_mut()
            {
                let mut snapshot = record["snapshot"].clone();
                remove_snapshot_paths(&mut snapshot, path);
                replace_snapshot(record, snapshot, changed_at)?;
            }
            Ok(())
        })
    }

    fn mutate<T>(&self, update: impl FnOnce(&mut Value) -> AppResult<T>) -> AppResult<T> {
        self.store
            .update("workspaces", empty_registry(), |value| mutate_registry(value, update))
    }

    fn mutate_in_transaction<T>(
        &self,
        transaction: &Transaction<'_>,
        update: impl FnOnce(&mut Value) -> AppResult<T>,
    ) -> AppResult<T> {
        self.store
            .update_in_transaction(transaction, "workspaces", empty_registry(), |value| {
                mutate_registry(value, update)
            })
    }
}

fn mutate_registry<T>(
    value: &mut Value,
    update: impl FnOnce(&mut Value) -> AppResult<T>,
) -> AppResult<T> {
    *value = canonical_registry(value.take())?;
    let before_records = value["records"].clone();
    let result = update(value)?;
    validate_record_revisions(&before_records, value)?;
    validate_registry(value)?;
    Ok(result)
}

fn apply_workspace_command(
    registry: &mut Value,
    command: WorkspaceCommand,
) -> AppResult<WorkspaceMutation> {
    match command {
        WorkspaceCommand::Open {
            id,
            client_id,
            takeover,
            initial_snapshot,
            now,
        } => {
            validate_id(&id, "id")?;
            validate_id(&client_id, "clientId")?;
            let expires_at = lease_expires_at(now)?;
            let now_value = timestamp_value(now)?;
            let exists = registry["records"]
                .as_object()
                .expect("validated workspace records")
                .contains_key(&id);
            if !exists {
                let snapshot = initial_snapshot
                    .as_ref()
                    .and_then(persistent_snapshot)
                    .ok_or_else(|| AppError::bad("Workspace snapshot is required"))?;
                registry["records"]
                    .as_object_mut()
                    .expect("validated workspace records")
                    .insert(
                        id.clone(),
                        json!({
                            "id":id,
                            "snapshot":snapshot,
                            "revision":0,
                            "updatedAt":now_value,
                            "lastOpenedAt":now_value,
                        }),
                    );
                registry["order"]
                    .as_array_mut()
                    .expect("validated workspace order")
                    .push(Value::String(id.clone()));
            }
            let record = registry["records"]
                .get_mut(&id)
                .expect("workspace record exists");
            let leased_by_other = record
                .get("leaseExpiresAt")
                .and_then(Value::as_u64)
                .is_some_and(|expires| expires as u128 > now)
                && record.get("leaseClientId").and_then(Value::as_str) != Some(&client_id);
            let editable = !leased_by_other || takeover;
            if editable {
                record["leaseClientId"] = Value::String(client_id);
                record["leaseExpiresAt"] = Value::from(expires_at);
                record["lastOpenedAt"] = Value::from(now_value);
            }
            Ok(WorkspaceMutation {
                response: json!({
                    "record":record,
                    "editable":editable,
                    "leaseDurationMs":LEASE_MS,
                }),
                notify: true,
            })
        }
        WorkspaceCommand::Heartbeat { id, client_id, now } => {
            validate_id(&id, "id")?;
            validate_id(&client_id, "clientId")?;
            let record = registry["records"]
                .get_mut(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            if record.get("leaseClientId").and_then(Value::as_str) != Some(&client_id) {
                return Err(AppError::conflict("Workspace is open elsewhere"));
            }
            record["leaseExpiresAt"] = Value::from(lease_expires_at(now)?);
            Ok(WorkspaceMutation {
                response: json!({"success":true,"leaseDurationMs":LEASE_MS}),
                notify: false,
            })
        }
        WorkspaceCommand::Release { id, client_id } => {
            validate_id(&id, "id")?;
            validate_id(&client_id, "clientId")?;
            let record = registry["records"]
                .get_mut(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            let released = record.get("leaseClientId").and_then(Value::as_str) == Some(&client_id);
            if released {
                let object = record.as_object_mut().expect("validated workspace record");
                object.remove("leaseClientId");
                object.remove("leaseExpiresAt");
            }
            Ok(WorkspaceMutation {
                response: json!({"success":true,"released":released}),
                notify: released,
            })
        }
        WorkspaceCommand::Save {
            id,
            client_id,
            revision,
            snapshot,
            metadata,
            now,
        } => {
            validate_id(&id, "id")?;
            validate_id(&client_id, "clientId")?;
            let snapshot = persistent_snapshot(&snapshot)
                .ok_or_else(|| AppError::bad("Invalid workspace snapshot"))?;
            let record = registry["records"]
                .get_mut(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            require_revision(record, revision, "Workspace changed on server")?;
            if record_type(record)? != snapshot_type(&snapshot).expect("validated snapshot") {
                return Err(AppError::conflict("Workspace type cannot change"));
            }
            if record["snapshot"] == snapshot {
                require_lease_or_available(record, &client_id, now)?;
            } else {
                require_lease(record, &client_id, now)?;
            }
            let next = replace_snapshot_and_metadata(record, snapshot, metadata.as_ref(), now)?;
            let updated_at = record["updatedAt"]
                .as_u64()
                .expect("validated workspace timestamp");
            record["leaseExpiresAt"] = Value::from(lease_expires_at(now)?);
            Ok(WorkspaceMutation {
                response: json!({"success":true,"revision":next,"updatedAt":updated_at}),
                notify: true,
            })
        }
        WorkspaceCommand::Convert {
            id,
            client_id,
            revision,
            snapshot,
            now,
        } => {
            validate_id(&id, "id")?;
            validate_id(&client_id, "clientId")?;
            let snapshot = persistent_snapshot(&snapshot)
                .ok_or_else(|| AppError::bad("Invalid workspace snapshot"))?;
            let record = registry["records"]
                .get_mut(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            require_revision(record, revision, "Workspace changed on server")?;
            require_lease(record, &client_id, now)?;
            if record_type(record)? == snapshot_type(&snapshot).expect("validated snapshot") {
                return Err(AppError::bad("Workspace already uses this type"));
            }
            let next = replace_snapshot(record, snapshot, now)?;
            record["leaseExpiresAt"] = Value::from(lease_expires_at(now)?);
            Ok(WorkspaceMutation {
                response: json!({"success":true,"revision":next}),
                notify: true,
            })
        }
        WorkspaceCommand::Reorder { order } => {
            reorder_registry(registry, &order)?;
            Ok(WorkspaceMutation {
                response: json!({"success":true,"order":order}),
                notify: true,
            })
        }
        WorkspaceCommand::Delete { id, client_id, now } => {
            validate_id(&id, "id")?;
            validate_id(&client_id, "clientId")?;
            let record = registry["records"]
                .get(&id)
                .ok_or_else(|| AppError::not_found("Workspace not found"))?;
            require_lease_or_available(record, &client_id, now)?;
            registry["records"]
                .as_object_mut()
                .expect("validated workspace records")
                .remove(&id);
            registry["order"]
                .as_array_mut()
                .expect("validated workspace order")
                .retain(|value| value.as_str() != Some(&id));
            Ok(WorkspaceMutation {
                response: json!({"success":true}),
                notify: true,
            })
        }
        WorkspaceCommand::MoveWindows {
            source_id,
            destination_id,
            client_id,
            source_revision,
            destination_revision,
            source_snapshot,
            destination_snapshot,
            delete_source,
            now,
        } => {
            validate_id(&source_id, "sourceId")?;
            validate_id(&destination_id, "destinationId")?;
            validate_id(&client_id, "clientId")?;
            if source_id == destination_id {
                return Err(AppError::bad("Source and destination must differ"));
            }
            let source_snapshot = persistent_snapshot(&source_snapshot)
                .ok_or_else(|| AppError::bad("Invalid source workspace snapshot"))?;
            let destination_snapshot = persistent_snapshot(&destination_snapshot)
                .ok_or_else(|| AppError::bad("Invalid destination workspace snapshot"))?;
            {
                let records = registry["records"]
                    .as_object()
                    .expect("validated workspace records");
                let source = records
                    .get(&source_id)
                    .ok_or_else(|| AppError::not_found("Source workspace not found"))?;
                let destination = records
                    .get(&destination_id)
                    .ok_or_else(|| AppError::not_found("Destination workspace not found"))?;
                require_lease(source, &client_id, now)?;
                require_lease(destination, &client_id, now)?;
                require_revision(
                    source,
                    source_revision,
                    "Source workspace changed on server",
                )?;
                require_revision(
                    destination,
                    destination_revision,
                    "Destination workspace changed on server",
                )?;
                if record_type(source)?
                    != snapshot_type(&source_snapshot).expect("validated source snapshot")
                    || record_type(destination)?
                        != snapshot_type(&destination_snapshot)
                            .expect("validated destination snapshot")
                {
                    return Err(AppError::conflict("Workspace type cannot change"));
                }
                if delete_source && source.get("name").and_then(Value::as_str).is_some() {
                    return Err(AppError::bad(
                        "Named workspace cannot be deleted automatically",
                    ));
                }
            }
            let next_source_revision = if delete_source {
                registry["records"]
                    .as_object_mut()
                    .expect("validated workspace records")
                    .remove(&source_id);
                registry["order"]
                    .as_array_mut()
                    .expect("validated workspace order")
                    .retain(|value| value.as_str() != Some(&source_id));
                source_revision
            } else {
                let source = registry["records"]
                    .get_mut(&source_id)
                    .expect("source workspace exists");
                let next = replace_snapshot(source, source_snapshot, now)?;
                let object = source.as_object_mut().expect("validated source workspace");
                object.remove("leaseClientId");
                object.remove("leaseExpiresAt");
                next
            };
            let destination = registry["records"]
                .get_mut(&destination_id)
                .expect("destination workspace exists");
            let next_destination_revision =
                replace_snapshot(destination, destination_snapshot, now)?;
            destination["lastOpenedAt"] = Value::from(timestamp_value(now)?);
            Ok(WorkspaceMutation {
                response: json!({
                    "success":true,
                    "sourceRevision":next_source_revision,
                    "destinationRevision":next_destination_revision,
                }),
                notify: true,
            })
        }
    }
}

fn validate_id(value: &str, key: &str) -> AppResult<()> {
    if value.is_empty() || value.len() > 128 {
        return Err(AppError::bad(format!("{key} is required")));
    }
    Ok(())
}

fn timestamp_value(now: u128) -> AppResult<u64> {
    u64::try_from(now).map_err(|_| AppError::internal("Workspace timestamp is out of range"))
}

fn lease_expires_at(now: u128) -> AppResult<u64> {
    now.checked_add(LEASE_MS)
        .and_then(|value| u64::try_from(value).ok())
        .ok_or_else(|| AppError::internal("Workspace lease timestamp is out of range"))
}

fn record_type(record: &Value) -> AppResult<&'static str> {
    record
        .get("snapshot")
        .and_then(snapshot_type)
        .ok_or_else(|| AppError::internal("Invalid workspace type"))
}

fn validate_record_revisions(before_records: &Value, registry: &Value) -> AppResult<()> {
    let before_records = before_records
        .as_object()
        .ok_or_else(|| crate::error::AppError::internal("Invalid workspace registry records"))?;
    let after_records = registry["records"]
        .as_object()
        .ok_or_else(|| crate::error::AppError::internal("Invalid workspace registry records"))?;
    for (id, after) in after_records {
        let after_revision = after["revision"]
            .as_u64()
            .ok_or_else(|| crate::error::AppError::internal("Invalid workspace revision"))?;
        let Some(before) = before_records.get(id) else {
            if after_revision != 0 {
                return Err(crate::error::AppError::internal(
                    "New workspace must start at revision zero",
                ));
            }
            continue;
        };
        let before_revision = before["revision"]
            .as_u64()
            .ok_or_else(|| crate::error::AppError::internal("Invalid workspace revision"))?;
        let content_unchanged = ["snapshot", "name", "icon", "iconColor"]
            .iter()
            .all(|key| after.get(key) == before.get(key));
        if content_unchanged {
            if after_revision != before_revision || after["updatedAt"] != before["updatedAt"] {
                return Err(crate::error::AppError::internal(
                    "Workspace revision changed without a document or metadata change",
                ));
            }
            continue;
        }
        let expected = before_revision
            .checked_add(1)
            .ok_or_else(|| crate::error::AppError::conflict("Workspace revision is exhausted"))?;
        if after_revision != expected {
            return Err(crate::error::AppError::internal(
                "Workspace revision must advance exactly once",
            ));
        }
    }
    Ok(())
}

fn valid_snapshot(snapshot: &Value) -> bool {
    if !snapshot.is_object() {
        return false;
    }
    match snapshot_type(snapshot) {
        Some("desktop") if snapshot.get("canvas").is_none() => {}
        Some("canvas") if snapshot.get("canvas").is_some_and(Value::is_object) => {}
        _ => return false,
    }
    let Some(windows) = snapshot.get("windows").and_then(Value::as_array) else {
        return false;
    };
    let mut ids = std::collections::HashSet::new();
    if windows.iter().any(|window| {
        window
            .get("id")
            .and_then(Value::as_str)
            .is_none_or(|id| id.is_empty() || !ids.insert(id))
            || !window.get("type").is_some_and(Value::is_string)
            || !window.get("source").is_some_and(Value::is_object)
            || !window.get("initialState").is_some_and(Value::is_object)
    }) {
        return false;
    }
    let active = snapshot.get("activeWindowId");
    active.is_some_and(|value| value.is_null() || value.as_str().is_some_and(|id| ids.contains(id)))
        && snapshot.get("activeTabMap").is_some_and(|value| {
            value.as_object().is_some_and(|map| {
                map.values()
                    .all(|value| value.as_str().is_some_and(|id| ids.contains(id)))
            })
        })
        && snapshot
            .get("nextWindowId")
            .and_then(Value::as_u64)
            .is_some_and(|value| value >= 1)
        && snapshot.get("tabGroupSplits").is_none_or(Value::is_object)
}

fn snapshot_type(snapshot: &Value) -> Option<&'static str> {
    match snapshot.get("workspaceType").and_then(Value::as_str) {
        Some("desktop") => Some("desktop"),
        Some("canvas") => Some("canvas"),
        _ => None,
    }
}

fn persistent_snapshot(snapshot: &Value) -> Option<Value> {
    if !valid_snapshot(snapshot) {
        return None;
    }
    Some(snapshot.clone())
}

fn window_target(window: &Value) -> Option<&str> {
    match window["type"].as_str() {
        Some("browser") => Some(window["initialState"]["dir"].as_str().unwrap_or_default()),
        Some("viewer") => window["initialState"]["viewing"]
            .as_str()
            .filter(|path| !path.is_empty())
            .or_else(|| {
                window["initialState"]["playing"]
                    .as_str()
                    .filter(|path| !path.is_empty())
            }),
        Some("hermes") => None,
        _ => window["initialState"]["viewing"]
            .as_str()
            .or_else(|| window["initialState"]["playing"].as_str())
            .or_else(|| window["initialState"]["dir"].as_str())
            .or_else(|| window["iconPath"].as_str()),
    }
}

fn mutable_local_window(window: &Value) -> bool {
    window["source"]["kind"].as_str() == Some("local") && window["type"].as_str() != Some("hermes")
}

fn repair_focus(snapshot: &mut Value) {
    let mut ids = Vec::new();
    let mut groups = std::collections::HashMap::<String, Vec<String>>::new();
    let mut group_by_id = std::collections::HashMap::<String, String>::new();
    for window in snapshot["windows"].as_array().into_iter().flatten() {
        let Some(id) = window["id"].as_str() else {
            continue;
        };
        let id = id.to_string();
        let group = window["tabGroupId"]
            .as_str()
            .filter(|group| !group.is_empty())
            .unwrap_or(id.as_str())
            .to_string();
        ids.push(id.clone());
        group_by_id.insert(id.clone(), group.clone());
        groups.entry(group).or_default().push(id);
    }
    if ids.is_empty() {
        snapshot["activeWindowId"] = Value::Null;
        clear_canvas_maximized_window(snapshot, &ids);
        snapshot["activeTabMap"] = json!({});
        snapshot["tabGroupSplits"] = json!({});
        return;
    }
    if !snapshot["activeWindowId"]
        .as_str()
        .is_some_and(|id| ids.iter().any(|candidate| candidate == id))
    {
        snapshot["activeWindowId"] = Value::String(ids.last().cloned().unwrap_or_default());
    }
    clear_canvas_maximized_window(snapshot, &ids);

    let mut splits = Map::new();
    if let Some(raw_splits) = snapshot["tabGroupSplits"].as_object() {
        for (group, split) in raw_splits {
            let Some(left) = split["leftTabId"].as_str() else {
                continue;
            };
            let Some(members) = groups.get(group) else {
                continue;
            };
            if members.len() < 2
                || group_by_id.get(left).map(String::as_str) != Some(group.as_str())
            {
                continue;
            }
            splits.insert(group.clone(), split.clone());
        }
    }
    snapshot["tabGroupSplits"] = Value::Object(splits.clone());

    let mut active_tabs = Map::new();
    if let Some(raw_map) = snapshot["activeTabMap"].as_object() {
        for (group, active) in raw_map {
            let active_id = active.as_str();
            if active_id
                .is_some_and(|id| group_by_id.get(id).map(String::as_str) == Some(group.as_str()))
            {
                active_tabs.insert(group.clone(), active.clone());
                continue;
            }
            let split_left = splits
                .get(group)
                .and_then(|split| split["leftTabId"].as_str());
            if let Some(replacement) = groups
                .get(group)
                .into_iter()
                .flatten()
                .find(|id| Some(id.as_str()) != split_left)
            {
                active_tabs.insert(group.clone(), Value::String(replacement.clone()));
            }
        }
    }
    snapshot["activeTabMap"] = Value::Object(active_tabs);

    if let Some(active_id) = snapshot["activeWindowId"].as_str().map(str::to_string)
        && let Some(group) = group_by_id.get(&active_id)
        && let Some(split) = splits.get(group)
        && split["leftTabId"].as_str() == Some(active_id.as_str())
        && let Some(replacement) = groups
            .get(group)
            .into_iter()
            .flatten()
            .find(|id| id.as_str() != active_id)
    {
        snapshot["activeWindowId"] = Value::String(replacement.clone());
    }
}

fn clear_canvas_maximized_window(snapshot: &mut Value, ids: &[String]) {
    if let Some(canvas) = snapshot.get_mut("canvas").and_then(Value::as_object_mut) {
        if !canvas
            .get("maximizedWindowId")
            .and_then(Value::as_str)
            .is_some_and(|id| ids.iter().any(|candidate| candidate == id))
        {
            canvas.insert("maximizedWindowId".into(), Value::Null);
        }
    }
}

pub(crate) fn rewrite_snapshot_paths(snapshot: &mut Value, old_path: &str, new_path: &str) {
    if let Some(windows) = snapshot["windows"].as_array_mut() {
        for window in windows {
            if window["source"]["kind"].as_str() != Some("local")
                || window["type"].as_str() == Some("hermes")
            {
                continue;
            }
            if let Some(icon_path) = window.get_mut("iconPath") {
                logical_path::rewrite_value(icon_path, old_path, new_path);
            }
            if let Some(initial_state) = window
                .get_mut("initialState")
                .and_then(Value::as_object_mut)
            {
                for key in ["dir", "viewing", "playing"] {
                    if let Some(value) = initial_state.get_mut(key) {
                        logical_path::rewrite_value(value, old_path, new_path);
                    }
                }
            }
            if let Some(root_path) = window
                .get_mut("source")
                .and_then(Value::as_object_mut)
                .and_then(|source| source.get_mut("rootPath"))
            {
                logical_path::rewrite_value(root_path, old_path, new_path);
            }
        }
    }
    repair_focus(snapshot);
}

pub(crate) fn remove_snapshot_paths(snapshot: &mut Value, path: &str) {
    if let Some(windows) = snapshot["windows"].as_array_mut() {
        windows.retain_mut(|window| {
            if !mutable_local_window(window) {
                return true;
            }
            let should_remove = window_target(window)
                .map(|value| logical_path::matches(value, path))
                .unwrap_or_else(|| {
                    window["iconPath"]
                        .as_str()
                        .is_some_and(|value| logical_path::matches(value, path))
                });
            if should_remove {
                return false;
            }
            for key in ["dir", "viewing", "playing"] {
                if window["initialState"][key]
                    .as_str()
                    .is_some_and(|value| logical_path::matches(value, path))
                {
                    window["initialState"][key] = Value::Null;
                }
            }
            if window["iconPath"]
                .as_str()
                .is_some_and(|value| logical_path::matches(value, path))
            {
                window["iconPath"] = Value::Null;
            }
            if window["source"]["rootPath"]
                .as_str()
                .is_some_and(|value| logical_path::matches(value, path))
            {
                window["source"]["rootPath"] = Value::Null;
            }
            true
        });
    }
    repair_focus(snapshot);
}

fn normalize_metadata_value(key: &str, value: &Value) -> Result<Option<String>, &'static str> {
    let error = match key {
        "name" => "Invalid workspace name",
        "icon" => "Invalid workspace icon",
        "iconColor" => "Invalid workspace icon color",
        _ => return Err("Invalid workspace metadata"),
    };
    if value.is_null() {
        return Ok(None);
    }
    let value = value.as_str().ok_or(error)?.trim();
    let valid = match key {
        "name" => value.encode_utf16().count() <= 120,
        "icon" => value.len() <= 64 && value.chars().all(|ch| ch.is_ascii_alphanumeric()),
        "iconColor" => {
            value.len() <= 32
                && value
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        }
        _ => false,
    };
    if !valid {
        return Err(if key == "name" {
            "Workspace name is too long"
        } else {
            error
        });
    }
    Ok((!value.is_empty()).then(|| value.to_string()))
}

fn canonical_registry(raw: Value) -> crate::error::AppResult<Value> {
    if raw["version"].as_u64() != Some(1) {
        return Err(AppError::internal("Invalid workspace registry"));
    }
    let records = raw["records"]
        .as_object()
        .ok_or_else(|| AppError::internal("Invalid workspace registry records"))?;
    let order = raw["order"]
        .as_array()
        .ok_or_else(|| AppError::internal("Invalid workspace registry order"))?;
    let mut seen = std::collections::HashSet::new();
    for id in order {
        let id = id
            .as_str()
            .ok_or_else(|| AppError::internal("Invalid workspace registry order"))?;
        if !records.contains_key(id) || !seen.insert(id) {
            return Err(AppError::internal("Invalid workspace registry order"));
        }
    }
    if seen.len() != records.len() {
        return Err(AppError::internal("Invalid workspace registry order"));
    }
    for (id, record) in records {
        let valid = !id.is_empty()
            && record["id"].as_str() == Some(id)
            && persistent_snapshot(&record["snapshot"]).is_some()
            && record["revision"].is_u64()
            && record["updatedAt"].is_u64()
            && record["lastOpenedAt"].is_u64();
        if !valid {
            return Err(AppError::internal("Invalid workspace registry record"));
        }
    }
    Ok(raw)
}

fn validate_registry(value: &Value) -> crate::error::AppResult<()> {
    if canonical_registry(value.clone())? != *value {
        return Err(crate::error::AppError::internal(
            "Non-canonical workspace registry",
        ));
    }
    Ok(())
}

fn require_lease(record: &Value, client_id: &str, now: u128) -> crate::error::AppResult<()> {
    let owned = record.get("leaseClientId").and_then(Value::as_str) == Some(client_id);
    let alive = record
        .get("leaseExpiresAt")
        .and_then(Value::as_u64)
        .is_some_and(|expires| expires as u128 > now);
    if !owned || !alive {
        return Err(crate::error::AppError::conflict(
            "Workspace is open elsewhere",
        ));
    }
    Ok(())
}

fn require_lease_or_available(
    record: &Value,
    client_id: &str,
    now: u128,
) -> crate::error::AppResult<()> {
    let owned = record.get("leaseClientId").and_then(Value::as_str) == Some(client_id);
    let alive = record
        .get("leaseExpiresAt")
        .and_then(Value::as_u64)
        .is_some_and(|expires| expires as u128 > now);
    if alive && !owned {
        return Err(crate::error::AppError::conflict(
            "Workspace is open elsewhere",
        ));
    }
    Ok(())
}

fn require_revision(record: &Value, expected: u64, message: &str) -> crate::error::AppResult<()> {
    if record.get("revision").and_then(Value::as_u64) != Some(expected) {
        return Err(crate::error::AppError::conflict(message));
    }
    Ok(())
}

fn next_revision(record: &mut Value, now: u128) -> crate::error::AppResult<u64> {
    let revision = record
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| crate::error::AppError::internal("Invalid workspace revision"))?;
    let next = revision
        .checked_add(1)
        .ok_or_else(|| crate::error::AppError::conflict("Workspace revision is exhausted"))?;
    record["revision"] = Value::from(next);
    record["updatedAt"] = Value::from(timestamp_value(now)?);
    Ok(next)
}

fn replace_snapshot(
    record: &mut Value,
    snapshot: Value,
    now: u128,
) -> crate::error::AppResult<u64> {
    let revision = record
        .get("revision")
        .and_then(Value::as_u64)
        .ok_or_else(|| crate::error::AppError::internal("Invalid workspace revision"))?;
    if record.get("snapshot") == Some(&snapshot) {
        return Ok(revision);
    }
    record["snapshot"] = snapshot;
    next_revision(record, now)
}

fn replace_snapshot_and_metadata(
    record: &mut Value,
    snapshot: Value,
    metadata: Option<&Value>,
    now: u128,
) -> crate::error::AppResult<u64> {
    let before = record.clone();
    record["snapshot"] = snapshot;
    if let Some(metadata) = metadata {
        apply_metadata(record, metadata)?;
    }
    let unchanged = ["snapshot", "name", "icon", "iconColor"]
        .iter()
        .all(|key| record.get(key) == before.get(key));
    if unchanged {
        return record["revision"]
            .as_u64()
            .ok_or_else(|| crate::error::AppError::internal("Invalid workspace revision"));
    }
    next_revision(record, now)
}

fn reorder_registry(registry: &mut Value, requested: &Value) -> crate::error::AppResult<()> {
    let requested = requested
        .as_array()
        .ok_or_else(|| crate::error::AppError::bad("Workspace order is required"))?;
    if requested.iter().any(|value| !value.is_string()) {
        return Err(crate::error::AppError::bad(
            "Workspace order must contain only strings",
        ));
    }
    let current = registry["order"]
        .as_array()
        .ok_or_else(|| crate::error::AppError::internal("Invalid workspace order"))?;
    let mut requested_ids = requested
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let mut current_ids = current.iter().filter_map(Value::as_str).collect::<Vec<_>>();
    requested_ids.sort_unstable();
    current_ids.sort_unstable();
    if requested_ids != current_ids {
        return Err(crate::error::AppError::conflict("Workspace list changed"));
    }
    registry["order"] = Value::Array(requested.clone());
    Ok(())
}

fn apply_metadata(record: &mut Value, body: &Value) -> crate::error::AppResult<()> {
    if ["name", "icon", "iconColor"]
        .iter()
        .all(|key| body.get(key).is_none())
    {
        return Err(crate::error::AppError::bad(
            "Workspace metadata is required",
        ));
    }

    let mut normalized = Vec::new();
    for key in ["name", "icon", "iconColor"] {
        if let Some(value) = body.get(key) {
            normalized.push((
                key,
                normalize_metadata_value(key, value).map_err(crate::error::AppError::bad)?,
            ));
        }
    }

    let object = record
        .as_object_mut()
        .ok_or_else(|| crate::error::AppError::internal("Invalid workspace registry record"))?;
    for (key, value) in normalized {
        match value {
            Some(value) => {
                object.insert(key.into(), Value::String(value));
            }
            None => {
                object.remove(key);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository() -> (WorkspaceRepository, std::path::PathBuf) {
        let database = std::env::temp_dir().join(format!(
            "derp-workspace-repository-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let connection = crate::state_db::connection(&database).unwrap();
        connection
            .execute(
                "CREATE TABLE state_documents (kind TEXT NOT NULL, library_key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(kind, library_key))",
                [],
            )
            .unwrap();
        drop(connection);
        (
            WorkspaceRepository::from_store(DocumentStore::new(&database, "library")),
            database,
        )
    }

    fn nested_snapshot() -> Value {
        json!({
            "workspaceType":"desktop",
            "windows":[
                {
                    "id":"left",
                    "type":"browser",
                    "title":"Browser",
                    "iconName":null,
                    "iconPath":"Books",
                    "iconType":"folder",
                    "iconIsVirtual":false,
                    "source":{"kind":"local","rootPath":"Books"},
                    "initialState":{"dir":"Books","viewing":null,"playing":null,"audioOnly":false,"readerKind":null},
                    "tabGroupId":"group",
                    "openedFromWindowId":null,
                    "tabPinned":false,
                    "fileOpenTargetWindowId":"right",
                    "layout":{
                        "bounds":{"x":0,"y":0,"width":800,"height":600},
                        "fullscreen":false,
                        "snapZone":"assist-custom",
                        "minimized":false,
                        "zIndex":1,
                        "restoreBounds":null,
                        "tiling":{
                            "cols":2,"rows":1,"colStart":0,"colEnd":1,"rowStart":0,"rowEnd":1,
                            "colLines":[0,0.5,1],"rowLines":[0,1]
                        }
                    }
                },
                {
                    "id":"right",
                    "type":"viewer",
                    "title":"Reader",
                    "source":{"kind":"local"},
                    "initialState":{"viewing":"Books/note.pdf","readerKind":"pdf"},
                    "tabGroupId":"group",
                    "layout":{"bounds":{"x":800,"y":0,"width":800,"height":600},"zIndex":2}
                }
            ],
            "activeWindowId":"right",
            "activeTabMap":{"group":"right"},
            "nextWindowId":3,
            "tabGroupSplits":{"group":{"leftTabId":"left","leftPaneFraction":0.5}}
        })
    }

    #[test]
    fn repository_commands_preserve_lease_snapshot_and_revision_rules() {
        let (repository, database) = repository();
        let snapshot = nested_snapshot();

        let opened = repository
            .execute(WorkspaceCommand::Open {
                id: "workspace".into(),
                client_id: "client".into(),
                takeover: false,
                initial_snapshot: Some(snapshot.clone()),
                now: 100,
            })
            .unwrap();
        assert_eq!(opened.response["editable"], true);
        assert_eq!(
            opened.response["record"]["snapshot"]["workspaceType"],
            "desktop"
        );
        let mut changed = snapshot;
        changed["nextWindowId"] = json!(4);
        let saved = repository
            .execute(WorkspaceCommand::Save {
                id: "workspace".into(),
                client_id: "client".into(),
                revision: 0,
                snapshot: changed.clone(),
                metadata: None,
                now: 101,
            })
            .unwrap();
        assert_eq!(saved.response["revision"], 1);

        let stale = repository.execute(WorkspaceCommand::Save {
            id: "workspace".into(),
            client_id: "client".into(),
            revision: 0,
            snapshot: changed,
            metadata: None,
            now: 102,
        });
        assert!(stale.is_err());
        assert_eq!(
            repository.read().unwrap()["records"]["workspace"]["revision"],
            1
        );

        let listed = repository.public_registry(102, Some("other")).unwrap();
        assert_eq!(listed["records"]["workspace"]["locked"], true);
        assert!(listed["records"]["workspace"].get("leaseClientId").is_none());
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn workspace_path_rewrite_uses_the_repository_transaction_boundary() {
        let (repository, database) = repository();
        repository
            .execute(WorkspaceCommand::Open {
                id: "workspace".into(),
                client_id: "client".into(),
                takeover: false,
                initial_snapshot: Some(nested_snapshot()),
                now: 100,
            })
            .unwrap();
        let app_database = crate::state_db::AppDatabase::new(&database);

        let aborted: AppResult<()> = app_database.transaction(|transaction| {
            repository.move_paths_in_transaction(transaction, "Books", "Library", 200)?;
            Err(AppError::internal("abort workspace path rewrite"))
        });
        assert!(aborted.is_err());
        assert_eq!(
            repository.read().unwrap()["records"]["workspace"]["snapshot"]["windows"][0]["source"]
                ["rootPath"],
            "Books"
        );

        app_database
            .transaction(|transaction| {
                repository.move_paths_in_transaction(transaction, "Books", "Library", 200)
            })
            .unwrap();
        let record = &repository.read().unwrap()["records"]["workspace"];
        assert_eq!(
            record["snapshot"]["windows"][0]["source"]["rootPath"],
            "Library"
        );
        assert_eq!(record["revision"], 1);
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn persistent_snapshot_rejects_dangling_active_window() {
        let mut missing_active = nested_snapshot();
        missing_active["activeWindowId"] = json!("missing");

        assert!(persistent_snapshot(&missing_active).is_none());
    }

    #[test]
    fn removing_workspace_window_clears_stale_maximized_window() {
        let mut snapshot = json!({
            "workspaceType": "canvas",
            "windows": [{"id": "kept", "initialState": {}}],
            "activeWindowId": "kept",
            "canvas": {"maximizedWindowId": "removed"}
        });

        remove_snapshot_paths(&mut snapshot, "missing/path");

        assert_eq!(snapshot["canvas"]["maximizedWindowId"], Value::Null);
        assert!(snapshot.get("maximizedWindowId").is_none());
    }

    #[test]
    fn path_move_rewrites_local_source_root() {
        let mut snapshot = json!({
            "windows": [{
                "id": "reader",
                "type": "viewer",
                "source": {"kind": "local", "rootPath": "Books/Old"},
                "initialState": {"viewing": "Books/Old/chapter.pdf"}
            }]
        });

        rewrite_snapshot_paths(&mut snapshot, "Books/Old", "Books/New");

        assert_eq!(snapshot["windows"][0]["source"]["rootPath"], "Books/New");
    }

    #[test]
    fn path_move_normalizes_slashes_like_the_client() {
        let mut snapshot = json!({
            "windows": [{
                "id": "browser",
                "type": "browser",
                "source": {"kind": "local"},
                "initialState": {"dir": "Books/Old/"}
            }]
        });

        rewrite_snapshot_paths(&mut snapshot, "Books/Old/", "Books/New/");

        assert_eq!(snapshot["windows"][0]["initialState"]["dir"], "Books/New");
    }

    #[test]
    fn unrelated_path_move_does_not_materialize_optional_window_fields() {
        let mut snapshot = json!({
            "windows": [{
                "id": "browser",
                "type": "browser",
                "source": {"kind": "local"},
                "initialState": {}
            }],
            "activeWindowId": "browser",
            "activeTabMap": {},
            "tabGroupSplits": {}
        });
        let before = snapshot.clone();

        rewrite_snapshot_paths(&mut snapshot, "Missing", "Elsewhere");

        assert_eq!(snapshot, before);
    }

    #[test]
    fn path_remove_clears_local_secondary_paths() {
        let mut snapshot = json!({
            "windows": [{
                "id": "reader",
                "type": "viewer",
                "source": {"kind": "local", "rootPath": "Books/Old"},
                "iconPath": "Books/Old/chapter.pdf",
                "initialState": {
                    "viewing": "Books/Current.pdf",
                    "playing": "Books/Old/audio.mp3"
                }
            }],
            "activeWindowId": "reader"
        });

        remove_snapshot_paths(&mut snapshot, "Books/Old");

        let window = &snapshot["windows"][0];
        assert_eq!(window["initialState"]["viewing"], "Books/Current.pdf");
        assert_eq!(window["initialState"]["playing"], Value::Null);
        assert_eq!(window["source"]["rootPath"], Value::Null);
        assert_eq!(window["iconPath"], Value::Null);
    }

    #[test]
    fn focus_repair_removes_cross_group_focus_and_single_tab_splits() {
        let mut snapshot = json!({
            "windows": [
                {"id":"left","tabGroupId":"group","initialState":{}},
                {"id":"right","tabGroupId":"group","initialState":{}},
                {"id":"solo","initialState":{}}
            ],
            "activeWindowId":"left",
            "activeTabMap":{"group":"solo","missing":"solo"},
            "tabGroupSplits":{
                "group":{"leftTabId":"left","leftPaneFraction":0.5},
                "solo":{"leftTabId":"solo","leftPaneFraction":0.5}
            }
        });

        repair_focus(&mut snapshot);

        assert_eq!(snapshot["activeTabMap"]["group"], "right");
        assert!(snapshot["activeTabMap"].get("missing").is_none());
        assert!(snapshot["tabGroupSplits"].get("group").is_some());
        assert!(snapshot["tabGroupSplits"].get("solo").is_none());
        assert_eq!(snapshot["activeWindowId"], "right");
    }

    #[test]
    fn registry_rejects_malformed_stored_shape() {
        let result = canonical_registry(json!({"records": []}));

        assert!(result.is_err());
    }

    #[test]
    fn registry_does_not_treat_present_empty_document_as_missing_state() {
        assert!(canonical_registry(json!({})).is_err());
    }

    #[test]
    fn registry_rejects_order_that_is_not_exact_record_permutation() {
        let record = json!({
            "id": "one",
            "snapshot": {
                "workspaceType": "desktop",
                "windows": [],
                "activeWindowId": null,
                "activeTabMap": {},
                "nextWindowId": 1,
                "tabGroupSplits": {}
            },
            "revision": 0,
            "updatedAt": 0,
            "lastOpenedAt": 0
        });
        let missing = canonical_registry(json!({
            "version": 1,
            "order": [],
            "records": {"one": record.clone()}
        }));
        let duplicate = canonical_registry(json!({
            "version": 1,
            "order": ["one", "one"],
            "records": {"one": record}
        }));

        assert!(missing.is_err());
        assert!(duplicate.is_err());
    }

    #[test]
    fn registry_rejects_record_with_missing_canonical_metadata() {
        let result = canonical_registry(json!({
            "version": 1,
            "order": ["one"],
            "records": {
                "one": {
                    "id": "one",
                    "snapshot": {
                        "workspaceType": "desktop",
                        "windows": [],
                        "activeWindowId": null,
                        "activeTabMap": {},
                        "nextWindowId": 1,
                        "tabGroupSplits": {}
                    }
                }
            }
        }));

        assert!(result.is_err());
    }

    #[test]
    fn registry_rejects_snapshot_without_explicit_workspace_type() {
        let result = canonical_registry(json!({
            "version": 1,
            "order": ["one"],
            "records": {
                "one": {
                    "id": "one",
                    "snapshot": {
                        "windows": [],
                        "activeWindowId": null,
                        "activeTabMap": {},
                        "nextWindowId": 1,
                        "tabGroupSplits": {}
                    },
                    "revision": 0,
                    "updatedAt": 0,
                    "lastOpenedAt": 0
                }
            }
        }));

        assert!(result.is_err());
    }

    #[test]
    fn persistent_snapshot_rejects_unknown_workspace_type() {
        let snapshot = json!({
            "workspaceType": "board",
            "windows": [],
            "activeWindowId": null,
            "activeTabMap": {},
            "nextWindowId": 1
        });

        assert!(persistent_snapshot(&snapshot).is_none());
    }

    #[test]
    fn persistent_snapshot_requires_type_specific_canvas_state() {
        let canvas_without_state = json!({
            "workspaceType": "canvas",
            "windows": [],
            "activeWindowId": null,
            "activeTabMap": {},
            "nextWindowId": 1
        });
        let desktop_with_canvas_state = json!({
            "workspaceType": "desktop",
            "windows": [],
            "activeWindowId": null,
            "activeTabMap": {},
            "nextWindowId": 1,
            "canvas": {
                "camera": {"x": 0, "y": 0, "zoom": 1},
                "maximizedWindowId": null,
                "windowSizeByType": {},
                "nextZIndex": 1
            }
        });

        assert!(persistent_snapshot(&canvas_without_state).is_none());
        assert!(persistent_snapshot(&desktop_with_canvas_state).is_none());
    }

    #[test]
    fn persistent_snapshot_requires_canonical_workspace_fields() {
        let missing_focus = json!({
            "workspaceType": "desktop",
            "windows": [],
            "nextWindowId": 1
        });

        assert!(persistent_snapshot(&missing_focus).is_none());
    }

    #[test]
    fn repository_rejects_and_rolls_back_malformed_mutation_output() {
        let (repository, database) = repository();

        let result = repository.mutate(|registry| {
            registry["order"] = Value::Null;
            Ok(())
        });

        assert!(result.is_err());
        assert_eq!(repository.read().unwrap(), empty_registry());
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn repository_rejects_snapshot_changes_without_the_matching_revision() {
        let (repository, database) = repository();
        let snapshot = json!({
            "workspaceType": "desktop",
            "windows": [],
            "activeWindowId": null,
            "activeTabMap": {},
            "nextWindowId": 1,
            "tabGroupSplits": {}
        });
        assert_eq!(persistent_snapshot(&snapshot), Some(snapshot.clone()));
        repository
            .mutate(|registry| {
                registry["records"]["one"] = json!({
                    "id": "one",
                    "snapshot": snapshot,
                    "revision": 0,
                    "updatedAt": 10,
                    "lastOpenedAt": 10
                });
                registry["order"] = json!(["one"]);
                Ok(())
            })
            .unwrap();

        let result = repository.mutate(|registry| {
            registry["records"]["one"]["snapshot"]["nextWindowId"] = json!(2);
            Ok(())
        });

        assert!(result.is_err());
        assert_eq!(
            repository.read().unwrap()["records"]["one"]["snapshot"]["nextWindowId"],
            1
        );
        let _ = std::fs::remove_file(database);
    }

    #[test]
    fn replacing_an_unchanged_snapshot_preserves_its_revision_and_timestamp() {
        let snapshot = json!({"workspaceType":"desktop"});
        let mut record = json!({
            "snapshot": snapshot,
            "revision": 7,
            "updatedAt": 42
        });

        let revision = replace_snapshot(&mut record, snapshot, 99).unwrap();

        assert_eq!(revision, 7);
        assert_eq!(record["revision"], 7);
        assert_eq!(record["updatedAt"], 42);
    }

}
