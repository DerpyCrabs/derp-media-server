mod db;
mod indexer;
mod types;

use self::{
    db::{IndexDb, SEARCH_CANDIDATE_LIMIT},
    types::*,
};
use crate::{
    config::{FileSearchConfig, MediaRoot},
    error::{AppError, AppResult},
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher, event::ModifyKind};
use serde_json::{Value, json};
use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    path::{Component, Path},
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::sync::{RwLock, Semaphore, mpsc};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

const MAX_PENDING_DIRECTORIES: usize = 2_048;
const WATCH_DEBOUNCE: Duration = Duration::from_millis(200);

enum Request {
    ChangeLogical(String),
    ChangeRoot { root_id: String, directory: String },
    WatchFailed { root_id: String, error: String },
    ReconcileAll(Option<tokio::sync::oneshot::Sender<()>>),
}

pub struct FileSearch {
    config: FileSearchConfig,
    roots: RwLock<Vec<Root>>,
    db: StdMutex<Option<IndexDb>>,
    reader: StdMutex<Option<IndexDb>>,
    init_error: StdMutex<Option<String>>,
    sender: mpsc::UnboundedSender<Request>,
    watchers: StdMutex<HashMap<String, RecommendedWatcher>>,
    degraded_watchers: StdMutex<HashSet<String>>,
    target_token: StdMutex<i64>,
    requests: Arc<Semaphore>,
}

impl FileSearch {
    pub fn new(config: FileSearchConfig, roots: Vec<MediaRoot>) -> Arc<Self> {
        let roots = roots.into_iter().map(root_from_media).collect::<Vec<_>>();
        let (sender, receiver) = mpsc::unbounded_channel();
        let (db, init_error, rebuild) = if config.enabled {
            match IndexDb::open_or_recover(&config) {
                Ok(mut db) => match db.sync_roots(&roots) {
                    Ok(rebuild) => (Some(db), None, rebuild),
                    Err(error) => (None, Some(error), Vec::new()),
                },
                Err(error) => (None, Some(error), Vec::new()),
            }
        } else {
            (None, None, Vec::new())
        };
        let service = Arc::new(Self {
            config,
            roots: RwLock::new(roots),
            db: StdMutex::new(db),
            reader: StdMutex::new(None),
            init_error: StdMutex::new(init_error),
            sender,
            watchers: StdMutex::new(HashMap::new()),
            degraded_watchers: StdMutex::new(HashSet::new()),
            target_token: StdMutex::new(now_ms() as i64),
            requests: Arc::new(Semaphore::new(64)),
        });
        if service.config.enabled && service.db.lock().is_ok_and(|db| db.is_some()) {
            let runner = service.clone();
            tokio::spawn(async move { runner.run(receiver, rebuild).await });
            let weak = Arc::downgrade(&service);
            tokio::spawn(async move {
                loop {
                    let Some(service) = weak.upgrade() else { break };
                    let (complete, receiver) = tokio::sync::oneshot::channel();
                    if service
                        .sender
                        .send(Request::ReconcileAll(Some(complete)))
                        .is_err()
                    {
                        break;
                    }
                    drop(service);
                    if receiver.await.is_err() {
                        break;
                    }
                    let Some(service) = weak.upgrade() else { break };
                    let degraded = service.current_status().state != "ready";
                    drop(service);
                    tokio::time::sleep(Duration::from_secs(if degraded { 3 } else { 60 })).await;
                }
            });
        }
        service
    }

    pub fn changed(&self, directory: &str) {
        if self.config.enabled {
            let _ = self.sender.send(Request::ChangeLogical(directory.into()));
        }
    }

