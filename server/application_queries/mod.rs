use crate::{
    app::{AppState, knowledge_base_root, list_directory, roots, settings_path, stats_path},
    error::{AppError, AppResult},
    media,
    resources::{
        CatalogError, CatalogErrorCode, CatalogResult, PageCursor, ReadContext, ReadSurface,
        ResourceDetail, ResourcePage, ResourceRef, summary_to_legacy_file,
    },
    shares, store, virtual_directory, workspace_persistence,
};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::path::Path;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileListing {
    pub(crate) files: Vec<media::FileItem>,
    pub(crate) virtual_entries: Map<String, Value>,
    pub(crate) virtual_directory: Option<Value>,
}

pub(crate) fn catalog_reads_enabled() -> bool {
    catalog_reads_enabled_value(std::env::var("CATALOG_READS").ok().as_deref())
}

fn catalog_reads_enabled_value(value: Option<&str>) -> bool {
    !matches!(
        value.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
        Some("0" | "false" | "off" | "no")
    )
}

pub(crate) fn read_surface(value: Option<&str>) -> ReadSurface {
    match value {
        Some("workspace") => ReadSurface::Workspace,
        Some("canvas") => ReadSurface::Canvas,
        Some("share") => ReadSurface::Share,
        Some("ssr") => ReadSurface::Ssr,
        _ => ReadSurface::Library,
    }
}

pub(crate) async fn browse_owner(
    state: &AppState,
    dir: &str,
    surface: ReadSurface,
    offset: usize,
) -> AppResult<FileListing> {
    if catalog_reads_enabled() {
        catalog_owner(state, dir, surface, offset).await
    } else {
        legacy_owner(state, dir, surface, offset).await
    }
}

pub(crate) async fn browse_grant(
    state: &AppState,
    grant_root: &str,
    logical: &str,
) -> AppResult<FileListing> {
    shares::authorize_grant_logical_path(&state.config, &roots(state), grant_root, logical)?;
    if catalog_reads_enabled() {
        let adapter = state.resources.compatibility();
        let root = adapter
            .resolve_filesystem(grant_root, ReadSurface::Share)
            .await
            .map_err(|error| error.into_app_error())?;
        let context = ReadContext::grant(ReadSurface::Share, root.reference);
        let mut page = adapter
            .browse_compatibility(&context, logical, None, usize::MAX)
            .await
            .map_err(|error| error.into_app_error())?;
        while let Some(cursor) = page.next_cursor.clone() {
            let next = adapter
                .browse_compatibility(&context, logical, Some(cursor), usize::MAX)
                .await
                .map_err(|error| error.into_app_error())?;
            page.items.extend(next.items);
            page.next_cursor = next.next_cursor;
            page.total = next.total;
        }
        Ok(project(page))
    } else {
        let runtime = roots(state);
        Ok(FileListing {
            files: list_directory(state, logical)?
                .into_iter()
                .filter(|item| item.is_virtual != Some(true))
                .filter(|item| {
                    shares::authorize_grant_logical_path(
                        &state.config,
                        &runtime,
                        grant_root,
                        &item.path,
                    )
                    .is_ok()
                })
                .collect(),
            virtual_entries: Map::new(),
            virtual_directory: None,
        })
    }
}

pub(crate) async fn inspect_owner(
    state: &AppState,
    resource: &ResourceRef,
    surface: ReadSurface,
) -> CatalogResult<ResourceDetail> {
    if !catalog_reads_enabled() {
        return Err(CatalogError::new(
            CatalogErrorCode::Unsupported,
            "Resource inspection is disabled by catalog_reads rollback",
        ));
    }
    state
        .resources
        .inspect(&ReadContext::owner(surface), resource)
        .await
}

