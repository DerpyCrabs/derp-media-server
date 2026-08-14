use crate::{
    error::{AppError, AppResult},
    state_db,
};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

pub const CANVAS_DOCUMENT_SCHEMA_VERSION: u64 = 2;
const CANVAS_DOCUMENT: state_db::StateDocument = state_db::StateDocument::CanvasV2;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasRecord {
    pub id: String,
    pub name: String,
    pub state: Value,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CanvasDocument {
    pub schema_version: u64,
    pub revision: u64,
    pub active_id: Option<String>,
    pub canvases: Vec<CanvasRecord>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveCanvasDocument {
    pub schema_version: u64,
    pub expected_revision: u64,
    pub active_id: Option<String>,
    pub canvases: Vec<CanvasRecord>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn empty_document() -> CanvasDocument {
    CanvasDocument {
        schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
        revision: 0,
        active_id: None,
        canvases: Vec::new(),
    }
}

fn corrupt(message: impl std::fmt::Display) -> AppError {
    AppError::internal(format!(
        "Stored Canvas state is corrupt and was preserved: {message}"
    ))
}

fn exact_object<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    let object = value.as_object()?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return None;
    }
    Some(object)
}

fn valid_rect(value: &Value) -> bool {
    exact_object(value, &["x", "y", "width", "height"], &[]).is_some()
        && ["x", "y", "width", "height"].iter().all(|key| {
            value
                .get(key)
                .and_then(Value::as_f64)
                .is_some_and(f64::is_finite)
        })
        && value
            .get("width")
            .and_then(Value::as_f64)
            .is_some_and(|x| x > 0.0)
        && value
            .get("height")
            .and_then(Value::as_f64)
            .is_some_and(|x| x > 0.0)
}

fn valid_content(content: &Value) -> bool {
    exact_object(
        content,
        &["schemaVersion", "codec", "codecVersion", "payload"],
        &[],
    )
    .is_some()
        && content.get("schemaVersion").and_then(Value::as_u64) == Some(1)
        && content
            .get("codec")
            .and_then(Value::as_str)
            .is_some_and(|codec| !codec.trim().is_empty())
        && content
            .get("codecVersion")
            .and_then(Value::as_u64)
            .is_some_and(|version| version > 0)
        && content.get("payload").is_some()
}

fn valid_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.encode_utf16().count() <= maximum
}

fn valid_camera(value: &Value) -> bool {
    exact_object(value, &["x", "y", "zoom"], &[]).is_some()
        && ["x", "y", "zoom"].iter().all(|key| {
            value
                .get(key)
                .and_then(Value::as_f64)
                .is_some_and(f64::is_finite)
        })
        && value
            .get("zoom")
            .and_then(Value::as_f64)
            .is_some_and(|zoom| zoom > 0.0)
}

fn valid_window_size(value: &Value) -> bool {
    exact_object(value, &["width", "height"], &[]).is_some()
        && ["width", "height"].iter().all(|key| {
            value
                .get(key)
                .and_then(Value::as_f64)
                .is_some_and(|part| part.is_finite() && part > 0.0)
        })
}

fn valid_window_sizes(value: &Value) -> bool {
    const KEYS: &[&str] = &[
        "browser",
        "viewer",
        "integration",
        "viewer-audio",
        "viewer-video",
        "viewer-image",
        "viewer-text",
        "viewer-pdf",
        "viewer-other",
    ];
    value.as_object().is_some_and(|sizes| {
        sizes
            .iter()
            .all(|(key, size)| KEYS.contains(&key.as_str()) && valid_window_size(size))
    })
}

fn valid_definition(definition: &Value, window_id: &str) -> bool {
    let Some(object) = exact_object(definition, &["id", "title", "content"], &["iconName"]) else {
        return false;
    };
    object.get("id").and_then(Value::as_str) == Some(window_id)
        && object.get("title").is_some_and(Value::is_string)
        && object
            .get("iconName")
            .is_none_or(|icon| icon.is_null() || icon.is_string())
        && object.get("content").is_some_and(valid_content)
}

