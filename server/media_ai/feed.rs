use crate::{
    activity::sql_error,
    app::{Shared, timestamp_ms},
    error::{AppError, AppResult},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const PAGE_SIZE: usize = 24;
const RESERVE: usize = 192;
const MAX_FEED: usize = 2048;
const MIN_SCORE: f64 = 50.0;
const DAY: i64 = 86_400_000;

pub fn initialize(c: &Connection) -> AppResult<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_rankings (
           library_key TEXT NOT NULL, path TEXT NOT NULL, item_json TEXT NOT NULL,
           score REAL NOT NULL, profile_key TEXT NOT NULL, ranked_at INTEGER NOT NULL,
           shown INTEGER NOT NULL DEFAULT 0, last_shown INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY(library_key,path));
         CREATE TABLE IF NOT EXISTS media_prepared (
           library_key TEXT NOT NULL, path TEXT NOT NULL, fingerprint TEXT NOT NULL, metadata_json TEXT NOT NULL,
           PRIMARY KEY(library_key,path));
         CREATE INDEX IF NOT EXISTS media_rankings_ready ON media_rankings(library_key,score);
         CREATE INDEX IF NOT EXISTS media_rankings_mix ON media_rankings(library_key,last_shown,score DESC);
         CREATE INDEX IF NOT EXISTS media_rankings_reserve ON media_rankings(library_key,profile_key,shown,ranked_at);
         CREATE TABLE IF NOT EXISTS media_feeds (
           id TEXT PRIMARY KEY, library_key TEXT NOT NULL, paths_json TEXT NOT NULL,
           created_at INTEGER NOT NULL, hour INTEGER NOT NULL, seen_cursor INTEGER NOT NULL DEFAULT 0);
         CREATE INDEX IF NOT EXISTS media_feeds_recent ON media_feeds(library_key,created_at);",
    ).map_err(sql_error)
}

