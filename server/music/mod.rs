mod catalog;
mod curation;
mod enrichment;
mod playlists;
mod radio;
#[cfg(test)]
mod tests;

use crate::{activity::sql_error, app::Shared, error::AppResult};
use axum::{
    Router,
    routing::{get, post},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

pub fn initialize(c: &Connection) -> AppResult<()> {
    curation::initialize(c)?;
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS music_tracks (
        path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, metadata TEXT NOT NULL,
        enrichment TEXT NOT NULL DEFAULT '{}', overrides TEXT NOT NULL DEFAULT '{}',
        added_at INTEGER NOT NULL, enriched_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS music_playlists (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, rules TEXT, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, last_played INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS music_playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY(playlist_id,position));
      CREATE INDEX IF NOT EXISTS music_playlist_paths ON music_playlist_tracks(path);
      CREATE TABLE IF NOT EXISTS music_artist_cache (
        artist TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS music_skips (
        id TEXT PRIMARY KEY, path TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS music_skips_path ON music_skips(path,created_at);",
    )
    .map_err(sql_error)
}

pub use curation::{needs_review, review_batch};
pub use radio::prepare_station;

pub(crate) async fn initial_data(state: &Shared) -> AppResult<Value> {
    Ok(catalog::home(
        axum::extract::State(state.clone()),
        axum::extract::Query(catalog::HomeQuery { genre: None }),
    )
    .await?
    .0)
}

pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/music/home", get(catalog::home))
        .route(
            "/api/music/artwork/{*path}",
            get(crate::routes::media::audio_artwork),
        )
        .route("/api/music/refresh", post(catalog::refresh))
        .route("/api/music/tracks", get(catalog::search))
        .route(
            "/api/music/playlists",
            get(playlists::list).post(playlists::create),
        )
        .route(
            "/api/music/playlists/{id}",
            get(playlists::get)
                .put(playlists::update)
                .delete(playlists::delete),
        )
        .route("/api/music/playlists/{id}/tracks", post(playlists::append))
        .route("/api/music/playlists/{id}/played", post(playlists::played))
        .route("/api/music/radio", post(radio::cached))
        .route("/api/music/skip", post(radio::skip))
}

pub fn start(state: &Shared) {
    catalog::start(state);
    enrichment::start(state);
}

pub fn apply_metadata(
    state: &crate::app::AppState,
    path: &str,
    metadata: &mut Value,
) -> AppResult<()> {
    let row = state
        .database
        .connection()?
        .query_row(
            "SELECT m.enrichment,m.overrides,coalesce(r.decision,'null') FROM music_tracks m
             LEFT JOIN music_reviews r ON r.path=m.path AND r.version=1 AND r.fingerprint=m.fingerprint
               AND r.metadata=m.metadata AND r.enrichment=m.enrichment AND r.overrides=m.overrides
             WHERE m.path=?1",
            [path],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        )
        .optional()
        .map_err(sql_error)?;
    if let Some((extra, overrides, review)) = row {
        let extra: Value = serde_json::from_str(&extra).unwrap_or(json!({}));
        let overrides: Value = serde_json::from_str(&overrides).unwrap_or(json!({}));
        let mut genres = catalog::genres(&metadata["genre"]);
        genres.extend(catalog::genres(&extra["genre"]));
        genres.sort();
        genres.dedup();
        metadata["genre"] = json!(genres);
        let review: Value = serde_json::from_str(&review).unwrap_or_default();
        if review["kind"] == "song" {
            for key in ["title", "artist", "album"] {
                if key != "title" || review[key].as_str().is_some_and(|v| !v.is_empty()) {
                    metadata[key] = review[key].clone();
                }
            }
            metadata["genre"] = review["genres"].clone();
        }
        if let Some(fields) = overrides.as_object() {
            for (key, value) in fields {
                metadata[key] = value.clone();
            }
        }
    }
    Ok(())
}

pub fn move_paths(tx: &rusqlite::Transaction<'_>, old: &str, new: &str) -> AppResult<()> {
    for table in [
        "music_tracks",
        "music_playlist_tracks",
        "music_skips",
        "music_reviews",
    ] {
        tx.execute(&format!("UPDATE OR REPLACE {table} SET path=?2||substr(path,length(?1)+1) WHERE path=?1 OR substr(path,1,length(?1)+1)=?1||'/'"), params![old,new]).map_err(sql_error)?;
    }
    Ok(())
}

pub fn remove_paths(tx: &rusqlite::Transaction<'_>, path: &str) -> AppResult<()> {
    for table in [
        "music_tracks",
        "music_playlist_tracks",
        "music_skips",
        "music_reviews",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE path=?1 OR substr(path,1,length(?1)+1)=?1||'/'"),
            [path],
        )
        .map_err(sql_error)?;
    }
    Ok(())
}
