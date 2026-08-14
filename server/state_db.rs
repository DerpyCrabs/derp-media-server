use crate::{
    config::Config,
    error::{AppError, AppResult},
};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior, params};
use serde_json::{Map, Value, json};
use std::{
    cmp::Ordering,
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const CURRENT_SCHEMA_VERSION: i64 = 1;
const MASTER_SCHEMA_VERSION: i64 = 3;
const BACKUP_DIRECTORY: &str = "state-db-backups";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StateDocument {
    SettingsV1,
    PlaybackStatsV1,
    CanvasV2,
}

impl StateDocument {
    pub const fn name(self) -> &'static str {
        match self {
            Self::SettingsV1 => "settings.v1",
            Self::PlaybackStatsV1 => "playback-stats.v1",
            Self::CanvasV2 => "canvas.v2",
        }
    }
}

pub fn database(config: &Config) -> PathBuf {
    config.data_path.join("app.sqlite3")
}

fn error(error: impl std::fmt::Display) -> AppError {
    AppError::internal(error.to_string())
}

pub fn connection(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppError::io)?;
    }
    let connection = Connection::open(path).map_err(error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(error)?;
    connection
        .execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(error)?;
    Ok(connection)
}

fn table_names(connection: &Connection) -> Result<Vec<String>, String> {
    connection
        .prepare(
            "SELECT name FROM sqlite_schema
             WHERE type='table' AND name NOT LIKE 'sqlite_%'
             ORDER BY name",
        )
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn validate_tables(connection: &Connection, expected: &[&str]) -> Result<(), String> {
    let actual = table_names(connection)?;
    let mut expected = expected
        .iter()
        .map(|name| (*name).to_string())
        .collect::<Vec<_>>();
    expected.sort();
    if actual != expected {
        return Err(format!(
            "unexpected tables: found {}, expected {}",
            actual.join(", "),
            expected.join(", ")
        ));
    }
    let extra_objects: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_schema
             WHERE type IN ('view', 'trigger') OR (type='index' AND sql IS NOT NULL)",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if extra_objects != 0 {
        return Err("unexpected indexes, triggers, or views".into());
    }
    Ok(())
}

fn validate_columns(connection: &Connection, table: &str, expected: &str) -> Result<(), String> {
    let actual: Option<String> = connection
        .query_row(
            "SELECT group_concat(
               name || ':' || type || ':' || \"notnull\" || ':' || pk || ':' ||
               coalesce(dflt_value, '') || ':' || hidden,
               '|'
             )
             FROM (SELECT * FROM pragma_table_xinfo(?1) ORDER BY cid)",
            [table],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if actual.as_deref() != Some(expected) {
        return Err(format!("unexpected {table} columns"));
    }
    Ok(())
}

fn validate_integrity(connection: &Connection) -> Result<(), String> {
    let result: String = connection
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if result != "ok" {
        return Err(format!("database integrity check failed: {result}"));
    }
    Ok(())
}

fn normalized_schema_sql(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn validate_current_schema(connection: &Connection) -> Result<(), String> {
    validate_integrity(connection)?;
    validate_tables(
        connection,
        &[
            "app_preferences",
            "reader_state",
            "state_documents",
            "state_schema",
        ],
    )?;
    validate_columns(
        connection,
        "state_schema",
        "id:INTEGER:0:1::0|version:INTEGER:1:0::0|applied_at:INTEGER:1:0::0",
    )?;
    validate_columns(
        connection,
        "state_documents",
        "kind:TEXT:1:1::0|library_key:TEXT:1:2::0|value_json:TEXT:1:0::0|updated_at:INTEGER:1:0::0",
    )?;
    let state_documents_sql: String = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type='table' AND name='state_documents'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let expected_state_documents_sql = normalized_schema_sql(
        "CREATE TABLE state_documents (
           kind TEXT NOT NULL CHECK(kind IN ('settings.v1', 'playback-stats.v1', 'canvas.v2')),
           library_key TEXT NOT NULL,
           value_json TEXT NOT NULL,
           updated_at INTEGER NOT NULL,
           PRIMARY KEY(kind, library_key)
         )",
    );
    if normalized_schema_sql(&state_documents_sql) != expected_state_documents_sql {
        return Err("unexpected state_documents definition".into());
    }
    let unknown_documents: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM state_documents
             WHERE kind NOT IN ('settings.v1', 'playback-stats.v1', 'canvas.v2')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if unknown_documents != 0 {
        return Err("unknown state document kinds in current schema".into());
    }
    validate_columns(
        connection,
        "reader_state",
        "path:TEXT:0:1::0|state_json:TEXT:1:0::0|fingerprint:TEXT:1:0::0|revision:INTEGER:1:0::0|updated_at:INTEGER:1:0::0",
    )?;
    validate_columns(
        connection,
        "app_preferences",
        "id:INTEGER:0:1::0|state_json:TEXT:1:0::0|revision:INTEGER:1:0::0|updated_at:INTEGER:1:0::0",
    )?;
    let rows = connection
        .prepare("SELECT id, version, applied_at FROM state_schema ORDER BY id")
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if rows.len() != 1 || rows[0].0 != 1 || rows[0].1 != CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "unsupported state_schema rows; expected id 1 at version {CURRENT_SCHEMA_VERSION}"
        ));
    }
    Ok(())
}

fn validate_master_v3_schema(connection: &Connection) -> Result<(), String> {
    validate_integrity(connection)?;
    validate_tables(
        connection,
        &[
            "app_preferences",
            "legacy_state_import",
            "reader_state",
            "schema_migrations",
            "state_documents",
        ],
    )?;
    validate_columns(
        connection,
        "schema_migrations",
        "version:INTEGER:0:1::0|applied_at:INTEGER:1:0::0",
    )?;
    validate_columns(
        connection,
        "state_documents",
        "kind:TEXT:1:1::0|library_key:TEXT:1:2::0|value_json:TEXT:1:0::0|updated_at:INTEGER:1:0::0",
    )?;
    validate_columns(
        connection,
        "legacy_state_import",
        "version:INTEGER:0:1::0|imported_at:INTEGER:1:0::0",
    )?;
    validate_columns(
        connection,
        "reader_state",
        "scope:TEXT:1:1::0|path:TEXT:1:2::0|state_json:TEXT:1:0::0|fingerprint:TEXT:1:0::0|revision:INTEGER:1:0::0|updated_at:INTEGER:1:0::0",
    )?;
    validate_columns(
        connection,
        "app_preferences",
        "scope:TEXT:0:1::0|state_json:TEXT:1:0::0|revision:INTEGER:1:0::0|updated_at:INTEGER:1:0::0",
    )?;

    let migrations = connection
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if migrations != [1, 2, MASTER_SCHEMA_VERSION] {
        return Err(format!("unexpected schema_migrations rows: {migrations:?}"));
    }
    let legacy_imports = connection
        .prepare("SELECT version FROM legacy_state_import ORDER BY version")
        .map_err(|error| error.to_string())?
        .query_map([], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if legacy_imports != [1] {
        return Err(format!(
            "unexpected legacy_state_import rows: {legacy_imports:?}"
        ));
    }

    let unknown_documents: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM state_documents
             WHERE kind NOT IN ('settings', 'stats', 'canvases')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if unknown_documents != 0 {
        return Err("unknown state document kinds in master schema".into());
    }
    let unsupported_reader_scopes: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM reader_state
             WHERE scope != 'admin' AND scope NOT LIKE 'share:%'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let unsupported_preference_scopes: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM app_preferences WHERE scope != 'admin'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if unsupported_reader_scopes != 0 || unsupported_preference_scopes != 0 {
        return Err("unsupported non-admin state scopes in master schema".into());
    }
    Ok(())
}

#[derive(Clone)]
struct MasterCanvasRecord {
    id: String,
    writer_id: String,
    updated_at: u64,
    deleted: bool,
    name: String,
    state: Value,
}

struct MigratedDocument {
    kind: StateDocument,
    library_key: String,
    value_json: String,
    updated_at: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum MasterResourceTarget {
    Filesystem {
        root_id: &'static str,
        path: String,
    },
    Hermes {
        kind: &'static str,
        id: Option<String>,
    },
}

fn exact_keys(object: &Map<String, Value>, required: &[&str], optional: &[&str]) -> bool {
    required.iter().all(|key| object.contains_key(*key))
        && object
            .keys()
            .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str()))
}

fn valid_master_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.encode_utf16().count() <= maximum
}

fn master_path(value: &Value) -> Result<String, String> {
    let path = value
        .as_str()
        .ok_or_else(|| "expected filesystem path".to_string())?;
    if path.contains(['\0', '\n', '\r']) {
        return Err("invalid filesystem path".into());
    }
    let path = path.replace('\\', "/");
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err("invalid filesystem path".into()),
            part => parts.push(part),
        }
    }
    Ok(parts.join("/"))
}

fn valid_hermes_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value != "."
        && value != ".."
        && !value.contains(['/', '\\', '%'])
        && !value.chars().any(char::is_control)
}

