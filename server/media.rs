use crate::{
    config::{Config, MediaRoot},
    error::{AppError, AppResult},
};
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Clone, Debug)]
pub struct ResolvedPath {
    pub root: MediaRoot,
    pub relative: String,
    pub full: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_date: Option<f64>,
    pub extension: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_virtual: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_generated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<f64>,
}

pub fn media_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "mp4" | "webm" | "ogg" | "mov" | "avi" | "mkv" | "m4v" => "video",
        "mp3" | "wav" | "m4a" | "flac" | "aac" | "opus" => "audio",
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "ico" => "image",
        "pdf" => "pdf",
        "epub" | "fb2" | "fb2.zip" => "book",
        "txt" | "md" | "json" | "xml" | "csv" | "log" | "yaml" | "yml" | "ini" | "conf" | "sh"
        | "bat" | "ps1" | "js" | "ts" | "jsx" | "tsx" | "css" | "scss" | "html" | "py" | "java"
        | "c" | "cpp" | "h" | "cs" | "go" | "rs" | "php" | "rb" | "swift" | "kt" | "sql" => "text",
        _ => "other",
    }
}
pub fn extension(path: &Path) -> String {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if name.ends_with(".fb2.zip") {
        "fb2.zip".into()
    } else {
        path.extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase()
    }
}
pub fn name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
pub fn mime_type(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "ogg" => "video/ogg",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "m4v" => "video/x-m4v",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "opus" => "audio/opus",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        "fb2" => "application/x-fictionbook+xml",
        "fb2.zip" => "application/zip",
        "txt" | "log" | "ini" | "conf" | "bat" => "text/plain",
        "md" => "text/markdown",
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "yaml" | "yml" => "text/yaml",
        "sh" => "text/x-shellscript",
        "ps1" => "text/plain",
        "js" | "jsx" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "css" => "text/css",
        "scss" => "text/x-scss",
        "html" => "text/html",
        "py" => "text/x-python",
        "java" => "text/x-java",
        "c" | "h" => "text/x-c",
        "cpp" => "text/x-c++",
        "cs" => "text/x-csharp",
        "go" => "text/x-go",
        "rs" => "text/x-rust",
        "php" => "text/x-php",
        "rb" => "text/x-ruby",
        "swift" => "text/x-swift",
        "kt" => "text/x-kotlin",
        "sql" => "text/x-sql",
        _ => "application/octet-stream",
    }
}
fn clean_logical(input: &str) -> AppResult<String> {
    let s = input.replace('\\', "/");
    let mut out = Vec::new();
    for part in s.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err(AppError::bad("Invalid path: Path traversal detected")),
            p => out.push(p),
        }
    }
    Ok(out.join("/"))
}
fn inside(child: &Path, root: &Path) -> bool {
    child.starts_with(root)
}