fn valid_state(state: &Value) -> bool {
    if exact_object(
        state,
        &[
            "version",
            "windows",
            "maximizedWindowId",
            "camera",
            "windowSizeByType",
            "nextItemId",
            "nextZIndex",
        ],
        &[],
    )
    .is_none()
        || state.get("version").and_then(Value::as_u64) != Some(1)
        || !state.get("camera").is_some_and(valid_camera)
        || !state
            .get("windowSizeByType")
            .is_some_and(valid_window_sizes)
        || !state
            .get("nextItemId")
            .and_then(Value::as_u64)
            .is_some_and(|value| value > 0)
        || !state
            .get("nextZIndex")
            .and_then(Value::as_u64)
            .is_some_and(|value| value > 0)
    {
        return false;
    }
    let Some(windows) = state.get("windows").and_then(Value::as_array) else {
        return false;
    };
    let mut ids = HashSet::new();
    for window in windows {
        let Some(object) = exact_object(window, &["id", "definition", "bounds", "zIndex"], &[])
        else {
            return false;
        };
        let Some(id) = object.get("id").and_then(Value::as_str) else {
            return false;
        };
        if !valid_text(id, 128)
            || !ids.insert(id)
            || !object.get("bounds").is_some_and(valid_rect)
            || !object
                .get("zIndex")
                .and_then(Value::as_u64)
                .is_some_and(|value| value > 0)
            || !object
                .get("definition")
                .is_some_and(|definition| valid_definition(definition, id))
        {
            return false;
        }
    }
    match state.get("maximizedWindowId") {
        Some(Value::Null) => true,
        Some(Value::String(id)) => ids.contains(id.as_str()),
        _ => false,
    }
}

fn validate_document(document: &CanvasDocument) -> AppResult<()> {
    if document.schema_version != CANVAS_DOCUMENT_SCHEMA_VERSION {
        return Err(AppError::bad("Unsupported Canvas document version"));
    }
    let mut ids = HashSet::new();
    for canvas in &document.canvases {
        if !valid_text(&canvas.id, 128)
            || !valid_text(&canvas.name, 120)
            || !ids.insert(canvas.id.as_str())
            || !valid_state(&canvas.state)
        {
            return Err(AppError::bad("Invalid Canvas document"));
        }
    }
    match (&document.active_id, document.canvases.is_empty()) {
        (None, true) => Ok(()),
        (Some(active_id), false) if ids.contains(active_id.as_str()) => Ok(()),
        _ => Err(AppError::bad(
            "Canvas activeId does not identify a saved canvas",
        )),
    }
}

fn decode_stored(raw: &str) -> AppResult<CanvasDocument> {
    let document: CanvasDocument = serde_json::from_str(raw).map_err(corrupt)?;
    validate_document(&document).map_err(|error| corrupt(error.1))?;
    Ok(document)
}

