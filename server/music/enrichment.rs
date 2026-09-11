use super::catalog::genres;
use crate::{
    activity::sql_error,
    app::{Shared, timestamp_ms},
    error::{AppError, AppResult},
};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

async fn lastfm(
    state: &Shared,
    key: &str,
    method: &str,
    artist: &str,
    track: Option<&str>,
) -> AppResult<Value> {
    let mut query = vec![
        ("method", method),
        ("artist", artist),
        ("api_key", key),
        ("format", "json"),
        ("autocorrect", "1"),
    ];
    if let Some(track) = track {
        query.push(("track", track));
    }
    let response = state
        .client
        .get("https://ws.audioscrobbler.com/2.0/")
        .query(&query)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| AppError::bad("Last.fm is unavailable; cached metadata remains available"))?;
    if !response.status().is_success() {
        return Err(AppError::bad(
            "Last.fm request failed; enrichment will retry",
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| AppError::bad("Last.fm returned invalid metadata"))?;
    if value["error"].is_number() {
        return Err(AppError::bad(
            "Last.fm rejected the request. Check the API key; enrichment will retry.",
        ));
    }
    Ok(value)
}

fn genre_tags(value: &Value) -> Vec<String> {
    let names = value["toptags"]["tag"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .take(20)
                .filter_map(|v| v["name"].as_str())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let normalized = genres(&json!(names));
    let families = [
        "rock",
        "pop",
        "jazz",
        "blues",
        "folk",
        "metal",
        "punk",
        "electronic",
        "ambient",
        "classical",
        "soul",
        "funk",
        "disco",
        "house",
        "techno",
        "trance",
        "dub",
        "reggae",
        "country",
        "hip-hop",
        "rap",
        "r&b",
        "drum and bass",
        "breakbeat",
        "trip-hop",
        "shoegaze",
        "soundtrack",
        "orchestral",
        "synthwave",
        "chillwave",
        "downtempo",
        "industrial",
        "gospel",
        "swing",
        "bluegrass",
        "grunge",
        "idm",
        "edm",
        "lo-fi",
        "world",
        "ska",
        "bossa nova",
        "samba",
        "salsa",
        "flamenco",
        "acoustic",
        "experimental",
    ];
    normalized
        .into_iter()
        .filter(|tag| {
            families.iter().any(|family| {
                tag == family
                    || tag.ends_with(&format!(" {family}"))
                    || tag.starts_with(&format!("{family} "))
                    || tag.ends_with(&format!("-{family}"))
            })
        })
        .take(8)
        .collect()
}

async fn enrich_one(state: &Shared, key: &str) -> AppResult<bool> {
    let row = {
        let c = state.database.connection()?;
        c.query_row(
            "SELECT m.path,m.metadata,m.overrides FROM music_tracks m JOIN music_reviews r
          ON r.path=m.path AND r.version=1 AND r.fingerprint=m.fingerprint AND r.metadata=m.metadata
          AND r.enrichment=m.enrichment AND r.overrides=m.overrides
          WHERE json_extract(r.decision,'$.kind')='song' AND m.enriched_at<?1
          ORDER BY m.enriched_at,m.added_at DESC LIMIT 1",
            [timestamp_ms() as i64 - 30 * 86_400_000],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(sql_error)?
    };
    let Some((path, metadata, overrides)) = row else {
        return Ok(false);
    };
    let mut data: Value = serde_json::from_str(&metadata).unwrap_or(json!({}));
    super::apply_metadata(state, &path, &mut data)?;
    let artist = data["artist"].as_str().unwrap_or("");
    let title = data["title"].as_str().unwrap_or("");
    if artist.is_empty() || title.is_empty() {
        state
            .database
            .connection()?
            .execute(
                "UPDATE music_tracks SET enriched_at=?2 WHERE path=?1",
                params![path, timestamp_ms() as i64],
            )
            .map_err(sql_error)?;
        return Ok(true);
    }
    let cached = {
        let c = state.database.connection()?;
        c.query_row(
            "SELECT data FROM music_artist_cache WHERE artist=?1 AND updated_at>?2",
            params![
                artist.to_lowercase(),
                timestamp_ms() as i64 - 30 * 86_400_000
            ],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(sql_error)?
    };
    let artist_data = if let Some(cached) = cached {
        serde_json::from_str(&cached).unwrap_or(json!({}))
    } else {
        let tags = lastfm(state, key, "artist.getTopTags", artist, None).await?;
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        let similar = lastfm(state, key, "artist.getSimilar", artist, None).await?;
        let names = similar["similarartists"]["artist"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .take(50)
                    .filter_map(|v| v["name"].as_str())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let data = json!({"genre":genre_tags(&tags),"similar":names});
        state.database.connection()?.execute("INSERT INTO music_artist_cache VALUES(?1,?2,?3) ON CONFLICT(artist) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",params![artist.to_lowercase(),data.to_string(),timestamp_ms() as i64]).map_err(sql_error)?;
        data
    };
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let tagged = lastfm(state, key, "track.getTopTags", artist, Some(title)).await?;
    let mut tags = genre_tags(&tagged);
    let source = if tags.is_empty() {
        tags = genres(&artist_data["genre"]);
        "last.fm artist"
    } else {
        "last.fm track"
    };
    state
        .database
        .connection()?
        .execute(
            "UPDATE music_tracks SET enrichment=?2,enriched_at=?3 WHERE path=?1 AND metadata=?4 AND overrides=?5",
            params![
                path,
                json!({"genre":tags,"source":source}).to_string(),
                timestamp_ms() as i64,
                metadata,
                overrides
            ],
        )
        .map_err(sql_error)?;
    Ok(true)
}

pub(super) fn start(state: &Shared) {
    let weak = std::sync::Arc::downgrade(state);
    tokio::spawn(async move {
        let mut due = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            let Some(state) = weak.upgrade() else { break };
            if (timestamp_ms() as i64) < due {
                continue;
            }
            let key = state.config.music.last_fm_api_key.trim();
            if key.is_empty() {
                continue;
            }
            match enrich_one(&state, key).await {
                Ok(worked) => {
                    if worked {
                        let _ = state.database.update(
                            "music-enrichment-status",
                            &state.config.library_key,
                            json!({}),
                            |v| {
                                *v = json!({"lastSuccess":timestamp_ms(),"error":null});
                                Ok(())
                            },
                        );
                    } else {
                        due = timestamp_ms() as i64 + 30_000;
                    }
                }
                Err(error) => {
                    due = timestamp_ms() as i64 + 300_000;
                    let _ = state.database.update(
                        "music-enrichment-status",
                        &state.config.library_key,
                        json!({}),
                        |v| {
                            v["error"] = json!(error.1);
                            Ok(())
                        },
                    );
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_personal_tags_and_normalizes_genres() {
        assert_eq!(
            genre_tags(
                &json!({"toptags":{"tag":[{"name":"seen live"},{"name":"Hip Hop"},{"name":"indie rock"},{"name":"favorites"}]}})
            ),
            vec!["hip-hop", "indie rock"]
        );
    }
}
