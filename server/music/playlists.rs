use super::catalog::{Track, normalize_genre, tracks};
use crate::{
    activity::sql_error,
    app::{Shared, timestamp_ms},
    error::{AppError, AppResult},
};
use axum::{
    Json,
    extract::{Path, State},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub(super) struct Rules {
    pub genre: String,
    pub artist: String,
    pub liked: bool,
    pub unplayed: bool,
    pub not_played_days: u32,
    pub limit: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Edit {
    name: String,
    #[serde(default)]
    paths: Vec<String>,
    rules: Option<Rules>,
}

fn validate(state: &Shared, edit: &Edit) -> AppResult<()> {
    if edit.name.trim().is_empty() || edit.name.len() > 160 || edit.paths.len() > 10_000 {
        return Err(AppError::bad(
            "A playlist needs a name (up to 160 characters) and at most 10,000 tracks",
        ));
    }
    if let Some(r) = &edit.rules {
        if r.genre.len() > 100
            || r.artist.len() > 300
            || r.not_played_days > 36500
            || r.limit > 10000
        {
            return Err(AppError::bad("Invalid smart playlist rules"));
        }
    }
    validate_paths(state, &edit.paths)
}

fn validate_paths(state: &Shared, paths: &[String]) -> AppResult<()> {
    if paths.len() > 10000 {
        return Err(AppError::bad("Too many tracks"));
    }
    for path in paths {
        let resolved = crate::media::resolve(&state.config, path)?;
        if !resolved.full.is_file()
            || crate::media::media_type(&crate::media::extension(&resolved.full)) != "audio"
        {
            return Err(AppError::bad(
                "Playlists can contain available music files only",
            ));
        }
    }
    Ok(())
}

fn write_tracks(c: &Connection, id: &str, paths: &[String]) -> AppResult<()> {
    c.execute(
        "DELETE FROM music_playlist_tracks WHERE playlist_id=?1",
        [id],
    )
    .map_err(sql_error)?;
    let mut seen = HashSet::new();
    for (position, path) in paths.iter().filter(|p| seen.insert(p.as_str())).enumerate() {
        c.execute(
            "INSERT INTO music_playlist_tracks VALUES(?1,?2,?3)",
            params![id, position as i64, path],
        )
        .map_err(sql_error)?;
    }
    Ok(())
}

pub(super) fn matches(track: &Track, rules: &Rules, now: i64) -> bool {
    (rules.genre.is_empty() || track.genre.contains(&normalize_genre(&rules.genre)))
        && (rules.artist.is_empty()
            || track
                .artist
                .to_lowercase()
                .contains(&rules.artist.to_lowercase()))
        && (!rules.liked || track.liked)
        && (!rules.unplayed || track.plays == 0)
        && (rules.not_played_days == 0
            || track.last_played == 0
            || now - track.last_played >= i64::from(rules.not_played_days) * 86_400_000)
}

fn document(c: &Connection, id: &str, all: &[Track]) -> AppResult<Value> {
    let entry: Option<(String, Option<String>, i64, i64, i64)> = c
        .query_row(
            "SELECT name,rules,created_at,updated_at,last_played FROM music_playlists WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(sql_error)?;
    let Some((name, rules, created, updated, last_played)) = entry else {
        return Err(AppError::not_found("Playlist not found"));
    };
    let rules: Option<Rules> = rules.and_then(|v| serde_json::from_str(&v).ok());
    let mut items = if let Some(rules) = &rules {
        let eligible: HashSet<_> = super::catalog::approved_tracks(c)?
            .into_iter()
            .map(|t| t.path)
            .collect();
        let mut items: Vec<_> = all
            .iter()
            .filter(|t| eligible.contains(&t.path) && matches(t, rules, timestamp_ms() as i64))
            .cloned()
            .collect();
        items.sort_by_key(|t| (std::cmp::Reverse(t.liked), t.last_played, t.path.clone()));
        items.truncate(if rules.limit == 0 { 1000 } else { rules.limit });
        items
    } else {
        let lookup: HashMap<_, _> = all.iter().map(|t| (t.path.as_str(), t)).collect();
        let mut st = c
            .prepare(
                "SELECT path FROM music_playlist_tracks WHERE playlist_id=?1 ORDER BY position",
            )
            .map_err(sql_error)?;
        let paths = st
            .query_map([id], |r| r.get::<_, String>(0))
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        paths
            .iter()
            .filter_map(|p| lookup.get(p.as_str()).map(|t| (*t).clone()))
            .collect()
    };
    for item in &mut items {
        item.reason = format!("From {name}");
    }
    Ok(
        json!({"id":id,"name":name,"rules":rules,"createdAt":created,"updatedAt":updated,"lastPlayed":last_played,"items":items}),
    )
}

pub(super) async fn list(State(state): State<Shared>) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        let c = state.database.connection()?;
        let all = tracks(&c, true)?;
        let mut st = c
            .prepare("SELECT id FROM music_playlists ORDER BY last_played DESC,updated_at DESC,id")
            .map_err(sql_error)?;
        let ids = st
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(sql_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_error)?;
        let mut items = Vec::new();
        for id in ids {
            let mut value = document(&c, &id, &all)?;
            value["count"] = json!(value["items"].as_array().map(Vec::len).unwrap_or(0));
            let preview = value["items"].as_array().and_then(|i| i.first()).cloned();
            value["preview"] = json!(preview);
            value.as_object_mut().unwrap().remove("items");
            items.push(value);
        }
        Ok(Json(json!({"items":items})))
    })
    .await
    .map_err(sql_error)?
}

