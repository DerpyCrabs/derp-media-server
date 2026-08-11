use super::types::{
    LegacyPageFields, LegacyResourceFields, ProviderOperation, ResourceAppearance, ResourceKind,
    ResourceOpenTarget, ResourcePresentation, ResourcePreview, ResourcePreviewKind,
    ResourceVersion, SourceId,
};
use crate::{
    config::{Config, MediaRoot},
    error::{AppError, AppResult},
    hermes::HermesTransport,
    media,
    thumbnails::Thumbnailer,
    virtual_directory,
};
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::Path, sync::Arc, time::UNIX_EPOCH};

#[derive(Clone)]
pub(crate) enum ProviderSource {
    Filesystem {
        source_id: SourceId,
        root: MediaRoot,
        legacy_root_prefix: bool,
    },
    Hermes {
        source_id: SourceId,
    },
}

impl ProviderSource {
    pub(crate) fn source_id(&self) -> &SourceId {
        match self {
            Self::Filesystem { source_id, .. } | Self::Hermes { source_id } => source_id,
        }
    }
}

#[derive(Clone)]
pub(crate) struct ProviderBrowse {
    pub(crate) source: ProviderSource,
    pub(crate) locator: String,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
}

#[derive(Clone)]
pub(crate) struct ProviderInspect {
    pub(crate) source: ProviderSource,
    pub(crate) locator: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ProviderResource {
    pub(crate) name: String,
    pub(crate) provider_locator: String,
    pub(crate) legacy_locator: String,
    pub(crate) kind: ResourceKind,
    pub(crate) presentation: ResourcePresentation,
    pub(crate) mime_type: Option<String>,
    pub(crate) size: Option<u64>,
    pub(crate) preview: Option<ResourcePreview>,
    pub(crate) version: Option<ResourceVersion>,
    pub(crate) operations: Vec<ProviderOperation>,
    pub(crate) platform_identity: Option<String>,
    pub(crate) fingerprint: Option<String>,
    pub(crate) appearance: Option<ResourceAppearance>,
    pub(crate) open_target: Option<ResourceOpenTarget>,
    pub(crate) legacy: LegacyResourceFields,
    pub(crate) virtual_entry: Option<Value>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ProviderPage {
    pub(crate) items: Vec<ProviderResource>,
    pub(crate) total: usize,
    pub(crate) next_offset: Option<usize>,
    pub(crate) legacy: LegacyPageFields,
}

pub(crate) trait ReadProvider: Send + Sync {
    fn browse<'a>(&'a self, query: ProviderBrowse) -> BoxFuture<'a, AppResult<ProviderPage>>;

    fn inspect<'a>(&'a self, query: ProviderInspect) -> BoxFuture<'a, AppResult<ProviderResource>>;
}

pub(crate) struct FilesystemProvider {
    config: Config,
    thumbnails: Arc<Thumbnailer>,
}

#[derive(Clone, Copy)]
enum FilesystemIdentityObservation {
    Strong,
    Compatibility,
}

impl FilesystemProvider {
    pub(crate) fn new(config: Config, thumbnails: Arc<Thumbnailer>) -> Self {
        Self { config, thumbnails }
    }