fn stored_raw(transaction: &Transaction<'_>, library_key: &str) -> AppResult<Option<String>> {
    transaction
        .query_row(
            "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key=?2",
            params![CANVAS_DOCUMENT.name(), library_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| AppError::internal(error.to_string()))
}

fn write_document(
    transaction: &Transaction<'_>,
    library_key: &str,
    document: &CanvasDocument,
) -> AppResult<()> {
    let serialized =
        serde_json::to_string(document).map_err(|error| AppError::internal(error.to_string()))?;
    transaction
        .execute(
            "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(kind, library_key) DO UPDATE SET
               value_json=excluded.value_json, updated_at=excluded.updated_at",
            params![
                CANVAS_DOCUMENT.name(),
                library_key,
                serialized,
                now_ms() as i64
            ],
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

pub fn load(database: &Path, library_key: &str) -> AppResult<CanvasDocument> {
    let connection = state_db::connection(database)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| AppError::internal(error.to_string()))?;
    let Some(raw) = stored_raw(&transaction, library_key)? else {
        return Ok(empty_document());
    };
    decode_stored(&raw)
}

pub fn save(
    database: &Path,
    library_key: &str,
    incoming: SaveCanvasDocument,
) -> AppResult<CanvasDocument> {
    if incoming.schema_version != CANVAS_DOCUMENT_SCHEMA_VERSION {
        return Err(AppError::bad("Unsupported Canvas document version"));
    }
    let mut connection = state_db::connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let current = match stored_raw(&transaction, library_key)? {
        Some(raw) => decode_stored(&raw)?,
        None => empty_document(),
    };
    if current.revision != incoming.expected_revision {
        return Err(AppError::conflict(format!(
            "Canvas changed since revision {}",
            incoming.expected_revision
        )));
    }

    let current_by_id = current
        .canvases
        .iter()
        .map(|canvas| (canvas.id.as_str(), canvas))
        .collect::<HashMap<_, _>>();
    let timestamp = now_ms();
    let canvases = incoming
        .canvases
        .into_iter()
        .map(|mut canvas| {
            canvas.name = canvas.name.trim().to_string();
            canvas.updated_at = current_by_id
                .get(canvas.id.as_str())
                .filter(|stored| stored.name == canvas.name && stored.state == canvas.state)
                .map_or(timestamp, |stored| stored.updated_at);
            canvas
        })
        .collect();
    let document = CanvasDocument {
        schema_version: CANVAS_DOCUMENT_SCHEMA_VERSION,
        revision: current.revision.saturating_add(1),
        active_id: incoming.active_id,
        canvases,
    };
    validate_document(&document)?;
    write_document(&transaction, library_key, &document)?;
    transaction
        .commit()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(document)
}

fn records_mut(value: &mut Value) -> AppResult<&mut Vec<Value>> {
    let document: CanvasDocument = serde_json::from_value(value.clone()).map_err(corrupt)?;
    validate_document(&document).map_err(|error| corrupt(error.1))?;
    value
        .get_mut("canvases")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| corrupt("missing Canvas records"))
}

fn bump_record(record: &mut Value, updated_at: u128) {
    let current = record
        .get("updatedAt")
        .and_then(Value::as_u64)
        .unwrap_or_default();
    record["updatedAt"] = Value::from(current.saturating_add(1).max(updated_at as u64));
}

fn bump_document(value: &mut Value) {
    if value.get("schemaVersion").and_then(Value::as_u64) == Some(CANVAS_DOCUMENT_SCHEMA_VERSION) {
        let revision = value["revision"].as_u64().unwrap_or_default();
        value["revision"] = Value::from(revision.saturating_add(1));
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ContentMutation {
    Unchanged,
    Changed,
    RemoveHost,
}

pub(crate) fn mutate_contents(
    records: &mut Value,
    updated_at: u128,
    mut mutate: impl FnMut(&mut Value) -> AppResult<ContentMutation>,
) -> AppResult<()> {
    let mut any_changed = false;
    {
        let items = records_mut(records)?;
        for record in items {
            let (changed, clear_maximized) = {
                let state = record
                    .get_mut("state")
                    .expect("validated Canvas record has state");
                let maximized_id = state
                    .get("maximizedWindowId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let windows = state
                    .get_mut("windows")
                    .and_then(Value::as_array_mut)
                    .expect("validated Canvas state has windows");
                let mut changed = false;
                let mut removed = false;
                let mut failure = None;
                windows.retain_mut(|window| {
                    if failure.is_some() {
                        return true;
                    }
                    let content = window
                        .get_mut("definition")
                        .and_then(|definition| definition.get_mut("content"))
                        .expect("validated Canvas window has content");
                    match mutate(content) {
                        Ok(ContentMutation::Unchanged) => true,
                        Ok(ContentMutation::Changed) => {
                            changed = true;
                            true
                        }
                        Ok(ContentMutation::RemoveHost) => {
                            changed = true;
                            removed = true;
                            false
                        }
                        Err(error) => {
                            failure = Some(error);
                            true
                        }
                    }
                });
                if let Some(error) = failure {
                    return Err(error);
                }
                let clear_maximized = removed
                    && maximized_id.as_deref().is_some_and(|id| {
                        !windows
                            .iter()
                            .any(|window| window.get("id").and_then(Value::as_str) == Some(id))
                    });
                (changed, clear_maximized)
            };
            if !changed {
                continue;
            }
            if clear_maximized {
                record["state"]["maximizedWindowId"] = Value::Null;
            }
            bump_record(record, updated_at);
            any_changed = true;
        }
    }
    if any_changed {
        bump_document(records);
        let document: CanvasDocument = serde_json::from_value(records.clone()).map_err(corrupt)?;
        validate_document(&document).map_err(|error| corrupt(error.1))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;

    fn state() -> Value {
        json!({
            "version":1,
            "windows":[],
            "maximizedWindowId":null,
            "camera":{"x":0,"y":0,"zoom":1},
            "windowSizeByType":{},
            "nextItemId":1,
            "nextZIndex":1
        })
    }

    fn database(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "derp-canvas-{name}-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        Connection::open(&path)
            .unwrap()
            .execute_batch(
                "CREATE TABLE state_documents (
                   kind TEXT NOT NULL, library_key TEXT NOT NULL, value_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL, PRIMARY KEY(kind, library_key)
                 );",
            )
            .unwrap();
        path
    }

    fn insert_raw(database: &Path, raw: &str) {
        Connection::open(database)
            .unwrap()
            .execute(
                "INSERT INTO state_documents(kind,library_key,value_json,updated_at)
                 VALUES(?1,'library',?2,1)",
                params![CANVAS_DOCUMENT.name(), raw],
            )
            .unwrap();
    }

    fn read_raw(database: &Path) -> String {
        Connection::open(database)
            .unwrap()
            .query_row(
                "SELECT value_json FROM state_documents
                 WHERE kind=?1 AND library_key='library'",
                [CANVAS_DOCUMENT.name()],
                |row| row.get(0),
            )
            .unwrap()
    }

    #[test]
    fn rejects_stale_revision_without_changing_document() {
        let database = database("conflict");
        let initial = save(
            &database,
            "library",
            SaveCanvasDocument {
                schema_version: 2,
                expected_revision: 0,
                active_id: Some("canvas-1".into()),
                canvases: vec![CanvasRecord {
                    id: "canvas-1".into(),
                    name: "Saved".into(),
                    state: state(),
                    updated_at: 0,
                }],
            },
        )
        .unwrap();
        let raw = read_raw(&database);

        let error = save(
            &database,
            "library",
            SaveCanvasDocument {
                schema_version: 2,
                expected_revision: 0,
                active_id: initial.active_id.clone(),
                canvases: initial.canvases.clone(),
            },
        )
        .unwrap_err();

        assert_eq!(error.0, axum::http::StatusCode::CONFLICT);
        assert_eq!(read_raw(&database), raw);
        std::fs::remove_file(database).unwrap();
    }

    #[test]
    fn preserves_corrupt_sqlite_bytes() {
        let database = database("corrupt");
        let raw = "{not valid Canvas JSON";
        insert_raw(&database, raw);

        let error = load(&database, "library").unwrap_err();

        assert!(error.1.contains("was preserved"));
        assert_eq!(read_raw(&database), raw);
        std::fs::remove_file(database).unwrap();
    }

    #[test]
    fn path_mutation_preserves_semantically_corrupt_document() {
        let database = database("corrupt-path-mutation");
        let raw = r#"{"schemaVersion":2,"revision":4,"activeId":"missing","canvases":[]}"#;
        insert_raw(&database, raw);

        let error = state_db::update_document(
            &database,
            CANVAS_DOCUMENT,
            "library",
            json!([]),
            |document| mutate_contents(document, 10, |_| Ok(ContentMutation::Unchanged)),
        )
        .unwrap_err();

        assert!(error.1.contains("corrupt and was preserved"));
        assert_eq!(read_raw(&database), raw);
        std::fs::remove_file(database).unwrap();
    }

    #[test]
    fn content_mutation_is_provider_neutral_and_advances_revision() {
        let mut document = json!({
            "schemaVersion":2,
            "revision":4,
            "activeId":"canvas-1",
            "canvases":[{
                "id":"canvas-1","name":"Canvas","updatedAt":1,
                "state":{
                    "version":1,
                    "windows":[{
                        "id":"window-1",
                        "bounds":{"x":0,"y":0,"width":320,"height":224},
                        "zIndex":1,
                        "definition":{
                            "id":"window-1","title":"Chapter",
                            "content":{"schemaVersion":1,"codec":"fixture.content",
                                "codecVersion":1,"payload":{"value":"before"}}
                        }
                    }],
                    "maximizedWindowId":"window-1",
                    "camera":{"x":0,"y":0,"zoom":1},
                    "windowSizeByType":{},
                    "nextItemId":2,
                    "nextZIndex":2
                }
            }]
        });

        let mut unexpected_host_field = document.clone();
        unexpected_host_field["canvases"][0]["state"]["windows"][0]["definition"]["unexpected"] =
            json!(true);
        let unexpected_host_field: CanvasDocument =
            serde_json::from_value(unexpected_host_field).unwrap();
        assert!(validate_document(&unexpected_host_field).is_err());

        mutate_contents(&mut document, 10, |content| {
            assert_eq!(content["codec"], "fixture.content");
            content["payload"]["value"] = json!("after");
            Ok(ContentMutation::Changed)
        })
        .unwrap();

        assert_eq!(document["revision"], 5);
        assert_eq!(
            document["canvases"][0]["state"]["windows"][0]["definition"]["content"]["payload"]["value"],
            "after"
        );
        assert_eq!(document["canvases"][0]["updatedAt"], 10);
    }

    #[test]
    fn opaque_provider_payload_is_not_interpreted() {
        let mut canvas_state = state();
        canvas_state["windows"] = json!([{
            "id":"window-1",
            "definition":{
                "id":"window-1",
                "title":"Opaque",
                "iconName":null,
                "content":{
                    "schemaVersion":1,
                    "codec":"third-party.content",
                    "codecVersion":7,
                    "payload":{"providerOwned":"../opaque","nested":{"value":true}}
                }
            },
            "bounds":{"x":0,"y":0,"width":320,"height":224},
            "zIndex":1
        }]);
        canvas_state["maximizedWindowId"] = json!("window-1");
        let document = CanvasDocument {
            schema_version: 2,
            revision: 1,
            active_id: Some("canvas-1".into()),
            canvases: vec![CanvasRecord {
                id: "canvas-1".into(),
                name: "Canvas".into(),
                state: canvas_state,
                updated_at: 1,
            }],
        };

        validate_document(&document).unwrap();
    }

    #[test]
    fn removing_content_host_repairs_maximized_window() {
        let mut canvas_state = state();
        canvas_state["windows"] = json!([{
            "id":"window-1",
            "definition":{
                "id":"window-1","title":"Fixture",
                "content":{"schemaVersion":1,"codec":"fixture.content",
                    "codecVersion":1,"payload":{}}
            },
            "bounds":{"x":0,"y":0,"width":320,"height":224},
            "zIndex":1
        }]);
        canvas_state["maximizedWindowId"] = json!("window-1");
        let mut document = json!({
            "schemaVersion":2,
            "revision":1,
            "activeId":"canvas-1",
            "canvases":[{
                "id":"canvas-1","name":"Canvas","state":canvas_state,"updatedAt":1
            }]
        });

        mutate_contents(&mut document, 20, |_| Ok(ContentMutation::RemoveHost)).unwrap();

        assert_eq!(document["revision"], 2);
        assert_eq!(document["canvases"][0]["state"]["windows"], json!([]));
        assert_eq!(
            document["canvases"][0]["state"]["maximizedWindowId"],
            Value::Null
        );
    }
}
