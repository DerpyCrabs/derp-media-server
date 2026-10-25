use crate::{
    activity::sql_error,
    app::{Shared, timestamp_ms},
    error::{AppError, AppResult},
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, patch},
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Location {
    Paged {
        #[serde(rename = "pageIndex")]
        page_index: u32,
    },
    Book {
        #[serde(rename = "chapterId")]
        chapter_id: String,
        progress: f64,
        #[serde(default)]
        anchor: String,
    },
}
impl Location {
    fn validate(&self) -> AppResult<()> {
        match self {
            Self::Paged { page_index } if *page_index <= 1_000_000 => Ok(()),
            Self::Book {
                chapter_id,
                progress,
                anchor,
            } if !chapter_id.is_empty()
                && chapter_id.len() <= 4096
                && anchor.len() <= 4096
                && progress.is_finite()
                && (0.0..=1.0).contains(progress) =>
            {
                Ok(())
            }
            _ => Err(AppError::bad("Invalid document location")),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Note {
    id: String,
    path: String,
    fingerprint: String,
    location: Location,
    label: String,
    quote: String,
    note: String,
    revision: i64,
    created_at: i64,
    updated_at: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Create {
    id: String,
    path: String,
    fingerprint: String,
    location: Location,
    label: String,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    note: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Edit {
    path: String,
    revision: i64,
    label: String,
    note: String,
}
#[derive(Deserialize)]
struct Request {
    path: String,
}
#[derive(Deserialize)]
struct Delete {
    path: String,
    revision: i64,
}

pub fn initialize(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS reader_notes (
        id TEXT PRIMARY KEY, path TEXT NOT NULL, fingerprint TEXT NOT NULL, location TEXT NOT NULL,
        label TEXT NOT NULL, quote TEXT NOT NULL, note TEXT NOT NULL, revision INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS reader_notes_path ON reader_notes(path, created_at);",
        )
        .map_err(sql_error)
}
fn text_limits(label: &str, note: &str) -> AppResult<()> {
    if label.trim().is_empty() || label.chars().count() > 200 || note.len() > 32_768 {
        return Err(AppError::bad(
            "Use a title of 1–200 characters and a note under 32 KiB",
        ));
    }
    Ok(())
}
fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    let raw: String = row.get(3)?;
    let location = serde_json::from_str(&raw).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Note {
        id: row.get(0)?,
        path: row.get(1)?,
        fingerprint: row.get(2)?,
        location,
        label: row.get(4)?,
        quote: row.get(5)?,
        note: row.get(6)?,
        revision: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}
fn item(connection: &Connection, id: &str, path: &str) -> AppResult<Note> {
    connection
        .query_row(
            "SELECT * FROM reader_notes WHERE id=?1 AND path=?2",
            params![id, path],
            read,
        )
        .optional()
        .map_err(sql_error)?
        .ok_or_else(|| AppError::not_found("Note not found"))
}
async fn list(
    State(state): State<Shared>,
    Query(request): Query<Request>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        let fingerprint = crate::routes::reader_state::fingerprint(&state, &request.path)?;
        let connection = state.database.connection()?;
        let mut statement = connection
            .prepare("SELECT * FROM reader_notes WHERE path=?1 ORDER BY created_at,id")
            .map_err(sql_error)?;
        let items = statement
            .query_map([&request.path], read)
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        Ok(Json(json!({ "items": items, "fingerprint": fingerprint })))
    })
    .await
    .map_err(sql_error)?
}
async fn create(State(state): State<Shared>, Json(body): Json<Create>) -> AppResult<Json<Note>> {
    tokio::task::spawn_blocking(move || {
        text_limits(&body.label, &body.note)?;
        body.location.validate()?;
        if uuid::Uuid::parse_str(&body.id).is_err() || body.quote.len() > 32_768 {
            return Err(AppError::bad("Invalid note identifier or quote longer than 32 KiB"));
        }
        let fingerprint = crate::routes::reader_state::fingerprint(&state, &body.path)?;
        if fingerprint != body.fingerprint { return Err(AppError::conflict("The document changed. Reopen it before adding a note.")); }
        let note = state.database.transaction(|tx| {
            let existing = tx.query_row("SELECT * FROM reader_notes WHERE id=?1", [&body.id], read).optional().map_err(sql_error)?;
            if let Some(existing) = existing {
                if existing.path == body.path && existing.fingerprint == body.fingerprint && existing.label == body.label.trim() && existing.quote == body.quote && existing.note == body.note && json!(existing.location) == json!(body.location) {
                    return Ok(existing);
                }
                return Err(AppError::conflict("This note identifier is already in use"));
            }
            let count: i64 = tx.query_row("SELECT count(*) FROM reader_notes WHERE path=?1", [&body.path], |row| row.get(0)).map_err(sql_error)?;
            if count >= 2000 { return Err(AppError::bad("This document already has 2,000 notes. Export or remove some before adding more.")); }
            let now = timestamp_ms() as i64;
            tx.execute("INSERT INTO reader_notes VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?8)", params![body.id,body.path,body.fingerprint,json!(body.location).to_string(),body.label.trim(),body.quote,body.note,now]).map_err(sql_error)?;
            item(tx, &body.id, &body.path)
        })?;
        crate::app::emit_admin(&state, "reader-notes-changed");
        Ok(Json(note))
    }).await.map_err(sql_error)?
}
async fn edit(
    State(state): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Edit>,
) -> AppResult<Json<Note>> {
    tokio::task::spawn_blocking(move || {
        text_limits(&body.label, &body.note)?;
        crate::media::resolve(&state.config, &body.path)?;
        let note = state.database.transaction(|tx| {
            let existing = item(tx, &id, &body.path)?;
            if existing.revision != body.revision { return Err(AppError::conflict("This note changed in another window. Reload it before saving.")); }
            tx.execute("UPDATE reader_notes SET label=?3,note=?4,revision=revision+1,updated_at=?5 WHERE id=?1 AND path=?2", params![id,body.path,body.label.trim(),body.note,timestamp_ms() as i64]).map_err(sql_error)?;
            item(tx, &id, &body.path)
        })?;
        crate::app::emit_admin(&state, "reader-notes-changed");
        Ok(Json(note))
    }).await.map_err(sql_error)?
}
async fn delete(
    State(state): State<Shared>,
    Path(id): Path<String>,
    Query(body): Query<Delete>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        crate::media::resolve(&state.config, &body.path)?;
        state.database.transaction(|tx| {
            let existing = item(tx, &id, &body.path)?;
            if existing.revision != body.revision {
                return Err(AppError::conflict(
                    "This note changed in another window. Reload it before deleting.",
                ));
            }
            tx.execute(
                "DELETE FROM reader_notes WHERE id=?1 AND path=?2",
                params![id, body.path],
            )
            .map_err(sql_error)?;
            Ok(())
        })?;
        crate::app::emit_admin(&state, "reader-notes-changed");
        Ok(Json(json!({"ok": true})))
    })
    .await
    .map_err(sql_error)?
}
fn prefix(path: &str) -> String {
    format!(
        "{}/%",
        path.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    )
}
pub fn move_paths(tx: &Transaction<'_>, old: &str, new: &str) -> AppResult<()> {
    tx.execute("UPDATE reader_notes SET path=?1 || substr(path,length(?2)+1) WHERE path=?2 OR path LIKE ?3 ESCAPE '\\'", params![new,old,prefix(old)]).map_err(sql_error)?;
    Ok(())
}
pub fn remove_paths(tx: &Transaction<'_>, path: &str) -> AppResult<()> {
    tx.execute(
        "DELETE FROM reader_notes WHERE path=?1 OR path LIKE ?2 ESCAPE '\\'",
        params![path, prefix(path)],
    )
    .map_err(sql_error)?;
    Ok(())
}
pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/reader-notes", get(list).post(create))
        .route("/api/reader-notes/{id}", patch(edit).delete(delete))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestApp;

