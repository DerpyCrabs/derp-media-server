mod catalog;
mod feed;
mod provider;
use crate::{
    activity::sql_error,
    app::Shared,
    error::{AppError, AppResult},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio::sync::{Mutex, Semaphore};

use crate::config::MediaAiConfig as Settings;

pub struct Runtime {
    gate: Semaphore,
    rank_requested: AtomicBool,
    feed_lock: std::sync::Mutex<()>,
    interactive: AtomicUsize,
    pub status: Mutex<Value>,
    catalog_error: Mutex<Option<String>>,
}
impl Runtime {
    pub fn new() -> Self {
        Self {
            gate: Semaphore::new(1),
            rank_requested: AtomicBool::new(false),
            feed_lock: std::sync::Mutex::new(()),
            interactive: AtomicUsize::new(0),
            status: Mutex::new(json!({"phase":"idle"})),
            catalog_error: Mutex::new(None),
        }
    }
}
pub fn initialize(c: &Connection) -> AppResult<()> {
    feed::initialize(c)?;
    c.execute_batch("CREATE TABLE IF NOT EXISTS media_catalog (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '', duration REAL NOT NULL DEFAULT 0, retry_after INTEGER NOT NULL DEFAULT 0,
      analyzed INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 0, fingerprint TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS media_catalog_analysis ON media_catalog(analyzed,id);
      CREATE TABLE IF NOT EXISTS media_feedback(path TEXT PRIMARY KEY,kind TEXT NOT NULL,until INTEGER NOT NULL DEFAULT 0);
      CREATE VIRTUAL TABLE IF NOT EXISTS media_catalog_fts USING fts5(name,path,description,tags,content='media_catalog',content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS media_catalog_ai AFTER INSERT ON media_catalog BEGIN
        INSERT INTO media_catalog_fts(rowid,name,path,description,tags) VALUES(new.id,new.name,new.path,new.description,new.tags); END;
      CREATE TRIGGER IF NOT EXISTS media_catalog_ad AFTER DELETE ON media_catalog BEGIN
        INSERT INTO media_catalog_fts(media_catalog_fts,rowid,name,path,description,tags) VALUES('delete',old.id,old.name,old.path,old.description,old.tags); END;
      CREATE TRIGGER IF NOT EXISTS media_catalog_au AFTER UPDATE OF name,path,description,tags ON media_catalog BEGIN
        INSERT INTO media_catalog_fts(media_catalog_fts,rowid,name,path,description,tags) VALUES('delete',old.id,old.name,old.path,old.description,old.tags);
        INSERT INTO media_catalog_fts(rowid,name,path,description,tags) VALUES(new.id,new.name,new.path,new.description,new.tags); END;") .map_err(sql_error)?;
    let has_retry:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('media_catalog') WHERE name='retry_after')",[],|r|r.get(0)).map_err(sql_error)?;
    if !has_retry {
        c.execute(
            "ALTER TABLE media_catalog ADD COLUMN retry_after INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(sql_error)?;
    }
    c.execute(
        "DELETE FROM media_catalog WHERE kind NOT IN ('audio','video')",
        [],
    )
    .map_err(sql_error)?;
    Ok(())
}
fn settings(state: &Shared) -> AppResult<Settings> {
    Ok(state.config.media_ai.clone())
}
async fn status(State(state): State<Shared>) -> AppResult<Json<Value>> {
    let s = settings(&state)?;
    let c = state.database.connection()?;
    let (total, analyzed): (i64, i64) = c
        .query_row(
            "SELECT count(*),coalesce(sum(analyzed>0),0) FROM media_catalog",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(sql_error)?;
    let deferred: i64 = c
        .query_row(
            "SELECT count(*) FROM media_catalog WHERE analyzed=0 AND retry_after>?1",
            [crate::app::timestamp_ms() as i64],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    let timing: Value = c.query_row("SELECT coalesce(sum(audio_seconds),0),coalesce(sum(video_seconds),0),coalesce(sum(image_seconds),0) FROM media_totals", [], |r|Ok(json!({"audioSeconds":r.get::<_,f64>(0)?,"videoSeconds":r.get::<_,f64>(1)?,"imageSeconds":r.get::<_,f64>(2)?}))).map_err(sql_error)?;
    Ok(Json(
        json!({"deferred":deferred,"catalogError":state.media_ai.catalog_error.lock().await.clone(),"timing":timing,"enabled":s.enabled,"total":total,"analyzed":analyzed,"job":state.media_ai.status.lock().await.clone(),"context":{"maxTextBytes":provider::MAX_TEXT_BYTES,"maxCandidates":48,"analysisBatch":4,"maxImages":4}}),
    ))
}
struct Interactive<'a>(&'a AtomicUsize);
impl Drop for Interactive<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
async fn test(State(state): State<Shared>) -> AppResult<Json<Value>> {
    state.media_ai.interactive.fetch_add(1, Ordering::SeqCst);
    let _waiting = Interactive(&state.media_ai.interactive);
    let _permit = state.media_ai.gate.acquire().await.map_err(sql_error)?;
    provider::generate(&settings(&state)?,"Connection test.","Return ok true.",&[],json!({"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false})).await.map(Json)
}
#[derive(Deserialize)]
struct HomeContext {
    hour: Option<i64>,
    cursor: Option<usize>,
    #[serde(rename = "feedId")]
    feed_id: Option<String>,
}
async fn home(
    State(state): State<Shared>,
    Query(context): Query<HomeContext>,
) -> AppResult<Json<Value>> {
    if !settings(&state)?.enabled {
        return Ok(Json(
            json!({"enabled":false,"rows":[],"nextCursor":null,"warming":false}),
        ));
    }
    let work = state.clone();
    let value = tokio::task::spawn_blocking(move || {
        feed::page(
            &work,
            context.cursor.unwrap_or(0).min(10_000),
            context.feed_id.as_deref(),
            false,
            context.hour.unwrap_or(12).clamp(0, 23),
        )
    })
    .await
    .map_err(sql_error)??;
    if value["warming"] == true {
        state.media_ai.rank_requested.store(true, Ordering::SeqCst);
    }
    Ok(Json(value))
}
async fn refresh(State(state): State<Shared>, body: Option<Json<Value>>) -> AppResult<Json<Value>> {
    if !settings(&state)?.enabled {
        return Err(AppError::bad("Media AI is disabled in the server config"));
    }
    let hour = body
        .and_then(|v| v["hour"].as_i64())
        .unwrap_or(12)
        .clamp(0, 23);
    let work = state.clone();
    let value = tokio::task::spawn_blocking(move || feed::page(&work, 0, None, true, hour))
        .await
        .map_err(sql_error)??;
    if value["warming"] == true {
        state.media_ai.rank_requested.store(true, Ordering::SeqCst);
    }
    Ok(Json(value))
}

#[derive(Deserialize)]
struct Ask {
    query: String,
    #[serde(default)]
    history: Vec<String>,
    #[serde(default)]
    hour: i64,
}
async fn ask(State(state): State<Shared>, Json(body): Json<Ask>) -> AppResult<Json<Value>> {
    if body.query.trim().is_empty()
        || body.query.len() > 1000
        || body.history.len() > 6
        || body.history.iter().any(|s| s.len() > 1000)
    {
        return Err(AppError::bad(
            "Search is limited to 1000 characters and six follow-ups",
        ));
    }
    if !settings(&state)?.enabled {
        return Err(AppError::bad("Media AI is disabled in the server config"));
    }
    state.media_ai.interactive.fetch_add(1, Ordering::SeqCst);
    let _waiting = Interactive(&state.media_ai.interactive);
    let _permit = state.media_ai.gate.acquire().await.map_err(sql_error)?;
    catalog::ask(&state, &body.query, &body.history, body.hour.clamp(0, 23))
        .await
        .map(Json)
}
async fn feedback(State(state): State<Shared>, Json(body): Json<Value>) -> AppResult<Json<Value>> {
    let path = body["path"].as_str().unwrap_or("");
    let kind = body["kind"].as_str().unwrap_or("");
    if path.is_empty() || !["later", "hide", "more", "clear"].contains(&kind) {
        return Err(AppError::bad("Invalid feedback"));
    }
    crate::media::resolve(&state.config, path)?;
    let c = state.database.connection()?;
    if kind == "clear" {
        c.execute("DELETE FROM media_feedback WHERE path=?1", [path])
            .map_err(sql_error)?;
    } else {
        c.execute("INSERT INTO media_feedback VALUES(?1,?2,?3) ON CONFLICT(path) DO UPDATE SET kind=excluded.kind,until=excluded.until",params![path,kind,if kind=="later" {crate::app::timestamp_ms() as i64+86_400_000} else {0}]).map_err(sql_error)?;
    }
    Ok(Json(json!({"ok":true})))
}
async fn reset(State(state): State<Shared>) -> AppResult<Json<Value>> {
    state.database.transaction(|tx|{tx.execute_batch("UPDATE media_sessions SET excluded=1; UPDATE media_totals SET learned_seconds=0,learned_plays=0; DELETE FROM media_feedback; DELETE FROM media_rankings; DELETE FROM media_feeds;").map_err(sql_error)})?;
    state.database.update(
        "media-ai-profile",
        &state.config.library_key,
        json!({}),
        |v| {
            v["resetAt"] = json!(crate::app::timestamp_ms());
            Ok(())
        },
    )?;
    state
        .database
        .update("media-ai-home", &state.config.library_key, json!({}), |v| {
            *v = json!({"rows":[],"generatedAt":0,"invalidatedAt":crate::app::timestamp_ms()});
            Ok(())
        })?;
    Ok(Json(json!({"ok":true})))
}
async fn reanalyze(State(state): State<Shared>) -> AppResult<Json<Value>> {
    state
        .database
        .connection()?
        .execute("UPDATE media_catalog SET analyzed=0,retry_after=0", [])
        .map_err(sql_error)?;
    Ok(Json(json!({"ok":true})))
}
async fn exclude_session(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    let id = body["id"]
        .as_str()
        .ok_or_else(|| AppError::bad("Session ID required"))?;
    state.database.transaction(|tx|{
      tx.execute("UPDATE media_totals SET learned_seconds=MAX(0,learned_seconds-coalesce((SELECT seconds FROM media_sessions WHERE id=?1 AND excluded=0),0)), learned_plays=MAX(0,learned_plays-coalesce((SELECT qualified FROM media_sessions WHERE id=?1 AND excluded=0),0)) WHERE path=(SELECT path FROM media_sessions WHERE id=?1)",[id]).map_err(sql_error)?;
      tx.execute("UPDATE media_sessions SET excluded=1 WHERE id=?1",[id]).map_err(sql_error)?;Ok(())
    })?;
    Ok(Json(json!({"ok":true})))
}
pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/media-ai/status", get(status))
        .route("/api/media-ai/test", post(test))
        .route("/api/media-ai/home", get(home))
        .route("/api/media-ai/refresh", post(refresh))
        .route("/api/media-ai/ask", post(ask))
        .route("/api/media-ai/feedback", post(feedback))
        .route("/api/media-ai/reset", post(reset))
        .route("/api/media-ai/reanalyze", post(reanalyze))
        .route("/api/media-ai/exclude-session", post(exclude_session))
}

pub fn start(state: &Shared) {
    let weak = std::sync::Arc::downgrade(state);
    let scan_weak = weak.clone();
    tokio::spawn(async move {
        let mut cursor = 0;
        let mut epoch = crate::app::timestamp_ms() as i64;
        let mut scan_due = 0;
        let mut changed_scan = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let Some(state) = scan_weak.upgrade() else {
                break;
            };
            let Ok(s) = settings(&state) else { continue };
            let now = crate::app::timestamp_ms() as i64;
            if !s.enabled || s.paused || now < scan_due {
                continue;
            }
            let work = state.clone();
            let result =
                tokio::task::spawn_blocking(move || catalog::sync_page(&work, cursor, epoch)).await;
            match result {
                Ok(Ok((next, changed))) => {
                    *state.media_ai.catalog_error.lock().await = None;
                    cursor = next;
                    changed_scan |= changed;
                    if cursor == 0 {
                        if changed_scan {
                            let _ = state.database.update(
                                "media-ai-home",
                                &state.config.library_key,
                                json!({"rows":[]}),
                                |v| {
                                    v["generatedAt"] = json!(0);
                                    v["invalidatedAt"] = json!(crate::app::timestamp_ms());
                                    Ok(())
                                },
                            );
                        }
                        changed_scan = false;
                        scan_due = now + 60_000;
                        epoch = now;
                    }
                }
                failure => {
                    let error = match failure {
                        Ok(Err(error)) => error.1,
                        Err(error) => error.to_string(),
                        _ => unreachable!(),
                    };
                    eprintln!("Media AI catalog scan failed: {error}");
                    *state.media_ai.catalog_error.lock().await = Some(error);
                    scan_due = now + 10_000;
                }
            }
        }
    });
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let Some(state) = weak.upgrade() else { break };
            let Ok(s) = settings(&state) else { continue };
            let requested = state.media_ai.rank_requested.load(Ordering::SeqCst);
            if !s.enabled
                || (s.paused && !requested)
                || state.media_ai.interactive.load(Ordering::SeqCst) > 0
            {
                continue;
            }
            let Ok(permit) = state.media_ai.gate.try_acquire() else {
                continue;
            };
            let profile = match feed::profile_key(&state) {
                Ok(profile) => profile,
                Err(error) => {
                    *state.media_ai.status.lock().await = json!({"phase":"error","error":error.1});
                    continue;
                }
            };
            let rank = feed::needs_ranking(&state, &profile).unwrap_or(false);
            if !rank {
                state.media_ai.rank_requested.store(false, Ordering::SeqCst);
                if s.paused {
                    continue;
                }
            }
            *state.media_ai.status.lock().await =
                json!({"phase":if rank {"ranking"} else {"analyzing"}});
            let result = if rank {
                catalog::rank_batch(&state, &profile).await
            } else {
                catalog::enrich(&state).await
            };
            match result {
                Ok(worked) => {
                    if rank {
                        let _ = feed::ranking_finished(&state, &profile, worked, false);
                        state
                            .media_ai
                            .rank_requested
                            .store(worked, Ordering::SeqCst);
                    }
                    *state.media_ai.status.lock().await = json!({"phase":if worked {"running"} else {"up-to-date"},"lastSuccess":crate::app::timestamp_ms()});
                }
                Err(e) => {
                    if rank {
                        let _ = feed::ranking_finished(&state, &profile, false, true);
                    }
                    state.media_ai.rank_requested.store(false, Ordering::SeqCst);
                    *state.media_ai.status.lock().await = json!({"phase":"error","error":e.1});
                    drop(permit);
                    drop(state);
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                }
            }
        }
    });
}

pub fn move_paths(tx: &rusqlite::Transaction<'_>, old: &str, new: &str) -> AppResult<()> {
    feed::invalidate_paths(tx, old)?;
    feed::invalidate_paths(tx, new)?;
    for table in [
        "media_sessions",
        "media_totals",
        "media_intervals",
        "media_catalog",
        "media_feedback",
    ] {
        tx.execute(&format!("UPDATE OR REPLACE {table} SET path=?2||substr(path,length(?1)+1) WHERE path=?1 OR substr(path,1,length(?1)+1)=?1||'/'"),params![old,new]).map_err(sql_error)?;
    }
    tx.execute("DELETE FROM state_documents WHERE kind='media-ai-home'", [])
        .map_err(sql_error)?;
    Ok(())
}
pub fn remove_paths(tx: &rusqlite::Transaction<'_>, path: &str) -> AppResult<()> {
    feed::invalidate_paths(tx, path)?;
    for table in [
        "media_sessions",
        "media_totals",
        "media_intervals",
        "media_catalog",
        "media_feedback",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE path=?1 OR substr(path,1,length(?1)+1)=?1||'/'"),
            [path],
        )
        .map_err(sql_error)?;
    }
    Ok(())
}