    pub(crate) fn compatibility(&self) -> FilesystemCompatibilityAdapter<'_> {
        FilesystemCompatibilityAdapter { provider: self }
    }

    fn source_config(&self, root: &MediaRoot) -> Config {
        let mut config = self.config.clone();
        config.roots = vec![root.clone()];
        config
    }

    fn resource(
        &self,
        source: &ProviderSource,
        file: media::FileItem,
        observation: Option<(std::path::PathBuf, std::fs::Metadata)>,
        identity_observation: FilesystemIdentityObservation,
    ) -> AppResult<ProviderResource> {
        let ProviderSource::Filesystem {
            root,
            legacy_root_prefix,
            ..
        } = source
        else {
            return Err(AppError::internal(
                "Filesystem provider received non-filesystem Source",
            ));
        };
        let provider_locator = file.path.replace('\\', "/");
        let legacy_locator = if *legacy_root_prefix {
            if provider_locator.is_empty() {
                root.name.clone()
            } else {
                format!("{}/{}", root.name, provider_locator)
            }
        } else {
            provider_locator.clone()
        };
        let (full_path, metadata) = if let Some(observation) = observation {
            observation
        } else {
            let source_config = self.source_config(root);
            let resolved = media::resolve(&source_config, &[], &provider_locator)?;
            let metadata = std::fs::metadata(&resolved.full).map_err(AppError::io)?;
            (resolved.full, metadata)
        };
        let platform_identity = match identity_observation {
            FilesystemIdentityObservation::Strong => platform_identity(&full_path, &metadata),
            FilesystemIdentityObservation::Compatibility => {
                compatibility_platform_identity(&full_path, &metadata, file.is_directory)
            }
        };
        let presentation = presentation(file.is_directory, &file.media_type);
        let mime_type = (!file.is_directory).then(|| media::mime_type(&file.extension).to_string());
        let thumbnail_generated = if !file.is_directory
            && matches!(
                presentation,
                ResourcePresentation::Image | ResourcePresentation::Video
            ) {
            metadata
                .modified()
                .ok()
                .map(|modified| self.thumbnails.cached(&full_path, modified))
        } else {
            file.thumbnail_generated
        };
        Ok(ProviderResource {
            name: file.name,
            provider_locator,
            legacy_locator,
            kind: if file.is_directory {
                ResourceKind::Folder
            } else {
                ResourceKind::File
            },
            presentation,
            mime_type,
            size: (!file.is_directory).then_some(file.size),
            preview: matches!(
                presentation,
                ResourcePresentation::Image | ResourcePresentation::Video
            )
            .then_some(ResourcePreview {
                kind: ResourcePreviewKind::Thumbnail,
                available: thumbnail_generated.unwrap_or(false),
            }),
            version: Some(filesystem_version(&metadata)),
            operations: if file.is_directory {
                vec![ProviderOperation::Browse, ProviderOperation::Download]
            } else if matches!(
                presentation,
                ResourcePresentation::Audio | ResourcePresentation::Video
            ) {
                vec![
                    ProviderOperation::Read,
                    ProviderOperation::Stream,
                    ProviderOperation::Download,
                ]
            } else {
                vec![ProviderOperation::Read, ProviderOperation::Download]
            },
            platform_identity,
            fingerprint: Some(metadata_fingerprint(&metadata, file.is_directory)),
            appearance: None,
            open_target: None,
            legacy: LegacyResourceFields {
                is_virtual: file.is_virtual,
                view_count: file.view_count,
                share_token: file.share_token,
                thumbnail_generated,
                ..LegacyResourceFields::default().with_numeric_version(file.version)
            },
            virtual_entry: None,
        })
    }

    async fn browse_with_identity(
        &self,
        query: ProviderBrowse,
        identity_observation: FilesystemIdentityObservation,
    ) -> AppResult<ProviderPage> {
        let ProviderSource::Filesystem { root, .. } = &query.source else {
            return Err(AppError::internal(
                "Filesystem provider received non-filesystem Source",
            ));
        };
        if media::excluded_locator(&query.locator, true) {
            return Err(AppError::not_found("Filesystem Resource not found"));
        }
        let config = self.source_config(root);
        let mut files = media::list_observed(&config, &[], &query.locator)?;
        files.retain(|file| file.item.is_virtual != Some(true));
        let total = files.len();
        let end = query.offset.saturating_add(query.limit).min(total);
        let page = if query.offset >= total {
            Vec::new()
        } else {
            files.drain(query.offset..end).collect::<Vec<_>>()
        };
        let items = {
            #[cfg(windows)]
            {
                if matches!(
                    identity_observation,
                    FilesystemIdentityObservation::Compatibility
                ) && page.len() >= 128
                {
                    let worker_count = std::thread::available_parallelism()
                        .map(|count| count.get())
                        .unwrap_or(1)
                        .min(16)
                        .min(page.len());
                    let mut work = (0..worker_count).map(|_| Vec::new()).collect::<Vec<_>>();
                    for (index, file) in page.into_iter().enumerate() {
                        work[index % worker_count].push((index, file));
                    }
                    std::thread::scope(|scope| -> AppResult<Vec<ProviderResource>> {
                        let handles = work
                            .into_iter()
                            .map(|group| {
                                scope.spawn(|| {
                                    group
                                        .into_iter()
                                        .map(|(index, file)| {
                                            self.resource(
                                                &query.source,
                                                file.item,
                                                file.full_path.zip(file.metadata),
                                                identity_observation,
                                            )
                                            .map(|resource| (index, resource))
                                        })
                                        .collect::<AppResult<Vec<_>>>()
                                })
                            })
                            .collect::<Vec<_>>();
                        let mut indexed = Vec::with_capacity(total);
                        for handle in handles {
                            indexed.extend(handle.join().map_err(|_| {
                                AppError::internal("Filesystem identity worker panicked")
                            })??);
                        }
                        indexed.sort_unstable_by_key(|(index, _)| *index);
                        Ok(indexed.into_iter().map(|(_, resource)| resource).collect())
                    })?
                } else {
                    page.into_iter()
                        .map(|file| {
                            self.resource(
                                &query.source,
                                file.item,
                                file.full_path.zip(file.metadata),
                                identity_observation,
                            )
                        })
                        .collect::<AppResult<Vec<_>>>()?
                }
            }
            #[cfg(not(windows))]
            {
                page.into_iter()
                    .map(|file| {
                        self.resource(
                            &query.source,
                            file.item,
                            file.full_path.zip(file.metadata),
                            identity_observation,
                        )
                    })
                    .collect::<AppResult<Vec<_>>>()?
            }
        };
        Ok(ProviderPage {
            items,
            total,
            next_offset: (end < total).then_some(end),
            legacy: LegacyPageFields::default(),
        })
    }
}

pub(crate) struct FilesystemCompatibilityAdapter<'a> {
    provider: &'a FilesystemProvider,
}

impl FilesystemCompatibilityAdapter<'_> {
    pub(crate) async fn browse(&self, query: ProviderBrowse) -> AppResult<ProviderPage> {
        self.provider
            .browse_with_identity(query, FilesystemIdentityObservation::Compatibility)
            .await
    }
}

impl ReadProvider for FilesystemProvider {
    fn browse<'a>(&'a self, query: ProviderBrowse) -> BoxFuture<'a, AppResult<ProviderPage>> {
        Box::pin(self.browse_with_identity(query, FilesystemIdentityObservation::Strong))
    }

    fn inspect<'a>(&'a self, query: ProviderInspect) -> BoxFuture<'a, AppResult<ProviderResource>> {
        Box::pin(async move {
            let ProviderSource::Filesystem { root, .. } = &query.source else {
                return Err(AppError::internal(
                    "Filesystem provider received non-filesystem Source",
                ));
            };
            let config = self.source_config(root);
            let resolved = media::resolve(&config, &[], &query.locator)?;
            let metadata = std::fs::metadata(&resolved.full).map_err(AppError::io)?;
            if media::excluded_locator(&query.locator, metadata.is_dir()) {
                return Err(AppError::not_found("Filesystem Resource not found"));
            }
            let name = resolved
                .full
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let extension = media::extension(Path::new(&name));
            self.resource(
                &query.source,
                media::FileItem {
                    name,
                    path: query.locator,
                    media_type: if metadata.is_dir() {
                        "folder".into()
                    } else {
                        media::media_type(&extension).into()
                    },
                    size: if metadata.is_file() {
                        metadata.len()
                    } else {
                        0
                    },
                    extension,
                    is_directory: metadata.is_dir(),
                    is_virtual: None,
                    view_count: None,
                    share_token: None,
                    thumbnail_generated: None,
                    version: legacy_numeric_version(&metadata),
                    resource: None,
                },
                Some((resolved.full, metadata)),
                FilesystemIdentityObservation::Strong,
            )
        })
    }
}

