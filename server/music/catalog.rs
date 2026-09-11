use crate::{
    activity::sql_error,
    app::{Shared, timestamp_ms},
    error::AppResult,
};
use axum::{
    Json,
    extract::{Query, State},
};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Track {
    pub path: String,
    pub name: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: Vec<String>,
    pub genre_source: String,
    pub duration: f64,
    pub track_number: i64,
    pub year: i64,
    pub liked: bool,
    pub plays: i64,
    pub last_played: i64,
    pub added_at: i64,
    pub skips: i64,
    pub has_artwork: bool,
    #[serde(skip)]
    pub approved: bool,
    #[serde(skip)]
    pub ai_score: f64,
    #[serde(default)]
    pub reason: String,
}

pub(super) fn normalize_genre(value: &str) -> String {
    let value = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    match value.as_str() {
        "hip hop" | "hiphop" => "hip-hop".into(),
        "trip hop" | "triphop" => "trip-hop".into(),
        "neo soul" | "neosoul" => "neo-soul".into(),
        "rnb" | "r&b" | "rhythm and blues" => "r&b".into(),
        "electronica" | "electronica/dance" => "electronic".into(),
        "drum & bass" | "drum n bass" | "dnb" => "drum and bass".into(),
        _ => value,
    }
}

pub(super) fn genres(value: &Value) -> Vec<String> {
    let values = match value {
        Value::Array(items) => items.iter().filter_map(Value::as_str).collect(),
        Value::String(value) => vec![value.as_str()],
        _ => Vec::new(),
    };
    let mut result: Vec<_> = values
        .into_iter()
        .flat_map(|v| v.split([';', ',']))
        .map(normalize_genre)
        .filter(|v| !v.is_empty() && v.len() <= 100)
        .collect();
    result.sort();
    result.dedup();
    result.truncate(20);
    result
}

pub(super) fn tracks(c: &Connection, include_hidden: bool) -> AppResult<Vec<Track>> {
    let mut st = c
        .prepare(
            "SELECT m.path,c.name,m.metadata,m.enrichment,m.overrides,m.added_at,
        coalesce(t.learned_plays,0),coalesce(t.last_played,0),coalesce(f.kind='more',0),
        (SELECT count(*) FROM music_skips s WHERE s.path=m.path AND s.created_at>?1),
        coalesce(v.decision,'null'),
        coalesce(json_extract(m.metadata,'$.hasArtwork'),EXISTS(
          SELECT 1 FROM media_prepared p WHERE p.path=m.path AND p.fingerprint=m.fingerprint
          AND json_extract(p.metadata_json,'$.previewKind')='cover'))
      FROM music_tracks m JOIN media_catalog c ON c.path=m.path
      LEFT JOIN media_totals t ON t.path=m.path LEFT JOIN media_feedback f ON f.path=m.path
      LEFT JOIN music_reviews v ON v.path=m.path AND v.version=1 AND v.fingerprint=m.fingerprint
        AND v.metadata=m.metadata AND v.enrichment=m.enrichment AND v.overrides=m.overrides
      WHERE ?2 OR NOT EXISTS(SELECT 1 FROM media_feedback h WHERE
        (h.path=m.path OR substr(m.path,1,length(h.path)+1)=h.path||'/') AND
        (h.kind='hide' OR h.until>?3)) ORDER BY m.path",
        )
        .map_err(sql_error)?;
    st.query_map(
        params![
            timestamp_ms() as i64 - 30 * 86_400_000,
            include_hidden,
            timestamp_ms() as i64
        ],
        |r| {
            let mut metadata: Value =
                serde_json::from_str(&r.get::<_, String>(2)?).unwrap_or(json!({}));
            let extra: Value = serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or(json!({}));
            let overrides: Value =
                serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or(json!({}));
            let mut genre = genres(&metadata["genre"]);
            let mut source = if genre.is_empty() {
                "unknown"
            } else {
                "embedded"
            }
            .to_string();
            if !genres(&extra["genre"]).is_empty() {
                if genre.is_empty() {
                    source = extra["source"].as_str().unwrap_or("last.fm").into();
                } else {
                    source = "embedded + last.fm".into();
                }
                genre.extend(genres(&extra["genre"]));
                genre.sort();
                genre.dedup();
            }
            if let Some(fields) = overrides.as_object() {
                for (key, value) in fields {
                    metadata[key] = value.clone();
                }
                if fields.contains_key("genre") {
                    genre = genres(&overrides["genre"]);
                    source = "custom".into();
                }
            }
            let name: String = r.get(1)?;
            let title = metadata["title"]
                .as_str()
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| name.rsplit_once('.').map(|v| v.0).unwrap_or(&name))
                .to_string();
            let mut track = Track {
                path: r.get(0)?,
                name,
                title,
                artist: metadata["artist"].as_str().unwrap_or("").into(),
                album: metadata["album"].as_str().unwrap_or("").into(),
                album_artist: metadata["albumArtist"].as_str().unwrap_or("").into(),
                genre,
                genre_source: source,
                duration: metadata["duration"].as_f64().unwrap_or(0.0),
                track_number: metadata["trackNumber"].as_i64().unwrap_or(0),
                year: metadata["year"].as_i64().unwrap_or(0),
                added_at: r.get(5)?,
                plays: r.get(6)?,
                last_played: r.get(7)?,
                liked: r.get(8)?,
                skips: r.get(9)?,
                has_artwork: r.get(11)?,
                approved: false,
                ai_score: 0.0,
                reason: String::new(),
            };
            let review: Value = serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or_default();
            super::curation::apply(&mut track, &review);
            Ok(track)
        },
    )
    .map_err(sql_error)?
    .collect::<Result<Vec<_>, _>>()
    .map_err(sql_error)
}