pub fn resolve(config: &Config, input: &str) -> AppResult<ResolvedPath> {
    let logical = clean_logical(input)?;
    let roots = &config.roots;
    let multiple = roots.len() > 1;
    let (root, relative) = if multiple {
        let mut split = logical.split('/');
        let first = split.next().unwrap_or("");
        if let Some(root) = roots.iter().find(|r| r.name.eq_ignore_ascii_case(first)) {
            (root.clone(), split.collect::<Vec<_>>().join("/"))
        } else {
            (config.roots[0].clone(), logical.clone())
        }
    } else {
        (
            roots
                .first()
                .ok_or_else(|| AppError::internal("No media roots"))?
                .clone(),
            logical.clone(),
        )
    };
    let mut full = root.path.clone();
    for component in Path::new(&relative).components() {
        if let Component::Normal(part) = component {
            full.push(part);
        } else if !matches!(component, Component::CurDir) {
            return Err(AppError::bad("Invalid path: Path traversal detected"));
        }
    }
    let absolute_root = std::path::absolute(&root.path).map_err(AppError::io)?;
    let absolute = std::path::absolute(&full).map_err(AppError::io)?;
    if !inside(&absolute, &absolute_root) {
        return Err(AppError::bad("Invalid path: Path traversal detected"));
    }
    if absolute_root.exists() {
        let mut existing = absolute.as_path();
        while !existing.exists() {
            let Some(parent) = existing.parent() else {
                break;
            };
            existing = parent;
        }
        let canonical = fs::canonicalize(existing).map_err(AppError::io)?;
        let canonical_root = fs::canonicalize(&absolute_root).map_err(AppError::io)?;
        if !inside(&canonical, &canonical_root) {
            return Err(AppError::bad(
                "Invalid path: Symbolic link escapes media root",
            ));
        }
    }
    Ok(ResolvedPath {
        root,
        relative,
        full: absolute,
    })
}
pub fn editable(config: &Config, input: &str) -> bool {
    resolve(config, input)
        .map(|r| {
            r.root.editable_folders.iter().any(|f| {
                let f = f.replace('\\', "/");
                r.relative == f || r.relative.starts_with(&(f + "/"))
            })
        })
        .unwrap_or(false)
}
fn excluded_dir(n: &str) -> bool {
    n.starts_with('.')
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
        .contains(&n)
}
fn excluded_file(n: &str) -> bool {
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
    .contains(&n)
}
fn virtual_item(name: &str) -> FileItem {
    FileItem {
        name: name.into(),
        path: name.into(),
        media_type: "folder".into(),
        size: 0,
        created_date: None,
        extension: String::new(),
        is_directory: true,
        is_virtual: Some(true),
        view_count: None,
        thumbnail_generated: None,
        version: None,
    }
}
pub fn list(config: &Config, input: &str) -> AppResult<Vec<FileItem>> {
    let logical = clean_logical(input)?;
    let mut items = if logical.is_empty() {
        vec![virtual_item("Favorites"), virtual_item("Most Played")]
    } else {
        vec![]
    };
    let roots = &config.roots;
    if roots.len() > 1 && logical.is_empty() {
        for r in roots {
            items.push(FileItem {
                name: r.name.clone(),
                path: r.name.clone(),
                media_type: "folder".into(),
                size: 0,
                created_date: fs::metadata(&r.path)
                    .ok()
                    .and_then(|metadata| metadata.created().ok())
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_secs_f64() * 1000.0),
                extension: String::new(),
                is_directory: true,
                is_virtual: None,
                view_count: None,
                thumbnail_generated: None,
                version: None,
            });
        }
        sort(&mut items);
        return Ok(items);
    }
    let resolved = resolve(config, input)?;
    for entry in fs::read_dir(&resolved.full).map_err(AppError::io)? {
        let Ok(entry) = entry else { continue };
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if (meta.is_dir() && excluded_dir(&name)) || (!meta.is_dir() && excluded_file(&name)) {
            continue;
        }
        let rel = if resolved.relative.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", resolved.relative, name)
        };
        let path = if roots.len() > 1 {
            format!("{}/{}", resolved.root.name, rel)
        } else {
            rel
        };
        let ext = extension(Path::new(&name));
        let version = meta
            .modified()
            .ok()
            .and_then(|x| x.duration_since(UNIX_EPOCH).ok())
            .map(|x| x.as_secs_f64() * 1000.0);
        let created_date = meta
            .created()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs_f64() * 1000.0);
        items.push(FileItem {
            name,
            path,
            media_type: if meta.is_dir() {
                "folder".into()
            } else {
                media_type(&ext).into()
            },
            size: if meta.is_dir() { 0 } else { meta.len() },
            created_date,
            extension: ext,
            is_directory: meta.is_dir(),
            is_virtual: None,
            view_count: None,
            thumbnail_generated: if meta.is_file()
                && ["image", "video"].contains(&media_type(
                    Path::new(&entry.path())
                        .extension()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .as_ref(),
                )) {
                Some(false)
            } else {
                None
            },
            version,
        });
    }
    sort(&mut items);
    Ok(items)
}
fn sort(v: &mut [FileItem]) {
    v.sort_by(|a, b| {
        b.is_virtual
            .unwrap_or(false)
            .cmp(&a.is_virtual.unwrap_or(false))
            .then_with(|| b.is_directory.cmp(&a.is_directory))
            .then_with(|| natord::compare_ignore_case(&a.name, &b.name))
    })
}
