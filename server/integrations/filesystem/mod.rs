use super::{
    contracts::{
        BrowseRequest, INTEGRATION_SCHEMA_VERSION, IntegrationActionOutcomeDto,
        IntegrationActionRequestDto, IntegrationCapabilityDto, IntegrationDescriptorDto,
        IntegrationSearchRequest, IntegrationSearchResultDto, ResourceAppearanceDto,
        ResourceKeyDto, ResourcePageDto, ResourceSummaryDto,
    },
    registry::{
        ActionCapability, BrowseCapability, ChangeCapability, InspectCapability, IntegrationModule,
        SearchCapability, SearchContribution,
    },
};
use crate::{
    app::AppState,
    config::Config,
    error::{AppError, AppResult},
    file_commands::CreateContent,
    file_search::FileSearch,
    media, store,
};
use futures_util::future::BoxFuture;
use serde_json::{Map, Value, json};
use std::{collections::HashMap, path::Path, sync::Arc};

pub(crate) mod persisted_content;
mod routes;

pub(crate) const PROVIDER_ID: &str = "filesystem";
const DEFAULT_ROOT_ID: &str = "configured-default";
const COLLECTION_ROOT_ID: &str = "application-collections";
const KEY_PREFIX: &str = "v1:";

fn file_presentation(media_type: &str) -> &'static str {
    match media_type {
        "video" => "video",
        "audio" => "audio",
        "image" => "image",
        "text" => "text",
        "pdf" => "pdf",
        "book" => "book",
        _ => "unsupported",
    }
}

fn file_icon(media_type: &str) -> &'static str {
    match media_type {
        "video" => "video",
        "audio" => "music",
        "image" => "image",
        "text" => "file-text",
        "pdf" | "book" => "book-open",
        _ => "file",
    }
}

pub(crate) struct FilesystemIntegration {
    config: Config,
    pub(crate) search: Arc<FileSearch>,
}

impl FilesystemIntegration {
    fn new(config: Config, search: Arc<FileSearch>) -> Arc<Self> {
        Arc::new(Self { config, search })
    }

    fn root_summary(&self) -> ResourceSummaryDto {
        ResourceSummaryDto {
            key: encode_key(DEFAULT_ROOT_ID, ""),
            name: "Library".into(),
            kind: "root".into(),
            mime: None,
            capabilities: vec!["browse".into(), "search".into()],
            presentation: Some("browse".into()),
            appearance: Some(ResourceAppearanceDto {
                icon: Some("folder".into()),
                tone: Some("muted".into()),
                color: None,
            }),
            size: None,
            metadata: Some(HashMap::from([(
                "logicalPath".into(),
                Value::String(String::new()),
            )])),
        }
    }

    fn root_summary_for(&self, root_id: &str) -> AppResult<ResourceSummaryDto> {
        if root_id == DEFAULT_ROOT_ID {
            return Ok(self.root_summary());
        }
        let root = self
            .config
            .roots
            .iter()
            .find(|root| root.id == root_id)
            .ok_or_else(|| AppError::not_found("Filesystem root not found"))?;
        let mut summary = self.root_summary();
        summary.key = encode_key(root_id, "");
        summary.name = root.name.clone();
        Ok(summary)
    }

    fn breadcrumbs(&self, root_id: &str, address_path: &str) -> AppResult<Vec<ResourceSummaryDto>> {
        let mut breadcrumbs = vec![self.root_summary_for(root_id)?];
        let mut address = String::new();
        for segment in address_path
            .split('/')
            .filter(|segment| !segment.is_empty())
        {
            address = child_path(&address, segment)?;
            let logical = self.logical_path(root_id, &address)?;
            breadcrumbs.push(self.summary(
                root_id,
                &logical,
                media::FileItem {
                    name: segment.into(),
                    path: logical.clone(),
                    media_type: "folder".into(),
                    size: 0,
                    extension: String::new(),
                    is_directory: true,
                    view_count: None,
                    thumbnail_generated: None,
                    version: None,
                },
            ));
        }
        Ok(breadcrumbs)
    }

    fn logical_path(&self, root_id: &str, path: &str) -> AppResult<String> {
        let path = normalize_path(path)?;
        if root_id == DEFAULT_ROOT_ID || self.config.roots.len() == 1 {
            return Ok(path);
        }
        let root = self
            .config
            .roots
            .iter()
            .find(|root| root.id == root_id)
            .ok_or_else(|| AppError::not_found("Filesystem root not found"))?;
        Ok(if path.is_empty() {
            root.name.clone()
        } else {
            format!("{}/{path}", root.name)
        })
    }

    fn collection_summary(&self, slug: &str) -> AppResult<ResourceSummaryDto> {
        let (name, icon) = match slug {
            "favorites" => ("Favorites", "star"),
            "most-played" => ("Most Played", "play"),
            _ => return Err(AppError::not_found("Application collection not found")),
        };
        Ok(ResourceSummaryDto {
            key: encode_key(COLLECTION_ROOT_ID, slug),
            name: name.into(),
            kind: "collection".into(),
            mime: None,
            capabilities: vec!["browse".into()],
            presentation: Some("browse".into()),
            appearance: Some(ResourceAppearanceDto {
                icon: Some(icon.into()),
                tone: Some("muted".into()),
                color: None,
            }),
            size: None,
            metadata: None,
        })
    }