pub(super) async fn get(
    State(state): State<Shared>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        let c = state.database.connection()?;
        document(&c, &id, &tracks(&c, true)?).map(Json)
    })
    .await
    .map_err(sql_error)?
}

pub(super) async fn create(
    State(state): State<Shared>,
    Json(edit): Json<Edit>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        validate(&state,&edit)?;
        let id=uuid::Uuid::new_v4().to_string();
        state.database.transaction(|tx| {
            tx.execute("INSERT INTO music_playlists(id,name,rules,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)",params![id,edit.name.trim(),edit.rules.as_ref().map(|r|json!(r).to_string()),timestamp_ms() as i64]).map_err(sql_error)?;
            if edit.rules.is_none() {write_tracks(tx,&id,&edit.paths)?;}
            Ok(())
        })?;
        Ok(Json(json!({"id":id})))
    }).await.map_err(sql_error)?
}

pub(super) async fn update(
    State(state): State<Shared>,
    Path(id): Path<String>,
    Json(edit): Json<Edit>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        validate(&state, &edit)?;
        state.database.transaction(|tx| {
            let changed = tx
                .execute(
                    "UPDATE music_playlists SET name=?2,rules=?3,updated_at=?4 WHERE id=?1",
                    params![
                        id,
                        edit.name.trim(),
                        edit.rules.as_ref().map(|r| json!(r).to_string()),
                        timestamp_ms() as i64
                    ],
                )
                .map_err(sql_error)?;
            if changed == 0 {
                return Err(AppError::not_found("Playlist not found"));
            }
            write_tracks(
                tx,
                &id,
                if edit.rules.is_some() {
                    &[]
                } else {
                    &edit.paths
                },
            )?;
            Ok(Json(json!({"ok":true})))
        })
    })
    .await
    .map_err(sql_error)?
}

#[derive(Deserialize)]
pub(super) struct Append {
    paths: Vec<String>,
}
pub(super) async fn append(
    State(state): State<Shared>,
    Path(id): Path<String>,
    Json(body): Json<Append>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        validate_paths(&state, &body.paths)?;
        state.database.transaction(|tx| {
            let saved: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM music_playlists WHERE id=?1 AND rules IS NULL)",
                    [&id],
                    |r| r.get(0),
                )
                .map_err(sql_error)?;
            if !saved {
                return Err(AppError::bad(
                    "Choose a saved playlist; smart playlists use rules",
                ));
            }
            let mut st = tx
                .prepare(
                    "SELECT path FROM music_playlist_tracks WHERE playlist_id=?1 ORDER BY position",
                )
                .map_err(sql_error)?;
            let mut paths = st
                .query_map([&id], |r| r.get::<_, String>(0))
                .map_err(sql_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(sql_error)?;
            paths.extend(body.paths);
            if paths.len() > 10000 {
                return Err(AppError::bad("Playlist is full"));
            }
            write_tracks(tx, &id, &paths)?;
            tx.execute(
                "UPDATE music_playlists SET updated_at=?2 WHERE id=?1",
                params![id, timestamp_ms() as i64],
            )
            .map_err(sql_error)?;
            Ok(Json(json!({"ok":true})))
        })
    })
    .await
    .map_err(sql_error)?
}

pub(super) async fn delete(
    State(state): State<Shared>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    state
        .database
        .connection()?
        .execute("DELETE FROM music_playlists WHERE id=?1", [id])
        .map_err(sql_error)?;
    Ok(Json(json!({"ok":true})))
}
pub(super) async fn played(
    State(state): State<Shared>,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    state
        .database
        .connection()?
        .execute(
            "UPDATE music_playlists SET last_played=?2 WHERE id=?1",
            params![id, timestamp_ms() as i64],
        )
        .map_err(sql_error)?;
    Ok(Json(json!({"ok":true})))
}
