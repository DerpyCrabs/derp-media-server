use crate::{activity::sql_error, error::AppResult};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

pub fn initialize(c: &Connection) -> AppResult<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS media_ai_reviewed_files (
           path TEXT PRIMARY KEY, completed_at INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS media_ai_analysis_runs (
           library_key TEXT PRIMARY KEY, generation INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS media_ai_analysis_queue (
           library_key TEXT NOT NULL, path TEXT NOT NULL,
           finished INTEGER NOT NULL DEFAULT 0,
           PRIMARY KEY(library_key,path));",
    )
    .map_err(sql_error)
}

pub fn reviewed(c: &Connection, path: &str) -> AppResult<()> {
    c.execute(
        "INSERT INTO media_ai_reviewed_files(path,completed_at) VALUES(?1,?2)
         ON CONFLICT(path) DO UPDATE SET completed_at=excluded.completed_at",
        params![path, crate::app::timestamp_ms() as i64],
    )
    .map_err(sql_error)?;
    c.execute(
        "UPDATE media_ai_analysis_queue SET finished=1 WHERE path=?1",
        [path],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub fn invalidate(c: &Connection, path: &str) -> AppResult<()> {
    c.execute("DELETE FROM media_ai_reviewed_files WHERE path=?1", [path])
        .map_err(sql_error)?;
    Ok(())
}

pub fn adopt_existing(c: &Connection, library: &str) -> AppResult<()> {
    c.execute(
            "INSERT OR IGNORE INTO media_ai_reviewed_files(path,completed_at)
             SELECT c.path,?2 FROM media_catalog c WHERE c.analyzed>0
             OR EXISTS(SELECT 1 FROM media_rankings r WHERE r.library_key=?1 AND r.path=c.path AND json_extract(r.item_json,'$.previewReady')=1)
             OR EXISTS(SELECT 1 FROM music_reviews r JOIN music_tracks m ON m.path=r.path
               WHERE r.path=c.path AND r.fingerprint=m.fingerprint AND r.metadata=m.metadata AND r.enrichment=m.enrichment AND r.overrides=m.overrides)",
            params![library, crate::app::timestamp_ms() as i64],
        ).map_err(sql_error)?;
    Ok(())
}

// Called after the initial filesystem crawl has ended and its catalog pass is complete.
pub fn snapshot(c: &Connection, library: &str) -> AppResult<()> {
    c.execute(
        "UPDATE media_ai_analysis_queue SET finished=1
         WHERE library_key=?1 AND (NOT EXISTS(SELECT 1 FROM media_catalog c WHERE c.path=media_ai_analysis_queue.path)
         OR EXISTS(SELECT 1 FROM media_feedback f WHERE (media_ai_analysis_queue.path=f.path OR substr(media_ai_analysis_queue.path,1,length(f.path)+1)=f.path||'/') AND (f.kind='hide' OR f.until>cast(strftime('%s','now') as integer)*1000)))",
        [library],
    ).map_err(sql_error)?;
    let pending: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM media_ai_analysis_queue WHERE library_key=?1 AND finished=0)",
        [library], |row| row.get(0),
    ).map_err(sql_error)?;
    if pending {
        return Ok(());
    }
    let existing: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM media_ai_analysis_runs WHERE library_key=?1)",
            [library],
            |row| row.get(0),
        )
        .map_err(sql_error)?;
    if !existing {
        adopt_existing(c, library)?;
    }
    let unreviewed: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM media_catalog c WHERE NOT EXISTS(SELECT 1 FROM media_ai_reviewed_files r WHERE r.path=c.path)
         AND NOT EXISTS(SELECT 1 FROM media_feedback f WHERE (c.path=f.path OR substr(c.path,1,length(f.path)+1)=f.path||'/') AND (f.kind='hide' OR f.until>cast(strftime('%s','now') as integer)*1000)))",
        [], |row| row.get(0),
    ).map_err(sql_error)?;
    if existing && !unreviewed {
        return Ok(());
    }
    c.execute(
        "DELETE FROM media_ai_analysis_queue WHERE library_key=?1",
        [library],
    )
    .map_err(sql_error)?;
    c.execute(
        "INSERT INTO media_ai_analysis_queue(library_key,path,finished)
         SELECT ?1,c.path,EXISTS(SELECT 1 FROM media_ai_reviewed_files r WHERE r.path=c.path)
         FROM media_catalog c WHERE (?2=0 OR NOT EXISTS(SELECT 1 FROM media_ai_reviewed_files r WHERE r.path=c.path))
         AND NOT EXISTS(SELECT 1 FROM media_feedback f WHERE (c.path=f.path OR substr(c.path,1,length(f.path)+1)=f.path||'/') AND (f.kind='hide' OR f.until>cast(strftime('%s','now') as integer)*1000))",
        params![library, existing],
    ).map_err(sql_error)?;
    c.execute(
        "INSERT INTO media_ai_analysis_runs(library_key,generation) VALUES(?1,1)
         ON CONFLICT(library_key) DO UPDATE SET generation=generation+1",
        [library],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub fn status(c: &Connection, library: &str) -> AppResult<Value> {
    let exists: bool = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM media_ai_analysis_runs WHERE library_key=?1)",
            [library],
            |row| row.get(0),
        )
        .map_err(sql_error)?;
    if !exists {
        let found: i64 = c
            .query_row("SELECT count(*) FROM media_catalog", [], |row| row.get(0))
            .map_err(sql_error)?;
        let completed: i64 = c.query_row("SELECT count(*) FROM media_catalog c JOIN media_ai_reviewed_files r ON r.path=c.path", [], |row| row.get(0)).map_err(sql_error)?;
        return Ok(json!({"phase":"discovering","found":found,"completed":completed}));
    }
    let (total, completed): (i64,i64) = c.query_row(
        "SELECT count(*),coalesce(sum(finished),0) FROM media_ai_analysis_queue WHERE library_key=?1",
        [library], |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(sql_error)?;
    Ok(
        json!({"phase":if completed==total {"complete"} else {"processing"},"completed":completed,"total":total}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::activity::initialize(&c).unwrap();
        crate::media_ai::initialize(&c).unwrap();
        crate::music::initialize(&c).unwrap();
        c
    }
    fn add(c: &Connection, path: &str) {
        c.execute(
            "INSERT INTO media_catalog(path,name,kind) VALUES(?1,?1,'video')",
            [path],
        )
        .unwrap();
    }

    #[test]
    fn discovery_does_not_claim_a_total_or_percentage() {
        let c = database();
        add(&c, "one");
        assert_eq!(
            status(&c, "test").unwrap(),
            json!({"phase":"discovering","found":1,"completed":0})
        );
        add(&c, "two");
        assert_eq!(
            status(&c, "test").unwrap(),
            json!({"phase":"discovering","found":2,"completed":0})
        );
    }

    #[test]
    fn queue_survives_batches_restart_and_new_files_without_changing_total() {
        let c = database();
        add(&c, "book");
        add(&c, "song");
        reviewed(&c, "book").unwrap();
        snapshot(&c, "test").unwrap();
        assert_eq!(
            status(&c, "test").unwrap(),
            json!({"phase":"processing","completed":1,"total":2})
        );
        add(&c, "later");
        initialize(&c).unwrap();
        snapshot(&c, "test").unwrap();
        assert_eq!(status(&c, "test").unwrap()["total"], 2);
        reviewed(&c, "book").unwrap();
        assert_eq!(status(&c, "test").unwrap()["completed"], 1);
        reviewed(&c, "song").unwrap();
        assert_eq!(status(&c, "test").unwrap()["phase"], "complete");
        snapshot(&c, "test").unwrap();
        assert_eq!(
            status(&c, "test").unwrap(),
            json!({"phase":"processing","completed":0,"total":1})
        );
        reviewed(&c, "later").unwrap();
        assert_eq!(status(&c, "test").unwrap()["phase"], "complete");
    }

    #[test]
    fn existing_ai_reviews_count_once_and_cache_removal_cannot_undo_work() {
        let c = database();
        add(&c, "book");
        add(&c, "video");
        c.execute("INSERT INTO media_rankings(library_key,path,item_json,score,profile_key,ranked_at) VALUES('test','book','{\"type\":\"pdf\",\"previewReady\":true}',80,'old',1)",[]).unwrap();
        snapshot(&c, "test").unwrap();
        assert_eq!(status(&c, "test").unwrap()["completed"], 1);
        c.execute("DELETE FROM media_rankings", []).unwrap();
        initialize(&c).unwrap();
        snapshot(&c, "test").unwrap();
        assert_eq!(status(&c, "test").unwrap()["completed"], 1);
        reviewed(&c, "video").unwrap();
        assert_eq!(status(&c, "test").unwrap()["phase"], "complete");
    }

    #[test]
    fn removed_files_finish_their_queue_slots_and_changed_files_get_new_work() {
        let c = database();
        add(&c, "keep");
        add(&c, "removed");
        snapshot(&c, "test").unwrap();
        reviewed(&c, "keep").unwrap();
        c.execute("DELETE FROM media_catalog WHERE path='removed'", [])
            .unwrap();
        snapshot(&c, "test").unwrap();
        assert_eq!(
            status(&c, "test").unwrap(),
            json!({"phase":"complete","completed":2,"total":2})
        );
        invalidate(&c, "keep").unwrap();
        snapshot(&c, "test").unwrap();
        assert_eq!(
            status(&c, "test").unwrap(),
            json!({"phase":"processing","completed":0,"total":1})
        );
    }
}