pub(crate) async fn inspect_grant(
    state: &AppState,
    grant_root: &str,
    grant_is_directory: bool,
    resource: &ResourceRef,
) -> CatalogResult<ResourceDetail> {
    if !catalog_reads_enabled() {
        return Err(CatalogError::new(
            CatalogErrorCode::Unsupported,
            "Resource inspection is disabled by catalog_reads rollback",
        ));
    }
    let adapter = state.resources.compatibility();
    let root = adapter
        .resolve_filesystem(grant_root, ReadSurface::Share)
        .await?;
    let context = if grant_is_directory {
        ReadContext::grant(ReadSurface::Share, root.reference)
    } else {
        ReadContext::grant_exact(ReadSurface::Share, root.reference)
    };
    state.resources.inspect(&context, resource).await
}

pub(crate) async fn resolve_owner(
    state: &AppState,
    legacy_locator: &str,
    surface: ReadSurface,
) -> CatalogResult<ResourceDetail> {
    if !catalog_reads_enabled() {
        return Err(CatalogError::new(
            CatalogErrorCode::Unsupported,
            "Resource legacy resolution is disabled by catalog_reads rollback",
        ));
    }
    state
        .resources
        .compatibility()
        .resolve_persisted(&ReadContext::owner(surface), legacy_locator)
        .await
}

pub(crate) async fn resolve_grant(
    state: &AppState,
    grant_root: &str,
    grant_is_directory: bool,
    legacy_locator: &str,
) -> CatalogResult<ResourceDetail> {
    if !catalog_reads_enabled() {
        return Err(CatalogError::new(
            CatalogErrorCode::Unsupported,
            "Resource legacy resolution is disabled by catalog_reads rollback",
        ));
    }
    let adapter = state.resources.compatibility();
    let root = adapter
        .resolve_filesystem(grant_root, ReadSurface::Share)
        .await?;
    let context = if grant_is_directory {
        ReadContext::grant(ReadSurface::Share, root.reference)
    } else {
        ReadContext::grant_exact(ReadSurface::Share, root.reference)
    };
    adapter.resolve_persisted(&context, legacy_locator).await
}

pub(crate) async fn share_info(
    state: &AppState,
    share: &shares::Share,
    token: &str,
    authorized: bool,
) -> Value {
    let extension = if share.is_directory {
        String::new()
    } else {
        media::extension(Path::new(&share.path))
    };
    let mut result = json!({
        "name":shares::name(&share.path),
        "isDirectory":share.is_directory,
        "editable":share.editable,
        "mediaType":if share.is_directory{"folder"}else{media::media_type(&extension)},
        "extension":extension,
        "needsPasscode":share.passcode.is_some(),
        "authorized":authorized
    });
    if authorized {
        result["path"] = json!(share.path);
        let kb_root = knowledge_base_root(state, &share.path);
        result["isKnowledgeBase"] = json!(share.is_directory && kb_root.is_some());
        if let Some(root) = kb_root {
            result["knowledgeBaseRoot"] = json!(root);
        }
        if share.is_directory {
            let settings = store::section(
                &settings_path(state),
                &state.config.library_key,
                crate::app::default_settings(),
            );
            result["adminViewMode"] = settings["viewModes"]
                .get(&share.path)
                .cloned()
                .unwrap_or_else(|| json!("list"));
            result["workspaceTaskbarPins"] = workspace_persistence::share_pins(
                share
                    .workspace_taskbar_pins
                    .as_ref()
                    .unwrap_or(&Value::Null),
                &share.path,
                token,
            );
            result["workspaceLayoutPresets"] = workspace_persistence::presets(
                share
                    .workspace_layout_presets
                    .as_ref()
                    .unwrap_or(&Value::Null),
                Some((&share.path, token)),
            );
        }
        if catalog_reads_enabled() {
            let adapter = state.resources.compatibility();
            if let Ok(root) = adapter
                .resolve_filesystem(&share.path, ReadSurface::Share)
                .await
            {
                let context = if share.is_directory {
                    ReadContext::grant(ReadSurface::Share, root.reference)
                } else {
                    ReadContext::grant_exact(ReadSurface::Share, root.reference)
                };
                if let Ok(detail) = adapter.inspect(&context, &share.path).await {
                    result["resource"] =
                        serde_json::to_value(detail.summary).unwrap_or(Value::Null);
                }
            }
        }
    }
    if share.editable {
        result["restrictions"] = serde_json::to_value(shares::effective(share)).unwrap();
        result["usedBytes"] = json!(share.used_bytes.unwrap_or(0));
    }
    result
}