fn master_resource_target(path: &str) -> Result<MasterResourceTarget, String> {
    match path {
        "Favorites" => Ok(MasterResourceTarget::Filesystem {
            root_id: "application-collections",
            path: "favorites".into(),
        }),
        "Most Played" => Ok(MasterResourceTarget::Filesystem {
            root_id: "application-collections",
            path: "most-played".into(),
        }),
        "Hermes Sessions" => Ok(MasterResourceTarget::Hermes {
            kind: "root",
            id: None,
        }),
        "Hermes Sessions/archived" => Ok(MasterResourceTarget::Hermes {
            kind: "archived",
            id: None,
        }),
        path if path.starts_with("Hermes Sessions/project/") => {
            let id = &path["Hermes Sessions/project/".len()..];
            if !valid_hermes_opaque_id(id) {
                return Err("invalid Hermes project path".into());
            }
            Ok(MasterResourceTarget::Hermes {
                kind: "project",
                id: Some(id.into()),
            })
        }
        path if path.starts_with("Hermes Sessions/session/") => {
            let id = &path["Hermes Sessions/session/".len()..];
            if !valid_hermes_opaque_id(id) {
                return Err("invalid Hermes session path".into());
            }
            Ok(MasterResourceTarget::Hermes {
                kind: "session",
                id: Some(id.into()),
            })
        }
        path if path.starts_with("Hermes Sessions/") => {
            Err("unsupported Hermes virtual path".into())
        }
        path => Ok(MasterResourceTarget::Filesystem {
            root_id: "configured-default",
            path: path.into(),
        }),
    }
}

fn target_from_value(value: &Value) -> Result<MasterResourceTarget, String> {
    master_resource_target(&master_path(value)?)
}

fn filesystem_resource_key(root_id: &str, path: &str) -> Value {
    json!({
        "provider": "filesystem",
        "id": format!("v1:{}:{root_id}{path}", root_id.len()),
    })
}

fn hermes_resource_key(kind: &str, id: Option<&str>) -> Value {
    json!({
        "provider": "hermes",
        "id": format!("v1:{}:{kind}{}", kind.len(), id.unwrap_or_default()),
    })
}

fn target_resource_key(target: &MasterResourceTarget) -> Value {
    match target {
        MasterResourceTarget::Filesystem { root_id, path } => {
            filesystem_resource_key(root_id, path)
        }
        MasterResourceTarget::Hermes { kind, id } => hermes_resource_key(kind, id.as_deref()),
    }
}

fn valid_rect(value: &Value) -> bool {
    ["x", "y", "width", "height"].iter().all(|key| {
        value
            .get(key)
            .and_then(Value::as_f64)
            .is_some_and(f64::is_finite)
    }) && value
        .get("width")
        .and_then(Value::as_f64)
        .is_some_and(|part| part > 0.0)
        && value
            .get("height")
            .and_then(Value::as_f64)
            .is_some_and(|part| part > 0.0)
}

fn renderer_for_master_viewer(
    definition: &Map<String, Value>,
    initial: &Map<String, Value>,
) -> Result<&'static str, String> {
    if let Some(reader_kind) = initial.get("readerKind").filter(|value| !value.is_null()) {
        return match reader_kind.as_str() {
            Some("folder") => Ok("folder-reader"),
            Some("pdf") => Ok("pdf-reader"),
            Some("book") => Ok("book-reader"),
            _ => Err("invalid Canvas reader kind".into()),
        };
    }
    Ok(match definition.get("iconType").and_then(Value::as_str) {
        Some("audio") => "audio-player",
        Some("video") => "video-player",
        Some("image") => "image-viewer",
        Some("text") => "text-viewer",
        Some("pdf") => "pdf-reader",
        Some("book") => "book-reader",
        Some("folder") => "folder-reader",
        _ => "unsupported-file",
    })
}

fn filesystem_envelope(payload: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "codec": "filesystem.content",
        "codecVersion": 1,
        "payload": payload,
    })
}

fn hermes_envelope(payload: Value) -> Value {
    json!({
        "schemaVersion": 1,
        "codec": "hermes.content",
        "codecVersion": 1,
        "payload": payload,
    })
}

fn explorer_envelope(window_id: &str, target: &MasterResourceTarget) -> Result<Value, String> {
    match target {
        MasterResourceTarget::Filesystem { root_id, path } => Ok(filesystem_envelope(json!({
            "kind": "explorer",
            "id": window_id,
            "address": {"rootId": root_id, "path": path},
        }))),
        MasterResourceTarget::Hermes { kind, id } if *kind != "session" => {
            Ok(hermes_envelope(json!({
                "kind": "explorer",
                "id": window_id,
                "location": hermes_resource_key(kind, id.as_deref()),
            })))
        }
        MasterResourceTarget::Hermes { kind, id } => Ok(hermes_envelope(json!({
            "kind": "resource",
            "id": window_id,
            "resource": hermes_resource_key(kind, id.as_deref()),
            "renderer": "hermes.chat",
        }))),
    }
}

fn migrate_master_definition(value: &Value, window_id: &str) -> Result<Value, String> {
    let definition = value
        .as_object()
        .ok_or_else(|| "invalid Canvas window definition".to_string())?;
    if !exact_keys(
        definition,
        &["id", "type", "title", "source", "initialState"],
        &[
            "iconName",
            "iconPath",
            "iconType",
            "iconIsVirtual",
            "tabGroupId",
            "openedFromWindowId",
            "tabPinned",
            "layout",
            "fileOpenTargetWindowId",
            "hermes",
        ],
    ) || definition.get("id").and_then(Value::as_str) != Some(window_id)
        || !definition.get("title").is_some_and(Value::is_string)
        || !definition.get("source").is_some_and(|source| {
            source
                .as_object()
                .is_some_and(|source| source.get("kind").and_then(Value::as_str) == Some("local"))
        })
    {
        return Err("invalid Canvas window definition".into());
    }
    let initial = definition
        .get("initialState")
        .and_then(Value::as_object)
        .ok_or_else(|| "invalid Canvas initial state".to_string())?;
    let content = match definition.get("type").and_then(Value::as_str) {
        Some("browser") => {
            let target = initial
                .get("dir")
                .map(target_from_value)
                .transpose()?
                .unwrap_or_else(|| MasterResourceTarget::Filesystem {
                    root_id: "configured-default",
                    path: String::new(),
                });
            explorer_envelope(window_id, &target)?
        }
        Some("viewer") => {
            let target = initial
                .get("viewing")
                .or_else(|| initial.get("playing"))
                .ok_or_else(|| "Canvas viewer has no target".to_string())
                .and_then(target_from_value)?;
            if let MasterResourceTarget::Hermes {
                kind: "session",
                id,
            } = &target
            {
                hermes_envelope(json!({
                    "kind": "resource",
                    "id": window_id,
                    "resource": hermes_resource_key("session", id.as_deref()),
                    "renderer": "hermes.chat",
                }))
            } else {
                let MasterResourceTarget::Filesystem { root_id, path } = &target else {
                    return Err("Canvas viewer targets unsupported virtual resource".into());
                };
                let renderer = renderer_for_master_viewer(definition, initial)?;
                let context = initial.get("dir").map(target_from_value).transpose()?;
                let mut payload = json!({
                    "kind": "resource",
                    "id": window_id,
                    "address": {"rootId": root_id, "path": path},
                    "renderer": renderer,
                });
                if let Some(MasterResourceTarget::Filesystem { root_id, path }) = context {
                    payload["contextAddress"] = json!({"rootId": root_id, "path": path});
                }
                filesystem_envelope(payload)
            }
        }
        Some("hermes") => {
            let hermes = definition
                .get("hermes")
                .and_then(Value::as_object)
                .ok_or_else(|| "invalid Canvas Hermes state".to_string())?;
            let session_id = hermes
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| "Canvas Hermes window has no durable session".to_string())?;
            let mut payload = json!({
                "kind": "chat",
                "id": window_id,
                "sessionId": session_id,
                "title": definition["title"],
            });
            if let Some(cwd) = hermes.get("cwd") {
                if !cwd.is_null() && !cwd.is_string() {
                    return Err("invalid Canvas Hermes cwd".into());
                }
                payload["cwd"] = cwd.clone();
            }
            if let Some(read_only) = hermes.get("readOnly") {
                if !read_only.is_boolean() {
                    return Err("invalid Canvas Hermes read-only state".into());
                }
                payload["readOnly"] = read_only.clone();
            }
            hermes_envelope(payload)
        }
        _ => return Err("invalid Canvas window type".into()),
    };
    let mut migrated = json!({
        "id": window_id,
        "title": definition["title"],
        "content": content,
    });
    if let Some(icon_name) = definition.get("iconName") {
        if !icon_name.is_null() && !icon_name.is_string() {
            return Err("invalid Canvas icon name".into());
        }
        migrated["iconName"] = icon_name.clone();
    }
    Ok(migrated)
}

fn recovery_definition(value: &Value, window_id: &str, reason: String) -> Value {
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or(window_id);
    let mut migrated = json!({
        "id": window_id,
        "title": title,
        "content": {
            "schemaVersion": 1,
            "codec": "master-v3.recovery",
            "codecVersion": 1,
            "payload": {"reason": reason, "definition": value},
        },
    });
    if let Some(icon_name) = value
        .get("iconName")
        .filter(|icon| icon.is_null() || icon.is_string())
    {
        migrated["iconName"] = icon_name.clone();
    }
    migrated
}

