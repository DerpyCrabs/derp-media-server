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
    pub extension: String,
    pub is_directory: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_virtual: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub share_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_generated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource: Option<crate::resources::ResourceSummary>,
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

pub fn resolve(
    config: &Config,
    runtime_roots: &[MediaRoot],
    input: &str,
) -> AppResult<ResolvedPath> {
    let logical = clean_logical(input)?;
    let mut roots = config.roots.clone();
    roots.extend_from_slice(runtime_roots);
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
pub fn editable(config: &Config, runtime: &[MediaRoot], input: &str) -> bool {
    resolve(config, runtime, input)
        .map(|r| {
            !r.root.read_only
                && r.root.editable_folders.iter().any(|f| {
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
        extension: String::new(),
        is_directory: true,
        is_virtual: Some(true),
        view_count: None,
        share_token: None,
        thumbnail_generated: None,
        version: None,
        resource: None,
    }
}

pub(crate) struct ObservedFileItem {
    pub(crate) item: FileItem,
    pub(crate) full_path: Option<PathBuf>,
    pub(crate) metadata: Option<std::fs::Metadata>,
}

pub(crate) fn list_observed(
    config: &Config,
    runtime: &[MediaRoot],
    input: &str,
) -> AppResult<Vec<ObservedFileItem>> {
    let logical = clean_logical(input)?;
    let mut items = if logical.is_empty() {
        vec![
            ObservedFileItem {
                item: virtual_item("Favorites"),
                full_path: None,
                metadata: None,
            },
            ObservedFileItem {
                item: virtual_item("Most Played"),
                full_path: None,
                metadata: None,
            },
            ObservedFileItem {
                item: virtual_item("Shares"),
                full_path: None,
                metadata: None,
            },
        ]
    } else {
        vec![]
    };
    let mut roots = config.roots.clone();
    roots.extend_from_slice(runtime);
    if roots.len() > 1 && logical.is_empty() {
        for r in roots {
            items.push(ObservedFileItem {
                item: FileItem {
                    name: r.name.clone(),
                    path: r.name,
                    media_type: "folder".into(),
                    size: 0,
                    extension: String::new(),
                    is_directory: true,
                    is_virtual: None,
                    view_count: None,
                    share_token: None,
                    thumbnail_generated: None,
                    version: None,
                    resource: None,
                },
                full_path: None,
                metadata: None,
            });
        }
        sort_observed(&mut items);
        return Ok(items);
    }
    let resolved = resolve(config, runtime, input)?;
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
        items.push(ObservedFileItem {
            item: FileItem {
                name,
                path,
                media_type: if meta.is_dir() {
                    "folder".into()
                } else {
                    media_type(&ext).into()
                },
                size: if meta.is_dir() { 0 } else { meta.len() },
                extension: ext,
                is_directory: meta.is_dir(),
                is_virtual: None,
                view_count: None,
                share_token: None,
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
                resource: None,
            },
            full_path: Some(entry.path()),
            metadata: Some(meta),
        });
    }
    sort_observed(&mut items);
    Ok(items)
}

pub fn list(config: &Config, runtime: &[MediaRoot], input: &str) -> AppResult<Vec<FileItem>> {
    Ok(list_observed(config, runtime, input)?
        .into_iter()
        .map(|observed| observed.item)
        .collect())
}

fn sort_observed(v: &mut [ObservedFileItem]) {
    v.sort_by(|a, b| compare_items(&a.item, &b.item));
}

fn compare_items(a: &FileItem, b: &FileItem) -> std::cmp::Ordering {
    b.is_virtual
        .unwrap_or(false)
        .cmp(&a.is_virtual.unwrap_or(false))
        .then_with(|| b.is_directory.cmp(&a.is_directory))
        .then_with(|| natord::compare_ignore_case(&a.name, &b.name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig, MediaRoot};
    use serde_json::json;

    fn root(id: &str, name: &str, path: PathBuf) -> MediaRoot {
        MediaRoot {
            id: id.into(),
            name: name.into(),
            path,
            editable_folders: Vec::new(),
            read_only: false,
            source: "config".into(),
            created_at: None,
        }
    }

    fn config(base: &Path, roots: Vec<MediaRoot>) -> Config {
        Config {
            port: 3000,
            roots,
            library_key: "legacy-library-key".into(),
            share_link_domain: None,
            auth: AuthConfig::default(),
            data_path: base.join("data"),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: base.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            tls: None,
            hermes: None,
        }
    }

    fn fixture(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("derp-media-{name}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn file_item_legacy_json_shape_is_stable() {
        let value = serde_json::to_value(FileItem {
            name: "clip.mp4".into(),
            path: "Videos/clip.mp4".into(),
            media_type: "video".into(),
            size: 42,
            extension: "mp4".into(),
            is_directory: false,
            is_virtual: None,
            view_count: Some(7),
            share_token: None,
            thumbnail_generated: Some(false),
            version: Some(1234.0),
            resource: None,
        })
        .unwrap();

        assert_eq!(
            value,
            json!({
                "name":"clip.mp4",
                "path":"Videos/clip.mp4",
                "type":"video",
                "size":42,
                "extension":"mp4",
                "isDirectory":false,
                "viewCount":7,
                "thumbnailGenerated":false,
                "version":1234.0
            })
        );
    }

    #[test]
    fn legacy_listing_keeps_virtual_roots_prefixes_exclusions_and_versions() {
        let base = fixture("listing");
        let alpha = base.join("alpha");
        let beta = base.join("beta");
        fs::create_dir_all(alpha.join("Folder")).unwrap();
        fs::create_dir_all(alpha.join("node_modules")).unwrap();
        fs::create_dir_all(&beta).unwrap();
        fs::write(alpha.join("z.txt"), "z").unwrap();
        fs::write(alpha.join("Unicode-日本語.md"), "unicode").unwrap();
        fs::write(alpha.join(".hidden.txt"), "hidden").unwrap();
        fs::write(alpha.join("node_modules").join("hidden.js"), "hidden").unwrap();
        let config = config(
            &base,
            vec![
                root("legacy-alpha", "Alpha", alpha.clone()),
                root("legacy-beta", "Beta", beta),
            ],
        );

        let top = list(&config, &[], "").unwrap();
        assert_eq!(
            top.iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["Favorites", "Most Played", "Shares", "Alpha", "Beta"]
        );
        let files = list(&config, &[], "Alpha").unwrap();
        assert_eq!(
            files
                .iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["Folder", ".hidden.txt", "Unicode-日本語.md", "z.txt"]
        );
        assert_eq!(files[0].path, "Alpha/Folder");
        assert!(files[1..].iter().all(|item| item.version.is_some()));
        assert!(files.iter().all(|item| !item.path.contains("node_modules")));
        assert!(files.iter().any(|item| item.name == ".hidden.txt"));

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn legacy_single_root_paths_remain_unprefixed() {
        let base = fixture("single-root");
        let media = base.join("media");
        fs::create_dir_all(&media).unwrap();
        fs::write(media.join("clip.mp4"), "bytes").unwrap();
        let config = config(&base, vec![root("legacy-primary", "Media", media)]);

        let files = list(&config, &[], "").unwrap();
        let clip = files.iter().find(|item| item.name == "clip.mp4").unwrap();
        assert_eq!(clip.path, "clip.mp4");
        assert_eq!(clip.media_type, "video");

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn legacy_resolution_rejects_traversal_and_missing_directories() {
        let base = fixture("errors");
        let media = base.join("media");
        fs::create_dir_all(&media).unwrap();
        let config = config(&base, vec![root("legacy-primary", "Media", media)]);

        let traversal = resolve(&config, &[], "../outside").unwrap_err();
        assert!(traversal.1.contains("Path traversal detected"));
        let missing = list(&config, &[], "missing").unwrap_err();
        assert_eq!(missing.0, axum::http::StatusCode::NOT_FOUND);

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn resolution_rejects_symlink_escape_when_platform_can_create_link() {
        let base = fixture("symlink-escape");
        let media = base.join("media");
        let outside = base.join("outside");
        fs::create_dir_all(&media).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        let link = media.join("escape");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(&outside, &link).is_err() {
            fs::remove_dir_all(base).unwrap();
            return;
        }
        let config = config(&base, vec![root("legacy-primary", "Media", media)]);

        let error = resolve(&config, &[], "escape/secret.txt").unwrap_err();
        assert_eq!(error.0, axum::http::StatusCode::BAD_REQUEST);
        assert!(error.1.contains("Symbolic link escapes media root"));

        fs::remove_dir_all(base).unwrap();
    }
}