pub(crate) struct HermesProvider {
    transport: Arc<dyn HermesTransport>,
}

impl HermesProvider {
    pub(crate) fn new(transport: Arc<dyn HermesTransport>) -> Self {
        Self { transport }
    }

    pub(crate) fn compatibility(&self) -> HermesCompatibilityAdapter<'_> {
        HermesCompatibilityAdapter { provider: self }
    }
}

pub(crate) struct HermesCompatibilityAdapter<'a> {
    provider: &'a HermesProvider,
}

impl HermesCompatibilityAdapter<'_> {
    fn legacy_resource(
        &self,
        file: media::FileItem,
        entry: Option<Value>,
    ) -> AppResult<ProviderResource> {
        let legacy_locator = file.path.replace('\\', "/");
        let provider_locator = legacy_locator
            .strip_prefix(&format!("{}/", virtual_directory::HERMES_ROOT))
            .unwrap_or_default()
            .to_string();
        let entry_ref = entry.as_ref().and_then(Value::as_object);
        let kind = match entry_ref
            .and_then(|entry| entry.get("kind"))
            .and_then(Value::as_str)
        {
            Some("session") => ResourceKind::Conversation,
            Some("project") => ResourceKind::ConversationProject,
            _ if file.is_directory => ResourceKind::Folder,
            _ => ResourceKind::File,
        };
        let presentation = if kind == ResourceKind::Conversation {
            ResourcePresentation::Conversation
        } else if file.is_directory {
            ResourcePresentation::Browse
        } else {
            ResourcePresentation::Unsupported
        };
        let open_target = entry_ref
            .and_then(|entry| entry.get("openTarget"))
            .and_then(|target| serde_json::from_value(target.clone()).ok());
        let appearance = entry_ref
            .and_then(|entry| entry.get("appearance"))
            .and_then(|appearance| serde_json::from_value(appearance.clone()).ok());
        let operations = entry_ref
            .and_then(|entry| entry.get("capabilities"))
            .and_then(Value::as_array)
            .map(|capabilities| {
                let has = |name: &str| {
                    capabilities
                        .iter()
                        .any(|value| value.as_str() == Some(name))
                };
                let mut values = Vec::new();
                if file.is_directory || has("open") {
                    values.push(if file.is_directory {
                        ProviderOperation::Browse
                    } else {
                        ProviderOperation::Read
                    });
                }
                if has("download") {
                    values.push(ProviderOperation::Export);
                }
                values
            })
            .unwrap_or_else(|| {
                if file.is_directory {
                    vec![ProviderOperation::Browse]
                } else {
                    vec![ProviderOperation::Read]
                }
            });
        let metadata = entry_ref.and_then(|entry| entry.get("metadata"));
        let version = if kind == ResourceKind::Conversation {
            entry_ref
                .and_then(|entry| {
                    entry
                        .get("id")
                        .and_then(Value::as_str)
                        .or_else(|| {
                            entry
                                .get("openTarget")
                                .and_then(|target| target.get("sessionId"))
                                .and_then(Value::as_str)
                        })
                        .or_else(|| metadata.and_then(hermes_session_id))
                        .zip(metadata)
                        .map(|(id, metadata)| {
                            let archived = entry
                                .get("archived")
                                .and_then(Value::as_bool)
                                .or_else(|| {
                                    entry
                                        .get("openTarget")
                                        .and_then(|target| target.get("readOnly"))
                                        .and_then(Value::as_bool)
                                })
                                .unwrap_or_else(|| hermes_session_archived(metadata));
                            hermes_session_version(id, &file.name, metadata, archived)
                        })
                })
                .or_else(|| metadata.map(opaque_json_version))
        } else {
            metadata.map(opaque_json_version)
        };
        Ok(ProviderResource {
            name: file.name,
            provider_locator,
            legacy_locator,
            kind,
            presentation,
            mime_type: None,
            size: None,
            preview: None,
            version,
            operations,
            platform_identity: entry_ref
                .and_then(|entry| entry.get("id"))
                .and_then(Value::as_str)
                .map(|id| format!("hermes:{id}")),
            fingerprint: None,
            appearance,
            open_target,
            legacy: LegacyResourceFields {
                is_virtual: Some(true),
                ..LegacyResourceFields::default()
            },
            virtual_entry: entry,
        })
    }

    pub(crate) async fn browse(&self, locator: String, offset: usize) -> AppResult<ProviderPage> {
        let path = if locator.is_empty() {
            virtual_directory::HERMES_ROOT.to_string()
        } else {
            format!("{}/{}", virtual_directory::HERMES_ROOT, locator)
        };
        let listing =
            virtual_directory::list_hermes_with(self.provider.transport.as_ref(), &path, offset)
                .await?;
        let items = listing
            .files
            .into_iter()
            .map(|file| {
                let entry = listing.virtual_entries.get(&file.path).cloned();
                self.legacy_resource(file, entry)
            })
            .collect::<AppResult<Vec<_>>>()?;
        let directory = listing.virtual_directory;
        let total = directory
            .as_ref()
            .and_then(|value| value.get("total"))
            .and_then(Value::as_u64)
            .unwrap_or(items.len() as u64) as usize;
        let next_offset = directory
            .as_ref()
            .and_then(|value| value.get("nextOffset"))
            .and_then(Value::as_u64)
            .map(|value| value as usize);
        Ok(ProviderPage {
            items,
            total,
            next_offset,
            legacy: LegacyPageFields {
                virtual_directory: directory,
                virtual_entries: listing.virtual_entries,
            },
        })
    }
}