pub(super) fn approved_tracks(c: &Connection) -> AppResult<Vec<Track>> {
    Ok(tracks(c, false)?
        .into_iter()
        .filter(|t| t.approved)
        .collect())
}

pub(super) fn unique_songs(mut items: Vec<Track>) -> Vec<Track> {
    items.sort_by(|a, b| {
        b.liked
            .cmp(&a.liked)
            .then(b.plays.cmp(&a.plays))
            .then(b.has_artwork.cmp(&a.has_artwork))
            .then(a.path.len().cmp(&b.path.len()))
            .then(a.path.cmp(&b.path))
    });
    let mut seen = std::collections::HashSet::new();
    items.retain(|track| {
        let key = if track.artist.is_empty() || track.title.is_empty() {
            track.path.clone()
        } else {
            format!(
                "{}\0{}",
                track.artist.trim().to_lowercase(),
                track.title.trim().to_lowercase()
            )
        };
        seen.insert(key)
    });
    items
}

#[derive(Default, Deserialize)]
pub(super) struct Search {
    q: Option<String>,
    genre: Option<String>,
    path: Option<String>,
    offset: Option<usize>,
}

pub(super) async fn search(
    State(state): State<Shared>,
    Query(query): Query<Search>,
) -> AppResult<Json<Value>> {
    let work = state.clone();
    tokio::task::spawn_blocking(move || {
        let c = work.database.connection()?;
        let q = query.q.unwrap_or_default().to_lowercase();
        let genre = query.genre.map(|g| normalize_genre(&g));
        let items:Vec<_> = tracks(&c, true)?.into_iter().filter(|t|
            (query.path.is_some() || t.approved) && query.path.as_ref().is_none_or(|p| *p==t.path) &&
            genre.as_ref().is_none_or(|g| t.genre.contains(g)) &&
            (q.is_empty() || format!("{} {} {} {}",t.title,t.artist,t.album,t.path).to_lowercase().contains(&q)))
            .collect();
        let count = items.len();
        Ok(Json(json!({"items":items.into_iter().skip(query.offset.unwrap_or(0)).take(100).collect::<Vec<_>>(),"total":count})))
    }).await.map_err(sql_error)?
}

#[derive(Deserialize)]
pub(super) struct HomeQuery {
    pub genre: Option<String>,
}

pub(super) async fn refresh(State(state): State<Shared>) -> Json<Value> {
    state.media_ai.request_catalog_scan();
    if state.config.media_ai.enabled {
        state.media_ai.request_music_review();
    }
    Json(json!({"ok":true}))
}

fn artist_key(track: &Track) -> String {
    if track.artist.trim().is_empty() {
        track.path.clone()
    } else {
        track.artist.trim().to_lowercase()
    }
}

fn varied<T>(mut items: Vec<T>, artist: impl Fn(&T) -> String, limit: usize) -> Vec<T> {
    let mut counts = HashMap::<String, usize>::new();
    let mut selected = Vec::new();
    while !items.is_empty() && selected.len() < limit {
        let index = items
            .iter()
            .enumerate()
            .min_by_key(|(_, item)| counts.get(&artist(item)).copied().unwrap_or(0))
            .unwrap()
            .0;
        let item = items.remove(index);
        *counts.entry(artist(&item)).or_default() += 1;
        selected.push(item);
    }
    selected
}

