use super::catalog::{Track, genres};
use crate::{
    activity::sql_error,
    app::{Shared, timestamp_ms},
    error::{AppError, AppResult},
};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

const VERSION: i64 = 1;
const BATCH_SIZE: usize = 24;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Review {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genres: Vec<String>,
    pub score: f64,
    pub reason: String,
}

#[derive(Clone)]
struct Candidate {
    id: i64,
    path: String,
    fingerprint: String,
    metadata: String,
    enrichment: String,
    overrides: String,
    description: String,
    tags: String,
    duration: f64,
}

pub(super) fn initialize(c: &Connection) -> AppResult<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS music_reviews (
          path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, metadata TEXT NOT NULL,
          enrichment TEXT NOT NULL, overrides TEXT NOT NULL, decision TEXT NOT NULL,
          score REAL NOT NULL, profile_key TEXT NOT NULL, version INTEGER NOT NULL,
          reviewed_at INTEGER NOT NULL);
         CREATE INDEX IF NOT EXISTS music_reviews_score ON music_reviews(score DESC);
         CREATE TABLE IF NOT EXISTS music_radio_cache (
          id TEXT PRIMARY KEY, selection TEXT NOT NULL, created_at INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS music_radio_stations (
          id TEXT PRIMARY KEY, context TEXT NOT NULL, selection TEXT NOT NULL,
          profile_key TEXT NOT NULL, created_at INTEGER NOT NULL);",
    )
    .map_err(sql_error)
}

pub(super) fn pending(c: &Connection, profile: &str) -> AppResult<i64> {
    c.query_row(
        "SELECT count(*) FROM music_tracks m JOIN media_catalog c ON c.path=m.path
         LEFT JOIN music_reviews r ON r.path=m.path
         WHERE r.path IS NULL OR r.version!=?1 OR r.fingerprint!=m.fingerprint
           OR r.metadata!=m.metadata OR r.enrichment!=m.enrichment OR r.overrides!=m.overrides
           OR (r.profile_key!=?2 AND json_extract(r.decision,'$.kind')='song')",
        params![VERSION, profile],
        |r| r.get(0),
    )
    .map_err(sql_error)
}

pub fn needs_review(state: &Shared, profile: &str) -> AppResult<bool> {
    Ok(pending(&state.database.connection()?, profile)? > 0)
}

fn candidates(state: &Shared, profile: &str) -> AppResult<Vec<Candidate>> {
    let c = state.database.connection()?;
    let mut st = c
        .prepare(
            "SELECT c.id,m.path,m.fingerprint,m.metadata,m.enrichment,m.overrides,
                c.description,c.tags,coalesce(json_extract(m.metadata,'$.duration'),c.duration,0)
         FROM music_tracks m JOIN media_catalog c ON c.path=m.path
         LEFT JOIN music_reviews r ON r.path=m.path
         LEFT JOIN media_totals t ON t.path=m.path
         LEFT JOIN media_feedback f ON f.path=m.path
         WHERE r.path IS NULL OR r.version!=?1 OR r.fingerprint!=m.fingerprint
           OR r.metadata!=m.metadata OR r.enrichment!=m.enrichment OR r.overrides!=m.overrides
           OR (r.profile_key!=?2 AND json_extract(r.decision,'$.kind')='song')
         ORDER BY coalesce(f.kind='more',0) DESC,coalesce(t.learned_plays,0) DESC,
           (coalesce(json_extract(m.metadata,'$.duration'),c.duration,0) BETWEEN 30 AND 1200) DESC,
           (coalesce(json_extract(m.metadata,'$.artist'),'')!='') DESC,
           ((c.id*1103515245)%2147483647),c.id LIMIT ?3",
        )
        .map_err(sql_error)?;
    st.query_map(
        params![
            VERSION,
            profile,
            if state.config.media_ai.provider == "compatible" {
                12
            } else {
                BATCH_SIZE as i64
            }
        ],
        |r| {
            Ok(Candidate {
                id: r.get(0)?,
                path: r.get(1)?,
                fingerprint: r.get(2)?,
                metadata: r.get(3)?,
                enrichment: r.get(4)?,
                overrides: r.get(5)?,
                description: r.get(6)?,
                tags: r.get(7)?,
                duration: r.get(8)?,
            })
        },
    )
    .map_err(sql_error)?
    .collect::<Result<Vec<_>, _>>()
    .map_err(sql_error)
}