fn migrate_master_pin(value: &Value) -> Result<Value, String> {
    let pin = value
        .as_object()
        .ok_or_else(|| "invalid workspace taskbar pin".to_string())?;
    let id = pin
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "invalid workspace taskbar pin id".to_string())?;
    let title = pin
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "invalid workspace taskbar pin title".to_string())?;
    if pin.get("isDirectory").and_then(Value::as_bool).is_none()
        || pin
            .get("source")
            .and_then(Value::as_object)
            .and_then(|source| source.get("kind"))
            .and_then(Value::as_str)
            != Some("local")
    {
        return Err("invalid workspace taskbar pin source".into());
    }
    let path = pin
        .get("path")
        .ok_or_else(|| "workspace taskbar pin has no path".to_string())
        .and_then(master_path)?;
    if path.is_empty() {
        return Err("workspace taskbar pin path is empty".into());
    }
    let target = master_resource_target(&path)?;
    let mut migrated = json!({
        "id": id,
        "resource": target_resource_key(&target),
        "title": title,
    });
    if let Some(icon) = pin.get("customIconName").filter(|value| !value.is_null()) {
        if !icon.is_string() {
            return Err("invalid workspace taskbar pin icon".into());
        }
        migrated["customIconName"] = icon.clone();
    }
    Ok(migrated)
}

fn migrate_master_pins(value: Option<&Value>) -> Result<Value, String> {
    let Some(value) = value else {
        return Ok(Value::Array(Vec::new()));
    };
    let pins = value
        .as_array()
        .ok_or_else(|| "workspace taskbar pins are not an array".to_string())?;
    Ok(Value::Array(
        pins.iter()
            .map(migrate_master_pin)
            .collect::<Result<Vec<_>, _>>()?,
    ))
}

fn migrate_master_preset_window(value: &Value) -> Result<Value, String> {
    let window = value
        .as_object()
        .ok_or_else(|| "invalid workspace preset window".to_string())?;
    let id = window
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| valid_master_text(value, 128))
        .ok_or_else(|| "invalid workspace preset window id".to_string())?;
    let normalized = normalized_master_canvas_definition(value, id)
        .ok_or_else(|| "invalid workspace preset window definition".to_string())?;
    let mut migrated = migrate_master_definition(&normalized, id)
        .unwrap_or_else(|reason| recovery_definition(value, id, reason));
    for field in [
        "tabGroupId",
        "openedFromWindowId",
        "tabPinned",
        "layout",
        "fileOpenTargetWindowId",
    ] {
        if let Some(value) = window.get(field) {
            migrated[field] = value.clone();
        }
    }
    Ok(migrated)
}

fn migrate_master_snapshot(value: &Value) -> Result<Value, String> {
    let snapshot = value
        .as_object()
        .ok_or_else(|| "invalid workspace preset snapshot".to_string())?;
    let windows = snapshot
        .get("windows")
        .and_then(Value::as_array)
        .ok_or_else(|| "workspace preset has no windows".to_string())?
        .iter()
        .map(migrate_master_preset_window)
        .collect::<Result<Vec<_>, _>>()?;
    if windows.is_empty() {
        return Err("workspace preset has no durable windows".into());
    }
    let window_ids = windows
        .iter()
        .filter_map(|window| window.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let active_window_id = snapshot
        .get("activeWindowId")
        .filter(|value| value.is_null() || value.is_string())
        .cloned()
        .unwrap_or_else(|| json!(window_ids.last().copied()));
    let active_tab_map = snapshot
        .get("activeTabMap")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    let next_window_id = snapshot
        .get("nextWindowId")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .unwrap_or(windows.len() as u64 + 1);
    let pins = migrate_master_pins(snapshot.get("pinnedTaskbarItems"))?;
    let mut migrated = json!({
        "windows": windows,
        "activeWindowId": active_window_id,
        "activeTabMap": active_tab_map,
        "nextWindowId": next_window_id,
        "pinnedTaskbarItems": pins,
    });
    for field in [
        "browserTabTitle",
        "browserTabIcon",
        "browserTabIconColor",
        "tabGroupSplits",
        "fileOpenTarget",
    ] {
        if let Some(value) = snapshot.get(field) {
            migrated[field] = value.clone();
        }
    }
    Ok(migrated)
}

fn fallback_preset_timestamp(updated_at: i64) -> String {
    DateTime::<Utc>::from_timestamp_millis(updated_at)
        .unwrap_or(DateTime::UNIX_EPOCH)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn migrate_master_preset(value: &Value, updated_at: i64) -> Result<Value, String> {
    let preset = value
        .as_object()
        .ok_or_else(|| "invalid workspace layout preset".to_string())?;
    let id = preset
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "invalid workspace layout preset id".to_string())?;
    let name = preset
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| valid_master_text(value, 120))
        .ok_or_else(|| "invalid workspace layout preset name".to_string())?;
    if preset.get("scope").and_then(Value::as_str) != Some("admin") {
        return Err("invalid workspace layout preset scope".into());
    }
    let created_at = preset
        .get("createdAt")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| fallback_preset_timestamp(updated_at));
    if DateTime::parse_from_rfc3339(&created_at).is_err() {
        return Err("invalid workspace layout preset creation time".into());
    }
    let mut migrated = json!({
        "id": id,
        "name": name,
        "snapshot": migrate_master_snapshot(
            preset
                .get("snapshot")
                .ok_or_else(|| "workspace layout preset has no snapshot".to_string())?,
        )?,
        "createdAt": created_at,
    });
    if let Some(updated_at) = preset.get("updatedAt") {
        let updated_at = updated_at
            .as_str()
            .filter(|value| DateTime::parse_from_rfc3339(value).is_ok())
            .ok_or_else(|| "invalid workspace layout preset update time".to_string())?;
        migrated["updatedAt"] = json!(updated_at);
    }
    Ok(migrated)
}

fn migrate_master_settings_document(value: &str, updated_at: i64) -> Result<String, String> {
    let mut settings: Value = serde_json::from_str(value).map_err(|error| error.to_string())?;
    let settings_object = settings
        .as_object_mut()
        .ok_or_else(|| "settings document is not an object".to_string())?;
    let pins = migrate_master_pins(settings_object.get("workspaceTaskbarPins"))?;
    let presets = match settings_object.get("workspaceLayoutPresets") {
        None => Value::Array(Vec::new()),
        Some(value) => Value::Array(
            value
                .as_array()
                .ok_or_else(|| "workspace layout presets are not an array".to_string())?
                .iter()
                .map(|preset| migrate_master_preset(preset, updated_at))
                .collect::<Result<Vec<_>, _>>()?,
        ),
    };
    if crate::workspace_persistence::workspace_pins(&pins) != pins {
        return Err("migrated workspace taskbar pins are invalid".into());
    }
    if crate::workspace_persistence::presets(&presets) != presets {
        return Err("migrated workspace layout presets are invalid".into());
    }
    settings_object.insert("workspaceTaskbarPins".into(), pins);
    settings_object.insert("workspaceLayoutPresets".into(), presets);
    serde_json::to_string(&settings).map_err(|error| error.to_string())
}

