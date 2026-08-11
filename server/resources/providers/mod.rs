use super::types::{
    LegacyPageFields, LegacyResourceFields, ProviderOperation, ResourceAppearance, ResourceKind,
    ResourceOpenTarget, ResourcePresentation, ResourceVersion, SourceId,
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
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{path::Path, sync::Arc, time::UNIX_EPOCH};

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

impl FilesystemProvider {
    pub(crate) fn new(config: Config, thumbnails: Arc<Thumbnailer>) -> Self {
        Self { config, thumbnails }
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
        let source_config = self.source_config(root);
        let resolved = media::resolve(&source_config, &[], &provider_locator)?;
        let metadata = std::fs::metadata(&resolved.full).map_err(AppError::io)?;
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
                .map(|modified| self.thumbnails.cached(&resolved.full, modified))
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
            version: Some(filesystem_version(&resolved.full, &metadata)),
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
            platform_identity: platform_identity(&resolved.full, &metadata),
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
}

impl ReadProvider for FilesystemProvider {
    fn browse<'a>(&'a self, query: ProviderBrowse) -> BoxFuture<'a, AppResult<ProviderPage>> {
        Box::pin(async move {
            let ProviderSource::Filesystem { root, .. } = &query.source else {
                return Err(AppError::internal(
                    "Filesystem provider received non-filesystem Source",
                ));
            };
            let config = self.source_config(root);
            let mut files = media::list(&config, &[], &query.locator)?;
            files.retain(|file| file.is_virtual != Some(true));
            let total = files.len();
            let end = query.offset.saturating_add(query.limit).min(total);
            let page = if query.offset >= total {
                Vec::new()
            } else {
                files.drain(query.offset..end).collect::<Vec<_>>()
            };
            let items = page
                .into_iter()
                .map(|file| self.resource(&query.source, file))
                .collect::<AppResult<Vec<_>>>()?;
            Ok(ProviderPage {
                items,
                total,
                next_offset: (end < total).then_some(end),
                legacy: LegacyPageFields::default(),
            })
        })
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

    fn resource(&self, file: media::FileItem, entry: Option<Value>) -> AppResult<ProviderResource> {
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
        let version = entry_ref
            .and_then(|entry| entry.get("metadata"))
            .map(opaque_json_version);
        Ok(ProviderResource {
            name: file.name,
            provider_locator,
            legacy_locator,
            kind,
            presentation,
            mime_type: None,
            size: None,
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
}

impl ReadProvider for HermesProvider {
    fn browse<'a>(&'a self, query: ProviderBrowse) -> BoxFuture<'a, AppResult<ProviderPage>> {
        Box::pin(async move {
            if !matches!(query.source, ProviderSource::Hermes { .. }) {
                return Err(AppError::internal(
                    "Hermes provider received filesystem Source",
                ));
            }
            let path = if query.locator.is_empty() {
                virtual_directory::HERMES_ROOT.to_string()
            } else {
                format!("{}/{}", virtual_directory::HERMES_ROOT, query.locator)
            };
            let listing =
                virtual_directory::list_hermes_with(self.transport.as_ref(), &path, query.offset)
                    .await?;
            let items = listing
                .files
                .into_iter()
                .map(|file| {
                    let entry = listing.virtual_entries.get(&file.path).cloned();
                    self.resource(file, entry)
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
        })
    }

    fn inspect<'a>(&'a self, query: ProviderInspect) -> BoxFuture<'a, AppResult<ProviderResource>> {
        Box::pin(async move {
            let Some(id) = query.locator.strip_prefix("session/") else {
                return Err(AppError::not_found("Hermes Resource not found"));
            };
            if id.is_empty() || id.contains(['/', '\\']) {
                return Err(AppError::bad("Hermes Resource locator is invalid"));
            }
            let mut profile_query = Vec::new();
            if let Some(profile) = self.transport.profile() {
                profile_query.push(("profile", profile.into()));
            }
            let session = self
                .transport
                .get(&format!("api/sessions/{id}"), &profile_query)
                .await?;
            let title = session
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Untitled session")
                .to_string();
            self.resource(
                media::FileItem {
                    name: title,
                    path: format!("{}/session/{id}", virtual_directory::HERMES_ROOT),
                    media_type: "other".into(),
                    size: 0,
                    extension: String::new(),
                    is_directory: false,
                    is_virtual: Some(true),
                    view_count: None,
                    share_token: None,
                    thumbnail_generated: None,
                    version: None,
                    resource: None,
                },
                Some(serde_json::json!({
                    "provider":"hermes",
                    "kind":"session",
                    "id":id,
                    "capabilities":["open","download"],
                    "openTarget":{"type":"hermesSession","sessionId":id,"readOnly":false},
                    "metadata":session,
                    "appearance":{"icon":"agent-session","tone":"violet"}
                })),
            )
        })
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

fn filesystem_version(path: &Path, metadata: &std::fs::Metadata) -> ResourceVersion {
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let mut hash = Sha256::new();
    hash.update(modified.to_le_bytes());
    hash.update(metadata.len().to_le_bytes());
    hash.update([metadata.is_dir() as u8]);
    if let Some(identity) = platform_identity(path, metadata) {
        hash.update(identity.as_bytes());
    }
    ResourceVersion::new(format!("fs:v1:{}", digest_hex(hash.finalize())))
}

fn metadata_fingerprint(metadata: &std::fs::Metadata, is_directory: bool) -> String {
    let created = metadata
        .created()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!(
        "fs-meta:v1:{created}:{}:{}",
        metadata.len(),
        is_directory as u8
    )
}

#[cfg(windows)]
fn platform_identity(path: &Path, _metadata: &std::fs::Metadata) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let information = winapi_util::file::information(&file).ok()?;
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
