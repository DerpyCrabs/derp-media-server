use crate::{
    contracts::{
        CANVAS_DOCUMENT_SCHEMA_VERSION, CanvasCameraDto, CanvasRectDto, CanvasWindowSizeDto,
        PersistedCanvasStateDto, PersistedCanvasWindowDefinitionDto, PersistedContentEnvelopeDto,
    },
    error::{AppError, AppResult},
    state_db,
};
use rusqlite::{OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(test)]
use crate::contracts::CanvasRecordDto as CanvasRecord;
pub(crate) use crate::contracts::{
    CanvasDocumentDto as CanvasDocument, SaveCanvasDocumentDto as SaveCanvasDocument,
};
const CANVAS_DOCUMENT: state_db::StateDocument = state_db::StateDocument::CanvasV2;

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

fn valid_rect(value: &CanvasRectDto) -> bool {
    value.x.is_finite()
        && value.y.is_finite()
        && value.width.is_finite()
        && value.width > 0.0
        && value.height.is_finite()
        && value.height > 0.0
}

fn valid_content(content: &PersistedContentEnvelopeDto) -> bool {
    content.schema_version == 1 && !content.codec.trim().is_empty() && content.codec_version > 0
}

fn valid_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.encode_utf16().count() <= maximum
}

fn valid_camera(value: &CanvasCameraDto) -> bool {
    value.x.is_finite() && value.y.is_finite() && value.zoom.is_finite() && value.zoom > 0.0
}

fn valid_window_size(value: &CanvasWindowSizeDto) -> bool {
    value.width.is_finite() && value.width > 0.0 && value.height.is_finite() && value.height > 0.0
}

fn valid_definition(definition: &PersistedCanvasWindowDefinitionDto, window_id: &str) -> bool {
    definition.id == window_id && valid_content(&definition.content)
}

fn valid_state(state: &PersistedCanvasStateDto) -> bool {
    if state.version != 1
        || !valid_camera(&state.camera)
        || !state.window_size_by_type.values().all(valid_window_size)
        || state.next_item_id == 0
        || state.next_z_index == 0
    {
        return false;
    }
    let mut ids = HashSet::new();
    for window in &state.windows {
        if !valid_text(&window.id, 128)
            || !ids.insert(window.id.as_str())
            || !valid_rect(&window.bounds)
            || window.z_index == 0
            || !valid_definition(&window.definition, &window.id)
        {
            return false;
        }
    }
    state
        .maximized_window_id
        .as_ref()
        .is_none_or(|id| ids.contains(id.as_str()))
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

    fn state_value() -> Value {
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

    fn state() -> PersistedCanvasStateDto {
        serde_json::from_value(state_value()).unwrap()
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
    fn rejects_save_request_without_required_active_id() {
        let valid = serde_json::from_value::<SaveCanvasDocument>(json!({
            "schemaVersion":2,
            "expectedRevision":0,
            "activeId":null,
            "canvases":[]
        }))
        .unwrap();
        assert_eq!(valid.active_id, None);

        let error = serde_json::from_value::<SaveCanvasDocument>(json!({
            "schemaVersion":2,
            "expectedRevision":0,
            "canvases":[]
        }))
        .unwrap_err();

        assert!(error.to_string().contains("activeId"));
    }

    #[test]
    fn nested_wire_state_requires_nullable_fields_and_rejects_null_window_sizes() {
        let mut missing_maximized = state_value();
        missing_maximized
            .as_object_mut()
            .unwrap()
            .remove("maximizedWindowId");
        let error =
            serde_json::from_value::<PersistedCanvasStateDto>(missing_maximized).unwrap_err();
        assert!(error.to_string().contains("maximizedWindowId"));

        let mut null_window_size = state_value();
        null_window_size["windowSizeByType"]["viewer"] = Value::Null;
        assert!(serde_json::from_value::<PersistedCanvasStateDto>(null_window_size).is_err());
    }

    #[test]
    fn stored_document_missing_active_id_is_rejected_without_mutation() {
        let database = database("missing-active-id");
        let raw = r#"{"schemaVersion":2,"revision":0,"canvases":[]}"#;
        insert_raw(&database, raw);

        let error = load(&database, "library").unwrap_err();

        assert!(error.1.contains("was preserved"));
        assert!(error.1.contains("activeId"));
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
        assert!(serde_json::from_value::<CanvasDocument>(unexpected_host_field).is_err());

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
        let mut canvas_state = state_value();
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
                state: serde_json::from_value(canvas_state).unwrap(),
                updated_at: 1,
            }],
        };

        validate_document(&document).unwrap();
    }

    #[test]
    fn removing_content_host_repairs_maximized_window() {
        let mut canvas_state = state_value();
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