pub fn invalidate_paths(c: &Connection, path: &str) -> AppResult<()> {
    c.execute("DELETE FROM media_rankings WHERE path=?1 OR substr(path,1,length(?1)+1)=?1||'/' OR (json_extract(item_json,'$.type')='folder' AND substr(?1,1,length(path)+1)=path||'/')", [path]).map_err(sql_error)?;
    c.execute(
        "DELETE FROM media_prepared WHERE path=?1 OR substr(path,1,length(?1)+1)=?1||'/'",
        [path],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub fn profile_key(state: &Shared) -> AppResult<String> {
    let c = state.database.connection()?;
    let mut st = c
        .prepare("SELECT path,kind FROM media_feedback ORDER BY path")
        .map_err(sql_error)?;
    let feedback = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    let mut st = c.prepare("SELECT path,learned_plays FROM media_totals WHERE learned_plays>0 ORDER BY learned_plays DESC,path LIMIT 64").map_err(sql_error)?;
    let plays = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    let reset =
        state
            .database
            .document("media-ai-profile", &state.config.library_key, json!({}))?;
    let evidence = json!([
        state.settings.favorites()?,
        feedback,
        plays,
        reset["resetAt"]
    ]);
    Ok(Sha256::digest(evidence.to_string().as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

pub fn store_rankings(state: &Shared, items: &[Value], profile: &str) -> AppResult<()> {
    if profile != "previous-feed" && profile_key(state)? != profile {
        return Ok(());
    }
    state.database.transaction(|tx| {
        for item in items {
            let Some(path) = item["path"].as_str() else { continue };
            let score = item["aiScore"].as_f64().unwrap_or(0.0).clamp(0.0, 100.0);
            tx.execute(
                "INSERT INTO media_rankings(library_key,path,item_json,score,profile_key,ranked_at)
                 VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(library_key,path) DO UPDATE SET
                 item_json=excluded.item_json,score=excluded.score,profile_key=excluded.profile_key,ranked_at=excluded.ranked_at",
                params![state.config.library_key,path,item.to_string(),score,profile,timestamp_ms() as i64],
            ).map_err(sql_error)?;
        }
        Ok(())
    })
}

pub fn excluded_ids(state: &Shared, profile: &str) -> AppResult<Vec<i64>> {
    let c = state.database.connection()?;
    let mut st = c.prepare("SELECT json_extract(item_json,'$.id') FROM media_rankings WHERE library_key=?1 AND profile_key=?2 AND ranked_at>?3").map_err(sql_error)?;
    st.query_map(
        params![
            state.config.library_key,
            profile,
            timestamp_ms() as i64 - DAY
        ],
        |r| r.get(0),
    )
    .map_err(sql_error)?
    .collect::<Result<_, _>>()
    .map_err(sql_error)
}

fn import_previous_feed(state: &Shared) -> AppResult<()> {
    if state.database.document(
        "media-ai-ranking-import",
        &state.config.library_key,
        json!(false),
    )? == true
    {
        return Ok(());
    }
    let old = state
        .database
        .document("media-ai-home", &state.config.library_key, json!({}))?;
    let items: Vec<_> = old["rows"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|row| row["items"].as_array().into_iter().flatten())
        .filter(|item| item["previewReady"] == true)
        .map(|item| {
            let mut item = item.clone();
            // These cards already passed the previous model's preview review.
            item["aiScore"] = json!(75);
            item
        })
        .collect();
    store_rankings(state, &items, "previous-feed")?;
    state.database.update(
        "media-ai-ranking-import",
        &state.config.library_key,
        json!(false),
        |v| {
            *v = json!(true);
            Ok(())
        },
    )
}

pub fn needs_ranking(state: &Shared, profile: &str) -> AppResult<bool> {
    let progress = state.database.document(
        "media-ai-ranking-progress",
        &state.config.library_key,
        json!({}),
    )?;
    let now = timestamp_ms() as i64;
    if progress["version"] == 1
        && progress["profile"] == profile
        && progress["retryAt"].as_i64().unwrap_or(0) > now
    {
        return Ok(false);
    }
    let c = state.database.connection()?;
    let ready: i64 = c
        .query_row(
            "SELECT count(*) FROM media_rankings r WHERE library_key=?1 AND score>=?2
         AND shown=0 AND profile_key=?3 AND ranked_at>?4
         AND NOT EXISTS(SELECT 1 FROM media_feedback f WHERE
           (r.path=f.path OR substr(r.path,1,length(f.path)+1)=f.path||'/') AND
           (f.kind='hide' OR f.until>?5))",
            params![state.config.library_key, MIN_SCORE, profile, now - DAY, now],
            |r| r.get(0),
        )
        .map_err(sql_error)?;
    Ok(ready < RESERVE as i64)
}

pub fn ranking_finished(state: &Shared, profile: &str, worked: bool, error: bool) -> AppResult<()> {
    state.database.update("media-ai-ranking-progress", &state.config.library_key, json!({}), |v| {
        *v = json!({"version":1,"profile":profile,"retryAt":if worked {0} else {timestamp_ms() as i64 + if error {30_000} else {3_600_000}},"error":error});
        Ok(())
    })
}

#[derive(Clone)]
struct Candidate {
    path: String,
    score: f64,
    shown: i64,
    last_shown: i64,
    plays: i64,
    last_played: i64,
    liked: bool,
    favorite: bool,
    habit: bool,
    familiar: bool,
    folder: bool,
}

fn related(path: &str, parent: &str) -> bool {
    path == parent
        || path
            .strip_prefix(parent)
            .is_some_and(|tail| tail.starts_with('/'))
}

fn weight(item: &Candidate, now: i64) -> f64 {
    let quality = ((item.score - 35.0) / 65.0).max(0.05).powi(3);
    let recent = if now - item.last_shown < 600_000 {
        0.12
    } else {
        1.0
    };
    let played = if now - item.last_played < 3_600_000 {
        0.35
    } else {
        1.0
    };
    let preference = 1.0
        + if item.liked { 0.5 } else { 0.0 }
        + if item.favorite { 0.3 } else { 0.0 }
        + if item.habit { 0.12 } else { 0.0 }
        + (item.plays as f64).ln_1p().min(3.0) * 0.05;
    quality * recent * played * preference / (1.0 + (item.shown as f64).ln_1p() * 0.15)
}

fn mix(items: &[Candidate], seed: &str, now: i64) -> Vec<String> {
    let mut ordered: Vec<_> = items
        .iter()
        .filter(|v| v.score >= MIN_SCORE)
        .map(|item| {
            let hash = Sha256::digest(format!("{seed}:{}", item.path).as_bytes());
            let bits = u64::from_le_bytes(hash[..8].try_into().unwrap()) >> 11;
            let uniform = (bits as f64 + 1.0) / ((1u64 << 53) as f64 + 1.0);
            (item, -uniform.ln() / weight(item, now))
        })
        .collect();
    ordered.sort_by(|a, b| a.1.total_cmp(&b.1));
    let mut selected: Vec<&Candidate> = Vec::new();
    let mut seen = HashSet::new();
    while selected.len() < items.len().min(MAX_FEED) {
        let slot = selected.len();
        let page = &selected[slot / PAGE_SIZE * PAGE_SIZE..];
        let matches_lane = |item: &Candidate| match slot % 10 {
            6 | 7 => item.familiar,
            8 => !item.familiar,
            _ => true,
        };
        let varied = |item: &Candidate| {
            let parent = crate::app::parent_logical(&item.path);
            page.iter()
                .filter(|other| crate::app::parent_logical(&other.path) == parent)
                .count()
                < 3
                && !page.iter().any(|other| {
                    other.folder && related(&item.path, &other.path)
                        || item.folder && related(&other.path, &item.path)
                })
        };
        let next = ordered
            .iter()
            .find(|(v, _)| !seen.contains(&v.path) && matches_lane(v) && varied(v))
            .or_else(|| {
                ordered
                    .iter()
                    .find(|(v, _)| !seen.contains(&v.path) && varied(v))
            })
            .or_else(|| ordered.iter().find(|(v, _)| !seen.contains(&v.path)));
        let Some((item, _)) = next else { break };
        seen.insert(item.path.clone());
        selected.push(item);
    }
    selected.iter().map(|v| v.path.clone()).collect()
}

fn pool(state: &Shared, hour: i64) -> AppResult<Vec<Candidate>> {
    let c = state.database.connection()?;
    let mut st = c.prepare("SELECT path FROM media_sessions WHERE excluded=0 AND qualified=1
        AND min(abs(hour-?1),24-abs(hour-?1))<=1 GROUP BY path HAVING count(DISTINCT started/86400000)>=2").map_err(sql_error)?;
    let habits: HashSet<String> = st
        .query_map([hour], |r| r.get(0))
        .map_err(sql_error)?
        .collect::<Result<_, _>>()
        .map_err(sql_error)?;
    let favorites = state.settings.favorites()?;
    let history = super::catalog::historical_opens(state)?;
    let now = timestamp_ms() as i64;
    let mut st = c.prepare("SELECT r.path,r.score,r.shown,r.last_shown,coalesce(t.learned_plays,json_extract(r.item_json,'$.learnedPlays'),0),coalesce(t.last_played,json_extract(r.item_json,'$.lastPlayed'),0),
        EXISTS(SELECT 1 FROM media_feedback f WHERE f.kind='more' AND (r.path=f.path OR substr(r.path,1,length(f.path)+1)=f.path||'/')),
        json_extract(r.item_json,'$.type')='folder',coalesce(json_extract(r.item_json,'$.historicalOpens'),0)
        FROM media_rankings r LEFT JOIN media_totals t ON r.path=t.path
        WHERE r.library_key=?1 AND r.score>=?2 AND json_extract(r.item_json,'$.previewReady')=1
        AND NOT EXISTS(SELECT 1 FROM media_feedback f WHERE (r.path=f.path OR substr(r.path,1,length(f.path)+1)=f.path||'/')
            AND (f.kind='hide' OR f.until>?3))
        ORDER BY r.last_shown,r.score DESC LIMIT ?4").map_err(sql_error)?;
    st.query_map(
        params![state.config.library_key, MIN_SCORE, now, MAX_FEED as i64],
        |r| {
            let path: String = r.get(0)?;
            let plays: i64 = r.get(4)?;
            let liked: bool = r.get(6)?;
            let favorite = favorites.iter().any(|f| related(&path, f));
            Ok(Candidate {
                score: r.get(1)?,
                shown: r.get(2)?,
                last_shown: r.get(3)?,
                plays,
                last_played: r.get(5)?,
                liked,
                favorite,
                habit: habits.contains(&path),
                familiar: plays > 0
                    || liked
                    || favorite
                    || history[&path].as_u64().unwrap_or(0) > 0
                    || r.get::<_, i64>(8)? > 0,
                folder: r.get(7)?,
                path,
            })
        },
    )
    .map_err(sql_error)?
    .collect::<Result<_, _>>()
    .map_err(sql_error)
}

#[derive(Serialize, Deserialize)]
struct Snapshot {
    id: String,
    paths: Vec<String>,
    created_at: i64,
    hour: i64,
    seen_cursor: usize,
}

fn snapshot(
    state: &Shared,
    feed_id: Option<&str>,
    refresh: bool,
    hour: i64,
) -> AppResult<Snapshot> {
    let c = state.database.connection()?;
    if !refresh {
        let saved = c.query_row(
            "SELECT id,paths_json,created_at,hour,seen_cursor FROM media_feeds WHERE library_key=?1
             AND ((?2 IS NOT NULL AND id=?2) OR (?2 IS NULL AND hour=?3)) ORDER BY created_at DESC LIMIT 1",
            params![state.config.library_key,feed_id,hour],
            |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,i64>(3)?,r.get::<_,i64>(4)? as usize)),
        ).optional().map_err(sql_error)?;
        if let Some((id, paths, created_at, hour, seen_cursor)) = saved {
            return Ok(Snapshot {
                id,
                paths: serde_json::from_str(&paths).map_err(sql_error)?,
                created_at,
                hour,
                seen_cursor,
            });
        }
        if feed_id.is_some() {
            return Err(AppError::conflict(
                "This feed expired. Refresh recommendations.",
            ));
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = timestamp_ms() as i64;
    let paths = mix(&pool(state, hour)?, &id, now);
    c.execute(
        "INSERT INTO media_feeds(id,library_key,paths_json,created_at,hour) VALUES(?1,?2,?3,?4,?5)",
        params![
            id,
            state.config.library_key,
            json!(paths).to_string(),
            now,
            hour
        ],
    )
    .map_err(sql_error)?;
    c.execute(
        "DELETE FROM media_feeds WHERE library_key=?1 AND created_at<?2",
        params![state.config.library_key, now - DAY],
    )
    .map_err(sql_error)?;
    Ok(Snapshot {
        id,
        paths,
        created_at: now,
        hour,
        seen_cursor: 0,
    })
}

pub fn page(
    state: &Shared,
    cursor: usize,
    feed_id: Option<&str>,
    refresh: bool,
    hour: i64,
) -> AppResult<Value> {
    let _guard = state.media_ai.feed_lock.lock().map_err(sql_error)?;
    import_previous_feed(state)?;
    let mut snapshot = snapshot(state, feed_id, refresh, hour)?;
    if cursor.saturating_add(PAGE_SIZE * 2) >= snapshot.paths.len()
        && snapshot.paths.len() < MAX_FEED
    {
        let old: HashSet<_> = snapshot.paths.iter().cloned().collect();
        snapshot.paths.extend(
            mix(
                &pool(state, snapshot.hour)?,
                &snapshot.id,
                timestamp_ms() as i64,
            )
            .into_iter()
            .filter(|path| !old.contains(path))
            .take(MAX_FEED - old.len()),
        );
    }
    let c = state.database.connection()?;
    let mut next = cursor.min(snapshot.paths.len());
    let mut items = Vec::new();
    while next < snapshot.paths.len() && items.len() < PAGE_SIZE {
        let end = (next + PAGE_SIZE - items.len()).min(snapshot.paths.len());
        let paths = &snapshot.paths[next..end];
        let mut st = c.prepare("SELECT path,item_json FROM media_rankings WHERE library_key=?1 AND score>=?2 AND path IN (SELECT value FROM json_each(?3))").map_err(sql_error)?;
        let found: HashMap<String, String> = st
            .query_map(
                params![
                    state.config.library_key,
                    MIN_SCORE,
                    json!(paths).to_string()
                ],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(sql_error)?
            .collect::<Result<_, _>>()
            .map_err(sql_error)?;
        let mut value = json!({"rows":[{"items":paths.iter().filter_map(|p| found.get(p)).filter_map(|v|serde_json::from_str::<Value>(v).ok()).collect::<Vec<_>>()}]});
        super::catalog::filter_response(state, &mut value)?;
        items.extend(
            value["rows"][0]["items"]
                .as_array()
                .into_iter()
                .flatten()
                .cloned(),
        );
        next = end;
    }
    state.database.transaction(|tx| {
        if next > snapshot.seen_cursor {
            let shown: Vec<_> = items.iter().filter_map(|v| v["path"].as_str()).collect();
            tx.execute("UPDATE media_rankings SET shown=shown+1,last_shown=?1 WHERE library_key=?2 AND path IN (SELECT value FROM json_each(?3))",
                params![timestamp_ms() as i64,state.config.library_key,json!(shown).to_string()]).map_err(sql_error)?;
        }
        tx.execute("UPDATE media_feeds SET paths_json=?1,seen_cursor=max(seen_cursor,?2) WHERE id=?3",
            params![json!(snapshot.paths).to_string(),next as i64,snapshot.id]).map_err(sql_error)?;
        Ok(())
    })?;
    let profile = profile_key(state)?;
    let warming = needs_ranking(state, &profile)?;
    let reset =
        state
            .database
            .document("media-ai-profile", &state.config.library_key, json!({}))?;
    Ok(
        json!({"feedId":snapshot.id,"generatedAt":snapshot.created_at,"profileResetAt":reset["resetAt"],
        "rows":[{"title":"For you","items":items}],"nextCursor":if next<snapshot.paths.len(){json!(next)}else{Value::Null},
        "resumeCursor":next,"warming":warming,"enabled":true}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        app::AppState,
        config::{Config, FileSearchConfig, ImageOptimizationConfig, MediaRoot},
    };
    use axum::extract::{Query, State};
    use std::{path::PathBuf, sync::Arc, time::Duration};

    fn candidate(id: usize, score: f64) -> Candidate {
        Candidate {
            path: format!("Collection{}/item{id}.mp4", id % 16),
            score,
            shown: 0,
            last_shown: 0,
            plays: 0,
            last_played: 0,
            liked: false,
            favorite: false,
            habit: false,
            familiar: false,
            folder: false,
        }
    }

    #[test]
    fn mix_has_no_duplicates_or_unapproved_media_and_is_stable_for_a_feed() {
        let items: Vec<_> = (0..200)
            .map(|id| candidate(id, if id % 4 == 0 { 20.0 } else { 90.0 }))
            .collect();
        let first = mix(&items, "feed", DAY);
        assert_eq!(first, mix(&items, "feed", DAY));
        assert_eq!(first.len(), 150);
        assert_eq!(first.iter().collect::<HashSet<_>>().len(), 150);
        assert!(first.iter().all(|path| {
            items
                .iter()
                .any(|v| v.path == *path && v.score >= MIN_SCORE)
        }));
        assert_ne!(&first[..24], &mix(&items, "new-feed", DAY)[..24]);
    }

    #[test]
    fn stronger_ai_scores_dominate_the_first_screen_over_many_refreshes() {
        let items: Vec<_> = (0..200)
            .map(|id| candidate(id, if id < 100 { 95.0 } else { 55.0 }))
            .collect();
        let high: HashSet<_> = items[..100].iter().map(|v| v.path.clone()).collect();
        let high_count: usize = (0..100)
            .map(|seed| {
                mix(&items, &seed.to_string(), DAY)
                    .iter()
                    .take(24)
                    .filter(|p| high.contains(*p))
                    .count()
            })
            .sum();
        assert!(
            high_count > 2000,
            "high scoring items occupied {high_count}/2400 positions"
        );
    }

    #[test]
    fn refresh_demotes_the_previous_screen_without_excluding_it_forever() {
        let mut items: Vec<_> = (0..100).map(|id| candidate(id, 85.0)).collect();
        let first = mix(&items, "first", DAY);
        let seen: HashSet<_> = first[..24].iter().cloned().collect();
        for item in &mut items {
            if seen.contains(&item.path) {
                item.last_shown = DAY;
                item.shown = 1;
            }
        }
        let immediate = mix(&items, "second", DAY + 1);
        assert!(
            immediate
                .iter()
                .take(24)
                .filter(|p| seen.contains(*p))
                .count()
                < 8
        );
        assert_eq!(immediate.len(), 100);
        assert!(
            weight(
                &items.iter().find(|v| seen.contains(&v.path)).unwrap(),
                DAY + 600_001
            ) > weight(
                &items.iter().find(|v| seen.contains(&v.path)).unwrap(),
                DAY + 1
            )
        );
    }

    #[test]
    fn mix_keeps_familiar_content_and_limits_same_folder_runs() {
        let mut items: Vec<_> = (0..200).map(|id| candidate(id, 85.0)).collect();
        for item in &mut items[..80] {
            item.familiar = true;
        }
        let familiar: HashSet<_> = items[..80].iter().map(|v| v.path.clone()).collect();
        let mixed = mix(&items, "variety", DAY);
        assert!(mixed[..24].iter().any(|p| familiar.contains(p)));
        assert!(mixed[..24].iter().any(|p| !familiar.contains(p)));
        for folder in 0..16 {
            assert!(
                mixed[..24]
                    .iter()
                    .filter(|p| p.starts_with(&format!("Collection{folder}/")))
                    .count()
                    <= 3
            );
        }
    }

    #[test]
    fn time_of_day_is_a_small_local_adjustment_to_the_same_ai_score() {
        let item = candidate(1, 90.0);
        let mut habitual = item.clone();
        habitual.habit = true;
        let boost = weight(&habitual, DAY) / weight(&item, DAY);
        assert!((boost - 1.12).abs() < 0.001);
        assert_eq!(item.score, habitual.score);
    }

    struct Library {
        state: Shared,
        directory: PathBuf,
    }
    impl Library {
        fn new() -> Self {
            let directory =
                std::env::temp_dir().join(format!("derp-feed-{}", uuid::Uuid::new_v4()));
            let media = directory.join("media");
            std::fs::create_dir_all(&media).unwrap();
            let config = Config {
                port: 0,
                library_key: "test".into(),
                data_path: directory.join("data"),
                roots: vec![MediaRoot {
                    id: "root".into(),
                    name: "media".into(),
                    path: media,
                    editable_folders: vec![],
                }],
                file_search: FileSearchConfig {
                    enabled: false,
                    index_path: directory.join("search.sqlite"),
                    watch_mode: "off".into(),
                    max_recursive_watchers: 0,
                    max_fs_concurrency: 1,
                    reconcile_directories_per_second: 1,
                },
                image_optimization: ImageOptimizationConfig::default(),
                playback: Default::default(),
                hermes: None,
                music: crate::config::MusicConfig::default(),
                media_ai: crate::config::MediaAiConfig {
                    enabled: true,
                    paused: true,
                    ..Default::default()
                },
            };
            crate::state_db::initialize(&config).unwrap();
            let database = crate::state_db::AppDatabase::from_config(&config);
            let state = Arc::new(AppState {
                media_ai: super::super::Runtime::new(),
                dev: false,
                vite_port: 0,
                client: reqwest::Client::new(),
                events: tokio::sync::broadcast::channel(8).0,
                admin_events: tokio::sync::broadcast::channel(8).0,
                hermes_events: tokio::sync::broadcast::channel(8).0,
                settings: crate::settings_persistence::SettingsRepository::from_config(&config),
                stats: crate::stats_persistence::StatsRepository::from_config(&config),
                workspaces: crate::workspace_persistence::WorkspaceRepository::from_config(&config),
                reader_state_db: tokio::sync::Mutex::new(()),
                thumbnails: crate::thumbnails::Thumbnailer::new(
                    directory.join("thumbnails"),
                    database.clone(),
                ),
                image_variants: crate::image_variants::ImageVariants::new(
                    directory.join("images"),
                    config.image_optimization.clone(),
                ),
                file_search: crate::file_search::FileSearch::new(
                    config.file_search.clone(),
                    config.roots.clone(),
                ),
                hermes: None,
                hermes_project_operations: tokio::sync::Mutex::new(()),
                file_mutations: tokio::sync::Mutex::new(()),
                playback: crate::video_playback::PlaybackRuntime::new(&config),
                hermes_runtime_ids: tokio::sync::Mutex::new(HashMap::new()),
                hermes_active_ids: tokio::sync::Mutex::new(HashSet::new()),
                database,
                config,
            });
            Self { state, directory }
        }
        fn add(&self, start: usize, count: usize) {
            let items:Vec<_>=(start..start+count).map(|id| {
                let path=format!("Collection{}/item{id}.mp4",id%16);
                let full=self.state.config.roots[0].path.join(&path);
                std::fs::create_dir_all(full.parent().unwrap()).unwrap();
                std::fs::write(full,b"media fixture").unwrap();
                json!({"id":id+1,"path":path,"name":format!("item{id}.mp4"),"type":"video","previewReady":true,"aiScore":85})
            }).collect();
            store_rankings(&self.state, &items, &profile_key(&self.state).unwrap()).unwrap();
        }
    }
    impl Drop for Library {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
    fn paths(page: &Value) -> Vec<String> {
        page["rows"][0]["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["path"].as_str().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn home_and_refresh_return_prepared_cards_while_the_model_gate_is_held() {
        let library = Library::new();
        library.add(0, 96);
        let _busy = library.state.media_ai.gate.acquire().await.unwrap();
        let first = tokio::time::timeout(
            Duration::from_secs(1),
            super::super::home(
                State(library.state.clone()),
                Query(super::super::HomeContext {
                    cursor: None,
                    hour: Some(9),
                    feed_id: None,
                }),
            ),
        )
        .await
        .expect("home waited for AI")
        .unwrap()
        .0;
        assert_eq!(paths(&first).len(), 24);
        let refreshed = tokio::time::timeout(
            Duration::from_secs(1),
            super::super::refresh(
                State(library.state.clone()),
                Some(axum::Json(json!({"hour":9}))),
            ),
        )
        .await
        .expect("refresh waited for AI")
        .unwrap()
        .0;
        assert_eq!(paths(&refreshed).len(), 24);
        assert_ne!(first["feedId"], refreshed["feedId"]);
        assert_ne!(paths(&first), paths(&refreshed));
        let next = tokio::time::timeout(
            Duration::from_secs(1),
            super::super::home(
                State(library.state.clone()),
                Query(super::super::HomeContext {
                    cursor: Some(24),
                    hour: Some(9),
                    feed_id: first["feedId"].as_str().map(str::to_string),
                }),
            ),
        )
        .await
        .expect("pagination waited for AI")
        .unwrap()
        .0;
        assert!(paths(&next).iter().all(|p| !paths(&first).contains(p)));
    }

    #[tokio::test]
    async fn an_empty_pool_returns_immediately_without_requesting_background_ranking() {
        let library = Library::new();
        let _busy = library.state.media_ai.gate.acquire().await.unwrap();
        let page = tokio::time::timeout(
            Duration::from_secs(1),
            super::super::home(
                State(library.state.clone()),
                Query(super::super::HomeContext {
                    cursor: None,
                    hour: None,
                    feed_id: None,
                }),
            ),
        )
        .await
        .expect("cold start waited for AI")
        .unwrap()
        .0;
        assert!(paths(&page).is_empty());
        assert_eq!(page["warming"], true);
        assert!(
            !library
                .state
                .media_ai
                .rank_requested
                .load(std::sync::atomic::Ordering::SeqCst)
        );
    }

    #[tokio::test]
    async fn feedback_does_not_shift_pagination_and_repeated_reads_do_not_inflate_exposure() {
        let library = Library::new();
        library.add(0, 72);
        let first = page(&library.state, 0, None, true, 10).unwrap();
        let id = first["feedId"].as_str().unwrap();
        let original = paths(&first);
        let c = library.state.database.connection().unwrap();
        c.execute(
            "INSERT INTO media_feedback VALUES(?1,'hide',0)",
            [&original[0]],
        )
        .unwrap();
        let second = page(&library.state, 24, Some(id), false, 10).unwrap();
        assert_eq!(paths(&second).len(), 24);
        assert!(paths(&second).iter().all(|p| !original.contains(p)));
        let total = || {
            c.query_row("SELECT sum(shown) FROM media_rankings", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap()
        };
        let before = total();
        assert_eq!(
            paths(&second),
            paths(&page(&library.state, 24, Some(id), false, 10).unwrap())
        );
        assert_eq!(total(), before);
    }

    #[tokio::test]
    async fn new_background_scores_append_without_replacing_the_existing_feed() {
        let library = Library::new();
        library.add(0, 24);
        let first = page(&library.state, 0, None, true, 10).unwrap();
        assert!(first["nextCursor"].is_null());
        library.add(24, 24);
        let next = page(&library.state, 24, first["feedId"].as_str(), false, 10).unwrap();
        assert_eq!(paths(&next).len(), 24);
        assert_eq!(first["feedId"], next["feedId"]);
        assert!(paths(&next).iter().all(|p| !paths(&first).contains(p)));
        assert_eq!(
            paths(&first),
            paths(&page(&library.state, 0, first["feedId"].as_str(), false, 10).unwrap())
        );
    }

    #[tokio::test]
    async fn different_hours_keep_the_same_ai_scores_and_profile() {
        let library = Library::new();
        library.add(0, 48);
        let before = profile_key(&library.state).unwrap();
        let morning = page(&library.state, 0, None, false, 8).unwrap();
        let evening = page(&library.state, 0, None, false, 20).unwrap();
        assert_ne!(morning["feedId"], evening["feedId"]);
        assert_eq!(before, profile_key(&library.state).unwrap());
        let count: i64 = library
            .state
            .database
            .connection()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM media_rankings WHERE score=85",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 48);
    }
}
