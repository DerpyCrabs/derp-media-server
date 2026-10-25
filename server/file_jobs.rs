use crate::{
    app::{Shared, emit, emit_path_moved, emit_path_removed},
    error::{AppError, AppResult},
    file_mutation::FileMutation,
    media,
};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::Path as FsPath,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::{Notify, Semaphore};

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Copy,
    Move,
    Delete,
    Trash,
    CreateArchive,
    ExtractArchive,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ConflictChoice {
    #[default]
    Ask,
    Skip,
    Replace,
    KeepBoth,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub operation: Operation,
    pub paths: Vec<String>,
    #[serde(default)]
    pub destination: String,
    pub name: Option<String>,
    pub entries: Option<Vec<String>>,
    #[serde(default)]
    pub conflict: ConflictChoice,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    id: String,
    operation: Operation,
    status: String,
    total: usize,
    completed: usize,
    skipped: usize,
    bytes: u64,
    current: String,
    conflict: Option<String>,
    errors: Vec<Value>,
}
struct Job {
    progress: Mutex<Progress>,
    cancel: AtomicBool,
    choice: Mutex<Option<(ConflictChoice, bool)>>,
    notify: Notify,
}
impl Job {
    fn update(&self, f: impl FnOnce(&mut Progress)) {
        f(&mut self.progress.lock().unwrap());
    }
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
    fn check(&self) -> AppResult<()> {
        if self.cancelled() {
            Err(AppError::bad("Cancelled"))
        } else {
            Ok(())
        }
    }
    fn bytes(&self, bytes: u64) {
        self.update(|p| p.bytes += bytes);
    }
}
pub struct Registry {
    jobs: Mutex<BTreeMap<String, Arc<Job>>>,
    slots: Arc<Semaphore>,
}
impl Default for Registry {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(BTreeMap::new()),
            slots: Arc::new(Semaphore::new(2)),
        }
    }
}
fn writable(state: &Shared, path: &str) -> AppResult<()> {
    let resolved = media::resolve(&state.config, path)?;
    if !media::editable(&state.config, path) {
        return Err(AppError::forbidden(
            "Destination or source is not in an editable folder",
        ));
    }
    if resolved.relative.is_empty() {
        return Err(AppError::forbidden("Cannot replace a media root"));
    }
    Ok(())
}
fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    }
}
fn name(path: &str) -> AppResult<&str> {
    path.rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::bad("Invalid filename"))
}
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && ![".", ".."].contains(&name)
        && !name.contains(['/', '\\', '\0'])
        && !name.starts_with(".derp-")
}