    fn collection_items(&self, slug: &str) -> AppResult<Vec<ResourceSummaryDto>> {
        let section = match slug {
            "favorites" => store::read(
                &self.config,
                store::StateDocument::SettingsV1,
                crate::app::default_settings(),
            ),
            "most-played" => store::read(
                &self.config,
                store::StateDocument::PlaybackStatsV1,
                serde_json::json!({"views":{}}),
            ),
            _ => return Err(AppError::not_found("Application collection not found")),
        }?;
        let paths: Vec<(String, Option<u64>)> = if slug == "favorites" {
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
        let mut items = Vec::new();
        for (path, view_count) in paths {
            let Ok(resolved) = media::resolve(&self.config, &path) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(&resolved.full) else {
                continue;
            };
            if slug == "most-played" && metadata.is_dir() {
                continue;
            }
            let name = media::name(&path);
            let extension = Path::new(&name)
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            let item = media::FileItem {
                name,
                path: path.clone(),
                media_type: if metadata.is_dir() {
                    "folder".into()
                } else {
                    media::media_type(&extension).into()
                },
                size: if metadata.is_dir() { 0 } else { metadata.len() },
                extension,
                is_directory: metadata.is_dir(),
                view_count,
                thumbnail_generated: None,
                version: None,
            };
            items.push(self.summary(DEFAULT_ROOT_ID, &path, item));
        }
        Ok(items)
    }

    fn knowledge_base_root(&self, logical_path: &str) -> AppResult<Option<String>> {
        let settings = store::read(
            &self.config,
            store::StateDocument::SettingsV1,
            crate::app::default_settings(),
        )?;
        for value in settings["knowledgeBases"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let Ok(root) = normalize_path(&value.replace('\\', "/")) else {
                continue;
            };
            if !root.is_empty()
                && (logical_path == root
                    || logical_path
                        .strip_prefix(&root)
                        .is_some_and(|suffix| suffix.starts_with('/')))
            {
                return Ok(Some(root));
            }
        }
        Ok(None)
    }

    fn knowledge_base_recent_items(
        &self,
        root_id: &str,
        knowledge_base_root: &str,
    ) -> AppResult<Vec<ResourceSummaryDto>> {
        let resolved = media::resolve(&self.config, knowledge_base_root)?;
        let mut recent = Vec::new();
        for entry in walkdir::WalkDir::new(&resolved.full)
            .into_iter()
            .filter_entry(visible_search_entry)
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file()
                || entry
                    .path()
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    != "md"
            {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            let modified = metadata.modified().unwrap_or(std::time::UNIX_EPOCH);
            let modified_millis = modified
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let relative = entry
                .path()
                .strip_prefix(&resolved.root.path)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            let logical_path = if self.config.roots.len() > 1 {
                format!("{}/{relative}", resolved.root.name)
            } else {
                relative
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let mut resource = self.summary(
                root_id,
                &logical_path,
                media::FileItem {
                    name,
                    path: logical_path.clone(),
                    media_type: "text".into(),
                    size: metadata.len(),
                    extension: "md".into(),
                    is_directory: false,
                    view_count: None,
                    thumbnail_generated: None,
                    version: None,
                },
            );
            resource.metadata.get_or_insert_with(HashMap::new).insert(
                "modifiedAt".into(),
                Value::String(chrono::DateTime::<chrono::Utc>::from(modified).to_rfc3339()),
            );
            recent.push((modified_millis, resource));
        }
        recent.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
        recent.truncate(10);
        Ok(recent.into_iter().map(|(_, item)| item).collect())
    }

    fn summary(
        &self,
        root_id: &str,
        logical_path: &str,
        item: media::FileItem,
    ) -> ResourceSummaryDto {
        let address_path = if root_id == DEFAULT_ROOT_ID || self.config.roots.len() == 1 {
            logical_path.to_string()
        } else {
            self.config
                .roots
                .iter()
                .find(|root| root.id == root_id)
                .and_then(|root| {
                    logical_path
                        .strip_prefix(&format!("{}/", root.name))
                        .or_else(|| (logical_path == root.name).then_some(""))
                })
                .unwrap_or(logical_path)
                .to_string()
        };
        let is_directory = item.is_directory;
        let presentation = file_presentation(&item.media_type);
        let icon = file_icon(&item.media_type);
        let mut metadata = HashMap::new();
        metadata.insert("logicalPath".into(), Value::String(item.path.clone()));
        metadata.insert("extension".into(), Value::String(item.extension.clone()));
        metadata.insert("isDirectory".into(), Value::Bool(is_directory));
        if let Some(version) = item.version.and_then(serde_json::Number::from_f64) {
            metadata.insert("version".into(), Value::Number(version));
        }
        ResourceSummaryDto {
            key: encode_key(root_id, &address_path),
            name: item.name,
            kind: if is_directory { "folder" } else { "file" }.into(),
            mime: (!is_directory).then(|| media::mime_type(&item.extension).to_string()),
            capabilities: {
                let mut capabilities = if is_directory {
                    vec!["browse".into(), "filesystem.copy".into(), "download".into()]
                } else {
                    vec!["read".into(), "filesystem.copy".into(), "download".into()]
                };
                if media::editable(&self.config, logical_path) {
                    if is_directory {
                        capabilities.extend([
                            "filesystem.create".into(),
                            "filesystem.upload".into(),
                            "filesystem.paste".into(),
                        ]);
                    } else {
                        capabilities.push("filesystem.edit".into());
                    }
                    capabilities.extend([
                        "filesystem.rename".into(),
                        "filesystem.move".into(),
                        "filesystem.delete".into(),
                    ]);
                }
                capabilities
            },
            presentation: Some(if is_directory { "browse" } else { presentation }.into()),
            appearance: Some(ResourceAppearanceDto {
                icon: Some(if is_directory { "folder" } else { icon }.into()),
                tone: Some("muted".into()),
                color: None,
            }),
            size: Some(item.size),
            metadata: Some(metadata),
        }
    }
}

impl BrowseCapability for FilesystemIntegration {
    fn browse<'a>(&'a self, request: BrowseRequest) -> BoxFuture<'a, AppResult<ResourcePageDto>> {
        Box::pin(async move {
            let (root_id, address_path) = decode_key(&request.key)?;
            if root_id == COLLECTION_ROOT_ID {
                let offset = parse_cursor(request.cursor.as_deref())?;
                let summary = self.collection_summary(&address_path)?;
                let items = self.collection_items(&address_path)?;
                let total = items.len();
                let limit = request.limit.clamp(1, 500);
                return Ok(ResourcePageDto {
                    schema_version: INTEGRATION_SCHEMA_VERSION,
                    location: request.key,
                    location_summary: Some(summary.clone()),
                    breadcrumbs: vec![self.root_summary(), summary],
                    items: items.into_iter().skip(offset).take(limit).collect(),
                    recent_items: Vec::new(),
                    next_cursor: (offset + limit < total).then(|| (offset + limit).to_string()),
                    total,
                });
            }
            let logical = self.logical_path(&root_id, &address_path)?;
            let recent_items = self
                .knowledge_base_root(&logical)
                .ok()
                .flatten()
                .and_then(|root| self.knowledge_base_recent_items(&root_id, &root).ok())
                .unwrap_or_default();
            let offset = parse_cursor(request.cursor.as_deref())?;
            let mut summaries = media::list(&self.config, &logical)?
                .into_iter()
                .map(|item| {
                    let path = item.path.clone();
                    self.summary(&root_id, &path, item)
                })
                .collect::<Vec<_>>();
            if address_path.is_empty() {
                summaries.insert(0, self.collection_summary("most-played")?);
                summaries.insert(0, self.collection_summary("favorites")?);
            }
            let total = summaries.len();
            let limit = request.limit.clamp(1, 500);
            let summaries = summaries.into_iter().skip(offset).take(limit).collect();
            let location_summary = if address_path.is_empty() {
                Some(self.root_summary_for(&root_id)?)
            } else {
                self.inspect(request.key.clone()).await.ok()
            };
            Ok(ResourcePageDto {
                schema_version: INTEGRATION_SCHEMA_VERSION,
                location: request.key,
                location_summary,
                breadcrumbs: self.breadcrumbs(&root_id, &address_path)?,
                items: summaries,
                recent_items,
                next_cursor: (offset + limit < total).then(|| (offset + limit).to_string()),
                total,
            })
        })
    }
}