impl HermesProvider {
    async fn browse_typed(&self, query: ProviderBrowse) -> AppResult<ProviderPage> {
        let mut resources = match query.locator.as_str() {
            "" => self.root_resources().await?,
            "archived" => self.session_resources(true).await?,
            locator => {
                let Some(id) = typed_id(locator, "project/")? else {
                    return Err(AppError::not_found("Hermes Resource not found"));
                };
                self.project(id).await?;
                self.project_session_resources(id).await?
            }
        };
        let total = resources.len();
        let limit = query.limit.max(1);
        let end = query.offset.saturating_add(limit).min(total);
        let items = if query.offset >= total {
            Vec::new()
        } else {
            resources.drain(query.offset..end).collect()
        };
        Ok(ProviderPage {
            items,
            total,
            next_offset: (end < total).then_some(end),
            legacy: LegacyPageFields::default(),
        })
    }

    async fn root_resources(&self) -> AppResult<Vec<ProviderResource>> {
        let mut projects = self.projects().await?;
        projects.sort_by(|left, right| {
            hermes_project_name(left)
                .to_lowercase()
                .cmp(&hermes_project_name(right).to_lowercase())
        });
        let mut assigned = HashSet::new();
        for project in &projects {
            let Some(id) = project.get("id").and_then(Value::as_str) else {
                continue;
            };
            for session in self.project_sessions(id).await? {
                if let Some(id) = hermes_session_id(&session) {
                    assigned.insert(id.to_string());
                }
            }
        }
        let mut resources = projects
            .into_iter()
            .filter_map(|project| self.project_resource(project).transpose())
            .collect::<AppResult<Vec<_>>>()?;
        resources.push(self.archived_resource());
        resources.extend(
            self.sessions(false)
                .await?
                .into_iter()
                .filter(|session| {
                    hermes_session_id(session).is_some_and(|id| !assigned.contains(id))
                })
                .filter_map(|session| self.session_resource(session, false, None).transpose())
                .collect::<AppResult<Vec<_>>>()?,
        );
        Ok(resources)
    }

    async fn session_resources(&self, archived: bool) -> AppResult<Vec<ProviderResource>> {
        self.sessions(archived)
            .await?
            .into_iter()
            .filter_map(|session| self.session_resource(session, archived, None).transpose())
            .collect()
    }

    async fn project_session_resources(&self, id: &str) -> AppResult<Vec<ProviderResource>> {
        self.project_sessions(id)
            .await?
            .into_iter()
            .filter_map(|session| self.session_resource(session, false, None).transpose())
            .collect()
    }