pub(super) fn short(value: &str, count: usize) -> String {
    value.chars().take(count).collect()
}

fn metadata_evidence(raw: &str) -> Value {
    let value: Value = serde_json::from_str(raw).unwrap_or_default();
    let mut result = json!({});
    for key in ["title", "artist", "album", "albumArtist", "source"] {
        if let Some(text) = value[key].as_str() {
            result[key] = json!(short(text, 300));
        }
    }
    for key in ["year", "trackNumber", "duration"] {
        if value[key].is_number() {
            result[key] = value[key].clone();
        }
    }
    if !value["genre"].is_null() {
        result["genre"] = json!(genres(&value["genre"]));
    }
    result
}

fn schema(ids: &[i64]) -> Value {
    json!({"type":"object","properties":{"musicReviews":{"type":"array","items":{
        "type":"object","properties":{
            "id":{"type":"integer","enum":ids},
            "kind":{"type":"string","enum":["song","effect","speech","unknown"]},
            "title":{"type":"string"},"artist":{"type":"string"},"album":{"type":"string"},
            "genres":{"type":"array","items":{"type":"string"}},
            "score":{"type":"number","minimum":0,"maximum":100},"reason":{"type":"string"}
        },"required":["id","kind","title","artist","album","genres","score","reason"],
        "additionalProperties":false
    }}},"required":["musicReviews"],"additionalProperties":false})
}

fn validate(value: Value, ids: &[i64]) -> AppResult<Vec<Review>> {
    let reviews: Vec<Review> = serde_json::from_value(value["musicReviews"].clone())
        .map_err(|_| AppError::bad("AI returned invalid music reviews"))?;
    let mut seen = HashSet::new();
    if reviews.len() != ids.len()
        || reviews.iter().any(|r| {
            !ids.contains(&r.id)
                || !seen.insert(r.id)
                || !["song", "effect", "speech", "unknown"].contains(&r.kind.as_str())
                || !r.score.is_finite()
                || !(0.0..=100.0).contains(&r.score)
                || r.title.len() > 1000
                || r.artist.len() > 1000
                || r.album.len() > 1000
                || r.reason.len() > 1000
                || r.genres.len() > 8
                || r.genres.iter().any(|g| g.is_empty() || g.len() > 100)
                || (r.kind != "song" && (r.score != 0.0 || !r.genres.is_empty()))
        })
    {
        return Err(AppError::bad(
            "AI music reviews did not match the requested files",
        ));
    }
    Ok(reviews)
}