pub(super) fn home_mixes(all: &[Track], radio: &Value) -> Value {
    struct Mix<'a> {
        genre: String,
        items: Vec<&'a Track>,
        artists: BTreeMap<String, f64>,
    }
    let tracks: HashMap<_, _> = all
        .iter()
        .map(|track| (track.path.as_str(), track))
        .collect();
    let mut candidates = Vec::new();
    for station in radio["stations"].as_array().into_iter().flatten() {
        let Some(genre) = station["genre"].as_str().filter(|g| !g.is_empty()) else {
            continue;
        };
        let items: Vec<_> = station["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|p| p.as_str())
            .filter_map(|p| tracks.get(p).copied())
            .filter(|t| t.genre.iter().any(|g| g == genre))
            .collect();
        let items = varied(items, |t| artist_key(t), 12);
        let mut artists = BTreeMap::<String, f64>::new();
        for item in &items {
            if !item.artist.trim().is_empty() {
                artists
                    .entry(artist_key(item))
                    .and_modify(|score| *score = score.max(item.ai_score))
                    .or_insert(item.ai_score);
            }
        }
        if artists.len() >= 2 {
            candidates.push(Mix {
                genre: genre.into(),
                items,
                artists,
            });
        }
    }
    let mut selected = Vec::new();
    let mut used_artists = HashMap::<String, usize>::new();
    let mut used_paths = HashSet::<String>::new();
    while selected.len() < 6 {
        let score = |mix: &Mix<'_>| {
            mix.artists
                .iter()
                .map(|(artist, fit)| {
                    fit / (1 + used_artists.get(artist).copied().unwrap_or(0)) as f64
                })
                .sum::<f64>()
                / mix.artists.len() as f64
        };
        let next = candidates
            .iter()
            .enumerate()
            .filter(|(_, mix)| {
                mix.artists
                    .keys()
                    .any(|artist| !used_artists.contains_key(artist))
                    && mix
                        .items
                        .iter()
                        .filter(|t| !used_paths.contains(&t.path))
                        .count()
                        * 2
                        >= mix.items.len()
            })
            .max_by(|(_, a), (_, b)| {
                score(a)
                    .total_cmp(&score(b))
                    .then(a.artists.len().cmp(&b.artists.len()))
                    .then(b.genre.cmp(&a.genre))
            })
            .map(|(index, _)| index);
        let Some(index) = next else { break };
        let mix = candidates.remove(index);
        for track in &mix.items {
            used_paths.insert(track.path.clone());
            *used_artists.entry(artist_key(track)).or_default() += 1;
        }
        selected.push(json!({"genre":mix.genre,"count":mix.items.len(),"items":mix.items}));
    }
    json!(selected)
}

pub(super) fn home_sections(all: &[Track], genre: Option<&str>) -> Value {
    let items: Vec<_> = all
        .iter()
        .filter(|t| genre.is_none_or(|g| t.genre.iter().any(|v| v == g)))
        .collect();
    let now = timestamp_ms() as i64;
    let mut rows = Vec::new();
    let mut recent: Vec<_> = items
        .iter()
        .copied()
        .filter(|t| t.last_played > 0)
        .collect();
    recent.sort_by_key(|t| std::cmp::Reverse(t.last_played));
    if !recent.is_empty() {
        rows.push(json!({"id":"recent","title":"Recently played","items":recent.into_iter().take(6).collect::<Vec<_>>()}));
    }
    let mut repeat: Vec<_> = items
        .iter()
        .copied()
        .filter(|t| t.liked || (t.plays > 0 && now - t.last_played < 30 * 86_400_000))
        .collect();
    repeat.sort_by_key(|t| std::cmp::Reverse((t.liked, t.plays, t.last_played)));
    if !repeat.is_empty() {
        rows.push(json!({"id":"repeat","title":"On repeat","items":repeat.into_iter().take(6).collect::<Vec<_>>()}));
    }
    let mut recommended: Vec<_> = items
        .iter()
        .copied()
        .filter(|t| t.ai_score >= 50.0)
        .collect();
    recommended.sort_by(|a, b| b.ai_score.total_cmp(&a.ai_score).then(a.path.cmp(&b.path)));
    if !recommended.is_empty() {
        rows.push(json!({"id":"recommended","title":"Recommended","items":varied(recommended.clone(), |t|artist_key(t), if genre.is_some() {24} else {8})}));
    }
    let rediscover: Vec<_> = recommended
        .iter()
        .filter(|t| t.plays > 0 && now - t.last_played > 14 * 86_400_000)
        .take(6)
        .collect();
    if !rediscover.is_empty() {
        rows.push(json!({"id":"rediscover","title":"Rediscover","items":rediscover}));
    }
    let mut albums = HashMap::<(String, String), Vec<&Track>>::new();
    for item in &recommended {
        if !item.album.is_empty() && !item.artist.is_empty() {
            let artist = if item.album_artist.is_empty() {
                &item.artist
            } else {
                &item.album_artist
            };
            albums
                .entry((
                    artist.trim().to_lowercase(),
                    item.album.trim().to_lowercase(),
                ))
                .or_default()
                .push(item);
        }
    }
    let mut albums: Vec<_> = albums
        .into_values()
        .filter(|items| items.len() > 1)
        .collect();
    albums.sort_by(|a, b| {
        let score = |items: &Vec<&Track>| {
            items.iter().map(|t| t.ai_score).sum::<f64>() / items.len() as f64
        };
        score(b)
            .total_cmp(&score(a))
            .then(a[0].album.cmp(&b[0].album))
            .then(a[0].artist.cmp(&b[0].artist))
    });
    let albums: Vec<_> = varied(albums, |tracks|artist_key(tracks[0]), 6).into_iter().map(|mut tracks| {
        tracks.sort_by_key(|t|(t.track_number,t.path.clone()));
        let first = tracks[0];
        let artist = if first.album_artist.is_empty() {&first.artist} else {&first.album_artist};
        json!({"title":first.album,"artist":artist,"cover":tracks.iter().find(|t|t.has_artwork).or_else(||tracks.first()),"items":tracks})
    }).collect();
    json!({"rows":rows,"albums":albums,"mixes":[]})
}