async fn catalog_owner(
    state: &AppState,
    dir: &str,
    surface: ReadSurface,
    offset: usize,
) -> AppResult<FileListing> {
    let context = ReadContext::owner(surface);
    let adapter = state.resources.compatibility();
    let hermes = dir == virtual_directory::HERMES_ROOT
        || dir.starts_with(&format!("{}/", virtual_directory::HERMES_ROOT));
    let first_cursor = (hermes && offset > 0).then(|| PageCursor::new(format!("offset:{offset}")));
    let mut page = adapter
        .browse_compatibility(&context, dir, first_cursor, usize::MAX)
        .await
        .map_err(|error| error.into_app_error())?;
    if !hermes {
        while let Some(cursor) = page.next_cursor.clone() {
            let next = adapter
                .browse_compatibility(&context, dir, Some(cursor), usize::MAX)
                .await
                .map_err(|error| error.into_app_error())?;
            page.items.extend(next.items);
            page.next_cursor = next.next_cursor;
            page.total = next.total;
            page.legacy
                .virtual_entries
                .extend(next.legacy.virtual_entries);
            if next.legacy.virtual_directory.is_some() {
                page.legacy.virtual_directory = next.legacy.virtual_directory;
            }
        }
    }
    Ok(project(page))
}

fn project(page: ResourcePage) -> FileListing {
    let mut entries = page.legacy.virtual_entries;
    for item in &page.items {
        if item.locator.source_id.as_str() == "source-hermes"
            && item.locator.provider_locator.is_empty()
        {
            entries
                .entry(item.legacy_locator.clone().unwrap_or_default())
                .or_insert_with(|| {
                    json!({"provider":"hermes","kind":"root","capabilities":["open"],
                    "appearance":{"icon":"agent-directory","tone":"violet"}})
                });
        }
    }
    FileListing {
        files: page.items.into_iter().map(summary_to_legacy_file).collect(),
        virtual_entries: entries,
        virtual_directory: page.legacy.virtual_directory,
    }
}

async fn legacy_owner(
    state: &AppState,
    dir: &str,
    surface: ReadSurface,
    offset: usize,
) -> AppResult<FileListing> {
    if dir == virtual_directory::HERMES_ROOT
        || dir.starts_with(&format!("{}/", virtual_directory::HERMES_ROOT))
    {
        if surface != ReadSurface::Workspace {
            return Err(AppError::not_found("Directory not found"));
        }
        let listing = virtual_directory::list_hermes(state, dir, offset).await?;
        return Ok(FileListing {
            files: listing.files,
            virtual_entries: listing.virtual_entries,
            virtual_directory: listing.virtual_directory,
        });
    }
    let mut files = legacy_list_items(state, dir)?;
    let mut entries = Map::new();
    if dir.is_empty() && surface == ReadSurface::Workspace && state.hermes.is_some() {
        let path = virtual_directory::HERMES_ROOT.to_string();
        files.push(media::FileItem {
            name: path.clone(),
            path: path.clone(),
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
        });
        entries.insert(
            path,
            json!({"provider":"hermes","kind":"root","capabilities":["open"],
                "appearance":{"icon":"agent-directory","tone":"violet"}}),
        );
    }
    let directory = virtual_directory::is_builtin_path(dir).then(|| {
        json!({"provider":"builtin","kind":"collection","path":dir,"capabilities":[],
            "offset":0,"pageSize":files.len(),"total":files.len()})
    });
    Ok(FileListing {
        files,
        virtual_entries: entries,
        virtual_directory: directory,
    })
}