    pub async fn search(self: &Arc<Self>, query_raw: &str, limit: usize) -> AppResult<Value> {
        let _permit = self
            .requests
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::internal("File search queue is busy"))?;
        if !self.config.enabled {
            return Err(AppError::internal("File search is disabled"));
        }
        if let Some(error) = self.init_error.lock().ok().and_then(|error| error.clone()) {
            return Err(AppError::internal(error));
        }
        let query = normalize(query_raw);
        let roots = self.roots.read().await.clone();
        let service = self.clone();
        tokio::task::spawn_blocking(move || service.search_sync(&query, limit, &roots))
            .await
            .map_err(|error| AppError::internal(error.to_string()))?
    }

    fn search_sync(&self, query: &str, limit: usize, roots: &[Root]) -> AppResult<Value> {
        let phrase = format!("\"{}\"", query.replace('"', "\"\""));
        let watcher_count = self
            .watchers
            .lock()
            .map(|watchers| watchers.len())
            .unwrap_or(0);
        let mut reader = self
            .reader
            .lock()
            .map_err(|_| AppError::internal("File search unavailable"))?;
        if reader.is_none() {
            *reader =
                Some(IndexDb::open_reader(&self.config.index_path).map_err(AppError::internal)?);
        }
        let db = reader
            .as_ref()
            .ok_or_else(|| AppError::internal("File search unavailable"))?;
        let rows = db.search_rows(&phrase).map_err(AppError::internal)?;
        let status = db.status(watcher_count).map_err(AppError::internal)?;
        let failed_roots = status
            .roots
            .iter()
            .filter(|root| root.state == "error")
            .map(|root| root.id.as_str())
            .collect::<HashSet<_>>();
        let mut results = Vec::new();
        for (root_id, relative, parent, is_directory, name, packed) in &rows {
            let Some(root) = roots.iter().find(|root| &root.id == root_id) else {
                continue;
            };
            let (extension, media_type) = packed
                .split_once('\0')
                .unwrap_or((packed.as_str(), "other"));
            results.push(ResultEntry {
                name: name.clone(),
                path: logical_path(root, relative, roots.len()),
                parent_path: logical_path(root, parent, roots.len()),
                root_id: root.id.clone(),
                root_name: root.name.clone(),
                is_directory: *is_directory,
                extension: extension.into(),
                media_type: if *is_directory {
                    "folder".into()
                } else {
                    media_type.into()
                },
            });
        }
        for root in roots {
            if failed_roots.contains(root.id.as_str()) || !normalize(&root.name).contains(query) {
                continue;
            }
            results.push(ResultEntry {
                name: root.name.clone(),
                path: logical_path(root, "", roots.len()),
                parent_path: String::new(),
                root_id: root.id.clone(),
                root_name: root.name.clone(),
                is_directory: true,
                extension: String::new(),
                media_type: "folder".into(),
            });
        }
        let mut seen = HashSet::new();
        results.retain(|entry| seen.insert(format!("{}:{}", entry.root_id, entry.path)));
        results.sort_by(|a, b| {
            score(a, query)
                .partial_cmp(&score(b, query))
                .unwrap_or(Ordering::Equal)
                .then_with(|| utf16_len(&a.path).cmp(&utf16_len(&b.path)))
                .then_with(|| natord::compare_ignore_case(&a.path, &b.path))
        });
        let truncated = rows.len() >= SEARCH_CANDIDATE_LIMIT || results.len() > limit;
        results.truncate(limit);
        Ok(json!({"results":results,"truncated":truncated,"status":status}))
    }

    fn current_status(&self) -> Status {
        if !self.config.enabled {
            return Status {
                state: "disabled".into(),
                stale: false,
                indexed_entries: 0,
                scanned_directories: 0,
                watcher_count: 0,
                roots: Vec::new(),
                error: None,
            };
        }
        let watcher_count = self
            .watchers
            .lock()
            .map(|watchers| watchers.len())
            .unwrap_or(0);
        let mut reader = match self.reader.lock() {
            Ok(reader) => reader,
            Err(_) => return error_status("File search unavailable".into()),
        };
        if reader.is_none() {
            match IndexDb::open_reader(&self.config.index_path) {
                Ok(db) => *reader = Some(db),
                Err(error) => return error_status(error),
            }
        }
        reader
            .as_ref()
            .and_then(|db| db.status(watcher_count).ok())
            .unwrap_or_else(|| error_status("File search unavailable".into()))
    }

    async fn run(
        self: Arc<Self>,
        mut receiver: mpsc::UnboundedReceiver<Request>,
        rebuild: Vec<String>,
    ) {
        let initial = self.clone();
        let _ = tokio::task::spawn_blocking(move || initial.initialize(rebuild)).await;
        while let Some(request) = receiver.recv().await {
            if is_change(&request) {
                let mut changes = vec![request];
                let timer = tokio::time::sleep(WATCH_DEBOUNCE);
                tokio::pin!(timer);
                loop {
                    tokio::select! {
                        () = &mut timer => break,
                        next = receiver.recv() => match next {
                            Some(next) => {
                                if is_change(&next) {
                                    timer.as_mut().reset(tokio::time::Instant::now() + WATCH_DEBOUNCE);
                                }
                                changes.push(next);
                            }
                            None => break,
                        }
                    }
                }
                let worker = self.clone();
                let _ = tokio::task::spawn_blocking(move || worker.handle_batch(changes)).await;
            } else {
                let worker = self.clone();
                let _ = tokio::task::spawn_blocking(move || worker.handle(request)).await;
            }
        }
    }

    fn initialize(&self, rebuild: Vec<String>) {
        let roots = self.roots.blocking_read().clone();
        for root in &roots {
            let _ = self.with_db(|db| {
                if rebuild.contains(&root.id) {
                    indexer::full_scan(db, root)
                } else {
                    self.reconcile_one(db, root)
                }
            });
        }
        self.refresh_watchers();
    }

    fn handle_batch(&self, requests: Vec<Request>) {
        let mut pending: HashMap<String, HashSet<String>> = HashMap::new();
        let mut collapsed = HashSet::new();
        let mut count = 0;
        for request in requests {
            match request {
                Request::ChangeLogical(directory) => {
                    if let Some((id, path)) = self.map_logical(&directory) {
                        queue_change(&mut pending, &mut collapsed, &mut count, id, path)
                    }
                }
                Request::ChangeRoot { root_id, directory } => queue_change(
                    &mut pending,
                    &mut collapsed,
                    &mut count,
                    root_id,
                    normalize_relative(&directory),
                ),
                other => self.handle(other),
            }
        }
        let roots = self.roots.blocking_read().clone();
        for id in collapsed {
            if let Some(root) = roots.iter().find(|r| r.id == id) {
                let _ = self.with_db(|db| self.reconcile_one(db, root));
            }
        }
        for (id, dirs) in pending {
            if let Some(root) = roots.iter().find(|r| r.id == id) {
                for dir in dirs {
                    let token = self.next_token();
                    let _ = self.with_db(|db| indexer::rescan_directory(db, root, &dir, token));
                }
            }
        }
        self.refresh_watchers();
    }

    fn handle(&self, request: Request) {
        match request {
            Request::ReconcileAll(complete) => {
                let roots = self.roots.blocking_read().clone();
                for root in &roots {
                    let _ = self.with_db(|db| self.reconcile_one(db, root));
                }
                let _ = self.with_db(|db| {
                    db.checkpoint(false);
                    Ok(())
                });
                self.refresh_watchers();
                if let Some(complete) = complete {
                    let _ = complete.send(());
                }
            }
            Request::WatchFailed { root_id, error } => {
                self.close_watcher(&root_id);
                self.degraded_watchers
                    .lock()
                    .ok()
                    .map(|mut set| set.insert(root_id.clone()));
                let _ = self.with_db(|db| {
                    db.set_refresh_mode(&root_id, "degraded", Some(&error));
                    Ok(())
                });
                let roots = self.roots.blocking_read().clone();
                if let Some(root) = roots.iter().find(|root| root.id == root_id) {
                    let _ = self.with_db(|db| self.reconcile_one(db, root));
                }
            }
            Request::ChangeLogical(directory) => {
                self.handle_batch(vec![Request::ChangeLogical(directory)])
            }
            Request::ChangeRoot { root_id, directory } => {
                self.handle_batch(vec![Request::ChangeRoot { root_id, directory }])
            }
        }
    }

    fn reconcile_one(&self, db: &mut IndexDb, root: &Root) -> Result<(), String> {
        let close_before = match (db.root_row(&root.id)?, std::fs::metadata(&root.path)) {
            (Some(row), Ok(metadata)) => {
                row.root_birthtime.is_none()
                    || indexer::metadata_birth_ms(&metadata) != row.root_birthtime
            }
            (Some(_), Err(_)) => true,
            (None, _) => false,
        };
        if close_before {
            self.close_watcher(&root.id);
        }
        let mut token = self
            .target_token
            .lock()
            .map_err(|_| "File search token lock poisoned".to_string())?;
        let result = indexer::reconcile(db, root, &self.config, &mut token);
        if db
            .root_row(&root.id)?
            .is_some_and(|row| row.state == "error")
        {
            self.close_watcher(&root.id);
        }
        result
    }
    fn next_token(&self) -> i64 {
        self.target_token
            .lock()
            .map(|mut value| {
                *value += 1;
                *value
            })
            .unwrap_or_else(|_| now_ms() as i64)
    }
    fn with_db<T>(
        &self,
        operation: impl FnOnce(&mut IndexDb) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut lock = self
            .db
            .lock()
            .map_err(|_| "File search database lock poisoned".to_string())?;
        operation(
            lock.as_mut()
                .ok_or_else(|| "File search unavailable".to_string())?,
        )
    }

    fn map_logical(&self, directory: &str) -> Option<(String, String)> {
        let normalized = normalize_relative(directory);
        let roots = self.roots.blocking_read();
        if roots.len() <= 1 {
            return roots.first().map(|root| (root.id.clone(), normalized));
        }
        let mut parts = normalized.split('/');
        let root_name = parts.next().unwrap_or("");
        roots
            .iter()
            .find(|root| root.name.eq_ignore_ascii_case(root_name))
            .map(|root| (root.id.clone(), parts.collect::<Vec<_>>().join("/")))
    }

    fn close_watcher(&self, id: &str) {
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.remove(id);
        }
    }
    fn refresh_watchers(&self) {
        if self.config.watch_mode == "off"
            || self.config.max_recursive_watchers == 0
            || !cfg!(any(windows, target_os = "macos"))
        {
            return;
        }
        let roots = self.roots.blocking_read().clone();
        let states = self
            .current_status()
            .roots
            .into_iter()
            .map(|root| (root.id, root.state))
            .collect::<HashMap<_, _>>();
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.retain(|id, _| {
                roots
                    .iter()
                    .any(|root| &root.id == id && watch_eligible(root))
                    && states
                        .get(id)
                        .is_some_and(|state| state != "error" && state != "building")
            });
            for root in &roots {
                if watchers.len() >= self.config.max_recursive_watchers as usize {
                    break;
                }
                if watchers.contains_key(&root.id) || !watch_eligible(root) {
                    continue;
                }
                if states
                    .get(&root.id)
                    .is_none_or(|state| state == "error" || state == "building")
                {
                    continue;
                }
                let id = root.id.clone();
                let base = root.path.clone();
                let sender = self.sender.clone();
                let watch_failure_sender = self.sender.clone();
                match notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    match event {
                        Ok(event) if watch_event(&event.kind) => {
                            if event.paths.is_empty() {
                                let _ = sender.send(Request::WatchFailed {
                                    root_id: id.clone(),
                                    error: "Watcher event did not include a filename".into(),
                                });
                                return;
                            }
                            for changed in event.paths {
                                if let Ok(relative) = changed.strip_prefix(&base) {
                                    let normalized =
                                        normalize_relative(&relative.to_string_lossy());
                                    if !ignored_event_path(&normalized) {
                                        let _ = sender.send(Request::ChangeRoot {
                                            root_id: id.clone(),
                                            directory: parent_relative(&normalized),
                                        });
                                    }
                                }
                            }
                        }
                        Err(error) => {
                            let _ = sender.send(Request::WatchFailed {
                                root_id: id.clone(),
                                error: error.to_string(),
                            });
                        }
                        _ => {}
                    }
                }) {
                    Ok(mut watcher) => match watcher.watch(&root.path, RecursiveMode::Recursive) {
                        Ok(()) => {
                            watchers.insert(root.id.clone(), watcher);
                            self.degraded_watchers
                                .lock()
                                .ok()
                                .map(|mut set| set.remove(&root.id));
                            let _ = self.with_db(|db| {
                                db.set_refresh_mode(&root.id, "recursive-watch", None);
                                Ok(())
                            });
                        }
                        Err(error) => {
                            let _ = watch_failure_sender.send(Request::WatchFailed {
                                root_id: root.id.clone(),
                                error: error.to_string(),
                            });
                        }
                    },
                    Err(error) => {
                        let _ = self.sender.send(Request::WatchFailed {
                            root_id: root.id.clone(),
                            error: error.to_string(),
                        });
                    }
                }
            }
            let degraded = self
                .degraded_watchers
                .lock()
                .map(|set| set.clone())
                .unwrap_or_default();
            for root in &roots {
                if !watchers.contains_key(&root.id)
                    && states
                        .get(&root.id)
                        .is_some_and(|state| state != "error" && state != "building")
                {
                    let _ = self.with_db(|db| {
                        db.set_refresh_mode(
                            &root.id,
                            if degraded.contains(&root.id) {
                                "degraded"
                            } else {
                                "polling"
                            },
                            None,
                        );
                        Ok(())
                    });
                }
            }
        }
    }
}