impl InspectCapability for FilesystemIntegration {
    fn inspect<'a>(&'a self, key: ResourceKeyDto) -> BoxFuture<'a, AppResult<ResourceSummaryDto>> {
        Box::pin(async move {
            let (root_id, address_path) = decode_key(&key)?;
            if root_id == COLLECTION_ROOT_ID {
                return self.collection_summary(&address_path);
            }
            if address_path.is_empty() {
                return Ok(self.root_summary());
            }
            let logical = self.logical_path(&root_id, &address_path)?;
            let parent = Path::new(&logical)
                .parent()
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let item = media::list(&self.config, &parent)?
                .into_iter()
                .find(|item| item.path == logical)
                .ok_or_else(|| AppError::not_found("Filesystem resource not found"))?;
            Ok(self.summary(&root_id, &logical, item))
        })
    }
}

impl ActionCapability for FilesystemIntegration {
    fn perform<'a>(
        &'a self,
        request: IntegrationActionRequestDto,
        state: &'a AppState,
    ) -> BoxFuture<'a, AppResult<IntegrationActionOutcomeDto>> {
        Box::pin(async move {
            let (root_id, address_path) = decode_key(&request.key)?;
            if root_id == COLLECTION_ROOT_ID {
                return Err(AppError::bad("Application collections are read-only"));
            }
            let logical = self.logical_path(&root_id, &address_path)?;
            let metadata = request
                .metadata
                .as_ref()
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let input_name = request
                .name
                .as_deref()
                .or_else(|| metadata.get("name").and_then(Value::as_str));

            match request.action.as_str() {
                "filesystem.createFile" | "filesystem.createFolder" => {
                    let name = input_name
                        .ok_or_else(|| AppError::bad("File or folder name is required"))?;
                    let target_address = child_path(&address_path, name)?;
                    let target_logical = self.logical_path(&root_id, &target_address)?;
                    let is_folder = request.action == "filesystem.createFolder"
                        || metadata.get("type").and_then(Value::as_str) == Some("folder");
                    if is_folder {
                        state
                            .file_commands
                            .create(&target_logical, CreateContent::Folder)
                            .await?;
                    } else {
                        let content = if let Some(base64) =
                            metadata.get("base64Content").and_then(Value::as_str)
                        {
                            crate::app::decode_node_base64(base64)
                        } else {
                            metadata
                                .get("content")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                                .as_bytes()
                                .to_vec()
                        };
                        state
                            .file_commands
                            .create(&target_logical, CreateContent::File(&content))
                            .await?;
                    }
                    crate::app::emit(state, &target_logical);
                    let key = encode_key(&root_id, &target_address);
                    let resource = self.inspect(key).await?;
                    Ok(action_outcome(
                        Some(resource),
                        json!({"message": if is_folder { "Folder created" } else { "File saved" }}),
                    ))
                }
                "filesystem.edit" => {
                    if address_path.is_empty() {
                        return Err(AppError::bad("Filesystem root cannot be edited"));
                    }
                    let content = match (
                        metadata.get("base64Content").and_then(Value::as_str),
                        metadata.get("content").and_then(Value::as_str),
                    ) {
                        (Some(value), _) if !value.is_empty() => {
                            crate::app::decode_node_base64(value)
                        }
                        (_, Some(value)) => value.as_bytes().to_vec(),
                        (Some(_), None) => Vec::new(),
                        (None, None) => return Err(AppError::bad("File content is required")),
                    };
                    state
                        .file_commands
                        .edit(
                            &logical,
                            &content,
                            metadata.get("expectedVersion").and_then(Value::as_f64),
                        )
                        .await?;
                    crate::app::emit(state, &logical);
                    let resource = self.inspect(request.key).await?;
                    Ok(action_outcome(
                        Some(resource),
                        json!({"message":"File saved"}),
                    ))
                }
                "filesystem.paste" => {
                    let name =
                        input_name.ok_or_else(|| AppError::bad("Pasted file name is required"))?;
                    let target_address = child_path(&address_path, name)?;
                    let target_logical = self.logical_path(&root_id, &target_address)?;
                    let content = match (
                        metadata.get("base64Content").and_then(Value::as_str),
                        metadata.get("content").and_then(Value::as_str),
                    ) {
                        (Some(value), _) if !value.is_empty() => {
                            crate::app::decode_node_base64(value)
                        }
                        (_, Some(value)) => value.as_bytes().to_vec(),
                        (Some(_), None) => Vec::new(),
                        (None, None) => return Err(AppError::bad("Pasted content is required")),
                    };
                    if metadata.get("mode").and_then(Value::as_str) == Some("replace") {
                        state
                            .file_commands
                            .edit(
                                &target_logical,
                                &content,
                                metadata.get("expectedVersion").and_then(Value::as_f64),
                            )
                            .await?;
                    } else {
                        state
                            .file_commands
                            .create(&target_logical, CreateContent::File(&content))
                            .await?;
                    }
                    crate::app::emit(state, &target_logical);
                    let resource = self.inspect(encode_key(&root_id, &target_address)).await?;
                    Ok(action_outcome(
                        Some(resource),
                        json!({"message":"File saved"}),
                    ))
                }
                "filesystem.rename" | "filesystem.move" => {
                    if address_path.is_empty() {
                        return Err(AppError::bad("Filesystem root cannot be moved"));
                    }
                    let target_address = if let Some(new_path) =
                        metadata.get("newPath").and_then(Value::as_str)
                    {
                        normalize_path(new_path)?
                    } else if request.action == "filesystem.move" {
                        let destination = metadata
                            .get("destinationDir")
                            .or_else(|| metadata.get("destination"))
                            .and_then(Value::as_str)
                            .ok_or_else(|| AppError::bad("Destination directory is required"))?;
                        let name = address_path
                            .rsplit('/')
                            .next()
                            .ok_or_else(|| AppError::bad("Filesystem resource has no name"))?;
                        child_path(destination, name)?
                    } else {
                        let name =
                            input_name.ok_or_else(|| AppError::bad("New name is required"))?;
                        let parent = address_path.rsplit_once('/').map_or("", |value| value.0);
                        child_path(parent, name)?
                    };
                    if target_address.is_empty() {
                        return Err(AppError::bad("Destination path is required"));
                    }
                    let target_logical = self.logical_path(&root_id, &target_address)?;
                    state
                        .file_commands
                        .move_path(&logical, &target_logical)
                        .await?;
                    crate::app::emit_path_moved(state, &logical, &target_logical);
                    crate::app::emit(state, &logical);
                    if crate::app::parent_logical(&logical)
                        != crate::app::parent_logical(&target_logical)
                    {
                        crate::app::emit(state, &target_logical);
                    }
                    let resource = self.inspect(encode_key(&root_id, &target_address)).await?;
                    Ok(action_outcome(
                        Some(resource),
                        json!({"message":"Renamed successfully"}),
                    ))
                }
                "filesystem.copy" => {
                    if address_path.is_empty() {
                        return Err(AppError::bad("Filesystem root cannot be copied"));
                    }
                    let destination_address = metadata
                        .get("destinationDir")
                        .or_else(|| metadata.get("destination"))
                        .and_then(Value::as_str)
                        .ok_or_else(|| AppError::bad("Destination directory is required"))?;
                    let destination_address = normalize_path(destination_address)?;
                    let destination_logical = self.logical_path(&root_id, &destination_address)?;
                    let copied = state
                        .file_commands
                        .copy_path(&logical, &destination_logical)
                        .await?;
                    crate::app::emit(state, &copied);
                    let name = address_path
                        .rsplit('/')
                        .next()
                        .ok_or_else(|| AppError::bad("Filesystem resource has no name"))?;
                    let copied_address = child_path(&destination_address, name)?;
                    let resource = self.inspect(encode_key(&root_id, &copied_address)).await?;
                    Ok(action_outcome(
                        Some(resource),
                        json!({"message":"Copied successfully"}),
                    ))
                }
                "filesystem.delete" => {
                    if address_path.is_empty() {
                        return Err(AppError::bad("Filesystem root cannot be deleted"));
                    }
                    let outcome = state.file_commands.delete(&logical).await?;
                    crate::app::emit_path_removed(state, &logical);
                    crate::app::emit(state, &logical);
                    Ok(action_outcome(
                        None,
                        json!({
                            "message": if outcome.is_directory { "Folder deleted" } else { "File deleted" }
                        }),
                    ))
                }
                "filesystem.download" => {
                    let name = address_path
                        .rsplit('/')
                        .find(|value| !value.is_empty())
                        .unwrap_or("Library");
                    Ok(action_outcome(
                        None,
                        json!({
                            "url": routes::download_url(&request.key),
                            "filename": name,
                        }),
                    ))
                }
                _ => Err(AppError::bad("Unsupported filesystem action")),
            }
        })
    }
}