pub async fn review_batch(state: &Shared, profile: &str) -> AppResult<bool> {
    let mut list = candidates(state, profile)?;
    if list.is_empty() {
        return Ok(false);
    }
    let c = state.database.connection()?;
    let mut folders = HashMap::new();
    for item in &list {
        let parent = crate::app::parent_logical(&item.path);
        if folders.contains_key(&parent) {
            continue;
        }
        let (count,clips):(i64,i64) = c.query_row(
            "SELECT count(*),coalesce(sum(coalesce(json_extract(m.metadata,'$.duration'),c.duration,0) BETWEEN 0.01 AND 10),0)
             FROM media_catalog c LEFT JOIN music_tracks m ON m.path=c.path
             WHERE c.kind='audio' AND substr(c.path,1,length(c.path)-length(c.name)-1)=?1",
            [&parent], |r|Ok((r.get(0)?,r.get(1)?)),
        ).map_err(sql_error)?;
        folders.insert(
            parent,
            json!({"audioFiles":count,"clipsUnder10Seconds":clips}),
        );
    }
    drop(c);
    let profile_data = crate::media_ai::music_profile(state)?;
    let prompt = loop {
        let items: Vec<_> = list
            .iter()
            .map(|item| {
                let metadata = metadata_evidence(&item.metadata);
                let overrides = metadata_evidence(&item.overrides);
                let enrichment = metadata_evidence(&item.enrichment);
                json!({"id":item.id,"path":short(&item.path,700),"duration":item.duration,
                "embeddedMetadata":metadata,"userCorrections":overrides,"serviceTags":enrichment,
                "existingAnalysis":short(&item.description,400),"searchTags":short(&item.tags,350),
                "folder":folders.get(&crate::app::parent_logical(&item.path))})
            })
            .collect();
        let prompt = json!({"profile":profile_data,"items":items}).to_string();
        if prompt.len() <= 35_000 {
            break prompt;
        }
        if list.len() == 1 {
            return Err(AppError::bad("Music metadata exceeds the review budget"));
        }
        list.pop();
    };
    let ids: Vec<_> = list.iter().map(|v| v.id).collect();
    let value=crate::media_ai::provider::generate(&state.config.media_ai,
        "Curate a music listening library. Review EVERY supplied file. Classify it as song (a complete musical piece meant to be listened to), effect (a hit, instrument sample, loop, UI sound, game effect or production asset), speech (spoken material), or unknown. A music filename, artist, album or genre tag is NOT sufficient evidence: sample packs often contain all of them. Use duration, folder context and the existing analysis together. A game or project folder can contain both real songs and incidental assets; judge individual files without blanket folder exclusions. Do not approve an entire sound bank as an album. For songs, recover title and artist from clear supplied filename/folder evidence when embedded fields are missing or corrupt; leave fields empty when uncertain. Keep album only when evidence supports a real musical release. Return at most four canonical musical genres supported by the evidence, normalize aliases, and discard websites, uploader credits, years, placeholders, franchise names, software names and instrument/sample labels. Genre uncertainty means an empty list, not invented tags. User corrections take priority. Score PERSONAL recommendation fit using the supplied history/likes: 90-100 strong fit, 70-89 good fit, 50-69 justified discovery, below 50 unsupported. Ownership alone is not evidence of taste. Effects, speech and unknown files must have score 0 and no genres. Give a short concrete reason, at most 140 characters. Do not claim to have listened. Return every supplied ID exactly once.",
        &prompt,&[],schema(&ids)).await?;
    let reviews = validate(value, &ids)?;
    if crate::media_ai::music_profile_key(state)? != profile {
        return Ok(false);
    }
    state.database.transaction(|tx| {
        for review in reviews {
            let item=list.iter().find(|item|item.id==review.id).unwrap();
            tx.execute(
                "INSERT INTO music_reviews(path,fingerprint,metadata,enrichment,overrides,decision,score,profile_key,version,reviewed_at)
                 SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE EXISTS(
                   SELECT 1 FROM music_tracks m JOIN media_catalog c ON c.path=m.path
                   WHERE m.path=?1 AND m.fingerprint=?2 AND m.metadata=?3 AND m.enrichment=?4 AND m.overrides=?5)
                 ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint,metadata=excluded.metadata,
                   enrichment=excluded.enrichment,overrides=excluded.overrides,decision=excluded.decision,
                   score=excluded.score,profile_key=excluded.profile_key,version=excluded.version,reviewed_at=excluded.reviewed_at",
                params![item.path,item.fingerprint,item.metadata,item.enrichment,item.overrides,
                    json!(review).to_string(),review.score,profile,VERSION,timestamp_ms() as i64],
            ).map_err(sql_error)?;
        }
        Ok(())
    })?;
    Ok(true)
}

pub(super) fn apply(track: &mut Track, value: &Value) {
    track.approved = value["kind"] == "song";
    track.ai_score = value["score"].as_f64().unwrap_or(0.0);
    if !track.approved {
        return;
    }
    if let Some(title) = value["title"].as_str().filter(|s| !s.trim().is_empty()) {
        track.title = title.trim().into();
    }
    track.artist = value["artist"].as_str().unwrap_or("").trim().into();
    track.album = value["album"].as_str().unwrap_or("").trim().into();
    track.album_artist = track.artist.clone();
    track.genre = genres(&value["genres"]);
    track.genre_source = "ai".into();
    track.reason = value["reason"].as_str().unwrap_or("").into();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn review_responses_must_cover_exactly_the_requested_files() {
        let song = json!({"id":1,"kind":"song","title":"Song","artist":"Artist","album":"","genres":["jazz"],"score":80,"reason":"Matches your likes"});
        assert!(validate(json!({"musicReviews":[song.clone()]}), &[1]).is_ok());
        assert!(validate(json!({"musicReviews":[song.clone()]}), &[1, 2]).is_err());
        assert!(validate(json!({"musicReviews":[song.clone(),song.clone()]}), &[1, 2]).is_err());
        assert!(validate(json!({"musicReviews":[song]}), &[2]).is_err());
        let effect = json!({"id":1,"kind":"effect","title":"Hit","artist":"","album":"","genres":["rock"],"score":80,"reason":""});
        assert!(validate(json!({"musicReviews":[effect]}), &[1]).is_err());
    }
}
