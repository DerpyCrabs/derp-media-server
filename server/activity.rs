use crate::{
    app::Shared,
    error::{AppError, AppResult},
};
use axum::{Json, Router, extract::State, routing::post};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};

pub fn sql_error(e: impl std::fmt::Display) -> AppError {
    AppError::internal(e.to_string())
}
pub fn initialize(c: &Connection) -> AppResult<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS media_sessions (
      id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
      started INTEGER NOT NULL, updated INTEGER NOT NULL, hour INTEGER NOT NULL,
      seconds REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0,
      qualified INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
      excluded INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL DEFAULT -1);
      CREATE INDEX IF NOT EXISTS media_sessions_path ON media_sessions(path,updated);
      CREATE TABLE IF NOT EXISTS media_totals (
      path TEXT PRIMARY KEY, opens INTEGER NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0,
      seconds REAL NOT NULL DEFAULT 0, completions INTEGER NOT NULL DEFAULT 0,
      learned_seconds REAL NOT NULL DEFAULT 0, learned_plays INTEGER NOT NULL DEFAULT 0,
      last_played INTEGER NOT NULL DEFAULT 0, audio_seconds REAL NOT NULL DEFAULT 0, video_seconds REAL NOT NULL DEFAULT 0, image_seconds REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS media_intervals (
      session TEXT NOT NULL, seq INTEGER NOT NULL, path TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
      PRIMARY KEY(session,seq));
      CREATE INDEX IF NOT EXISTS media_intervals_path ON media_intervals(path,end);") .map_err(sql_error)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub path: String,
    pub kind: String,
    pub source: String,
    #[serde(default)]
    pub mode: Option<String>,
    pub seq: i64,
    pub start: i64,
    pub end: i64,
    pub seconds: f64,
    pub duration: f64,
    pub hour: i64,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub excluded: bool,
}