impl SearchCapability for FilesystemIntegration {
    fn search<'a>(
        &'a self,
        request: IntegrationSearchRequest,
    ) -> BoxFuture<'a, AppResult<SearchContribution>> {
        Box::pin(async move {
            let value = self.search.search(&request.query, request.limit).await.ok();
            let rows = value
                .as_ref()
                .and_then(|value| value.get("results"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut results = Vec::new();
            for (index, row) in rows.into_iter().enumerate() {
                let Some(path) = row.get("path").and_then(Value::as_str) else {
                    continue;
                };
                let name = row
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(path)
                    .to_string();
                let root_id = row
                    .get("rootId")
                    .and_then(Value::as_str)
                    .unwrap_or(DEFAULT_ROOT_ID);
                let is_directory = row
                    .get("isDirectory")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let extension = media::extension(Path::new(path));
                let media_type = media::media_type(&extension);
                let mut metadata = row
                    .as_object()
                    .cloned()
                    .unwrap_or_else(Map::new)
                    .into_iter()
                    .collect::<HashMap<_, _>>();
                metadata.insert("logicalPath".into(), Value::String(path.into()));
                let resource = ResourceSummaryDto {
                    key: encode_key(DEFAULT_ROOT_ID, path),
                    name: name.clone(),
                    kind: if is_directory { "folder" } else { "file" }.into(),
                    mime: (!is_directory).then(|| media::mime_type(&extension).to_string()),
                    capabilities: if is_directory {
                        vec!["browse".into()]
                    } else {
                        vec!["read".into()]
                    },
                    presentation: Some(
                        if is_directory {
                            "browse"
                        } else {
                            file_presentation(media_type)
                        }
                        .into(),
                    ),
                    appearance: Some(ResourceAppearanceDto {
                        icon: Some(
                            if is_directory {
                                "folder"
                            } else {
                                file_icon(media_type)
                            }
                            .into(),
                        ),
                        tone: Some("muted".into()),
                        color: None,
                    }),
                    size: None,
                    metadata: Some(metadata),
                };
                results.push(IntegrationSearchResultDto {
                    id: format!("filesystem.filename:{}:{}", root_id, path),
                    contributor: "filesystem.filename".into(),
                    resource,
                    title: name,
                    detail: row
                        .get("parentPath")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    snippet: None,
                    score: 1.0 / (index + 1) as f64,
                    action: None,
                });
            }
            let knowledge_roots = store::read(
                &self.config,
                store::StateDocument::SettingsV1,
                crate::app::default_settings(),
            )?["knowledgeBases"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>();
            let needle = request.query.to_lowercase();
            let mut knowledge_count = 0usize;
            for root in knowledge_roots {
                let Ok(resolved) = media::resolve(&self.config, &root) else {
                    continue;
                };
                for entry in walkdir::WalkDir::new(&resolved.full)
                    .into_iter()
                    .filter_entry(visible_search_entry)
                    .filter_map(Result::ok)
                {
                    if knowledge_count >= request.limit {
                        break;
                    }
                    if !entry.file_type().is_file() {
                        continue;
                    }
                    let extension = entry
                        .path()
                        .extension()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_ascii_lowercase();
                    if !matches!(extension.as_str(), "md" | "txt") {
                        continue;
                    }
                    let Ok(content) = std::fs::read_to_string(entry.path()) else {
                        continue;
                    };
                    if !content.to_lowercase().contains(&needle) {
                        continue;
                    }
                    let relative = entry
                        .path()
                        .strip_prefix(&resolved.root.path)
                        .unwrap_or(entry.path())
                        .to_string_lossy()
                        .replace('\\', "/");
                    let path = if self.config.roots.len() > 1 {
                        format!("{}/{relative}", resolved.root.name)
                    } else {
                        relative
                    };
                    let name = entry.file_name().to_string_lossy().to_string();
                    let resource = ResourceSummaryDto {
                        key: encode_key(DEFAULT_ROOT_ID, &path),
                        name: name.clone(),
                        kind: "file".into(),
                        mime: mime_guess::from_path(&path).first_raw().map(str::to_string),
                        capabilities: vec!["read".into()],
                        presentation: Some("text".into()),
                        appearance: None,
                        size: entry.metadata().ok().map(|metadata| metadata.len()),
                        metadata: Some(HashMap::from([(
                            "logicalPath".into(),
                            Value::String(path.clone()),
                        )])),
                    };
                    results.push(IntegrationSearchResultDto {
                        id: format!("filesystem.knowledge:{path}"),
                        contributor: "filesystem.knowledge".into(),
                        resource,
                        title: name,
                        detail: Some(root.clone()),
                        snippet: Some(crate::app::search_snippet(&content, &needle)),
                        score: 0.75 / (knowledge_count + 1) as f64,
                        action: None,
                    });
                    knowledge_count += 1;
                }
            }
            Ok(SearchContribution {
                truncated: value
                    .as_ref()
                    .and_then(|value| value.get("truncated"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    || knowledge_count >= request.limit,
                results,
            })
        })
    }
}

impl ChangeCapability for FilesystemIntegration {
    fn changed(&self, locator: &str) {
        self.search.changed(locator);
    }
}

pub(crate) fn module(config: Config, search: Arc<FileSearch>) -> IntegrationModule {
    let runtime = FilesystemIntegration::new(config, search);
    IntegrationModule {
        descriptor: IntegrationDescriptorDto {
            id: PROVIDER_ID.into(),
            name: "Filesystem".into(),
            capabilities: vec![
                IntegrationCapabilityDto::Browse,
                IntegrationCapabilityDto::Inspect,
                IntegrationCapabilityDto::Actions,
                IntegrationCapabilityDto::Search,
            ],
            root: Some(runtime.root_summary()),
        },
        browse: Some(runtime.clone()),
        inspect: Some(runtime.clone()),
        actions: Some(runtime.clone()),
        search: Some(runtime.clone()),
        change: Some(runtime.clone()),
        shutdown: None,
        routes: routes::router(runtime),
    }
}

fn action_outcome(
    resource: Option<ResourceSummaryDto>,
    data: Value,
) -> IntegrationActionOutcomeDto {
    IntegrationActionOutcomeDto {
        success: true,
        resource,
        open_target: None,
        data: Some(data),
    }
}

fn child_path(parent: &str, name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', '\0', '\n', '\r'])
    {
        return Err(AppError::bad("File or folder name is invalid"));
    }
    let parent = normalize_path(parent)?;
    Ok(if parent.is_empty() {
        name.into()
    } else {
        format!("{parent}/{name}")
    })
}

pub(crate) fn encode_key(root_id: &str, path: &str) -> ResourceKeyDto {
    ResourceKeyDto::new(
        PROVIDER_ID,
        format!("{KEY_PREFIX}{}:{root_id}{path}", root_id.len()),
    )
}

pub(crate) fn decode_key(key: &ResourceKeyDto) -> AppResult<(String, String)> {
    if key.provider != PROVIDER_ID {
        return Err(AppError::bad("Filesystem resource provider is invalid"));
    }
    let encoded = key
        .id
        .strip_prefix(KEY_PREFIX)
        .ok_or_else(|| AppError::bad("Filesystem resource id is invalid"))?;
    let (length, value) = encoded
        .split_once(':')
        .ok_or_else(|| AppError::bad("Filesystem resource id is invalid"))?;
    let length = length
        .parse::<usize>()
        .map_err(|_| AppError::bad("Filesystem resource id is invalid"))?;
    if length == 0 || length > value.len() || !value.is_char_boundary(length) {
        return Err(AppError::bad("Filesystem resource id is invalid"));
    }
    let (root, path) = value.split_at(length);
    Ok((root.into(), normalize_path(path)?))
}

fn normalize_path(path: &str) -> AppResult<String> {
    if path.contains(['\0', '\n', '\r']) || path.contains('\\') {
        return Err(AppError::bad("Filesystem resource path is invalid"));
    }
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err(AppError::bad("Filesystem resource path is invalid")),
            value => parts.push(value),
        }
    }
    Ok(parts.join("/"))
}

fn parse_cursor(cursor: Option<&str>) -> AppResult<usize> {
    cursor
        .unwrap_or("0")
        .parse()
        .map_err(|_| AppError::bad("Browse cursor is invalid"))
}

fn visible_search_entry(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    !name.starts_with('.')
        && ![
            "node_modules",
            "$RECYCLE.BIN",
            "System Volume Information",
            ".git",
            ".svn",
            ".hg",
            "__pycache__",
            ".DS_Store",
        ]
        .contains(&name.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{FileSearchConfig, ImageOptimizationConfig, MediaRoot};
    use std::time::Duration;

    #[test]
    fn resource_keys_match_frontend_codec() {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/filesystem-resource-key-parity.json"
        ))
        .unwrap();
        for fixture in fixtures["valid"].as_array().unwrap() {
            let root_id = fixture["rootId"].as_str().unwrap();
            let path = fixture["path"].as_str().unwrap();
            let expected_id = fixture["id"].as_str().unwrap();
            let key = encode_key(root_id, path);
            assert_eq!(key.id, expected_id);
            assert_eq!(decode_key(&key).unwrap(), (root_id.into(), path.into()));
        }
        for id in fixtures["malformed"].as_array().unwrap() {
            assert!(decode_key(&ResourceKeyDto::new(PROVIDER_ID, id.as_str().unwrap())).is_err());
        }
    }

    #[tokio::test]
    async fn browse_populates_typed_recent_markdown_for_knowledge_base_locations() {
        let base = std::env::temp_dir().join(format!(
            "derp-filesystem-kb-recent-{}",
            uuid::Uuid::new_v4()
        ));
        let media = base.join("media");
        let data = base.join("data");
        std::fs::create_dir_all(media.join("Notes/.hidden")).unwrap();
        std::fs::create_dir_all(media.join("Notes/nested")).unwrap();
        std::fs::create_dir_all(media.join("Documents")).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        for index in 0..12 {
            let relative = if index == 11 {
                "Notes/nested/newest.md".into()
            } else {
                format!("Notes/note-{index:02}.md")
            };
            let path = media.join(relative);
            std::fs::write(&path, format!("note {index}")).unwrap();
            filetime::set_file_mtime(
                path,
                filetime::FileTime::from_unix_time(1_700_000_000 + index, 0),
            )
            .unwrap();
        }
        std::fs::write(media.join("Notes/ignored.txt"), "ignored").unwrap();
        std::fs::write(media.join("Notes/.hidden/secret.md"), "hidden").unwrap();
        let config = Config {
            port: 3000,
            roots: vec![MediaRoot {
                id: DEFAULT_ROOT_ID.into(),
                name: "Library".into(),
                path: media,
                editable_folders: vec!["Notes".into()],
            }],
            library_key: "library".into(),
            data_path: data.clone(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            hermes: None,
        };
        crate::state_db::initialize(&config).unwrap();
        store::update(
            &config,
            store::StateDocument::SettingsV1,
            crate::app::default_settings(),
            |settings| {
                settings["knowledgeBases"] = json!(["Notes"]);
                Ok(())
            },
        )
        .unwrap();
        let search = FileSearch::new(config.file_search.clone(), config.roots.clone());
        let runtime = FilesystemIntegration::new(config, search);

        let notes = runtime
            .browse(BrowseRequest {
                key: encode_key(DEFAULT_ROOT_ID, "Notes"),
                cursor: None,
                limit: 50,
            })
            .await
            .unwrap();
        assert_eq!(notes.recent_items.len(), 10);
        assert_eq!(notes.total, notes.items.len());
        assert_eq!(notes.recent_items[0].name, "newest.md");
        assert_eq!(notes.recent_items[1].name, "note-10.md");
        assert_eq!(notes.recent_items[9].name, "note-02.md");
        assert!(
            notes
                .recent_items
                .iter()
                .all(|item| item.name.ends_with(".md") && item.name != "secret.md")
        );
        let recent = &notes.recent_items[0];
        assert_eq!(
            recent.key,
            encode_key(DEFAULT_ROOT_ID, "Notes/nested/newest.md")
        );
        assert_eq!(recent.presentation.as_deref(), Some("text"));
        assert!(
            recent
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("modifiedAt"))
                .and_then(Value::as_str)
                .is_some_and(|value| value.contains('T'))
        );
        for item in &notes.recent_items {
            assert_eq!(
                runtime.inspect(item.key.clone()).await.unwrap().key,
                item.key
            );
        }

        let nested = runtime
            .browse(BrowseRequest {
                key: encode_key(DEFAULT_ROOT_ID, "Notes/nested"),
                cursor: None,
                limit: 20,
            })
            .await
            .unwrap();
        assert_eq!(
            nested
                .recent_items
                .iter()
                .map(|item| &item.key)
                .collect::<Vec<_>>(),
            notes
                .recent_items
                .iter()
                .map(|item| &item.key)
                .collect::<Vec<_>>()
        );

        let documents = runtime
            .browse(BrowseRequest {
                key: encode_key(DEFAULT_ROOT_ID, "Documents"),
                cursor: None,
                limit: 20,
            })
            .await
            .unwrap();
        assert!(documents.recent_items.is_empty());
        let _ = std::fs::remove_dir_all(base);
    }

    #[tokio::test]
    async fn multi_root_search_keys_match_browse_and_inspect() {
        let base = std::env::temp_dir().join(format!(
            "derp-filesystem-search-parity-{}",
            uuid::Uuid::new_v4()
        ));
        let alpha = base.join("alpha");
        let beta = base.join("beta");
        let data = base.join("data");
        std::fs::create_dir_all(alpha.join("Needle Folder")).unwrap();
        std::fs::create_dir_all(&beta).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(alpha.join("Needle Folder/child.txt"), "alpha").unwrap();
        std::fs::write(beta.join("Needle file.txt"), "beta").unwrap();
        let config = Config {
            port: 3000,
            roots: vec![
                MediaRoot {
                    id: "корень-🦀".into(),
                    name: "Alpha".into(),
                    path: alpha,
                    editable_folders: Vec::new(),
                },
                MediaRoot {
                    id: "beta-id".into(),
                    name: "Beta".into(),
                    path: beta,
                    editable_folders: Vec::new(),
                },
            ],
            library_key: "library".into(),
            data_path: data.clone(),
            file_search: FileSearchConfig {
                enabled: true,
                index_path: data.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 100,
            },
            image_optimization: ImageOptimizationConfig::default(),
            hermes: None,
        };
        crate::state_db::initialize(&config).unwrap();
        let search = FileSearch::new(config.file_search.clone(), config.roots.clone());
        let runtime = FilesystemIntegration::new(config, search);

        let configured_root = runtime
            .browse(BrowseRequest {
                key: encode_key("корень-🦀", ""),
                cursor: None,
                limit: 20,
            })
            .await
            .unwrap();
        assert_eq!(configured_root.location, encode_key("корень-🦀", ""));
        assert_eq!(
            configured_root.location_summary.as_ref().unwrap().key,
            configured_root.location
        );
        assert!(
            configured_root
                .items
                .iter()
                .any(|resource| resource.name == "Needle Folder")
        );

        let contribution = {
            let mut found = None;
            for _ in 0..100 {
                let current = runtime
                    .search(IntegrationSearchRequest {
                        query: "needle".into(),
                        limit: 20,
                    })
                    .await
                    .unwrap();
                let has_folder = current
                    .results
                    .iter()
                    .any(|result| result.title == "Needle Folder");
                let has_file = current
                    .results
                    .iter()
                    .any(|result| result.title == "Needle file.txt");
                if has_folder && has_file {
                    found = Some(current);
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            found.expect("multi-root search index did not become ready")
        };

        let root_page = runtime
            .browse(BrowseRequest {
                key: encode_key(DEFAULT_ROOT_ID, ""),
                cursor: None,
                limit: 20,
            })
            .await
            .unwrap();
        let alpha_root = root_page
            .items
            .iter()
            .find(|resource| resource.name == "Alpha")
            .unwrap();
        let beta_root = root_page
            .items
            .iter()
            .find(|resource| resource.name == "Beta")
            .unwrap();
        let alpha_page = runtime
            .browse(BrowseRequest {
                key: alpha_root.key.clone(),
                cursor: None,
                limit: 20,
            })
            .await
            .unwrap();
        let beta_page = runtime
            .browse(BrowseRequest {
                key: beta_root.key.clone(),
                cursor: None,
                limit: 20,
            })
            .await
            .unwrap();

        for result in &contribution.results {
            assert!(result.action.is_none());
            let (root_id, logical_path) = decode_key(&result.resource.key).unwrap();
            assert_eq!(root_id, DEFAULT_ROOT_ID);
            assert!(logical_path.starts_with("Alpha/") || logical_path.starts_with("Beta/"));
            let inspected = runtime.inspect(result.resource.key.clone()).await.unwrap();
            assert_eq!(inspected.key, result.resource.key);
            if result.resource.kind == "folder" {
                let browsed = runtime
                    .browse(BrowseRequest {
                        key: result.resource.key.clone(),
                        cursor: None,
                        limit: 20,
                    })
                    .await
                    .unwrap();
                assert_eq!(browsed.location, result.resource.key);
            }
        }
        let folder_result = contribution
            .results
            .iter()
            .find(|result| result.title == "Needle Folder")
            .unwrap();
        let file_result = contribution
            .results
            .iter()
            .find(|result| result.title == "Needle file.txt")
            .unwrap();
        assert_eq!(file_result.resource.presentation.as_deref(), Some("text"));
        assert_eq!(file_result.resource.mime.as_deref(), Some("text/plain"));
        assert_eq!(
            alpha_page
                .items
                .iter()
                .find(|resource| resource.name == "Needle Folder")
                .unwrap()
                .key,
            folder_result.resource.key
        );
        assert_eq!(
            beta_page
                .items
                .iter()
                .find(|resource| resource.name == "Needle file.txt")
                .unwrap()
                .key,
            file_result.resource.key
        );
        let _ = std::fs::remove_dir_all(base);
    }
}