    fn body(app: &TestApp, id: &str, path: &str) -> Create {
        Create {
            id: id.into(),
            path: path.into(),
            fingerprint: crate::routes::reader_state::fingerprint(&app.state, path).unwrap(),
            location: Location::Paged { page_index: 2 },
            label: "  Закладка  ".into(),
            quote: "A selected sentence".into(),
            note: "My thoughts".into(),
        }
    }
    #[tokio::test]
    async fn retries_are_idempotent_and_stale_edits_and_deletes_are_rejected() {
        let app = TestApp::new();
        app.write("book.pdf", b"document");
        let id = uuid::Uuid::new_v4().to_string();
        let saved = create(State(app.state.clone()), Json(body(&app, &id, "book.pdf")))
            .await
            .unwrap()
            .0;
        assert_eq!(saved.label, "Закладка");
        assert_eq!(
            create(State(app.state.clone()), Json(body(&app, &id, "book.pdf")))
                .await
                .unwrap()
                .0
                .revision,
            1
        );
        let edit_body = || Edit {
            path: "book.pdf".into(),
            revision: 1,
            label: "Revised".into(),
            note: "Changed".into(),
        };
        assert_eq!(
            edit(
                State(app.state.clone()),
                Path(id.clone()),
                Json(edit_body())
            )
            .await
            .unwrap()
            .0
            .revision,
            2
        );
        assert!(
            edit(
                State(app.state.clone()),
                Path(id.clone()),
                Json(edit_body())
            )
            .await
            .is_err()
        );
        assert!(
            delete(
                State(app.state.clone()),
                Path(id.clone()),
                Query(Delete {
                    path: "book.pdf".into(),
                    revision: 1
                })
            )
            .await
            .is_err()
        );
        let found = list(
            State(app.state.clone()),
            Query(Request {
                path: "book.pdf".into(),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(found["items"].as_array().unwrap().len(), 1);
        assert_eq!(found["items"][0]["note"], "Changed");
        let _ = delete(
            State(app.state.clone()),
            Path(id),
            Query(Delete {
                path: "book.pdf".into(),
                revision: 2,
            }),
        )
        .await
        .unwrap();
        assert!(
            list(
                State(app.state.clone()),
                Query(Request {
                    path: "book.pdf".into()
                })
            )
            .await
            .unwrap()
            .0["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    #[tokio::test]
    async fn replacement_preserves_notes_and_rejects_old_document_locations() {
        let app = TestApp::new();
        app.write("book.pdf", b"original");
        let id = uuid::Uuid::new_v4().to_string();
        let stale = body(&app, &uuid::Uuid::new_v4().to_string(), "book.pdf");
        let original = create(State(app.state.clone()), Json(body(&app, &id, "book.pdf")))
            .await
            .unwrap()
            .0;
        app.write("book.pdf", b"replacement with different content");
        assert!(create(State(app.state.clone()), Json(stale)).await.is_err());
        let found = list(
            State(app.state.clone()),
            Query(Request {
                path: "book.pdf".into(),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_ne!(found["fingerprint"], original.fingerprint);
        assert_eq!(found["items"][0]["quote"], original.quote);
    }
    #[tokio::test]
    async fn path_hooks_escape_wildcards_and_preserve_unicode_children() {
        let app = TestApp::new();
        for path in ["Книги_%/одна.pdf", "Книги_ab/другая.pdf"] {
            app.write(path, b"document");
            let _ = create(
                State(app.state.clone()),
                Json(body(&app, &uuid::Uuid::new_v4().to_string(), path)),
            )
            .await
            .unwrap();
        }
        app.state
            .database
            .transaction(|tx| move_paths(tx, "Книги_%", "Архив"))
            .unwrap();
        let connection = app.state.database.connection().unwrap();
        let paths: Vec<String> = connection
            .prepare("SELECT path FROM reader_notes ORDER BY path")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(paths, vec!["Архив/одна.pdf", "Книги_ab/другая.pdf"]);
        app.state
            .database
            .transaction(|tx| remove_paths(tx, "Архив"))
            .unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM reader_notes", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn locations_and_text_are_bounded() {
        assert!(
            Location::Book {
                chapter_id: "one".into(),
                progress: f64::NAN,
                anchor: "".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            Location::Book {
                chapter_id: "".into(),
                progress: 0.5,
                anchor: "".into()
            }
            .validate()
            .is_err()
        );
        assert!(
            Location::Paged {
                page_index: 1_000_001
            }
            .validate()
            .is_err()
        );
        assert!(text_limits(" ", "").is_err());
        assert!(text_limits("title", &"я".repeat(16385)).is_err());
        assert!(text_limits(&"я".repeat(200), "note").is_ok());
    }
}