    async fn projects(&self) -> AppResult<Vec<Value>> {
        let value = self.transport.rpc("projects.list", json!({})).await?;
        Ok(value
            .get("projects")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|project| {
                !project
                    .get("archived")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    && !project
                        .get("is_auto")
                        .or_else(|| project.get("isAuto"))
                        .or_else(|| project.get("auto"))
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
            })
            .collect())
    }

    async fn project(&self, id: &str) -> AppResult<Value> {
        self.projects()
            .await?
            .into_iter()
            .find(|project| project.get("id").and_then(Value::as_str) == Some(id))
            .ok_or_else(|| AppError::not_found("Hermes project not found"))
    }

    async fn project_sessions(&self, id: &str) -> AppResult<Vec<Value>> {
        let value = self
            .transport
            .rpc(
                "projects.project_sessions",
                json!({"project_id":id,"session_limit":i32::MAX}),
            )
            .await?;
        let mut sessions = Vec::new();
        if let Some(project) = value.get("project") {
            collect_hermes_sessions(project, &mut sessions);
        }
        sessions.sort_by(|a, b| hermes_session_time(b).total_cmp(&hermes_session_time(a)));
        let mut seen = HashSet::new();
        sessions.retain(|session| {
            hermes_session_id(session).is_some_and(|id| seen.insert(id.to_string()))
        });
        Ok(sessions)
    }

    async fn sessions(&self, archived: bool) -> AppResult<Vec<Value>> {
        let mut sessions = Vec::new();
        let mut offset = 0usize;
        loop {
            let mut query = vec![
                ("limit", "100".into()),
                ("offset", offset.to_string()),
                ("min_messages", "1".into()),
                ("order", "recent".into()),
                ("archived", if archived { "only" } else { "exclude" }.into()),
                ("exclude_sources", "tool,kanban".into()),
            ];
            if let Some(profile) = self.transport.profile() {
                query.push(("profile", profile.into()));
            }
            let page = self.transport.get("api/sessions", &query).await?;
            let rows = page
                .get("sessions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let count = rows.len();
            sessions.extend(rows);
            offset += count;
            let total = page
                .get("total")
                .and_then(Value::as_u64)
                .unwrap_or(offset as u64) as usize;
            if count == 0 || offset >= total {
                break;
            }
        }
        sessions.sort_by(|a, b| hermes_session_time(b).total_cmp(&hermes_session_time(a)));
        Ok(sessions)
    }

    fn project_resource(&self, project: Value) -> AppResult<Option<ProviderResource>> {
        let Some(id) = project.get("id").and_then(Value::as_str) else {
            return Ok(None);
        };
        validate_hermes_id(id)?;
        let name = hermes_project_name(&project).to_string();
        let color = project
            .get("color")
            .and_then(Value::as_str)
            .map(str::to_string);
        let provider_locator = format!("project/{id}");
        let legacy_locator = hermes_legacy_locator(&provider_locator);
        Ok(Some(ProviderResource {
            name,
            provider_locator,
            legacy_locator,
            kind: ResourceKind::ConversationProject,
            presentation: ResourcePresentation::Browse,
            mime_type: None,
            size: None,
            preview: None,
            version: Some(opaque_json_version(&project)),
            operations: vec![ProviderOperation::Browse],
            platform_identity: Some(format!("hermes:{id}")),
            fingerprint: None,
            appearance: Some(ResourceAppearance {
                icon: project
                    .get("icon")
                    .and_then(Value::as_str)
                    .unwrap_or("project")
                    .into(),
                tone: "indigo".into(),
                color,
            }),
            open_target: None,
            legacy: LegacyResourceFields {
                is_virtual: Some(true),
                ..LegacyResourceFields::default()
            },
            virtual_entry: None,
        }))
    }

    fn archived_resource(&self) -> ProviderResource {
        ProviderResource {
            name: "Archived".into(),
            provider_locator: "archived".into(),
            legacy_locator: hermes_legacy_locator("archived"),
            kind: ResourceKind::Folder,
            presentation: ResourcePresentation::Browse,
            mime_type: None,
            size: None,
            preview: None,
            version: None,
            operations: vec![ProviderOperation::Browse],
            platform_identity: Some("hermes:archived".into()),
            fingerprint: None,
            appearance: Some(ResourceAppearance {
                icon: "archive".into(),
                tone: "muted".into(),
                color: None,
            }),
            open_target: None,
            legacy: LegacyResourceFields {
                is_virtual: Some(true),
                ..LegacyResourceFields::default()
            },
            virtual_entry: None,
        }
    }

    fn session_resource(
        &self,
        session: Value,
        archived: bool,
        locator_id: Option<&str>,
    ) -> AppResult<Option<ProviderResource>> {
        let Some(id) = locator_id.or_else(|| hermes_session_id(&session)) else {
            return Ok(None);
        };
        validate_hermes_id(id)?;
        let name = session
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
            .unwrap_or("Untitled session")
            .to_string();
        let version = hermes_session_version(id, &name, &session, archived);
        let provider_locator = format!("session/{id}");
        let legacy_locator = hermes_legacy_locator(&provider_locator);
        Ok(Some(ProviderResource {
            name,
            provider_locator,
            legacy_locator,
            kind: ResourceKind::Conversation,
            presentation: ResourcePresentation::Conversation,
            mime_type: None,
            size: None,
            preview: None,
            version: Some(version),
            operations: vec![ProviderOperation::Read, ProviderOperation::Export],
            platform_identity: Some(format!("hermes:{id}")),
            fingerprint: None,
            appearance: Some(ResourceAppearance {
                icon: "agent-session".into(),
                tone: "violet".into(),
                color: None,
            }),
            open_target: Some(ResourceOpenTarget::HermesSession {
                session_id: id.into(),
                read_only: archived,
            }),
            legacy: LegacyResourceFields {
                is_virtual: Some(true),
                ..LegacyResourceFields::default()
            },
            virtual_entry: None,
        }))
    }
}

impl ReadProvider for HermesProvider {
    fn browse<'a>(&'a self, query: ProviderBrowse) -> BoxFuture<'a, AppResult<ProviderPage>> {
        Box::pin(async move {
            if !matches!(query.source, ProviderSource::Hermes { .. }) {
                return Err(AppError::internal(
                    "Hermes provider received filesystem Source",
                ));
            }
            self.browse_typed(query).await
        })
    }

    fn inspect<'a>(&'a self, query: ProviderInspect) -> BoxFuture<'a, AppResult<ProviderResource>> {
        Box::pin(async move {
            if !matches!(query.source, ProviderSource::Hermes { .. }) {
                return Err(AppError::internal(
                    "Hermes provider received filesystem Source",
                ));
            }
            if query.locator == "archived" {
                return Ok(self.archived_resource());
            }
            if let Some(id) = typed_id(&query.locator, "project/")? {
                return self
                    .project_resource(self.project(id).await?)?
                    .ok_or_else(|| AppError::not_found("Hermes project not found"));
            }
            let Some(id) = typed_id(&query.locator, "session/")? else {
                return Err(AppError::not_found("Hermes Resource not found"));
            };
            let mut profile_query = Vec::new();
            if let Some(profile) = self.transport.profile() {
                profile_query.push(("profile", profile.into()));
            }
            let session = self
                .transport
                .get(&format!("api/sessions/{id}"), &profile_query)
                .await?;
            let archived = hermes_session_archived(&session);
            self.session_resource(session, archived, Some(id))?
                .ok_or_else(|| AppError::not_found("Hermes Resource not found"))
        })
    }
}

fn validate_hermes_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.contains(['/', '\\']) {
        return Err(AppError::bad("Hermes Resource locator is invalid"));
    }
    Ok(())
}

fn typed_id<'a>(locator: &'a str, prefix: &str) -> AppResult<Option<&'a str>> {
    let Some(id) = locator.strip_prefix(prefix) else {
        return Ok(None);
    };
    validate_hermes_id(id)?;
    Ok(Some(id))
}

fn hermes_legacy_locator(provider_locator: &str) -> String {
    format!("{}/{}", virtual_directory::HERMES_ROOT, provider_locator)
}

fn hermes_session_id(value: &Value) -> Option<&str> {
    value
        .get("_lineage_root_id")
        .or_else(|| value.get("lineage_root_id"))
        .or_else(|| value.get("lineageRootId"))
        .or_else(|| value.get("root_session_id"))
        .or_else(|| value.get("id"))
        .or_else(|| value.get("session_id"))
        .and_then(Value::as_str)
}