fn is_change(request: &Request) -> bool {
    matches!(
        request,
        Request::ChangeLogical(_) | Request::ChangeRoot { .. }
    )
}

fn root_from_media(root: MediaRoot) -> Root {
    Root {
        id: root.id,
        name: root.name,
        path: root.path,
        source: "config".into(),
    }
}
fn queue_change(
    pending: &mut HashMap<String, HashSet<String>>,
    collapsed: &mut HashSet<String>,
    count: &mut usize,
    id: String,
    path: String,
) {
    if collapsed.contains(&id) {
        return;
    }
    let set = pending.entry(id.clone()).or_default();
    if set.contains(&path) {
        return;
    }
    if *count >= MAX_PENDING_DIRECTORIES {
        *count -= set.len();
        set.clear();
        collapsed.insert(id);
        return;
    }
    set.insert(path);
    *count += 1;
}
fn watch_eligible(root: &Root) -> bool {
    !cfg!(windows)
        || !root
            .path
            .to_string_lossy()
            .replace('/', "\\")
            .starts_with("\\\\")
}
fn watch_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(ModifyKind::Name(_))
    )
}
fn ignored_event_path(path: &str) -> bool {
    let parts = path.split('/').collect::<Vec<_>>();
    let ignored_parent = parts
        .iter()
        .take(parts.len().saturating_sub(1))
        .any(|part| {
            part.starts_with('.')
                || [
                    "node_modules",
                    "$RECYCLE.BIN",
                    "System Volume Information",
                    ".git",
                    ".svn",
                    ".hg",
                    "__pycache__",
                    ".DS_Store",
                ]
                .contains(part)
        });
    let ignored_file = parts.last().is_some_and(|name| {
        [
            "pagefile.sys",
            "swapfile.sys",
            "hiberfil.sys",
            "DumpStack.log",
            "DumpStack.log.tmp",
            "desktop.ini",
            "Thumbs.db",
            ".DS_Store",
        ]
        .contains(name)
    });
    ignored_parent || ignored_file
}
fn logical_path(root: &Root, relative: &str, count: usize) -> String {
    if count <= 1 {
        relative.into()
    } else if relative.is_empty() {
        root.name.clone()
    } else {
        format!("{}/{}", root.name, relative)
    }
}
pub(super) fn normalize(value: &str) -> String {
    value
        .replace('\\', "/")
        .nfkd()
        .filter(|character| !is_combining_mark(*character))
        .collect::<String>()
        .to_lowercase()
        .trim()
        .into()
}