pub fn record(c: &mut Connection, a: &Activity) -> AppResult<()> {
    let now = crate::app::timestamp_ms() as i64;
    let mode = a.mode.as_deref().unwrap_or(&a.kind);
    if !["audio", "video", "image"].contains(&mode) || (a.kind == "image") != (mode == "image") {
        return Err(AppError::bad("Invalid playback mode"));
    }
    if a.id.is_empty()
        || a.id.len() > 100
        || a.path.is_empty()
        || a.path.len() > 4096
        || a.seq < 0
        || !["audio", "video", "image"].contains(&a.kind.as_str())
        || !["chosen", "queued", "autoplay", "repeat"].contains(&a.source.as_str())
        || !a.seconds.is_finite()
        || !(0.0..=30.0).contains(&a.seconds)
        || !a.duration.is_finite()
        || a.duration < 0.0
        || !(0..24).contains(&a.hour)
        || a.end < a.start
        || a.end - a.start > 30_000
        || (a.end - now).abs() > 86_400_000
    {
        return Err(AppError::bad("Invalid playback activity"));
    }
    let tx = c.transaction().map_err(sql_error)?;
    let prior: Option<(String, i64, f64, bool, bool, bool)> = tx
        .query_row(
            "SELECT path,seq,seconds,qualified,completed,excluded FROM media_sessions WHERE id=?1",
            [&a.id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(sql_error)?;
    if let Some(p) = &prior {
        if p.0 != a.path {
            return Err(AppError::bad("Activity session path changed"));
        }
        if a.seq <= p.1 {
            return Ok(());
        }
    }
    // Subtract union coverage from other tabs, retaining each file's actual elapsed time.
    let mut segments = vec![(a.start, a.end)];
    {
        let mut st=tx.prepare("SELECT start,end FROM media_intervals WHERE path=?1 AND session!=?2 AND end>?3 AND start<?4 ORDER BY start").map_err(sql_error)?;
        let spans = st
            .query_map(params![a.path, a.id, a.start, a.end], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(sql_error)?;
        for span in spans {
            let (s, e) = span.map_err(sql_error)?;
            segments = segments
                .into_iter()
                .flat_map(|(x, y)| {
                    let mut v = Vec::new();
                    if s >= y || e <= x {
                        v.push((x, y));
                    } else {
                        if x < s {
                            v.push((x, s));
                        }
                        if e < y {
                            v.push((e, y));
                        }
                    }
                    v
                })
                .collect();
        }
    }
    let elapsed = (a.end - a.start) as f64 / 1000.0;
    let uncovered = segments
        .iter()
        .map(|(s, e)| (e - s) as f64 / 1000.0)
        .sum::<f64>();
    let delta = a.seconds.min(elapsed)
        * if elapsed > 0.0 {
            uncovered / elapsed
        } else {
            0.0
        };
    let previous_seconds = prior.as_ref().map(|p| p.2).unwrap_or(0.0);
    let seconds = previous_seconds + delta;
    let qualified = a.kind != "image"
        && seconds
            >= if a.duration > 0.0 {
                120.0_f64.min(a.duration / 2.0)
            } else {
                120.0
            };
    let was_qualified = prior.as_ref().is_some_and(|p| p.3);
    let was_completed = prior.as_ref().is_some_and(|p| p.4);
    let excluded = a.excluded || prior.as_ref().is_some_and(|p| p.5);
    let was_excluded = prior.as_ref().is_some_and(|p| p.5);
    tx.execute("INSERT INTO media_sessions(id,path,kind,source,started,updated,hour,seconds,duration,qualified,completed,excluded,seq)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
      ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,seconds=excluded.seconds,duration=excluded.duration,
      qualified=MAX(media_sessions.qualified,excluded.qualified),completed=MAX(media_sessions.completed,excluded.completed),excluded=excluded.excluded,seq=excluded.seq",
      params![a.id,a.path,a.kind,a.source,a.start,a.end,a.hour,seconds,a.duration,qualified,a.completed,excluded,a.seq]).map_err(sql_error)?;
    let learned_delta = if excluded {
        if !was_excluded {
            -previous_seconds
        } else {
            0.0
        }
    } else {
        delta
    };
    let play_delta = i64::from(qualified && !was_qualified);
    let learned_play = if excluded {
        if !was_excluded && was_qualified {
            -1
        } else {
            0
        }
    } else {
        play_delta
    };
    tx.execute("INSERT INTO media_totals(path,opens,plays,seconds,completions,learned_seconds,learned_plays,last_played,audio_seconds,video_seconds,image_seconds)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(path) DO UPDATE SET
      opens=opens+excluded.opens,plays=plays+excluded.plays,seconds=seconds+excluded.seconds,
      completions=completions+excluded.completions,learned_seconds=MAX(0,learned_seconds+excluded.learned_seconds),
      learned_plays=MAX(0,learned_plays+excluded.learned_plays),last_played=MAX(last_played,excluded.last_played),audio_seconds=audio_seconds+excluded.audio_seconds,video_seconds=video_seconds+excluded.video_seconds,image_seconds=image_seconds+excluded.image_seconds",
      params![a.path,i64::from(prior.is_none()),play_delta,delta,i64::from(a.completed&&!was_completed),learned_delta,learned_play,a.end,if mode=="audio"{delta}else{0.0},if mode=="video"{delta}else{0.0},if mode=="image"{delta}else{0.0}]).map_err(sql_error)?;
    if delta > 0.0 {
        tx.execute(
            "INSERT OR IGNORE INTO media_intervals VALUES(?1,?2,?3,?4,?5)",
            params![a.id, a.seq, a.path, a.start, a.end],
        )
        .map_err(sql_error)?;
    }
    tx.execute("DELETE FROM media_intervals WHERE end<?1", [now - 120_000])
        .map_err(sql_error)?;
    tx.execute(
        "DELETE FROM media_sessions WHERE updated<?1",
        [now - 365 * 86_400_000_i64],
    )
    .map_err(sql_error)?;
    tx.commit().map_err(sql_error)
}
async fn ingest(State(state): State<Shared>, Json(a): Json<Activity>) -> AppResult<Json<Value>> {
    let resolved = crate::media::resolve(&state.config, &a.path)?;
    if crate::media::media_type(&crate::media::extension(&resolved.full)) != a.kind {
        return Err(AppError::bad("Activity media type mismatch"));
    }
    record(&mut state.database.connection()?, &a)?;
    if a.seq == 0 {
        crate::app::emit_admin(&state, "stats-changed");
    }
    Ok(Json(json!({"ok":true})))
}
pub fn router() -> Router<Shared> {
    Router::new().route("/api/activity", post(ingest))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        c
    }
    fn event(id: &str, seq: i64, start: i64, end: i64) -> Activity {
        Activity {
            id: id.into(),
            path: "Music/song.mp3".into(),
            kind: "audio".into(),
            source: "chosen".into(),
            mode: None,
            seq,
            start,
            end,
            seconds: (end - start) as f64 / 1000.0,
            duration: 10.0,
            hour: 12,
            completed: false,
            excluded: false,
        }
    }
    #[test]
    fn idempotent_qualified_plays_and_overlap() {
        let mut c = setup();
        let now = crate::app::timestamp_ms() as i64;
        let a = event("one", 0, now - 5000, now);
        record(&mut c, &a).unwrap();
        record(&mut c, &a).unwrap();
        record(&mut c, &event("two", 0, now - 3000, now + 2000)).unwrap();
        let totals: (i64, i64, f64) = c
            .query_row("SELECT opens,plays,seconds FROM media_totals", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(totals, (2, 1, 7.0));
    }
    #[test]
    fn samples_completion_and_exclusion() {
        let mut c = setup();
        let now = crate::app::timestamp_ms() as i64;
        record(&mut c, &event("one", 0, now - 4000, now - 2000)).unwrap();
        let mut a = event("one", 1, now - 2000, now + 2000);
        a.completed = true;
        record(&mut c, &a).unwrap();
        let mut excluded = event("one", 2, now + 2000, now + 2000);
        excluded.excluded = true;
        record(&mut c, &excluded).unwrap();
        let totals: (i64, i64, f64, f64, i64) = c
            .query_row(
                "SELECT opens,plays,seconds,learned_seconds,learned_plays FROM media_totals",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!(totals, (1, 1, 6.0, 0.0, 0));
    }
    #[test]
    fn image_time_never_becomes_a_play() {
        let mut c = setup();
        let now = crate::app::timestamp_ms() as i64;
        let mut a = event("image", 0, now - 10000, now);
        a.kind = "image".into();
        record(&mut c, &a).unwrap();
        assert_eq!(
            c.query_row("SELECT plays FROM media_totals", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[cfg(test)]
mod mode_tests {
    use super::*;
    #[test]
    fn audio_only_video_counts_as_listening() {
        let mut c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        let now = crate::app::timestamp_ms() as i64;
        let a = Activity {
            id: "listen".into(),
            path: "a.mp4".into(),
            kind: "video".into(),
            mode: Some("audio".into()),
            source: "chosen".into(),
            seq: 0,
            start: now - 5000,
            end: now,
            seconds: 5.0,
            duration: 10.0,
            hour: 12,
            completed: false,
            excluded: false,
        };
        record(&mut c, &a).unwrap();
        let times: (f64, f64) = c
            .query_row(
                "SELECT audio_seconds,video_seconds FROM media_totals",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(times, (5.0, 0.0));
    }
}
