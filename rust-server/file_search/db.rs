use super::{normalize, types::*};
use crate::config::FileSearchConfig;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use std::{fs, path::Path, time::Duration};

const SCHEMA_VERSION: i64 = 2;
pub(super) const SEARCH_CANDIDATE_LIMIT: usize = 500;
pub(super) type SearchRow = (String, String, String, bool, String, String);

pub(super) struct IndexDb {
    connection: Connection,
}

impl IndexDb {
    pub fn open_or_recover(config: &FileSearchConfig) -> Result<Self, String> {
        if let Some(parent) = config.index_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        match Self::open(&config.index_path) {
            Ok(db) => Ok(db),
            Err(first) => {
                for candidate in [
                    config.index_path.clone(),
                    format!("{}-wal", config.index_path.display()).into(),
                    format!("{}-shm", config.index_path.display()).into(),
                ] {
                    match fs::remove_file(candidate) {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.to_string()),
                    }
                }
                Self::open(&config.index_path).map_err(|second| {
                    format!(
                        "Failed to initialize file search index: {second} (recovery after {first})"
                    )
                })
            }
        }
    }

    fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-32768; PRAGMA temp_store=MEMORY; PRAGMA journal_size_limit=33554432;",
            )
            .map_err(|error| error.to_string())?;
        if connection
            .execute_batch("PRAGMA journal_mode=WAL;")
            .is_err()
        {
            connection
                .execute_batch("PRAGMA journal_mode=DELETE;")
                .map_err(|error| error.to_string())?;
        }
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        let had_entries = table_exists(&connection, "entries")?;
        let had_fts = table_exists(&connection, "entries_fts")?;
        let incompatible_unversioned =
            version == 0 && had_entries && !column_exists(&connection, "entries", "relative_path")?;
        if incompatible_unversioned || (version != 0 && version != SCHEMA_VERSION) {
            connection
                .execute_batch("DROP TABLE IF EXISTS entries_fts; DROP TABLE IF EXISTS crawl_queue; DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS roots;")
                .map_err(|error| error.to_string())?;
        }
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS roots (
               root_id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
               source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'building',
               refresh_mode TEXT NOT NULL DEFAULT 'polling', generation INTEGER NOT NULL DEFAULT 0,
               indexed_entries INTEGER NOT NULL DEFAULT 0, scanned_directories INTEGER NOT NULL DEFAULT 0,
               last_complete_at INTEGER, error TEXT, root_mtime INTEGER, root_birthtime INTEGER
             );
             CREATE TABLE IF NOT EXISTS entries (
               id INTEGER PRIMARY KEY, root_id TEXT NOT NULL REFERENCES roots(root_id) ON DELETE CASCADE,
               relative_path TEXT NOT NULL, parent_path TEXT NOT NULL, name TEXT NOT NULL,
               name_key TEXT NOT NULL, path_key TEXT NOT NULL, is_directory INTEGER NOT NULL,
               extension TEXT NOT NULL, media_type TEXT NOT NULL, directory_mtime INTEGER,
               directory_birthtime INTEGER, generation INTEGER NOT NULL, seen_token INTEGER NOT NULL DEFAULT 0,
               UNIQUE(root_id, relative_path)
             );
             CREATE INDEX IF NOT EXISTS entries_root_parent ON entries(root_id,parent_path);
             CREATE INDEX IF NOT EXISTS entries_root_path ON entries(root_id,relative_path);
             CREATE INDEX IF NOT EXISTS entries_name_key ON entries(name_key);
             CREATE INDEX IF NOT EXISTS entries_root_directory_id ON entries(root_id,is_directory,id);
             CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
               name_key,path_key,content='entries',content_rowid='id',tokenize='trigram case_sensitive 1'
             );
             CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
               INSERT INTO entries_fts(rowid,name_key,path_key) VALUES(new.id,new.name_key,new.path_key);
             END;
             CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
               INSERT INTO entries_fts(entries_fts,rowid,name_key,path_key) VALUES('delete',old.id,old.name_key,old.path_key);
             END;
             CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE OF name_key,path_key ON entries BEGIN
               INSERT INTO entries_fts(entries_fts,rowid,name_key,path_key) VALUES('delete',old.id,old.name_key,old.path_key);
               INSERT INTO entries_fts(rowid,name_key,path_key) VALUES(new.id,new.name_key,new.path_key);
             END;
             CREATE TABLE IF NOT EXISTS crawl_queue (
               root_id TEXT NOT NULL,relative_path TEXT NOT NULL,generation INTEGER NOT NULL,
               PRIMARY KEY(root_id,relative_path)
             );
             PRAGMA user_version=2;",
        ).map_err(|error| error.to_string())?;
        connection
            .execute_batch("CREATE VIRTUAL TABLE IF NOT EXISTS __fts_probe USING fts5(value,tokenize='trigram'); DROP TABLE __fts_probe;")
            .map_err(|error| error.to_string())?;
        if version == SCHEMA_VERSION && had_entries && !had_fts {
            connection
                .execute("INSERT INTO entries_fts(entries_fts) VALUES('rebuild')", [])
                .map_err(|error| error.to_string())?;
        }
        Ok(Self { connection })
    }

    pub fn open_reader(path: &Path) -> Result<Self, String> {
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| error.to_string())?;
        connection
            .busy_timeout(Duration::from_secs(2))
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA query_only=ON; PRAGMA cache_size=-32768; PRAGMA temp_store=MEMORY;",
            )
            .map_err(|error| error.to_string())?;
        Ok(Self { connection })
    }

    pub fn sync_roots(&mut self, roots: &[Root]) -> Result<Vec<String>, String> {
        let tx = self.connection.transaction().map_err(err)?;
        let existing_ids = {
            let mut stmt = tx.prepare("SELECT root_id FROM roots").map_err(err)?;
            stmt.query_map([], |row| row.get::<_, String>(0))
                .map_err(err)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(err)?
        };
        for id in existing_ids
            .iter()
            .filter(|id| !roots.iter().any(|root| &root.id == *id))
        {
            tx.execute("DELETE FROM roots WHERE root_id=?", [id])
                .map_err(err)?;
            tx.execute("DELETE FROM crawl_queue WHERE root_id=?", [id])
                .map_err(err)?;
        }
        let mut rebuild = Vec::new();
        for root in roots {
            let existing: Option<(String, String)> = tx
                .query_row(
                    "SELECT root_path,state FROM roots WHERE root_id=?",
                    [&root.id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(err)?;
            match existing {
                None => {
                    tx.execute("INSERT INTO roots(root_id,name,root_path,source,state) VALUES(?,?,?,?, 'building')", params![root.id,root.name,root.path.to_string_lossy(),root.source]).map_err(err)?;
                    rebuild.push(root.id.clone());
                }
                Some((old_path, _))
                    if canonical(&old_path) != canonical(&root.path.to_string_lossy()) =>
                {
                    tx.execute("DELETE FROM entries WHERE root_id=?", [&root.id])
                        .map_err(err)?;
                    tx.execute("DELETE FROM crawl_queue WHERE root_id=?", [&root.id])
                        .map_err(err)?;
                    tx.execute("UPDATE roots SET name=?,root_path=?,source=?,state='building',generation=0,indexed_entries=0,scanned_directories=0,last_complete_at=NULL,error=NULL,root_mtime=NULL,root_birthtime=NULL,refresh_mode='polling' WHERE root_id=?", params![root.name,root.path.to_string_lossy(),root.source,root.id]).map_err(err)?;
                    rebuild.push(root.id.clone());
                }
                Some(_) => {
                    tx.execute(
                        "UPDATE roots SET name=?,root_path=?,source=? WHERE root_id=?",
                        params![root.name, root.path.to_string_lossy(), root.source, root.id],
                    )
                    .map_err(err)?;
                }
            }
        }
        tx.commit().map_err(err)?;
        Ok(rebuild)
    }

    pub fn root_row(&self, id: &str) -> Result<Option<RootRow>, String> {
        self.connection.query_row(
            "SELECT state,generation,last_complete_at,root_mtime,root_birthtime FROM roots WHERE root_id=?", [id],
            |row| Ok(RootRow { state: row.get(0)?, generation: row.get(1)?, last_complete_at: row.get(2)?, root_mtime: row.get(3)?, root_birthtime: row.get(4)? }),
        ).optional().map_err(err)
    }

    pub fn execute(&self, sql: &str, values: impl rusqlite::Params) -> Result<usize, String> {
        self.connection.execute(sql, values).map_err(err)
    }

    pub fn enqueue_crawl(&self, root_id: &str, path: &str, generation: i64) -> Result<(), String> {
        self.execute(
            "INSERT OR IGNORE INTO crawl_queue(root_id,relative_path,generation) VALUES(?,?,?)",
            params![root_id, path, generation],
        )?;
        Ok(())
    }

    pub fn next_crawl(&self, root_id: &str, generation: i64) -> Result<Option<String>, String> {
        self.connection.query_row("SELECT relative_path FROM crawl_queue WHERE root_id=? AND generation=? ORDER BY rowid LIMIT 1", params![root_id,generation], |row| row.get(0)).optional().map_err(err)
    }

    pub fn write_entries(&mut self, root_id: &str, entries: &[IndexedEntry]) -> Result<(), String> {
        if entries.is_empty() {
            return Ok(());
        }
        let tx = self.connection.transaction().map_err(err)?;
        for entry in entries {
            tx.execute(
                "INSERT INTO entries(root_id,relative_path,parent_path,name,name_key,path_key,is_directory,extension,media_type,directory_mtime,directory_birthtime,generation,seen_token)
                 VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL,?,?) ON CONFLICT(root_id,relative_path) DO UPDATE SET
                 parent_path=excluded.parent_path,name=excluded.name,name_key=excluded.name_key,path_key=excluded.path_key,
                 is_directory=excluded.is_directory,extension=excluded.extension,media_type=excluded.media_type,
                 directory_mtime=CASE WHEN excluded.is_directory=1 AND entries.is_directory=1 THEN entries.directory_mtime ELSE NULL END,
                 directory_birthtime=CASE WHEN excluded.is_directory=1 AND entries.is_directory=1 THEN entries.directory_birthtime ELSE NULL END,
                 generation=excluded.generation,seen_token=excluded.seen_token",
                params![root_id,entry.relative_path,entry.parent_path,entry.name,normalize(&entry.name),normalize(&entry.relative_path),entry.is_directory as i32,entry.extension,entry.media_type,entry.generation,entry.seen_token],
            ).map_err(err)?;
            if entry.is_directory && entry.queue_directory {
                tx.execute("INSERT OR IGNORE INTO crawl_queue(root_id,relative_path,generation) VALUES(?,?,?)", params![root_id,entry.relative_path,entry.generation]).map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }

    pub fn directory_exists(&self, root_id: &str, path: &str) -> Result<bool, String> {
        self.connection.query_row("SELECT EXISTS(SELECT 1 FROM entries WHERE root_id=? AND relative_path=? AND is_directory=1)", params![root_id,path], |row| row.get(0)).map_err(err)
    }

    pub fn stale_child_directories(
        &self,
        root_id: &str,
        parent: &str,
        token: i64,
    ) -> Result<Vec<String>, String> {
        let mut stmt = self.connection.prepare("SELECT relative_path FROM entries WHERE root_id=? AND parent_path=? AND seen_token<>? AND is_directory=1 LIMIT 256").map_err(err)?;
        stmt.query_map(params![root_id, parent, token], |row| row.get(0))
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)
    }

    pub fn directory_page(
        &self,
        root_id: &str,
        cursor: i64,
        limit: u32,
    ) -> Result<Vec<DirectoryRow>, String> {
        let mut stmt = self.connection.prepare("SELECT id,relative_path,directory_mtime,directory_birthtime FROM entries WHERE root_id=? AND is_directory=1 AND id>? ORDER BY id LIMIT ?").map_err(err)?;
        stmt.query_map(params![root_id, cursor, limit], |row| {
            Ok(DirectoryRow {
                id: row.get(0)?,
                relative_path: row.get(1)?,
                mtime: row.get(2)?,
                birthtime: row.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)
    }

    pub fn count(&self, root_id: &str) -> Result<i64, String> {
        self.connection
            .query_row(
                "SELECT count(*) FROM entries WHERE root_id=?",
                [root_id],
                |row| row.get(0),
            )
            .map_err(err)
    }

    pub fn set_refresh_mode(&self, root_id: &str, mode: &str, error: Option<&str>) {
        let _ = self.connection.execute(
            "UPDATE roots SET refresh_mode=?,error=COALESCE(?,error) WHERE root_id=?",
            params![mode, error, root_id],
        );
    }

    pub fn status(&self, watcher_count: usize) -> Result<Status, String> {
        let mut stmt = self.connection.prepare("SELECT root_id,name,state,refresh_mode,indexed_entries,scanned_directories,last_complete_at,error FROM roots ORDER BY name").map_err(err)?;
        let roots = stmt
            .query_map([], |row| {
                Ok(RootStatus {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    state: row.get(2)?,
                    refresh_mode: row.get(3)?,
                    indexed_entries: row.get(4)?,
                    scanned_directories: row.get(5)?,
                    last_complete_at: row.get(6)?,
                    error: row.get(7)?,
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        let state = if roots.iter().any(|root| root.state == "building") {
            "building"
        } else if roots.iter().any(|root| root.state == "refreshing") {
            "refreshing"
        } else if roots
            .iter()
            .any(|root| root.state == "partial" || root.state == "offline")
        {
            "partial"
        } else if roots.iter().any(|root| root.state == "error") {
            "error"
        } else {
            "ready"
        }
        .to_string();
        Ok(Status {
            stale: state != "ready",
            state,
            indexed_entries: roots.iter().map(|r| r.indexed_entries).sum(),
            scanned_directories: roots.iter().map(|r| r.scanned_directories).sum(),
            watcher_count,
            roots,
            error: None,
        })
    }

    pub fn search_rows(&self, phrase: &str) -> Result<Vec<SearchRow>, String> {
        let mut stmt = self.connection.prepare(
            "SELECT e.root_id,e.relative_path,e.parent_path,e.is_directory,e.name,e.extension||char(0)||e.media_type FROM entries_fts JOIN entries e ON e.id=entries_fts.rowid JOIN roots r ON r.root_id=e.root_id WHERE entries_fts MATCH ? AND r.state<>'offline' ORDER BY bm25(entries_fts,10.0,1.0) LIMIT ?"
        ).map_err(err)?;
        stmt.query_map(params![phrase, SEARCH_CANDIDATE_LIMIT as i64], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get::<_, i32>(3)? != 0,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)
    }

    pub fn checkpoint(&self, truncate: bool) {
        let _ = self.connection.execute_batch(if truncate {
            "PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);"
        } else {
            "PRAGMA wal_checkpoint(PASSIVE);"
        });
    }
}

fn table_exists(connection: &Connection, name: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?)",
            [name],
            |row| row.get(0),
        )
        .map_err(err)
}
fn column_exists(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(err)?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(names.iter().any(|name| name == column))
}
fn canonical(value: &str) -> String {
    std::path::absolute(Path::new(value))
        .unwrap_or_else(|_| Path::new(value).to_path_buf())
        .to_string_lossy()
        .into_owned()
}
fn err(error: rusqlite::Error) -> String {
    error.to_string()
}