pub async fn start_job(state: Shared, mut request: Request) -> AppResult<String> {
    if request.paths.is_empty() || request.paths.len() > 10000 {
        return Err(AppError::bad("Select between 1 and 10000 items"));
    }
    request.paths = request
        .paths
        .iter()
        .map(|p| p.replace('\\', "/").trim_matches('/').to_string())
        .collect();
    request.paths.sort();
    request.paths.dedup();
    let all = request.paths.clone();
    request.paths.retain(|path| {
        !all.iter()
            .any(|parent| path != parent && path.starts_with(&format!("{parent}/")))
    });
    for path in &request.paths {
        let resolved = media::resolve(&state.config, path)?;
        if resolved.relative.is_empty() {
            return Err(AppError::forbidden(
                "Select files or folders inside a media root",
            ));
        }
        if !resolved.full.exists() {
            return Err(AppError::not_found("Source does not exist"));
        }
        if matches!(
            request.operation,
            Operation::Move | Operation::Delete | Operation::Trash
        ) {
            writable(&state, path)?;
        }
    }
    if request.operation == Operation::Trash {
        crate::desktop_trash::require(&state.config)?;
    }
    if !matches!(request.operation, Operation::Delete | Operation::Trash) {
        let dest = media::resolve(&state.config, &request.destination)?;
        if !dest.full.is_dir() {
            return Err(AppError::bad("Choose an existing destination folder"));
        }
        for path in &request.paths {
            writable(&state, &join(&request.destination, name(path)?))?;
        }
    }
    if request.operation == Operation::CreateArchive {
        let name = request
            .name
            .as_deref()
            .filter(|n| valid_name(n) && crate::archives::Format::for_path(FsPath::new(n)).is_ok())
            .ok_or_else(|| AppError::bad("Enter a ZIP, TAR, TAR.GZ or TAR.XZ filename"))?;
        writable(&state, &join(&request.destination, name))?;
    }
    if request.operation == Operation::ExtractArchive && request.paths.len() != 1 {
        return Err(AppError::bad("Select one archive"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let job = Arc::new(Job {
        progress: Mutex::new(Progress {
            id: id.clone(),
            operation: request.operation,
            status: "queued".into(),
            total: request.paths.len(),
            completed: 0,
            skipped: 0,
            bytes: 0,
            current: String::new(),
            conflict: None,
            errors: vec![],
        }),
        cancel: AtomicBool::new(false),
        choice: Mutex::new(None),
        notify: Notify::new(),
    });
    {
        let mut jobs = state.file_jobs.jobs.lock().unwrap();
        if jobs.len() >= 100 {
            let finished: Vec<_> = jobs
                .iter()
                .filter(|(_, j)| {
                    matches!(
                        j.progress.lock().unwrap().status.as_str(),
                        "completed" | "cancelled" | "failed"
                    )
                })
                .map(|(id, _)| id.clone())
                .collect();
            for id in finished {
                jobs.remove(&id);
            }
        }
        if jobs.len() >= 100 {
            return Err(AppError::bad("Too many active file operations"));
        }
        jobs.insert(id.clone(), job.clone());
    }
    tokio::spawn(async move {
        let _permit = state.file_jobs.slots.clone().acquire_owned().await.unwrap();
        job.update(|p| p.status = "running".into());
        let result = run(&state, &job, request).await;
        job.update(|p| {
            p.conflict = None;
            if job.cancelled() {
                p.status = "cancelled".into();
            } else if let Err(error) = result {
                p.status = "failed".into();
                p.errors.push(json!({"path":p.current,"message":error.1}));
            } else {
                p.status = if p.errors.is_empty() {
                    "completed"
                } else {
                    "failed"
                }
                .into();
            }
        });
    });
    Ok(id)
}
async fn destination(
    state: &Shared,
    job: &Job,
    path: String,
    policy: &mut ConflictChoice,
) -> AppResult<Option<(String, bool)>> {
    job.check()?;
    writable(state, &path)?;
    if !media::resolve(&state.config, &path)?.full.exists() {
        return Ok(Some((path, false)));
    }
    let mut choice = *policy;
    if choice == ConflictChoice::Ask {
        job.update(|p| {
            p.status = "conflict".into();
            p.conflict = Some(path.clone());
        });
        loop {
            let notified = job.notify.notified();
            job.check()?;
            if let Some((answer, all)) = job.choice.lock().unwrap().take() {
                choice = answer;
                if all {
                    *policy = answer;
                }
                break;
            }
            notified.await;
        }
        job.update(|p| {
            p.status = "running".into();
            p.conflict = None;
        });
    }
    match choice {
        ConflictChoice::Skip => {
            job.update(|p| p.skipped += 1);
            Ok(None)
        }
        ConflictChoice::Replace => Ok(Some((path, true))),
        ConflictChoice::KeepBoth => {
            let parent = crate::app::parent_logical(&path);
            let original = FsPath::new(name(&path)?);
            let full = media::resolve(&state.config, &path)?.full;
            let stem = if full.is_dir() {
                name(&path)?.to_string()
            } else {
                original
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            };
            let ext = if full.is_dir() {
                String::new()
            } else {
                original
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default()
            };
            for index in 2..100000 {
                let candidate = join(&parent, &format!("{stem} ({index}){ext}"));
                if !media::resolve(&state.config, &candidate)?.full.exists() {
                    return Ok(Some((candidate, false)));
                }
            }
            Err(AppError::conflict("Cannot find an unused destination name"))
        }
        ConflictChoice::Ask => Err(AppError::bad("Choose a conflict action")),
    }
}
async fn transfer(
    state: &Shared,
    job: &Job,
    source: &str,
    target: String,
    moving: bool,
    policy: &mut ConflictChoice,
) -> AppResult<()> {
    let Some((target, replace)) = destination(state, job, target, policy).await? else {
        return Ok(());
    };
    if source == target {
        return Err(AppError::bad(
            "Source and destination are the same; choose Keep both to make a copy",
        ));
    }
    if moving {
        writable(state, source)?;
    }
    FileMutation::new(state)
        .transfer(
            source,
            &target,
            moving,
            replace,
            &|| job.cancelled(),
            &|n| job.bytes(n),
        )
        .await?;
    if moving {
        emit_path_moved(state, source, &target);
        emit(state, source);
    }
    emit(state, &target);
    Ok(())
}
async fn run(state: &Shared, job: &Arc<Job>, request: Request) -> AppResult<()> {
    job.check()?;
    let mut policy = request.conflict;
    if request.operation == Operation::CreateArchive {
        return create_archive(state, job, &request, &mut policy).await;
    }
    if request.operation == Operation::ExtractArchive {
        return extract_archive(state, job, &request, &mut policy).await;
    }
    for path in &request.paths {
        job.check()?;
        job.update(|p| p.current = path.clone());
        let result = match request.operation {
            Operation::Trash => {
                writable(state, path)?;
                FileMutation::new(state).trash(path).await.map(|_| {
                    emit_path_removed(state, path);
                    emit(state, path);
                })
            }
            Operation::Delete => {
                writable(state, path)?;
                FileMutation::new(state).delete(path).await.map(|_| {
                    emit_path_removed(state, path);
                    emit(state, path);
                })
            }
            _ => {
                transfer(
                    state,
                    job,
                    path,
                    join(&request.destination, name(path)?),
                    request.operation == Operation::Move,
                    &mut policy,
                )
                .await
            }
        };
        if let Err(error) = result {
            job.check()?;
            job.update(|p| p.errors.push(json!({"path":path,"message":error.1})));
        } else {
            job.update(|p| p.completed += 1);
        }
    }
    Ok(())
}

fn archive_error(e: impl std::fmt::Display) -> AppError {
    AppError::bad(format!("Archive: {e}"))
}
fn inspect_archive(path: &FsPath) -> AppResult<Vec<Value>> {
    crate::archives::inspect(path).map(|entries| {
        entries
            .into_iter()
            .map(|entry| serde_json::to_value(entry).unwrap())
            .collect()
    })
}
fn copy_bytes(
    input: &mut (impl std::io::Read + ?Sized),
    output: &mut impl std::io::Write,
    job: &Job,
) -> AppResult<()> {
    let mut buffer = vec![0; 256 * 1024];
    loop {
        job.check()?;
        let n = input.read(&mut buffer).map_err(AppError::io)?;
        if n == 0 {
            break;
        }
        output.write_all(&buffer[..n]).map_err(AppError::io)?;
        job.bytes(n as u64);
    }
    Ok(())
}
fn write_tar<W: std::io::Write>(
    output: W,
    sources: &[(std::path::PathBuf, String)],
    job: &Job,
) -> AppResult<W> {
    struct ProgressReader<'a> {
        file: std::fs::File,
        job: &'a Job,
    }
    impl std::io::Read for ProgressReader<'_> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.job.check().map_err(|e| std::io::Error::other(e.1))?;
            let n = self.file.read(buffer)?;
            self.job.bytes(n as u64);
            Ok(n)
        }
    }
    let mut archive = tar::Builder::new(output);
    for (source, name) in sources {
        for entry in walkdir::WalkDir::new(source) {
            job.check()?;
            let entry = entry.map_err(archive_error)?;
            let relative = entry.path().strip_prefix(source).map_err(archive_error)?;
            let member = std::path::Path::new(name).join(relative);
            job.update(|p| p.current = member.to_string_lossy().into_owned());
            if entry.file_type().is_symlink() {
                return Err(AppError::bad("Symbolic links cannot be archived"));
            }
            let metadata = entry.metadata().map_err(archive_error)?;
            let mut header = tar::Header::new_gnu();
            header.set_metadata(&metadata);
            // Ownership is local to the instance; archives should be portable.
            header.set_uid(0);
            header.set_gid(0);
            if entry.file_type().is_dir() {
                header.set_size(0);
                archive
                    .append_data(&mut header, &member, std::io::empty())
                    .map_err(archive_error)?;
            } else if entry.file_type().is_file() {
                let reader = ProgressReader {
                    file: std::fs::File::open(entry.path()).map_err(AppError::io)?,
                    job,
                };
                archive
                    .append_data(&mut header, &member, reader)
                    .map_err(archive_error)?;
            } else {
                return Err(AppError::bad("Unsupported file type in archive"));
            }
        }
        job.update(|p| p.completed += 1);
    }
    archive.into_inner().map_err(archive_error)
}
async fn create_archive(
    state: &Shared,
    job: &Arc<Job>,
    request: &Request,
    policy: &mut ConflictChoice,
) -> AppResult<()> {
    let format = crate::archives::Format::for_path(FsPath::new(request.name.as_deref().unwrap()))?;
    let target = join(&request.destination, request.name.as_deref().unwrap());
    if request
        .paths
        .iter()
        .any(|p| target == *p || target.starts_with(&format!("{p}/")))
    {
        return Err(AppError::bad(
            "Create the archive outside the selected folders",
        ));
    }
    let staging = join(
        &request.destination,
        &format!(".derp-archive-{}.zip", uuid::Uuid::new_v4()),
    );
    let full = media::resolve(&state.config, &staging)?.full;
    let sources = request
        .paths
        .iter()
        .map(|p| Ok((media::resolve(&state.config, p)?.full, name(p)?.to_string())))
        .collect::<AppResult<Vec<_>>>()?;
    let work = job.clone();
    let output = full.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<()> {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(AppError::io)?;
        use crate::archives::Format;
        match format {
            Format::Tar => {
                write_tar(file, &sources, &work)?;
                return Ok(());
            }
            Format::Gzip => {
                let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
                write_tar(encoder, &sources, &work)?
                    .finish()
                    .map_err(archive_error)?;
                return Ok(());
            }
            Format::Xz => {
                let encoder = xz2::write::XzEncoder::new(file, 1);
                write_tar(encoder, &sources, &work)?
                    .finish()
                    .map_err(archive_error)?;
                return Ok(());
            }
            Format::Zip => {}
        }
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(1));
        for (source, name) in sources {
            work.update(|p| p.current = name.clone());
            for entry in walkdir::WalkDir::new(&source) {
                work.check()?;
                let entry = entry.map_err(archive_error)?;
                let relative = entry
                    .path()
                    .strip_prefix(&source)
                    .map_err(archive_error)?
                    .to_string_lossy()
                    .replace('\\', "/");
                let member = if relative.is_empty() {
                    name.clone()
                } else {
                    format!("{name}/{relative}")
                };
                if entry.file_type().is_symlink() {
                    return Err(AppError::bad("Symbolic links cannot be archived"));
                }
                if entry.file_type().is_dir() {
                    archive
                        .add_directory(format!("{member}/"), options)
                        .map_err(archive_error)?;
                } else if entry.file_type().is_file() {
                    archive.start_file(member, options).map_err(archive_error)?;
                    copy_bytes(
                        &mut std::fs::File::open(entry.path()).map_err(AppError::io)?,
                        &mut archive,
                        &work,
                    )?;
                } else {
                    return Err(AppError::bad("Unsupported file type in archive"));
                }
            }
            work.update(|p| p.completed += 1);
        }
        archive.finish().map_err(archive_error)?;
        Ok(())
    })
    .await
    .map_err(archive_error)?;
    let result = match result {
        Ok(()) => transfer(state, job, &staging, target, true, policy).await,
        Err(e) => Err(e),
    };
    let _ = tokio::fs::remove_file(full).await;
    result
}
async fn extract_archive(
    state: &Shared,
    job: &Arc<Job>,
    request: &Request,
    policy: &mut ConflictChoice,
) -> AppResult<()> {
    let archive_path = media::resolve(&state.config, &request.paths[0])?.full;
    let inspect = archive_path.clone();
    let inspect_job = job.clone();
    let entries = tokio::task::spawn_blocking(move || {
        crate::archives::inspect_checked(&inspect, || inspect_job.check()).map(|entries| {
            entries
                .into_iter()
                .map(|entry| serde_json::to_value(entry).unwrap())
                .collect::<Vec<_>>()
        })
    })
    .await
    .map_err(archive_error)??;
    let selected: Vec<_> = entries
        .iter()
        .filter(|entry| {
            request.entries.as_ref().is_none_or(|selected| {
                selected.iter().any(|p| {
                    entry["path"]
                        .as_str()
                        .is_some_and(|name| name == p || name.starts_with(&format!("{p}/")))
                })
            })
        })
        .collect();
    if selected.is_empty() {
        return Err(AppError::bad("Select archive entries to extract"));
    }
    for entry in &selected {
        writable(
            state,
            &join(&request.destination, entry["path"].as_str().unwrap()),
        )?;
    }
    let members: Vec<String> = selected
        .iter()
        .map(|e| e["path"].as_str().unwrap().to_string())
        .collect();
    job.update(|p| {
        p.total = members.len();
        p.completed = 0;
    });
    let staging = join(
        &request.destination,
        &format!(".derp-extract-{}", uuid::Uuid::new_v4()),
    );
    let full = media::resolve(&state.config, &staging)?.full;
    let output = full.clone();
    let work = job.clone();
    let names = members.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<()> {
        crate::archives::extract(
            &archive_path,
            &output,
            &names,
            |input, output| copy_bytes(input, output, &work),
            || work.check(),
            |member| work.update(|p| p.current = member.to_string()),
        )?;
        Ok(())
    })
    .await
    .map_err(archive_error)?;
    if let Err(error) = result {
        let _ = tokio::fs::remove_dir_all(full).await;
        return Err(error);
    }
    let result = async {
        // Transfer files individually so an existing directory is merged rather than replaced.
        for member in members {
            job.check()?;
            let source = join(&staging, &member);
            let target = join(&request.destination, &member);
            let metadata = tokio::fs::metadata(media::resolve(&state.config, &source)?.full)
                .await
                .map_err(AppError::io)?;
            job.update(|p| p.current = member.clone());
            let result = if metadata.is_dir() {
                let resolved = media::resolve(&state.config, &target)?;
                if resolved.full.is_dir() {
                    Ok(())
                } else if !resolved.full.exists() {
                    FileMutation::new(state).create_directory(&target).await
                } else {
                    Err(AppError::conflict(
                        "An existing file blocks an archive directory",
                    ))
                }
            } else {
                transfer(state, job, &source, target.clone(), true, policy).await
            };
            if let Err(error) = result {
                job.check()?;
                job.update(|p| p.errors.push(json!({"path":member,"message":error.1})));
            } else {
                job.update(|p| p.completed += 1);
                emit(state, &target);
            }
        }
        Ok(())
    }
    .await;
    let _ = tokio::fs::remove_dir_all(full).await;
    result
}