pub(crate) fn legacy_list_items(state: &AppState, dir: &str) -> AppResult<Vec<media::FileItem>> {
    if let Some(result) = legacy_virtual_items(state, dir) {
        return result;
    }
    list_directory(state, dir)
}

pub(crate) fn legacy_virtual_items(
    state: &AppState,
    dir: &str,
) -> Option<AppResult<Vec<media::FileItem>>> {
    if dir == "Shares" {
        let runtime = roots(state);
        let mut items = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut all = match shares::read(&state.config, &runtime) {
            Ok(all) => all,
            Err(error) => return Some(Err(error)),
        };
        all.sort_by_key(|item| std::cmp::Reverse(item.created_at));
        for share in all {
            if !seen.insert(share.path.replace('\\', "/")) {
                continue;
            }
            let Ok(resolved) = media::resolve(&state.config, &runtime, &share.path) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(&resolved.full) else {
                continue;
            };
            let name = shares::name(&share.path);
            let extension = Path::new(&name)
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            items.push(media::FileItem {
                name,
                path: share.path,
                media_type: if metadata.is_dir() {
                    "folder".into()
                } else {
                    media::media_type(&extension).into()
                },
                size: if metadata.is_dir() { 0 } else { metadata.len() },
                extension,
                is_directory: share.is_directory,
                is_virtual: None,
                view_count: None,
                share_token: Some(share.token),
                thumbnail_generated: None,
                version: None,
                resource: None,
            });
        }
        return Some(Ok(items));
    }
    if dir == "Favorites" || dir == "Most Played" {
        let section = if dir == "Favorites" {
            store::section(
                &settings_path(state),
                &state.config.library_key,
                crate::app::default_settings(),
            )
        } else {
            store::section(
                &stats_path(state),
                &state.config.library_key,
                json!({"views":{}}),
            )
        };
        let paths: Vec<(String, Option<u64>)> = if dir == "Favorites" {
            section["favorites"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(|path| (path.into(), None)))
                .collect()
        } else {
            let mut values = section["views"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(path, value)| (path.clone(), value.as_u64()))
                .collect::<Vec<_>>();
            values.sort_by_key(|item| std::cmp::Reverse(item.1));
            values.truncate(50);
            values
        };
        let runtime = roots(state);
        let mut items = Vec::new();
        for (path, view_count) in paths {
            let Ok(resolved) = media::resolve(&state.config, &runtime, &path) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(&resolved.full) else {
                continue;
            };
            if dir == "Most Played" && metadata.is_dir() {
                continue;
            }
            let name = shares::name(&path);
            let extension = Path::new(&name)
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            let thumbnail_generated = if !metadata.is_dir()
                && matches!(media::media_type(&extension), "image" | "video")
            {
                metadata
                    .modified()
                    .ok()
                    .map(|modified| state.thumbnails.cached(&resolved.full, modified))
            } else {
                None
            };
            items.push(media::FileItem {
                name,
                path,
                media_type: if metadata.is_dir() {
                    "folder".into()
                } else {
                    media::media_type(&extension).into()
                },
                size: if metadata.is_dir() { 0 } else { metadata.len() },
                extension,
                is_directory: metadata.is_dir(),
                is_virtual: None,
                view_count,
                share_token: None,
                thumbnail_generated,
                version: None,
                resource: None,
            });
        }
        return Some(Ok(items));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_reads_defaults_on_and_has_explicit_rollback_values() {
        assert!(catalog_reads_enabled_value(None));
        assert!(catalog_reads_enabled_value(Some("1")));
        assert!(catalog_reads_enabled_value(Some("true")));
        for value in ["0", "false", "FALSE", "off", "no"] {
            assert!(!catalog_reads_enabled_value(Some(value)), "{value}");
        }
    }
}