pub(super) async fn home(
    State(state): State<Shared>,
    Query(query): Query<HomeQuery>,
) -> AppResult<Json<Value>> {
    tokio::task::spawn_blocking(move || {
        let c = state.database.connection()?;
        let enabled = state.config.media_ai.enabled;
        let approved = if enabled {
            approved_tracks(&c)?
        } else {
            vec![]
        };
        let items = unique_songs(approved.clone());
        let genres: std::collections::BTreeSet<_> =
            items.iter().flat_map(|t| t.genre.iter().cloned()).collect();
        let genre = query
            .genre
            .map(|g| normalize_genre(&g))
            .filter(|g| !g.is_empty());
        let mut result = home_sections(&items, genre.as_deref());
        result["total"] = json!(items.len());
        result["radio"] = super::radio::snapshot(&c, &approved)?;
        if genre.is_none() {
            result["mixes"] = home_mixes(&approved, &result["radio"]);
        }
        result["genres"] = json!(genres);
        result["genreViews"] = if genre.is_none() {
            Value::Object(
                genres
                    .iter()
                    .map(|g| (g.clone(), home_sections(&items, Some(g))))
                    .collect(),
            )
        } else {
            json!({})
        };
        result["aiEnabled"] = json!(enabled);
        result["paused"] = json!(state.config.media_ai.paused);
        result["searchEnabled"] = json!(state.config.file_search.enabled);
        let status = state.database.document(
            "music-curation-status",
            &state.config.library_key,
            json!({}),
        )?;
        result["curationError"] = status["error"].clone();
        Ok(Json(result))
    })
    .await
    .map_err(sql_error)?
}

pub(super) fn start(state: &Shared) {
    let weak = std::sync::Arc::downgrade(state);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let Some(state) = weak.upgrade() else { break };
            let work = state.clone();
            let pending=tokio::task::spawn_blocking(move || -> AppResult<Vec<(String,String)>> {
                let c=work.database.connection()?;
                c.execute("DELETE FROM music_tracks WHERE NOT EXISTS(SELECT 1 FROM media_catalog c WHERE c.path=music_tracks.path)",[]).map_err(sql_error)?;
                let mut st=c.prepare("SELECT c.path,c.fingerprint FROM media_catalog c LEFT JOIN music_tracks m ON m.path=c.path WHERE c.kind='audio' AND (m.path IS NULL OR m.fingerprint!=c.fingerprint) ORDER BY c.id LIMIT 100").map_err(sql_error)?;
                st.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(sql_error)?.collect::<Result<Vec<_>,_>>().map_err(sql_error)
            }).await;
            let Ok(Ok(pending)) = pending else { continue };
            for (path, fingerprint) in pending {
                let Ok(full) = crate::media::resolve(&state.config, &path) else {
                    continue;
                };
                let mut data = crate::routes::media::audio_metadata_path(&full.full)
                    .await
                    .map(|v| v.0)
                    .unwrap_or(json!({}));
                if let Some(object) = data.as_object_mut() {
                    let has_artwork = object.remove("coverArt").is_some_and(|v| v.is_string());
                    object.insert("hasArtwork".into(), json!(has_artwork));
                }
                let Ok(c) = state.database.connection() else {
                    continue;
                };
                let _=c.execute("INSERT INTO music_tracks(path,fingerprint,metadata,added_at) SELECT ?1,?2,?3,?4 WHERE EXISTS(SELECT 1 FROM media_catalog WHERE path=?1 AND fingerprint=?2) ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint,metadata=excluded.metadata,enrichment='{}',enriched_at=0",params![path,fingerprint,data.to_string(),timestamp_ms() as i64]);
            }
        }
    });
}