fn normalized_master_canvas_definition(value: &Value, window_id: &str) -> Option<Value> {
    let definition = value.as_object()?;
    if definition
        .get("source")?
        .get("kind")
        .and_then(Value::as_str)
        != Some("local")
    {
        return None;
    }
    let window_type = definition.get("type")?.as_str()?;
    if !matches!(window_type, "browser" | "viewer" | "hermes") {
        return None;
    }
    let initial = definition
        .get("initialState")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut normalized_initial = Map::new();
    for key in ["dir", "viewing", "playing"] {
        if let Some(value) = initial.get(key).filter(|value| value.is_string()) {
            normalized_initial.insert(key.into(), value.clone());
        }
    }
    if window_type == "viewer"
        && !normalized_initial.contains_key("viewing")
        && !normalized_initial.contains_key("playing")
        && let Some(value) = definition.get("iconPath").filter(|value| value.is_string())
    {
        normalized_initial.insert("viewing".into(), value.clone());
    }
    if window_type == "viewer"
        && let Some(value) = initial
            .get("readerKind")
            .filter(|value| matches!(value.as_str(), Some("pdf" | "folder" | "book")))
    {
        normalized_initial.insert("readerKind".into(), value.clone());
    }
    let mut normalized = json!({
        "id": window_id,
        "type": window_type,
        "title": definition
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(window_id),
        "source": {"kind": "local"},
        "initialState": normalized_initial,
    });
    if let Some(icon_name) = definition
        .get("iconName")
        .filter(|value| value.is_null() || value.is_string())
    {
        normalized["iconName"] = icon_name.clone();
    }
    if let Some(icon_type) = definition.get("iconType").filter(|value| value.is_string()) {
        normalized["iconType"] = icon_type.clone();
    }
    if window_type == "hermes" {
        let hermes = definition.get("hermes")?.as_object()?;
        let session_id = hermes.get("sessionId")?.as_str()?;
        let mut normalized_hermes = json!({
            "sessionId": session_id,
            "readOnly": hermes
                .get("readOnly")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
        if let Some(cwd) = hermes
            .get("cwd")
            .filter(|value| value.is_null() || value.is_string())
        {
            normalized_hermes["cwd"] = cwd.clone();
        }
        normalized["hermes"] = normalized_hermes;
    }
    Some(normalized)
}

fn finite_number(value: Option<&Value>, fallback: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
}

fn canvas_item_number(id: &str) -> u64 {
    id.strip_prefix("canvas-window-")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn validate_master_canvas_definition(value: &Value) -> Result<(), String> {
    let definition = value
        .as_object()
        .ok_or_else(|| "invalid Canvas window definition".to_string())?;
    let window_type = definition
        .get("type")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "browser" | "viewer" | "hermes"))
        .ok_or_else(|| "invalid Canvas window type".to_string())?;
    if definition
        .get("source")
        .and_then(Value::as_object)
        .and_then(|source| source.get("kind"))
        .and_then(Value::as_str)
        != Some("local")
    {
        return Err("invalid Canvas window source".into());
    }
    if window_type == "hermes"
        && definition
            .get("hermes")
            .and_then(Value::as_object)
            .and_then(|hermes| hermes.get("sessionId"))
            .and_then(Value::as_str)
            .is_none()
    {
        return Err("invalid Canvas Hermes state".into());
    }
    for value in definition
        .get("iconPath")
        .into_iter()
        .chain(
            definition
                .get("initialState")
                .and_then(Value::as_object)
                .into_iter()
                .flat_map(|initial| {
                    ["dir", "viewing", "playing"]
                        .into_iter()
                        .filter_map(|key| initial.get(key))
                }),
        )
        .filter(|value| value.is_string())
    {
        master_path(value)?;
    }
    Ok(())
}

fn migrate_master_canvas_state(value: &Value) -> Result<Value, String> {
    let state = value
        .as_object()
        .ok_or_else(|| "invalid Canvas state".to_string())?;
    if state.get("version").and_then(Value::as_u64) != Some(1)
        || !state.get("camera").is_some_and(Value::is_object)
    {
        return Err("invalid Canvas state".into());
    }
    let windows = state
        .get("windows")
        .and_then(Value::as_array)
        .ok_or_else(|| "invalid Canvas windows".to_string())?;
    let mut ids = std::collections::HashSet::<String>::new();
    let mut migrated_windows = Vec::with_capacity(windows.len());
    for window in windows {
        let Some(window) = window.as_object() else {
            return Err("invalid Canvas window".into());
        };
        let Some(id) = window.get("id").and_then(Value::as_str) else {
            return Err("invalid Canvas window id".into());
        };
        if !window.get("bounds").is_some_and(valid_rect) {
            return Err("invalid Canvas window placement".into());
        }
        let raw_definition = window
            .get("definition")
            .ok_or_else(|| "Canvas window has no definition".to_string())?;
        validate_master_canvas_definition(raw_definition)?;
        if !valid_master_text(id, 128) || ids.contains(id) {
            continue;
        }
        let normalized = normalized_master_canvas_definition(raw_definition, id)
            .ok_or_else(|| "invalid Canvas window definition".to_string())?;
        let definition = migrate_master_definition(&normalized, id)
            .unwrap_or_else(|reason| recovery_definition(raw_definition, id, reason));
        ids.insert(id.into());
        let bounds = json!({
            "x": window["bounds"]["x"],
            "y": window["bounds"]["y"],
            "width": window["bounds"]["width"],
            "height": window["bounds"]["height"],
        });
        let z_index = finite_number(window.get("zIndex"), 1.0).floor().max(1.0) as u64;
        migrated_windows.push(json!({
            "id": id,
            "definition": definition,
            "bounds": bounds,
            "zIndex": z_index,
        }));
    }
    let maximized = state
        .get("maximizedWindowId")
        .and_then(Value::as_str)
        .filter(|id| ids.contains(*id))
        .map_or(Value::Null, |id| Value::String(id.into()));
    let camera = state["camera"].as_object().expect("checked Canvas camera");
    let camera = json!({
        "x": finite_number(camera.get("x"), 0.0),
        "y": finite_number(camera.get("y"), 0.0),
        "zoom": finite_number(camera.get("zoom"), 1.0).clamp(0.08, 1.0),
    });
    let sizes = state
        .get("windowSizeByType")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let size_keys = [
        "browser",
        "viewer",
        "hermes",
        "viewer-audio",
        "viewer-video",
        "viewer-image",
        "viewer-text",
        "viewer-pdf",
        "viewer-other",
    ];
    let mut migrated_sizes = Map::new();
    for key in size_keys {
        let Some(size) = sizes.get(key).and_then(Value::as_object) else {
            continue;
        };
        let width = finite_number(size.get("width"), 0.0);
        let height = finite_number(size.get("height"), 0.0);
        if width <= 0.0 || height <= 0.0 {
            continue;
        }
        migrated_sizes.insert(
            if key == "hermes" { "integration" } else { key }.into(),
            json!({
                "width": (width / 32.0).round().mul_add(32.0, 0.0).max(320.0),
                "height": (height / 32.0).round().mul_add(32.0, 0.0).max(224.0),
            }),
        );
    }
    let inferred_item = ids
        .iter()
        .map(|id| canvas_item_number(id))
        .max()
        .unwrap_or(0)
        + 1;
    let inferred_z = migrated_windows
        .iter()
        .filter_map(|window| window.get("zIndex").and_then(Value::as_u64))
        .max()
        .unwrap_or(0)
        + 1;
    let next_item = finite_number(state.get("nextItemId"), migrated_windows.len() as f64 + 1.0)
        .floor()
        .max(inferred_item as f64) as u64;
    let next_z = finite_number(state.get("nextZIndex"), migrated_windows.len() as f64 + 1.0)
        .floor()
        .max(inferred_z as f64) as u64;
    Ok(json!({
        "version": 1,
        "windows": migrated_windows,
        "maximizedWindowId": maximized,
        "camera": camera,
        "windowSizeByType": migrated_sizes,
        "nextItemId": next_item.max(1),
        "nextZIndex": next_z.max(1),
    }))
}

fn master_canvas_record(value: &Value) -> Result<MasterCanvasRecord, String> {
    let record = value
        .as_object()
        .ok_or_else(|| "invalid Canvas record".to_string())?;
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| valid_master_text(value, 128))
        .ok_or_else(|| "invalid Canvas id".to_string())?;
    let writer_id = record
        .get("writerId")
        .and_then(Value::as_str)
        .filter(|value| valid_master_text(value, 128))
        .ok_or_else(|| "invalid Canvas writer id".to_string())?;
    let name = record
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| valid_master_text(value, 120))
        .ok_or_else(|| "invalid Canvas name".to_string())?;
    let updated_at = record
        .get("updatedAt")
        .and_then(Value::as_u64)
        .ok_or_else(|| "invalid Canvas timestamp".to_string())?;
    let deleted = record
        .get("deleted")
        .and_then(Value::as_bool)
        .ok_or_else(|| "invalid Canvas deletion state".to_string())?;
    let state = record.get("state").cloned().unwrap_or(Value::Null);
    if deleted {
        if !state.is_null() {
            return Err("deleted Canvas contains state".into());
        }
    } else if state.is_null() {
        return Err("live Canvas has no state".into());
    }
    Ok(MasterCanvasRecord {
        id: id.into(),
        writer_id: writer_id.into(),
        updated_at,
        deleted,
        name: name.trim().into(),
        state,
    })
}

fn compare_master_records(left: &MasterCanvasRecord, right: &MasterCanvasRecord) -> Ordering {
    left.updated_at
        .cmp(&right.updated_at)
        .then_with(|| left.writer_id.cmp(&right.writer_id))
}