async fn start(
    State(state): State<Shared>,
    Json(request): Json<Request>,
) -> AppResult<Json<Value>> {
    Ok(Json(json!({"id":start_job(state, request).await?})))
}
async fn status(State(state): State<Shared>, Path(id): Path<String>) -> AppResult<Json<Progress>> {
    Ok(Json(job(&state, &id)?.progress.lock().unwrap().clone()))
}
async fn list(State(state): State<Shared>) -> Json<Vec<Progress>> {
    Json(
        state
            .file_jobs
            .jobs
            .lock()
            .unwrap()
            .values()
            .map(|j| j.progress.lock().unwrap().clone())
            .collect(),
    )
}
#[derive(Deserialize)]
struct Decision {
    choice: ConflictChoice,
    #[serde(default)]
    all: bool,
}
fn job(state: &Shared, id: &str) -> AppResult<Arc<Job>> {
    state
        .file_jobs
        .jobs
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::not_found("Operation not found"))
}
async fn cancel(State(state): State<Shared>, Path(id): Path<String>) -> AppResult<Json<Value>> {
    let job = job(&state, &id)?;
    job.cancel.store(true, Ordering::Relaxed);
    job.notify.notify_one();
    Ok(Json(json!({"success":true})))
}
async fn decide(
    State(state): State<Shared>,
    Path(id): Path<String>,
    Json(decision): Json<Decision>,
) -> AppResult<Json<Value>> {
    let job = job(&state, &id)?;
    if decision.choice == ConflictChoice::Ask || job.progress.lock().unwrap().status != "conflict" {
        return Err(AppError::bad(
            "Operation is not waiting for a conflict decision",
        ));
    }
    *job.choice.lock().unwrap() = Some((decision.choice, decision.all));
    job.notify.notify_one();
    Ok(Json(json!({"success":true})))
}
#[derive(Deserialize)]
struct PathQuery {
    path: String,
}
async fn archive(
    State(state): State<Shared>,
    Query(query): Query<PathQuery>,
) -> AppResult<Json<Value>> {
    let path = media::resolve(&state.config, &query.path)?.full;
    let entries = tokio::task::spawn_blocking(move || inspect_archive(&path))
        .await
        .map_err(archive_error)??;
    Ok(Json(json!({"entries":entries})))
}
async fn properties(
    State(state): State<Shared>,
    Query(query): Query<PathQuery>,
) -> AppResult<Json<Value>> {
    let path = media::resolve(&state.config, &query.path)?.full;
    let metadata = tokio::fs::metadata(path).await.map_err(AppError::io)?;
    #[cfg(unix)]
    let permissions = {
        use std::os::unix::fs::PermissionsExt;
        format!("{:04o}", metadata.permissions().mode() & 0o7777)
    };
    #[cfg(not(unix))]
    let permissions = if metadata.permissions().readonly() {
        "Read only"
    } else {
        "Writable"
    }
    .to_string();
    Ok(Json(
        json!({"path":query.path,"size":metadata.len(),"directory":metadata.is_dir(),"permissions":permissions,"editable":media::editable(&state.config,&query.path),"modified":metadata.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t|t.as_secs_f64()*1000.)}),
    ))
}
pub fn router() -> Router<Shared> {
    Router::new()
        .route("/api/file-jobs", get(list).post(start))
        .route("/api/file-jobs/{id}", get(status))
        .route("/api/file-jobs/{id}/cancel", post(cancel))
        .route("/api/file-jobs/{id}/conflict", post(decide))
        .route("/api/files/archive", get(archive))
        .route("/api/files/properties", get(properties))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestApp;
    use std::io::Write;

    fn request(operation: Operation, paths: &[&str], destination: &str) -> Request {
        Request {
            operation,
            paths: paths.iter().map(|p| p.to_string()).collect(),
            destination: destination.into(),
            name: None,
            entries: None,
            conflict: ConflictChoice::Ask,
        }
    }
    async fn wait(state: &Shared, id: &str, status: Option<&str>) -> Progress {
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            loop {
                let progress = job(state, id).unwrap().progress.lock().unwrap().clone();
                if status.map_or_else(
                    || {
                        matches!(
                            progress.status.as_str(),
                            "completed" | "failed" | "cancelled"
                        )
                    },
                    |s| progress.status == s,
                ) {
                    return progress;
                }
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("job timed out")
    }
    #[tokio::test]
    async fn conflicts_keep_both_replace_skip_and_move() {
        let app = TestApp::new();
        app.write("source/a.txt", b"new");
        app.write("dest/a.txt", b"old");
        let id = start_job(
            app.state.clone(),
            request(Operation::Copy, &["source/a.txt"], "dest"),
        )
        .await
        .unwrap();
        wait(&app.state, &id, Some("conflict")).await;
        let _ = decide(
            State(app.state.clone()),
            Path(id.clone()),
            Json(Decision {
                choice: ConflictChoice::KeepBoth,
                all: true,
            }),
        )
        .await
        .unwrap();
        assert_eq!(wait(&app.state, &id, None).await.status, "completed");
        assert_eq!(
            std::fs::read(app.media.join("dest/a (2).txt")).unwrap(),
            b"new"
        );
        assert_eq!(std::fs::read(app.media.join("dest/a.txt")).unwrap(), b"old");
        let mut req = request(Operation::Move, &["source/a.txt"], "dest");
        req.conflict = ConflictChoice::Replace;
        let id = start_job(app.state.clone(), req).await.unwrap();
        assert_eq!(wait(&app.state, &id, None).await.status, "completed");
        assert!(!app.media.join("source/a.txt").exists());
        assert_eq!(std::fs::read(app.media.join("dest/a.txt")).unwrap(), b"new");
        app.write("source/a.txt", b"skip");
        let mut req = request(Operation::Move, &["source/a.txt"], "dest");
        req.conflict = ConflictChoice::Skip;
        let id = start_job(app.state.clone(), req).await.unwrap();
        assert_eq!(wait(&app.state, &id, None).await.skipped, 1);
        assert!(app.media.join("source/a.txt").exists());
    }
    #[tokio::test]
    async fn cancel_conflict_preserves_both_files() {
        let app = TestApp::new();
        app.write("a", b"source");
        app.write("dest/a", b"target");
        let id = start_job(app.state.clone(), request(Operation::Move, &["a"], "dest"))
            .await
            .unwrap();
        wait(&app.state, &id, Some("conflict")).await;
        let _ = cancel(State(app.state.clone()), Path(id.clone()))
            .await
            .unwrap();
        assert_eq!(wait(&app.state, &id, None).await.status, "cancelled");
        assert_eq!(std::fs::read(app.media.join("a")).unwrap(), b"source");
        assert_eq!(std::fs::read(app.media.join("dest/a")).unwrap(), b"target");
    }
    #[tokio::test]
    async fn allowlist_is_enforced_for_batch_and_archive() {
        let mut app = TestApp::new();
        app.write("private.txt", b"private");
        app.write("allowed/a", b"ok");
        let state = Arc::get_mut(&mut app.state).unwrap();
        state.config.write_access = crate::config::WriteAccess::EditableFolders;
        state.config.roots[0].editable_folders = vec!["allowed".into()];
        assert!(
            start_job(
                app.state.clone(),
                request(Operation::Delete, &["private.txt"], "")
            )
            .await
            .is_err()
        );
        assert!(
            start_job(
                app.state.clone(),
                request(Operation::Move, &["private.txt"], "allowed")
            )
            .await
            .is_err()
        );
        assert!(
            start_job(
                app.state.clone(),
                request(Operation::Copy, &["allowed/a"], "")
            )
            .await
            .is_err()
        );
        let id = start_job(
            app.state.clone(),
            request(Operation::Copy, &["private.txt"], "allowed"),
        )
        .await
        .unwrap();
        assert_eq!(wait(&app.state, &id, None).await.status, "completed");
        assert!(app.media.join("private.txt").exists());
    }
    #[tokio::test]
    async fn archive_round_trip_and_selective_extraction() {
        for extension in ["zip", "tar", "tar.gz", "tgz", "tar.xz", "txz"] {
            let app = TestApp::new();
            let archive_name = format!("test.{extension}");
            app.write("source/a.txt", b"one");
            app.write("source/nested/b.txt", b"two");
            std::fs::create_dir(app.media.join("out")).unwrap();
            let mut req = request(Operation::CreateArchive, &["source"], "");
            req.name = Some(archive_name.clone());
            let id = start_job(app.state.clone(), req).await.unwrap();
            assert_eq!(wait(&app.state, &id, None).await.status, "completed");
            let entries = inspect_archive(&app.media.join(&archive_name)).unwrap();
            assert_eq!(entries.len(), 4);
            let mut req = request(Operation::ExtractArchive, &[&archive_name], "out");
            req.entries = Some(vec!["source/nested".into()]);
            let id = start_job(app.state.clone(), req).await.unwrap();
            let result = wait(&app.state, &id, None).await;
            assert_eq!(result.status, "completed", "{:?}", result.errors);
            assert_eq!(
                std::fs::read(app.media.join("out/source/nested/b.txt")).unwrap(),
                b"two"
            );
            assert!(!app.media.join("out/source/a.txt").exists());
        }
    }
    #[tokio::test]
    async fn zip_slip_is_rejected() {
        let app = TestApp::new();
        let file = std::fs::File::create(app.media.join("bad.zip")).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file("../escape", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"bad").unwrap();
        archive.finish().unwrap();
        assert!(inspect_archive(&app.media.join("bad.zip")).is_err());
    }
    #[tokio::test]
    async fn partial_failure_continues_other_items() {
        let app = TestApp::new();
        app.write("a/file", b"a");
        app.write("b", b"b");
        let id = start_job(
            app.state.clone(),
            request(Operation::Copy, &["a", "b"], "a"),
        )
        .await
        .unwrap();
        let result = wait(&app.state, &id, None).await;
        assert_eq!(result.status, "failed");
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.completed, 1);
        assert_eq!(std::fs::read(app.media.join("a/b")).unwrap(), b"b");
    }
    #[tokio::test]
    async fn hidden_files_are_opt_in_and_staging_never_appears() {
        let app = TestApp::new();
        app.write("visible.txt", b"visible");
        app.write(".secret", b"hidden dotfile");
        app.write(".DS_Store", b"hidden");
        app.write(".hidden/file.txt", b"hidden folder");
        app.write(".derp-copy-test", b"staging");
        let mut cached = |_: &std::path::Path, _: std::time::SystemTime| false;
        let normal = media::list(&app.state.config, "", &mut cached).unwrap();
        assert!(normal.iter().any(|file| file.name == "visible.txt"));
        assert!(!normal.iter().any(|file| file.name == ".secret"));
        assert!(
            !normal
                .iter()
                .any(|file| file.name == ".DS_Store" || file.name == ".hidden")
        );
        let hidden = media::list_with_hidden(&app.state.config, "", &mut cached, true).unwrap();
        assert!(hidden.iter().any(|file| file.name == ".secret"));
        assert!(hidden.iter().any(|file| file.name == ".DS_Store"));
        assert!(hidden.iter().any(|file| file.name == ".hidden"));
        assert!(!hidden.iter().any(|file| file.name.starts_with(".derp-")));
    }
    #[tokio::test]
    async fn same_folder_copy_can_keep_both() {
        let app = TestApp::new();
        app.write("a.txt", b"original");
        let mut req = request(Operation::Copy, &["a.txt"], "");
        req.conflict = ConflictChoice::KeepBoth;
        let id = start_job(app.state.clone(), req).await.unwrap();
        assert_eq!(wait(&app.state, &id, None).await.status, "completed");
        assert_eq!(
            std::fs::read(app.media.join("a (2).txt")).unwrap(),
            b"original"
        );
    }
}