fn hermes_project_name(value: &Value) -> &str {
    value
        .get("name")
        .or_else(|| value.get("label"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("Untitled project")
}

fn hermes_session_time(value: &Value) -> f64 {
    value
        .get("last_active")
        .or_else(|| value.get("lastActive"))
        .and_then(Value::as_f64)
        .unwrap_or_default()
}

fn hermes_session_archived(value: &Value) -> bool {
    value
        .get("archived")
        .or_else(|| value.get("is_archived"))
        .or_else(|| value.get("isArchived"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn hermes_session_version(
    id: &str,
    title: &str,
    session: &Value,
    archived: bool,
) -> ResourceVersion {
    opaque_json_version(&json!({
        "id": id,
        "title": title,
        "lastActive": hermes_session_time(session),
        "archived": archived,
    }))
}

fn collect_hermes_sessions(value: &Value, output: &mut Vec<Value>) {
    if let Some(sessions) = value.get("sessions").and_then(Value::as_array) {
        output.extend(sessions.iter().cloned());
    }
    if let Some(object) = value.as_object() {
        for (key, child) in object {
            if key != "sessions" {
                collect_hermes_sessions(child, output);
            }
        }
    } else if let Some(array) = value.as_array() {
        for child in array {
            collect_hermes_sessions(child, output);
        }
    }
}

fn presentation(is_directory: bool, media_type: &str) -> ResourcePresentation {
    if is_directory {
        return ResourcePresentation::Browse;
    }
    match media_type {
        "video" => ResourcePresentation::Video,
        "audio" => ResourcePresentation::Audio,
        "image" => ResourcePresentation::Image,
        "text" => ResourcePresentation::Text,
        "pdf" => ResourcePresentation::Pdf,
        "book" => ResourcePresentation::Book,
        _ => ResourcePresentation::Unsupported,
    }
}

fn legacy_numeric_version(metadata: &std::fs::Metadata) -> Option<f64> {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0)
}

fn filesystem_version(metadata: &std::fs::Metadata) -> ResourceVersion {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let created = metadata
        .created()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let mut hash = Sha256::new();
    hash.update(modified.to_le_bytes());
    hash.update(created.to_le_bytes());
    hash.update(metadata.len().to_le_bytes());
    hash.update([metadata.is_dir() as u8]);
    ResourceVersion::new(format!("fs:v1:{}", digest_hex(hash.finalize())))
}

fn metadata_fingerprint(metadata: &std::fs::Metadata, is_directory: bool) -> String {
    let created = metadata
        .created()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("fs-meta:v1:{created}:{}", is_directory as u8)
}

fn compatibility_platform_identity(
    path: &Path,
    metadata: &std::fs::Metadata,
    _is_directory: bool,
) -> Option<String> {
    platform_identity(path, metadata)
}

#[cfg(windows)]
fn platform_identity(path: &Path, _metadata: &std::fs::Metadata) -> Option<String> {
    let handle = winapi_util::Handle::from_path_any(path).ok()?;
    let information = winapi_util::file::information(&handle).ok()?;
    Some(format!(
        "windows:{}:{}",
        information.volume_serial_number(),
        information.file_index()
    ))
}

#[cfg(unix)]
fn platform_identity(_path: &Path, metadata: &std::fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(format!("unix:{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(not(any(windows, unix)))]
fn platform_identity(_path: &Path, _metadata: &std::fs::Metadata) -> Option<String> {
    None
}

fn opaque_json_version(value: &Value) -> ResourceVersion {
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(value).unwrap_or_default());
    ResourceVersion::new(format!("hermes:v1:{}", digest_hex(hash.finalize())))
}

fn digest_hex(bytes: impl AsRef<[u8]>) -> String {
    bytes
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig};
    use std::{collections::VecDeque, sync::Mutex};

    #[cfg(windows)]
    #[test]
    fn windows_directory_platform_identity_detects_recreation() {
        let base = std::env::temp_dir().join(format!(
            "derp-provider-directory-identity-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&base).unwrap();
        let original = platform_identity(&base, &std::fs::metadata(&base).unwrap());

        std::fs::remove_dir(&base).unwrap();
        std::fs::create_dir(&base).unwrap();
        let recreated = platform_identity(&base, &std::fs::metadata(&base).unwrap());

        assert!(original.is_some());
        assert!(recreated.is_some());
        assert_ne!(recreated, original);
        std::fs::remove_dir(&base).unwrap();
    }

    #[tokio::test]
    async fn filesystem_inspect_rejects_excluded_locator_components() {
        let base = std::env::temp_dir().join(format!(
            "derp-provider-excluded-inspect-{}",
            uuid::Uuid::new_v4()
        ));
        let media = base.join("media");
        for directory in [".git", "node_modules", "$RECYCLE.BIN"] {
            std::fs::create_dir_all(media.join(directory)).unwrap();
        }
        std::fs::write(media.join(".git").join("config"), b"hidden").unwrap();
        std::fs::write(media.join("node_modules").join("package.json"), b"hidden").unwrap();
        std::fs::write(media.join("$RECYCLE.BIN").join("trash.txt"), b"hidden").unwrap();
        std::fs::write(media.join("visible.txt"), b"visible").unwrap();
        let root = MediaRoot {
            id: "source-filesystem".into(),
            name: "Media".into(),
            path: media.clone(),
            editable_folders: Vec::new(),
            read_only: false,
            source: "config".into(),
            created_at: None,
        };
        let config = Config {
            port: 3000,
            roots: vec![root.clone()],
            library_key: media.to_string_lossy().into_owned(),
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
        };
        let provider = FilesystemProvider::new(
            config.clone(),
            Arc::new(Thumbnailer::new(config.data_path.join("thumbnails"))),
        );
        let source = ProviderSource::Filesystem {
            source_id: SourceId::new("source-filesystem"),
            root,
            legacy_root_prefix: false,
        };

        for locator in [
            ".git/config",
            "node_modules/package.json",
            "$RECYCLE.BIN/trash.txt",
        ] {
            assert!(
                provider
                    .inspect(ProviderInspect {
                        source: source.clone(),
                        locator: locator.into(),
                    })
                    .await
                    .is_err(),
                "excluded locator was inspectable: {locator}"
            );
        }
        assert_eq!(
            provider
                .inspect(ProviderInspect {
                    source,
                    locator: "visible.txt".into(),
                })
                .await
                .unwrap()
                .name,
            "visible.txt"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    struct FakeHermes {
        gets: Mutex<VecDeque<Value>>,
        rpcs: Mutex<VecDeque<Value>>,
    }

    impl FakeHermes {
        fn new(
            gets: impl IntoIterator<Item = Value>,
            rpcs: impl IntoIterator<Item = Value>,
        ) -> Self {
            Self {
                gets: Mutex::new(gets.into_iter().collect()),
                rpcs: Mutex::new(rpcs.into_iter().collect()),
            }
        }
    }

    impl HermesTransport for FakeHermes {
        fn profile(&self) -> Option<&str> {
            Some("test")
        }

        fn get<'a>(
            &'a self,
            _path: &'a str,
            _query: &'a [(&'a str, String)],
        ) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async move {
                self.gets
                    .lock()
                    .unwrap()
                    .pop_front()
                    .ok_or_else(|| AppError::internal("unexpected Hermes get"))
            })
        }

        fn patch<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async { Err(AppError::internal("unexpected Hermes patch")) })
        }

        fn post<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async { Err(AppError::internal("unexpected Hermes post")) })
        }

        fn delete<'a>(&'a self, _path: &'a str) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Err(AppError::internal("unexpected Hermes delete")) })
        }

        fn ensure_events<'a>(&'a self) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Ok(()) })
        }

        fn rpc<'a>(&'a self, _method: &'a str, _params: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async move {
                self.rpcs
                    .lock()
                    .unwrap()
                    .pop_front()
                    .ok_or_else(|| AppError::internal("unexpected Hermes rpc"))
            })
        }
    }

    fn source() -> ProviderSource {
        ProviderSource::Hermes {
            source_id: SourceId::new("source-hermes"),
        }
    }

    #[tokio::test]
    async fn hermes_root_browse_keeps_typed_locators_and_legacy_paths() {
        let provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [serde_json::json!({
                "sessions":[
                    {"id":"inside","title":"Inside","last_active":2},
                    {"id":"loose","title":"Loose","last_active":1}
                ],
                "total":2
            })],
            [
                serde_json::json!({"projects":[{"id":"project-a","name":"Alpha"}]}),
                serde_json::json!({"project":{"sessions":[{"id":"inside"}]}}),
            ],
        )));

        let page = provider
            .browse(ProviderBrowse {
                source: source(),
                locator: String::new(),
                offset: 0,
                limit: usize::MAX,
            })
            .await
            .unwrap();

        assert_eq!(
            page.items
                .iter()
                .map(|resource| resource.provider_locator.as_str())
                .collect::<Vec<_>>(),
            ["project/project-a", "archived", "session/loose"]
        );
        assert_eq!(
            page.items
                .iter()
                .map(|resource| resource.legacy_locator.as_str())
                .collect::<Vec<_>>(),
            [
                "Hermes Sessions/project/project-a",
                "Hermes Sessions/archived",
                "Hermes Sessions/session/loose"
            ]
        );
        assert_eq!(page.total, 3);
        assert_eq!(page.next_offset, None);
    }

    #[tokio::test]
    async fn hermes_archived_browse_marks_sessions_read_only() {
        let provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [serde_json::json!({
                "sessions":[{"id":"old","title":"Old","archived":true}],
                "total":1
            })],
            [],
        )));

        let page = provider
            .browse(ProviderBrowse {
                source: source(),
                locator: "archived".into(),
                offset: 0,
                limit: 200,
            })
            .await
            .unwrap();

        assert_eq!(
            page.items[0].open_target,
            Some(ResourceOpenTarget::HermesSession {
                session_id: "old".into(),
                read_only: true,
            })
        );
    }

    #[tokio::test]
    async fn hermes_project_and_archive_inspect_as_browsable_resources() {
        let provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [],
            [serde_json::json!({
                "projects":[{"id":"project-a","name":"Alpha","color":"#123456"}]
            })],
        )));

        let project = provider
            .inspect(ProviderInspect {
                source: source(),
                locator: "project/project-a".into(),
            })
            .await
            .unwrap();
        assert_eq!(project.kind, ResourceKind::ConversationProject);
        assert_eq!(project.presentation, ResourcePresentation::Browse);
        assert_eq!(project.operations, [ProviderOperation::Browse]);
        assert_eq!(project.provider_locator, "project/project-a");
        assert_eq!(project.legacy_locator, "Hermes Sessions/project/project-a");
        assert!(project.version.is_some());

        let archived = provider
            .inspect(ProviderInspect {
                source: source(),
                locator: "archived".into(),
            })
            .await
            .unwrap();
        assert_eq!(archived.kind, ResourceKind::Folder);
        assert_eq!(archived.presentation, ResourcePresentation::Browse);
        assert_eq!(archived.operations, [ProviderOperation::Browse]);
        assert_eq!(archived.provider_locator, "archived");
        assert_eq!(archived.legacy_locator, "Hermes Sessions/archived");
    }

    #[tokio::test]
    async fn hermes_project_browse_pages_typed_sessions() {
        let provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [],
            [
                serde_json::json!({
                    "projects":[{"id":"project-a","name":"Alpha"}]
                }),
                serde_json::json!({
                    "project":{"groups":[{"sessions":[
                        {"id":"older","title":"Older","last_active":1},
                        {"id":"newer","title":"Newer","last_active":2}
                    ]}]}
                }),
            ],
        )));

        let page = provider
            .browse(ProviderBrowse {
                source: source(),
                locator: "project/project-a".into(),
                offset: 1,
                limit: 1,
            })
            .await
            .unwrap();

        assert_eq!(page.total, 2);
        assert_eq!(page.next_offset, None);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].provider_locator, "session/older");
        assert_eq!(page.items[0].kind, ResourceKind::Conversation);
        assert_eq!(
            page.items[0].operations,
            [ProviderOperation::Read, ProviderOperation::Export]
        );
    }

    #[tokio::test]
    async fn hermes_session_inspect_uses_remote_archive_state_and_locator_id() {
        let provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [serde_json::json!({
                "title":"Archived detail",
                "is_archived":true,
                "last_active":3
            })],
            [],
        )));

        let session = provider
            .inspect(ProviderInspect {
                source: source(),
                locator: "session/old".into(),
            })
            .await
            .unwrap();

        assert_eq!(session.provider_locator, "session/old");
        assert_eq!(
            session.open_target,
            Some(ResourceOpenTarget::HermesSession {
                session_id: "old".into(),
                read_only: true,
            })
        );
        assert_eq!(
            session.operations,
            [ProviderOperation::Read, ProviderOperation::Export]
        );
    }

    #[tokio::test]
    async fn hermes_session_version_normalizes_list_and_detail_payloads() {
        let provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [
                serde_json::json!({
                    "sessions":[{
                        "id":"same",
                        "title":"Stable",
                        "last_active":3,
                        "list_only":"ignored"
                    }],
                    "total":1
                }),
                serde_json::json!({
                    "id":"same",
                    "title":"Stable",
                    "lastActive":3.0,
                    "archived":false,
                    "detail_only":{"ignored":true}
                }),
                serde_json::json!({
                    "id":"same",
                    "title":"Changed",
                    "last_active":3,
                    "archived":false
                }),
                serde_json::json!({
                    "id":"same",
                    "title":"Stable",
                    "last_active":3,
                    "archived":true
                }),
                serde_json::json!({
                    "id":"same",
                    "title":"Stable",
                    "last_active":4,
                    "archived":false
                }),
            ],
            [serde_json::json!({"projects":[]})],
        )));

        let page = provider
            .browse(ProviderBrowse {
                source: source(),
                locator: String::new(),
                offset: 0,
                limit: usize::MAX,
            })
            .await
            .unwrap();
        let listed = page
            .items
            .iter()
            .find(|resource| resource.provider_locator == "session/same")
            .unwrap();
        let detailed = provider
            .inspect(ProviderInspect {
                source: source(),
                locator: "session/same".into(),
            })
            .await
            .unwrap();
        let renamed = provider
            .inspect(ProviderInspect {
                source: source(),
                locator: "session/same".into(),
            })
            .await
            .unwrap();
        let archived = provider
            .inspect(ProviderInspect {
                source: source(),
                locator: "session/same".into(),
            })
            .await
            .unwrap();
        let recently_active = provider
            .inspect(ProviderInspect {
                source: source(),
                locator: "session/same".into(),
            })
            .await
            .unwrap();

        assert_eq!(listed.version, detailed.version);
        assert_ne!(detailed.version, renamed.version);
        assert_ne!(detailed.version, archived.version);
        assert_ne!(detailed.version, recently_active.version);
    }

    #[tokio::test]
    async fn legacy_hermes_session_version_matches_typed_provider() {
        let list_payload = serde_json::json!({
            "sessions":[{
                "id":"same",
                "title":"Stable",
                "last_active":3,
                "transport_only":"ignored"
            }],
            "total":1
        });
        let typed_provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [list_payload.clone()],
            [serde_json::json!({"projects":[]})],
        )));
        let legacy_provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [list_payload],
            [serde_json::json!({"projects":[]})],
        )));

        let typed = typed_provider
            .browse(ProviderBrowse {
                source: source(),
                locator: String::new(),
                offset: 0,
                limit: usize::MAX,
            })
            .await
            .unwrap()
            .items
            .into_iter()
            .find(|resource| resource.provider_locator == "session/same")
            .unwrap();
        let legacy = legacy_provider
            .compatibility()
            .browse(String::new(), 0)
            .await
            .unwrap()
            .items
            .into_iter()
            .find(|resource| resource.provider_locator == "session/same")
            .unwrap();

        assert_eq!(legacy.version, typed.version);
    }

    #[tokio::test]
    async fn legacy_hermes_browse_keeps_virtual_directory_fields() {
        let provider = HermesProvider::new(Arc::new(FakeHermes::new(
            [serde_json::json!({
                "sessions":[{"id":"loose","title":"Loose"}],
                "total":1
            })],
            [serde_json::json!({"projects":[]})],
        )));

        let page = provider
            .compatibility()
            .browse(String::new(), 0)
            .await
            .unwrap();

        assert_eq!(
            page.legacy.virtual_directory.as_ref().unwrap()["kind"],
            "root"
        );
        assert!(
            page.legacy
                .virtual_entries
                .contains_key("Hermes Sessions/session/loose")
        );
        assert_eq!(page.items[0].legacy_locator, "Hermes Sessions/archived");
    }
}