pub(super) fn normalize_relative(value: &str) -> String {
    let mut parts = Vec::new();
    for component in Path::new(&value.replace('\\', "/")).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::ParentDir => {
                parts.pop();
            }
            _ => {}
        }
    }
    parts.join("/")
}
pub(super) fn parent_relative(value: &str) -> String {
    value.rsplit_once('/').map_or("", |value| value.0).into()
}
fn score(entry: &ResultEntry, query: &str) -> f64 {
    let name = normalize(&entry.name);
    if name == query {
        return 0.0;
    }
    if name.starts_with(query) {
        return 10.0 + utf16_len(&name) as f64 / 10_000.0;
    }
    if let Some(index) = name.find(query) {
        let query_index = utf16_len(&name[..index]);
        let preceding = name[..index].chars().next_back();
        let boundary =
            index == 0 || preceding.is_some_and(|c| c.is_whitespace() || "._-".contains(c));
        let score_index = if boundary && index > 0 {
            query_index.saturating_sub(preceding.map(char::len_utf16).unwrap_or(0))
        } else {
            query_index
        };
        return if boundary { 20.0 } else { 30.0 } + score_index as f64 / 1_000.0;
    }
    let full_path = normalize(&entry.path);
    let path_index = full_path
        .find(query)
        .map(|index| utf16_len(&full_path[..index]) as f64)
        .unwrap_or(-1.0);
    40.0 + path_index / 1_000.0 + utf16_len(&full_path) as f64 / 100_000.0
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}
fn error_status(error: String) -> Status {
    Status {
        state: "error".into(),
        stale: true,
        indexed_entries: 0,
        scanned_directories: 0,
        watcher_count: 0,
        roots: Vec::new(),
        error: Some(error),
    }
}
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::FileSearchConfig;
    #[test]
    fn relative_paths_cannot_escape() {
        assert_eq!(normalize_relative("a/../b\\c"), "b/c");
        assert_eq!(normalize_relative("../../x"), "x");
    }
    #[test]
    fn logical_multi_root_path() {
        let root = Root {
            id: "1".into(),
            name: "Media".into(),
            path: ".".into(),
            source: "config".into(),
        };
        assert_eq!(logical_path(&root, "a.jpg", 2), "Media/a.jpg");
    }

    #[tokio::test]
    async fn warm_index_reads_do_not_wait_for_writer() {
        let base =
            std::env::temp_dir().join(format!("derp-rust-search-read-{}", uuid::Uuid::new_v4()));
        let root_path = base.join("media");
        std::fs::create_dir_all(&root_path).unwrap();
        std::fs::write(root_path.join("Visible Needle.txt"), "content").unwrap();
        let config = FileSearchConfig {
            enabled: true,
            index_path: base.join("index.sqlite"),
            watch_mode: "off".into(),
            max_recursive_watchers: 0,
            max_fs_concurrency: 2,
            reconcile_directories_per_second: 64,
        };
        let root = Root {
            id: "root".into(),
            name: "Media".into(),
            path: root_path,
            source: "config".into(),
        };
        let mut writer = IndexDb::open_or_recover(&config).unwrap();
        writer.sync_roots(std::slice::from_ref(&root)).unwrap();
        indexer::full_scan(&mut writer, &root).unwrap();
        let (sender, _receiver) = mpsc::unbounded_channel();
        let service = Arc::new(FileSearch {
            config,
            roots: RwLock::new(vec![root]),
            db: StdMutex::new(Some(writer)),
            reader: StdMutex::new(None),
            init_error: StdMutex::new(None),
            sender,
            watchers: StdMutex::new(HashMap::new()),
            degraded_watchers: StdMutex::new(HashSet::new()),
            target_token: StdMutex::new(now_ms() as i64),
            requests: Arc::new(Semaphore::new(64)),
        });
        let (locked_sender, locked_receiver) = std::sync::mpsc::channel();
        let (release_sender, release_receiver) = std::sync::mpsc::channel();
        let writer_service = service.clone();
        let writer_thread = std::thread::spawn(move || {
            let _writer = writer_service.db.lock().unwrap();
            locked_sender.send(()).unwrap();
            release_receiver.recv().unwrap();
        });
        locked_receiver.recv().unwrap();

        let search =
            tokio::time::timeout(Duration::from_millis(500), service.search("needle", 50)).await;
        release_sender.send(()).unwrap();
        writer_thread.join().unwrap();

        assert_eq!(
            search.unwrap().unwrap()["results"][0]["name"],
            "Visible Needle.txt"
        );
        drop(service);
        std::fs::remove_dir_all(base).unwrap();
    }
}