fn migrate_master_canvas_document(value: &str) -> Result<String, String> {
    let raw: Value = serde_json::from_str(value).map_err(|error| error.to_string())?;
    let records = raw
        .as_array()
        .ok_or_else(|| "expected Canvas record array".to_string())?;
    let mut winners = HashMap::<String, MasterCanvasRecord>::new();
    for value in records {
        let candidate = master_canvas_record(value)?;
        if winners
            .get(&candidate.id)
            .is_none_or(|current| compare_master_records(&candidate, current).is_gt())
        {
            winners.insert(candidate.id.clone(), candidate);
        }
    }
    let mut live = winners
        .into_values()
        .filter(|record| !record.deleted)
        .collect::<Vec<_>>();
    live.sort_by(|left, right| compare_master_records(right, left));
    let active_id = live.first().map(|record| record.id.clone());
    let canvases = live
        .into_iter()
        .map(|record| {
            Ok(json!({
                "id": record.id,
                "name": record.name,
                "state": migrate_master_canvas_state(&record.state)?,
                "updatedAt": record.updated_at,
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    serde_json::to_string(&json!({
        "schemaVersion": 2,
        "revision": 1,
        "activeId": active_id,
        "canvases": canvases,
    }))
    .map_err(|error| error.to_string())
}

fn migrated_master_canvas_documents(
    connection: &Connection,
) -> Result<Vec<MigratedDocument>, String> {
    let rows = connection
        .prepare(
            "SELECT library_key, value_json, updated_at FROM state_documents
             WHERE kind='canvases' ORDER BY library_key",
        )
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    rows.into_iter()
        .map(|(library_key, value_json, updated_at)| {
            let value_json = migrate_master_canvas_document(&value_json)
                .map_err(|error| format!("Invalid Canvas state for {library_key}: {error}"))?;
            Ok(MigratedDocument {
                kind: StateDocument::CanvasV2,
                library_key,
                value_json,
                updated_at,
            })
        })
        .collect()
}

fn migrated_master_settings_documents(
    connection: &Connection,
) -> Result<Vec<MigratedDocument>, String> {
    let rows = connection
        .prepare(
            "SELECT library_key, value_json, updated_at FROM state_documents
             WHERE kind='settings' ORDER BY library_key",
        )
        .map_err(|error| error.to_string())?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    rows.into_iter()
        .map(|(library_key, value_json, updated_at)| {
            let value_json = migrate_master_settings_document(&value_json, updated_at)
                .map_err(|error| format!("Invalid settings for {library_key}: {error}"))?;
            Ok(MigratedDocument {
                kind: StateDocument::SettingsV1,
                library_key,
                value_json,
                updated_at,
            })
        })
        .collect()
}

fn create_current_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE state_schema (
               id INTEGER PRIMARY KEY CHECK(id=1),
               version INTEGER NOT NULL,
               applied_at INTEGER NOT NULL
             );
             CREATE TABLE state_documents (
               kind TEXT NOT NULL CHECK(kind IN ('settings.v1', 'playback-stats.v1', 'canvas.v2')),
               library_key TEXT NOT NULL,
               value_json TEXT NOT NULL,
               updated_at INTEGER NOT NULL,
               PRIMARY KEY(kind, library_key)
             );
             CREATE TABLE reader_state (
               path TEXT PRIMARY KEY,
               state_json TEXT NOT NULL,
               fingerprint TEXT NOT NULL,
               revision INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE app_preferences (
               id INTEGER PRIMARY KEY CHECK(id=1),
               state_json TEXT NOT NULL,
               revision INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO state_schema(id, version, applied_at) VALUES(1, ?1, ?2)",
            params![CURRENT_SCHEMA_VERSION, now_ms()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Failed to sync directory {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn backup_master_v3(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Database path has no parent: {}", path.display()))?;
    let directory = parent.join(BACKUP_DIRECTORY);
    let directory_existed = directory.exists();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create {}: {error}", directory.display()))?;
    if !directory_existed {
        sync_directory(parent)?;
    }
    let backup = directory.join(format!(
        "master-v3-{}-{}.sqlite3",
        now_ms(),
        uuid::Uuid::new_v4()
    ));
    let backup_name = backup.to_string_lossy();
    let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Failed to open application state for backup: {error}"))?;
    source
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Failed to configure application state backup: {error}"))?;
    if let Err(error) = source.execute("VACUUM INTO ?1", [backup_name.as_ref()]) {
        let _ = fs::remove_file(&backup);
        return Err(format!(
            "Failed to back up application state to {}: {error}",
            backup.display()
        ));
    }
    fs::File::open(&backup)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Failed to sync {}: {error}", backup.display()))?;
    let backup_connection = Connection::open_with_flags(&backup, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Failed to verify {}: {error}", backup.display()))?;
    validate_master_v3_schema(&backup_connection)
        .map_err(|error| format!("Invalid backup {}: {error}", backup.display()))?;
    drop(backup_connection);
    sync_directory(&directory)?;
    Ok(backup)
}

fn migrate_master_v3(
    transaction: &Connection,
    documents: &[MigratedDocument],
) -> Result<(), String> {
    transaction
        .execute_batch(
            "ALTER TABLE state_documents RENAME TO master_state_documents;
             ALTER TABLE reader_state RENAME TO master_reader_state;
             ALTER TABLE app_preferences RENAME TO master_app_preferences;",
        )
        .map_err(|error| error.to_string())?;
    create_current_schema(&transaction)?;
    transaction
        .execute_batch(
            "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
               SELECT 'playback-stats.v1', library_key, value_json, updated_at
               FROM master_state_documents WHERE kind='stats';
             INSERT INTO reader_state(path, state_json, fingerprint, revision, updated_at)
               SELECT path, state_json, fingerprint, revision, updated_at
               FROM master_reader_state WHERE scope='admin';
             INSERT INTO app_preferences(id, state_json, revision, updated_at)
               SELECT 1, state_json, revision, updated_at
               FROM master_app_preferences WHERE scope='admin';
             DROP TABLE master_state_documents;
             DROP TABLE master_reader_state;
             DROP TABLE master_app_preferences;
             DROP TABLE legacy_state_import;
             DROP TABLE schema_migrations;",
        )
        .map_err(|error| error.to_string())?;
    for document in documents {
        transaction
            .execute(
                "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
                 VALUES(?1, ?2, ?3, ?4)",
                params![
                    document.kind.name(),
                    document.library_key,
                    document.value_json,
                    document.updated_at
                ],
            )
            .map_err(|error| error.to_string())?;
    }
    validate_current_schema(&transaction)?;
    Ok(())
}

pub fn initialize(config: &Config) -> Result<(), String> {
    let path = database(config);
    let mut connection = connection(&path).map_err(|error| error.1)?;
    let tables = table_names(&connection)?;
    if tables.iter().any(|table| table == "state_schema") {
        return validate_current_schema(&connection)
            .map_err(|error| format!("Unsupported application state database: {error}"));
    }
    if tables.iter().any(|table| table == "schema_migrations") {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Failed to lock master-v3 application state: {error}"))?;
        validate_master_v3_schema(&transaction).map_err(|error| {
            format!("Unsupported master-v3 application state database: {error}")
        })?;
        let mut documents = migrated_master_settings_documents(&transaction).map_err(|error| {
            format!("Unsupported master-v3 application state database: {error}")
        })?;
        documents.extend(
            migrated_master_canvas_documents(&transaction).map_err(|error| {
                format!("Unsupported master-v3 application state database: {error}")
            })?,
        );
        let backup = backup_master_v3(&path)?;
        if let Err(error) = migrate_master_v3(&transaction, &documents) {
            return Err(format!(
                "Failed to migrate application state; backup preserved at {}: {error}",
                backup.display()
            ));
        }
        transaction.commit().map_err(|error| {
            format!(
                "Failed to commit application state migration; backup preserved at {}: {error}",
                backup.display()
            )
        })?;
        return Ok(());
    }
    if !tables.is_empty() {
        return Err("Unsupported unversioned application state database".into());
    }

    connection
        .execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    create_current_schema(&transaction)?;
    transaction.commit().map_err(|error| error.to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn document(
    database: &Path,
    document_name: StateDocument,
    library_key: &str,
    default: Value,
) -> AppResult<Value> {
    let connection = connection(database)?;
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key=?2",
            params![document_name.name(), library_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(error))
        .transpose()
        .map(|value| value.unwrap_or(default))
}

pub fn update_document<T>(
    database: &Path,
    document_name: StateDocument,
    library_key: &str,
    default: Value,
    update: impl FnOnce(&mut Value) -> AppResult<T>,
) -> AppResult<T> {
    let mut connection = connection(database)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(error)?;
    let raw: Option<String> = transaction
        .query_row(
            "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key=?2",
            params![document_name.name(), library_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(error)?;
    let mut value = raw
        .map(|raw| serde_json::from_str(&raw).map_err(error))
        .transpose()?
        .unwrap_or(default);
    let result = update(&mut value)?;
    let serialized = serde_json::to_string(&value).map_err(error)?;
    transaction
        .execute(
            "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
             VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(kind, library_key) DO UPDATE SET
               value_json=excluded.value_json, updated_at=excluded.updated_at",
            params![document_name.name(), library_key, serialized, now_ms()],
        )
        .map_err(error)?;
    transaction.commit().map_err(error)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{FileSearchConfig, ImageOptimizationConfig};

    fn test_config(data_path: PathBuf) -> Config {
        Config {
            port: 3000,
            roots: vec![],
            library_key: "library".into(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data_path.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            data_path,
            hermes: None,
        }
    }

    fn temp_data(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("derp-state-{name}-{}", uuid::Uuid::new_v4()))
    }

    fn master_canvas_fixture() -> Value {
        json!([
            {
                "id": "canvas-one",
                "writerId": "browser-1",
                "name": "Migrated canvas",
                "updatedAt": 203,
                "deleted": false,
                "state": {
                    "version": 1,
                    "windows": [
                        {
                            "id": "browser-1",
                            "definition": {
                                "id": "browser-1",
                                "type": "browser",
                                "title": "Notes",
                                "iconName": "Folder",
                                "iconPath": "Notes",
                                "iconType": "folder",
                                "source": {"kind": "local", "rootPath": null},
                                "initialState": {"dir": "Notes"},
                                "tabGroupId": null
                            },
                            "bounds": {"x": 0, "y": 0, "width": 640, "height": 480},
                            "zIndex": 1
                        },
                        {
                            "id": "viewer-1",
                            "definition": {
                                "id": "viewer-1",
                                "type": "viewer",
                                "title": "Manual",
                                "iconPath": "Books/manual.pdf",
                                "iconType": "pdf",
                                "source": {"kind": "local", "rootPath": null},
                                "initialState": {
                                    "viewing": "Books\\manual.pdf",
                                    "dir": "Books",
                                    "readerKind": "pdf"
                                },
                                "tabGroupId": null
                            },
                            "bounds": {"x": 640, "y": 0, "width": 768, "height": 544},
                            "zIndex": 2
                        },
                        {
                            "id": "hermes-1",
                            "definition": {
                                "id": "hermes-1",
                                "type": "hermes",
                                "title": "Research chat",
                                "iconName": null,
                                "iconPath": "Hermes Sessions/session/session-1",
                                "iconIsVirtual": true,
                                "source": {"kind": "local", "rootPath": null},
                                "initialState": {},
                                "tabGroupId": null,
                                "hermes": {
                                    "sessionId": "session-1",
                                    "cwd": "/project",
                                    "readOnly": true
                                }
                            },
                            "bounds": {"x": 0, "y": 544, "width": 640, "height": 480},
                            "zIndex": 3
                        },
                        {
                            "id": "favorites-browser",
                            "definition": {
                                "id": "favorites-browser",
                                "type": "browser",
                                "title": "Favorites",
                                "source": {"kind": "local", "rootPath": null},
                                "initialState": {"dir": "Favorites"}
                            },
                            "bounds": {"x": 1408, "y": 0, "width": 640, "height": 480},
                            "zIndex": 4
                        },
                        {
                            "id": "hermes-browser",
                            "definition": {
                                "id": "hermes-browser",
                                "type": "browser",
                                "title": "Project sessions",
                                "source": {"kind": "local", "rootPath": null},
                                "initialState": {"dir": "Hermes Sessions/project/project-canvas"}
                            },
                            "bounds": {"x": 1408, "y": 480, "width": 640, "height": 480},
                            "zIndex": 5
                        }
                    ],
                    "maximizedWindowId": "viewer-1",
                    "camera": {"x": 10, "y": 20, "zoom": 0.8},
                    "windowSizeByType": {
                        "browser": {"width": 640, "height": 480},
                        "hermes": {"width": 640, "height": 480},
                        "viewer-pdf": {"width": 768, "height": 544}
                    },
                    "nextItemId": 6,
                    "nextZIndex": 6
                }
            },
            {
                "id": "deleted-canvas",
                "writerId": "browser-1",
                "name": "Deleted",
                "updatedAt": 202,
                "deleted": true,
                "state": null
            }
        ])
    }

    fn master_settings_fixture() -> Value {
        json!({
            "favorites": ["one.jpg"],
            "future": true,
            "workspaceTaskbarPins": [
                {
                    "id": "pin-file",
                    "path": "Books\\manual.pdf",
                    "isDirectory": false,
                    "title": "Manual",
                    "customIconName": "BookOpen",
                    "isVirtual": false,
                    "source": {"kind": "local", "rootPath": null}
                },
                {
                    "id": "pin-favorites",
                    "path": "Favorites",
                    "isDirectory": true,
                    "title": "Favorites",
                    "isVirtual": true,
                    "source": {"kind": "local", "rootPath": null}
                },
                {
                    "id": "pin-hermes",
                    "path": "Hermes Sessions/session/session-settings",
                    "isDirectory": false,
                    "title": "Saved session",
                    "isVirtual": true,
                    "source": {"kind": "local", "rootPath": null}
                }
            ],
            "workspaceLayoutPresets": [{
                "id": "preset-one",
                "name": "Research layout",
                "scope": "admin",
                "snapshot": {
                    "windows": [
                        {
                            "id": "preset-collection",
                            "type": "browser",
                            "title": "Most Played",
                            "source": {"kind": "local", "rootPath": null},
                            "initialState": {"dir": "Most Played"},
                            "tabGroupId": "group-one",
                            "tabPinned": true,
                            "layout": {
                                "bounds": {"x": 10, "y": 20, "width": 640, "height": 480},
                                "zIndex": 2
                            }
                        },
                        {
                            "id": "preset-hermes-browser",
                            "type": "browser",
                            "title": "Project sessions",
                            "source": {"kind": "local", "rootPath": null},
                            "initialState": {"dir": "Hermes Sessions/project/project-settings"},
                            "tabGroupId": null,
                            "layout": {
                                "bounds": {"x": 650, "y": 20, "width": 640, "height": 480},
                                "zIndex": 3
                            }
                        }
                    ],
                    "activeWindowId": "preset-hermes-browser",
                    "activeTabMap": {"group-one": "preset-collection"},
                    "nextWindowId": 9,
                    "pinnedTaskbarItems": [
                        {
                            "id": "preset-pin-favorites",
                            "path": "Favorites",
                            "isDirectory": true,
                            "title": "Favorites",
                            "isVirtual": true,
                            "source": {"kind": "local"}
                        },
                        {
                            "id": "preset-pin-hermes",
                            "path": "Hermes Sessions/session/session-preset",
                            "isDirectory": false,
                            "title": "Preset session",
                            "isVirtual": true,
                            "source": {"kind": "local"}
                        }
                    ],
                    "browserTabTitle": "Saved research"
                },
                "createdAt": "2026-08-14T10:00:00Z",
                "updatedAt": "2026-08-14T11:00:00Z"
            }]
        })
    }

    fn create_master_v3_database(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE schema_migrations (
                   version INTEGER PRIMARY KEY,
                   applied_at INTEGER NOT NULL
                 );
                 CREATE TABLE state_documents (
                   kind TEXT NOT NULL,
                   library_key TEXT NOT NULL,
                   value_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL,
                   PRIMARY KEY(kind, library_key)
                 );
                 CREATE TABLE legacy_state_import (
                   version INTEGER PRIMARY KEY,
                   imported_at INTEGER NOT NULL
                 );
                 CREATE TABLE reader_state (
                   scope TEXT NOT NULL,
                   path TEXT NOT NULL,
                   state_json TEXT NOT NULL,
                   fingerprint TEXT NOT NULL,
                   revision INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL,
                   PRIMARY KEY(scope, path)
                 );
                 CREATE TABLE app_preferences (
                   scope TEXT PRIMARY KEY,
                   state_json TEXT NOT NULL,
                   revision INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 INSERT INTO schema_migrations VALUES(1, 101), (2, 102), (3, 103);
                 INSERT INTO legacy_state_import VALUES(1, 104);
                 INSERT INTO state_documents VALUES
                   ('stats', 'library', '{\"views\":{\"one.jpg\":3}}', 202);
                 INSERT INTO reader_state VALUES
                   ('admin', 'books/one.epub', '{\"page\":7}', '123:456', 4, 204),
                   ('share:obsolete-token', 'books/shared.epub', '{\"page\":9}', '321:654', 2, 203);
                 INSERT INTO app_preferences VALUES
                   ('admin', '{\"theme\":\"sepia\"}', 5, 205);",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO state_documents VALUES('settings', 'library', ?1, 201)",
                [serde_json::to_string(&master_settings_fixture()).unwrap()],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO state_documents VALUES('canvases', 'library', ?1, 203)",
                [serde_json::to_string(&master_canvas_fixture()).unwrap()],
            )
            .unwrap();
    }

    fn backups(data_path: &Path) -> Vec<PathBuf> {
        let directory = data_path.join(BACKUP_DIRECTORY);
        if !directory.exists() {
            return Vec::new();
        }
        let mut backups = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        backups.sort();
        backups
    }

    #[test]
    fn initializes_current_schema_idempotently() {
        let data_path = temp_data("current");
        let config = test_config(data_path.clone());

        initialize(&config).unwrap();
        initialize(&config).unwrap();

        let connection = connection(&database(&config)).unwrap();
        let version: i64 = connection
            .query_row("SELECT version FROM state_schema WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        let tables = connection
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        for table in [
            "app_preferences",
            "reader_state",
            "state_schema",
            "state_documents",
        ] {
            assert!(tables.iter().any(|name| name == table));
        }
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_noncurrent_schema_without_mutating_it() {
        let data_path = temp_data("unsupported");
        fs::create_dir_all(&data_path).unwrap();
        let database = data_path.join("app.sqlite3");
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE state_schema (id INTEGER PRIMARY KEY, version INTEGER NOT NULL, applied_at INTEGER NOT NULL);
                 INSERT INTO state_schema VALUES(1, 3, 1);
                 CREATE TABLE sentinel (value TEXT NOT NULL);
                 INSERT INTO sentinel VALUES('unchanged');",
            )
            .unwrap();
        drop(connection);
        let config = test_config(data_path.clone());

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("Unsupported application state database"));
        let connection = Connection::open(database).unwrap();
        let value: String = connection
            .query_row("SELECT value FROM sentinel", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "unchanged");
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn migrates_exact_master_v3_with_backup_and_is_idempotent() {
        let data_path = temp_data("master-v3");
        fs::create_dir_all(&data_path).unwrap();
        let config = test_config(data_path.clone());
        let database = database(&config);
        create_master_v3_database(&database);

        initialize(&config).unwrap();

        let settings =
            document(&database, StateDocument::SettingsV1, "library", Value::Null).unwrap();
        let stats = document(
            &database,
            StateDocument::PlaybackStatsV1,
            "library",
            Value::Null,
        )
        .unwrap();
        let canvases =
            document(&database, StateDocument::CanvasV2, "library", Value::Null).unwrap();
        assert_eq!(settings["favorites"], json!(["one.jpg"]));
        assert_eq!(settings["future"], true);
        let parsed_pins =
            crate::workspace_persistence::workspace_pins(&settings["workspaceTaskbarPins"]);
        assert_eq!(parsed_pins, settings["workspaceTaskbarPins"]);
        assert_eq!(parsed_pins.as_array().unwrap().len(), 3);
        assert_eq!(
            parsed_pins[0]["resource"],
            filesystem_resource_key("configured-default", "Books/manual.pdf")
        );
        assert_eq!(
            parsed_pins[1]["resource"],
            filesystem_resource_key("application-collections", "favorites")
        );
        assert_eq!(
            parsed_pins[2]["resource"],
            hermes_resource_key("session", Some("session-settings"))
        );
        assert!(parsed_pins[0].get("path").is_none());
        assert!(parsed_pins[0].get("source").is_none());
        let parsed_presets =
            crate::workspace_persistence::presets(&settings["workspaceLayoutPresets"]);
        assert_eq!(parsed_presets, settings["workspaceLayoutPresets"]);
        assert_eq!(parsed_presets.as_array().unwrap().len(), 1);
        let preset = &parsed_presets[0];
        assert_eq!(preset["id"], "preset-one");
        assert_eq!(preset["name"], "Research layout");
        assert_eq!(preset["createdAt"], "2026-08-14T10:00:00Z");
        assert_eq!(preset["updatedAt"], "2026-08-14T11:00:00Z");
        assert!(preset.get("scope").is_none());
        assert_eq!(
            preset["snapshot"]["activeWindowId"],
            "preset-hermes-browser"
        );
        assert_eq!(preset["snapshot"]["nextWindowId"], 9);
        assert_eq!(
            preset["snapshot"]["windows"][0]["layout"]["bounds"]["x"],
            10
        );
        assert_eq!(
            preset["snapshot"]["windows"][0]["content"]["payload"]["address"],
            json!({"rootId":"application-collections","path":"most-played"})
        );
        assert_eq!(
            preset["snapshot"]["windows"][1]["content"]["payload"]["location"],
            hermes_resource_key("project", Some("project-settings"))
        );
        assert_eq!(
            preset["snapshot"]["pinnedTaskbarItems"][1]["resource"],
            hermes_resource_key("session", Some("session-preset"))
        );
        assert_eq!(stats, serde_json::json!({"views":{"one.jpg":3}}));
        assert_eq!(canvases["schemaVersion"], 2);
        assert_eq!(canvases["revision"], 1);
        assert_eq!(canvases["activeId"], "canvas-one");
        assert_eq!(canvases["canvases"].as_array().unwrap().len(), 1);
        assert_eq!(
            canvases["canvases"][0]["state"]["windows"][0]["definition"]["content"]["codec"],
            "filesystem.content"
        );
        assert_eq!(
            canvases["canvases"][0]["state"]["windows"][1]["definition"]["content"]["payload"]["renderer"],
            "pdf-reader"
        );
        assert_eq!(
            canvases["canvases"][0]["state"]["windows"][1]["definition"]["content"]["payload"]["address"]
                ["path"],
            "Books/manual.pdf"
        );
        assert_eq!(
            canvases["canvases"][0]["state"]["windows"][2]["definition"]["content"]["codec"],
            "hermes.content"
        );
        assert_eq!(
            canvases["canvases"][0]["state"]["windows"][3]["definition"]["content"]["payload"]["address"],
            json!({"rootId":"application-collections","path":"favorites"})
        );
        assert_eq!(
            canvases["canvases"][0]["state"]["windows"][4]["definition"]["content"]["payload"]["location"],
            hermes_resource_key("project", Some("project-canvas"))
        );
        assert!(
            canvases["canvases"][0]["state"]["windowSizeByType"]
                .get("hermes")
                .is_none()
        );
        assert!(
            canvases["canvases"][0]["state"]["windowSizeByType"]
                .get("integration")
                .is_some()
        );
        let loaded = crate::canvas_persistence::load(&database, "library").unwrap();
        assert_eq!(loaded.schema_version, 2);
        assert_eq!(loaded.revision, 1);
        assert_eq!(loaded.active_id.as_deref(), Some("canvas-one"));
        assert_eq!(loaded.canvases.len(), 1);

        let connection = Connection::open(&database).unwrap();
        validate_current_schema(&connection).unwrap();
        let reader: (String, String, i64, i64) = connection
            .query_row(
                "SELECT state_json, fingerprint, revision, updated_at
                 FROM reader_state WHERE path='books/one.epub'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(reader, ("{\"page\":7}".into(), "123:456".into(), 4, 204));
        let obsolete_reader_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM reader_state WHERE path='books/shared.epub'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(obsolete_reader_rows, 0);
        let preferences: (String, i64, i64) = connection
            .query_row(
                "SELECT state_json, revision, updated_at FROM app_preferences WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(preferences, ("{\"theme\":\"sepia\"}".into(), 5, 205));
        let document_times = connection
            .prepare("SELECT updated_at FROM state_documents ORDER BY updated_at")
            .unwrap()
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(document_times, [201, 202, 203]);
        drop(connection);

        let backup_paths = backups(&data_path);
        assert_eq!(backup_paths.len(), 1);
        let backup =
            Connection::open_with_flags(&backup_paths[0], OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap();
        validate_master_v3_schema(&backup).unwrap();
        let backed_up_settings: String = backup
            .query_row(
                "SELECT value_json FROM state_documents
                 WHERE kind='settings' AND library_key='library'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&backed_up_settings).unwrap(),
            master_settings_fixture()
        );
        let backed_up_share_rows: i64 = backup
            .query_row(
                "SELECT COUNT(*) FROM reader_state WHERE scope='share:obsolete-token'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(backed_up_share_rows, 1);
        drop(backup);

        initialize(&config).unwrap();

        assert_eq!(backups(&data_path), backup_paths);
        assert_eq!(
            document(&database, StateDocument::SettingsV1, "library", Value::Null,).unwrap(),
            settings
        );
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn master_canvas_dedupe_uses_timestamp_writer_and_winning_tombstone() {
        let mut records = master_canvas_fixture().as_array().unwrap().clone();
        let mut older = records[0].clone();
        older["name"] = json!("Older");
        older["updatedAt"] = json!(202);
        older["writerId"] = json!("writer-z");
        records.push(older);
        let mut tied = records[0].clone();
        tied["name"] = json!("Tie winner");
        tied["writerId"] = json!("browser-2");
        records.push(tied.clone());

        let migrated: Value = serde_json::from_str(
            &migrate_master_canvas_document(&json!(records).to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(migrated["canvases"].as_array().unwrap().len(), 1);
        assert_eq!(migrated["canvases"][0]["name"], "Tie winner");

        tied["updatedAt"] = json!(204);
        tied["deleted"] = json!(true);
        tied["state"] = Value::Null;
        records.push(tied);
        let migrated: Value = serde_json::from_str(
            &migrate_master_canvas_document(&json!(records).to_string()).unwrap(),
        )
        .unwrap();
        assert_eq!(migrated["activeId"], Value::Null);
        assert!(migrated["canvases"].as_array().unwrap().is_empty());
    }

    #[test]
    fn migrates_master_sync_api_canvas_defaults_without_rejecting_optional_fields() {
        let raw = json!([{
            "id": "api-canvas",
            "name": "API canvas",
            "updatedAt": 500,
            "writerId": "playwright",
            "deleted": false,
            "state": {
                "version": 1,
                "windows": [{
                    "id": "canvas-window-7",
                    "definition": {
                        "type": "browser",
                        "source": {"kind": "local"},
                        "initialState": {"dir": "Notes"}
                    },
                    "bounds": {"x": 0, "y": 0, "width": 640, "height": 480}
                }],
                "camera": {"x": null, "zoom": 2}
            }
        }]);

        let migrated = migrate_master_canvas_document(&raw.to_string()).unwrap();
        let document: crate::contracts::CanvasDocumentDto =
            serde_json::from_str(&migrated).unwrap();
        assert_eq!(document.canvases.len(), 1);
        let state = &document.canvases[0].state;
        assert_eq!(state.maximized_window_id, None);
        assert_eq!(state.camera.x, 0.0);
        assert_eq!(state.camera.y, 0.0);
        assert_eq!(state.camera.zoom, 1.0);
        assert_eq!(state.next_item_id, 8);
        assert_eq!(state.next_z_index, 2);
        assert_eq!(state.windows[0].z_index, 1);
        assert_eq!(state.windows[0].definition.id, "canvas-window-7");
        assert_eq!(state.windows[0].definition.title, "canvas-window-7");
    }

    #[test]
    fn rejects_invalid_master_settings_without_mutation_or_backup() {
        let data_path = temp_data("invalid-master-settings");
        fs::create_dir_all(&data_path).unwrap();
        let config = test_config(data_path.clone());
        let database = database(&config);
        create_master_v3_database(&database);
        Connection::open(&database)
            .unwrap()
            .execute(
                "UPDATE state_documents
                 SET value_json='{\"workspaceTaskbarPins\":[{\"id\":\"broken\"}]}'
                 WHERE kind='settings'",
                [],
            )
            .unwrap();
        let original = fs::read(&database).unwrap();

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("Invalid settings"));
        assert_eq!(fs::read(&database).unwrap(), original);
        assert!(backups(&data_path).is_empty());
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn migration_lock_keeps_backup_and_conversion_on_one_snapshot() {
        use std::{sync::mpsc, thread, time::Duration as ThreadDuration};

        let data_path = temp_data("concurrent-master-writer");
        fs::create_dir_all(&data_path).unwrap();
        let database = data_path.join("app.sqlite3");
        create_master_v3_database(&database);
        let mut connection = Connection::open(&database).unwrap();
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        let (start_sender, start_receiver) = mpsc::channel();
        let (result_sender, result_receiver) = mpsc::channel();
        let writer_database = database.clone();
        let writer = thread::spawn(move || {
            let writer = Connection::open(writer_database).unwrap();
            writer.busy_timeout(Duration::from_secs(5)).unwrap();
            start_sender.send(()).unwrap();
            let result = writer.execute(
                "INSERT INTO state_documents(kind, library_key, value_json, updated_at)
                 VALUES('settings', 'library', '{\"writer\":true}', 999)
                 ON CONFLICT(kind, library_key) DO UPDATE SET
                   value_json=excluded.value_json, updated_at=excluded.updated_at",
                [],
            );
            result_sender.send(result.map(|_| ())).unwrap();
        });
        start_receiver.recv().unwrap();
        thread::sleep(ThreadDuration::from_millis(20));
        assert!(result_receiver.try_recv().is_err());

        validate_master_v3_schema(&transaction).unwrap();
        let mut documents = migrated_master_settings_documents(&transaction).unwrap();
        documents.extend(migrated_master_canvas_documents(&transaction).unwrap());
        let backup = backup_master_v3(&database).unwrap();
        migrate_master_v3(&transaction, &documents).unwrap();
        transaction.commit().unwrap();

        let writer_error = result_receiver.recv().unwrap().unwrap_err();
        assert!(writer_error.to_string().contains("CHECK constraint failed"));
        writer.join().unwrap();
        let settings =
            document(&database, StateDocument::SettingsV1, "library", Value::Null).unwrap();
        assert_eq!(settings["future"], true);
        let backup = Connection::open_with_flags(backup, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let original_settings: Value = serde_json::from_str(
            &backup
                .query_row(
                    "SELECT value_json FROM state_documents
                     WHERE kind='settings' AND library_key='library'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap(),
        )
        .unwrap();
        assert_eq!(original_settings, master_settings_fixture());
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn current_schema_rejects_legacy_document_kinds() {
        let data_path = temp_data("current-kind-check");
        let config = test_config(data_path.clone());
        initialize(&config).unwrap();
        let connection = Connection::open(database(&config)).unwrap();

        let error = connection
            .execute(
                "INSERT INTO state_documents VALUES('settings', 'library', '{}', 1)",
                [],
            )
            .unwrap_err();

        assert!(error.to_string().contains("CHECK constraint failed"));
        validate_current_schema(&connection).unwrap();
        drop(connection);
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_partial_master_schema_without_mutation_or_backup() {
        let data_path = temp_data("partial-master");
        fs::create_dir_all(&data_path).unwrap();
        let config = test_config(data_path.clone());
        let database = database(&config);
        create_master_v3_database(&database);
        Connection::open(&database)
            .unwrap()
            .execute_batch("DROP TABLE app_preferences;")
            .unwrap();
        let original = fs::read(&database).unwrap();

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("Unsupported master-v3 application state database"));
        assert_eq!(fs::read(&database).unwrap(), original);
        assert!(backups(&data_path).is_empty());
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_unknown_master_data_without_mutation_or_backup() {
        let data_path = temp_data("unknown-master-data");
        fs::create_dir_all(&data_path).unwrap();
        let config = test_config(data_path.clone());
        let database = database(&config);
        create_master_v3_database(&database);
        Connection::open(&database)
            .unwrap()
            .execute(
                "INSERT INTO state_documents VALUES('unknown', 'library', '{}', 300)",
                [],
            )
            .unwrap();
        let original = fs::read(&database).unwrap();

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("unknown state document kinds"));
        assert_eq!(fs::read(&database).unwrap(), original);
        assert!(backups(&data_path).is_empty());
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_invalid_master_canvas_without_mutation_or_backup() {
        let data_path = temp_data("invalid-master-canvas");
        fs::create_dir_all(&data_path).unwrap();
        let config = test_config(data_path.clone());
        let database = database(&config);
        create_master_v3_database(&database);
        Connection::open(&database)
            .unwrap()
            .execute(
                "UPDATE state_documents SET value_json='[{\"id\":\"broken\"}]'
                 WHERE kind='canvases'",
                [],
            )
            .unwrap();
        let original = fs::read(&database).unwrap();

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("Invalid Canvas state"));
        assert_eq!(fs::read(&database).unwrap(), original);
        assert!(backups(&data_path).is_empty());
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn failed_migration_rolls_back_all_schema_changes() {
        let data_path = temp_data("migration-rollback");
        fs::create_dir_all(&data_path).unwrap();
        let database = data_path.join("app.sqlite3");
        create_master_v3_database(&database);
        let mut connection = Connection::open(&database).unwrap();
        connection
            .execute(
                "INSERT INTO state_documents VALUES('unknown', 'library', '{}', 300)",
                [],
            )
            .unwrap();

        let duplicate_documents = [
            MigratedDocument {
                kind: StateDocument::CanvasV2,
                library_key: "library".into(),
                value_json: "{}".into(),
                updated_at: 1,
            },
            MigratedDocument {
                kind: StateDocument::CanvasV2,
                library_key: "library".into(),
                value_json: "{}".into(),
                updated_at: 2,
            },
        ];
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        assert!(migrate_master_v3(&transaction, &duplicate_documents).is_err());
        drop(transaction);
        drop(connection);

        let connection = Connection::open(&database).unwrap();
        let tables = table_names(&connection).unwrap();
        assert!(tables.iter().any(|table| table == "schema_migrations"));
        assert!(tables.iter().any(|table| table == "state_documents"));
        assert!(!tables.iter().any(|table| table == "state_schema"));
        let unknown: String = connection
            .query_row(
                "SELECT value_json FROM state_documents WHERE kind='unknown'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unknown, "{}");
        drop(connection);
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_corrupt_database_without_replacing_bytes() {
        let data_path = temp_data("corrupt");
        fs::create_dir_all(&data_path).unwrap();
        let config = test_config(data_path.clone());
        let database = database(&config);
        let corrupt = b"not a sqlite database\0preserve these bytes";
        fs::write(&database, corrupt).unwrap();

        assert!(initialize(&config).is_err());

        assert_eq!(fs::read(&database).unwrap(), corrupt);
        assert!(backups(&data_path).is_empty());
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn rejects_unversioned_database_without_claiming_it() {
        let data_path = temp_data("unversioned");
        fs::create_dir_all(&data_path).unwrap();
        let database = data_path.join("app.sqlite3");
        Connection::open(&database)
            .unwrap()
            .execute_batch("CREATE TABLE unknown_state (value TEXT NOT NULL);")
            .unwrap();
        let config = test_config(data_path.clone());

        let error = initialize(&config).unwrap_err();

        assert!(error.contains("Unsupported unversioned application state database"));
        let connection = Connection::open(database).unwrap();
        let has_schema: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='state_schema')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!has_schema);
        fs::remove_dir_all(data_path).unwrap();
    }

    #[test]
    fn current_documents_round_trip_and_preserve_corrupt_bytes() {
        let data_path = temp_data("documents");
        let config = test_config(data_path.clone());
        initialize(&config).unwrap();
        let database = database(&config);

        update_document(
            &database,
            StateDocument::SettingsV1,
            "library",
            serde_json::json!({}),
            |value| {
                value["favorites"] = serde_json::json!(["one.jpg"]);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(
            document(&database, StateDocument::SettingsV1, "library", Value::Null,).unwrap()["favorites"],
            serde_json::json!(["one.jpg"])
        );

        let corrupt = "{preserve exact invalid bytes  \n";
        connection(&database)
            .unwrap()
            .execute(
                "UPDATE state_documents SET value_json=?1 WHERE kind=?2 AND library_key='library'",
                params![corrupt, StateDocument::SettingsV1.name()],
            )
            .unwrap();
        assert!(
            update_document(
                &database,
                StateDocument::SettingsV1,
                "library",
                serde_json::json!({}),
                |_| Ok(()),
            )
            .is_err()
        );
        let stored: String = connection(&database)
            .unwrap()
            .query_row(
                "SELECT value_json FROM state_documents WHERE kind=?1 AND library_key='library'",
                [StateDocument::SettingsV1.name()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, corrupt);
        fs::remove_dir_all(data_path).unwrap();
    }
}
