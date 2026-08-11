use super::{
    IdentityStore, LegacyPageFields, LegacyResourceFields, LibraryId, ObservedResourceIdentity,
    PageCursor, ProviderBrowse, ProviderInspect, ProviderOperation, ProviderPage, ProviderResource,
    ProviderSource, ReadProvider, ResourceAppearance, ResourceAvailability, ResourceDetail,
    ResourceId, ResourceKind, ResourceLocator, ResourcePage, ResourcePresentation, ResourceRef,
    ResourceSummary, ResourceVersion, SourceId, StoredResourceIdentity,
};
use crate::{
    config::{Config, MediaRoot},
    error::AppError,
    hermes::HermesTransport,
    media, shares, store,
    thumbnails::Thumbnailer,
};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{path::Path, sync::Arc};
use tokio::sync::RwLock;

const LIBRARY_ROOT_ID: &str = "resource-library-root";
const CATALOG_SOURCE_ID: &str = "source-catalog";
const HERMES_SOURCE_ID: &str = "source-hermes";
const HERMES_ROOT_ID: &str = "resource-source-hermes-root";
const FAVORITES_ID: &str = "resource-collection-favorites";
const MOST_PLAYED_ID: &str = "resource-collection-most-played";
const SHARES_ID: &str = "resource-collection-shares";
const DEFAULT_PAGE_SIZE: usize = 200;
const MAX_PAGE_SIZE: usize = 1_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReadSurface {
    Library,
    Workspace,
    Canvas,
    Share,
    Ssr,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum ReadScope {
    Owner,
    Grant { root: ResourceRef },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ReadContext {
    pub(crate) scope: ReadScope,
    pub(crate) surface: ReadSurface,
}

impl ReadContext {
    pub(crate) fn owner(surface: ReadSurface) -> Self {
        Self {
            scope: ReadScope::Owner,
            surface,
        }
    }

    pub(crate) fn grant(surface: ReadSurface, root: ResourceRef) -> Self {
        Self {
            scope: ReadScope::Grant { root },
            surface,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct BrowseQuery {
    pub(crate) parent: ResourceRef,
    pub(crate) cursor: Option<PageCursor>,
    pub(crate) limit: usize,
}

impl BrowseQuery {
    pub(crate) fn first(parent: ResourceRef) -> Self {
        Self {
            parent,
            cursor: None,
            limit: DEFAULT_PAGE_SIZE,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CatalogErrorCode {
    InvalidRequest,
    Forbidden,
    ResourceNotFound,
    ResourceMissing,
    SourceUnavailable,
    Unsupported,
    Internal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogError {
    pub(crate) code: CatalogErrorCode,
    pub(crate) message: String,
}

impl CatalogError {
    fn new(code: CatalogErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn into_app_error(self) -> AppError {
        match self.code {
            CatalogErrorCode::InvalidRequest => AppError::bad(self.message),
            CatalogErrorCode::Forbidden => AppError::forbidden(self.message),
            CatalogErrorCode::ResourceNotFound | CatalogErrorCode::ResourceMissing => {
                AppError::not_found(self.message)
            }
            CatalogErrorCode::SourceUnavailable => AppError::conflict(self.message),
            CatalogErrorCode::Unsupported => AppError::bad(self.message),
            CatalogErrorCode::Internal => AppError::internal(self.message),
        }
    }
}

impl From<AppError> for CatalogError {
    fn from(error: AppError) -> Self {
        let code = match error.0 {
            StatusCode::BAD_REQUEST => CatalogErrorCode::InvalidRequest,
            StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED => CatalogErrorCode::Forbidden,
            StatusCode::NOT_FOUND => CatalogErrorCode::ResourceNotFound,
            _ => CatalogErrorCode::Internal,
        };
        Self::new(code, error.1)
    }
}

pub(crate) type CatalogResult<T> = Result<T, CatalogError>;

pub(crate) struct ResourceCatalog {
    config: Config,
    runtime_roots: Arc<RwLock<Vec<MediaRoot>>>,
    identity: IdentityStore,
    filesystem: super::FilesystemProvider,
    hermes: Option<super::HermesProvider>,
}

impl ResourceCatalog {
    pub(crate) fn new(
        config: Config,
        runtime_roots: Arc<RwLock<Vec<MediaRoot>>>,
        identity: IdentityStore,
        thumbnails: Arc<Thumbnailer>,
        hermes: Option<Arc<dyn HermesTransport>>,
    ) -> Self {
        Self {
            filesystem: super::FilesystemProvider::new(config.clone(), thumbnails),
            hermes: hermes.map(super::HermesProvider::new),
            config,
            runtime_roots,
            identity,
        }
    }

    pub(crate) fn library_id(&self) -> &LibraryId {
        self.identity.library_id()
    }

    pub(crate) fn library_ref(&self) -> ResourceRef {
        self.reference(LIBRARY_ROOT_ID)
    }

    pub(crate) fn compatibility(&self) -> LegacyCatalogAdapter<'_> {
        LegacyCatalogAdapter { catalog: self }
    }

    pub(crate) async fn sync_runtime_sources(&self) -> CatalogResult<()> {
        let roots = self.runtime_roots.read().await;
        self.identity
            .sync_runtime_sources(&roots)
            .map_err(Into::into)
    }

    pub(crate) async fn record_move(
        &self,
        old_legacy_locator: &str,
        new_legacy_locator: &str,
    ) -> CatalogResult<()> {
        let roots = self.runtime_roots().await;
        let old =
            media::resolve(&self.config, &roots, old_legacy_locator).map_err(CatalogError::from)?;
        let new =
            media::resolve(&self.config, &roots, new_legacy_locator).map_err(CatalogError::from)?;
        let (source_id, _) = self
            .identity
            .source_for_root(&old.root.id, &old.root.path)
            .map_err(CatalogError::from)?;
        let (destination_source_id, _) = self
            .identity
            .source_for_root(&new.root.id, &new.root.path)
            .map_err(CatalogError::from)?;
        self.identity
            .relocate_to(
                &source_id,
                &old.relative,
                &destination_source_id,
                &new.relative,
                new_legacy_locator,
            )
            .map_err(Into::into)
    }

    pub(crate) async fn browse(
        &self,
        context: &ReadContext,
        query: BrowseQuery,
    ) -> CatalogResult<ResourcePage> {
        self.browse_internal(context, query, false).await
    }

    async fn browse_internal(
        &self,
        context: &ReadContext,
        query: BrowseQuery,
        compatibility_unbounded: bool,
    ) -> CatalogResult<ResourcePage> {
        self.require_library(&query.parent)?;
        self.require_scope(context, &query.parent).await?;
        let resource_id = query.parent.resource_id.as_str();
        if resource_id == LIBRARY_ROOT_ID {
            return self
                .browse_library(context, query, compatibility_unbounded)
                .await;
        }
        if collection_name(resource_id).is_some() {
            return self.browse_collection(query, compatibility_unbounded).await;
        }
        if resource_id == HERMES_ROOT_ID {
            if context.surface != ReadSurface::Workspace {
                return Err(CatalogError::new(
                    CatalogErrorCode::ResourceNotFound,
                    "Resource not found",
                ));
            }
            return self
                .browse_provider(
                    ProviderSource::Hermes {
                        source_id: SourceId::new(HERMES_SOURCE_ID),
                    },
                    String::new(),
                    self.hermes_source_summary(),
                    query,
                    compatibility_unbounded,
                )
                .await;
        }
        if let Some((source, summary)) = self.source_root(&query.parent.resource_id).await? {
            let source = source.ok_or_else(|| {
                CatalogError::new(
                    CatalogErrorCode::SourceUnavailable,
                    "Filesystem Source is unavailable",
                )
            })?;
            if summary.availability != ResourceAvailability::Present {
                return Err(CatalogError::new(
                    CatalogErrorCode::SourceUnavailable,
                    "Filesystem Source is unavailable",
                ));
            }
            return self
                .browse_provider(
                    source,
                    String::new(),
                    summary,
                    query,
                    compatibility_unbounded,
                )
                .await;
        }
        let stored = self
            .identity
            .stored(&query.parent.resource_id)
            .map_err(CatalogError::from)?
            .ok_or_else(|| {
                CatalogError::new(CatalogErrorCode::ResourceNotFound, "Resource not found")
            })?;
        if stored.kind != "folder"
            && stored.kind != "conversationProject"
            && stored.kind != "source"
        {
            return Err(CatalogError::new(
                CatalogErrorCode::Unsupported,
                "Resource is not browsable",
            ));
        }
        let source = self.provider_source(&stored.source_id).await?;
        let parent = self.inspect(context, &query.parent).await?.summary;
        self.browse_provider(
            source,
            stored.provider_locator,
            parent,
            query,
            compatibility_unbounded,
        )
        .await
    }

    pub(crate) async fn inspect(
        &self,
        context: &ReadContext,
        resource: &ResourceRef,
    ) -> CatalogResult<ResourceDetail> {
        self.require_library(resource)?;
        self.require_scope(context, resource).await?;
        if resource.resource_id.as_str() == LIBRARY_ROOT_ID {
            return Ok(detail(self.library_summary()));
        }
        if collection_name(resource.resource_id.as_str()).is_some() {
            return Ok(detail(
                self.collection_summary(resource.resource_id.as_str())?,
            ));
        }
        if resource.resource_id.as_str() == HERMES_ROOT_ID {
            if context.surface != ReadSurface::Workspace {
                return Err(CatalogError::new(
                    CatalogErrorCode::ResourceNotFound,
                    "Resource not found",
                ));
            }
            return Ok(detail(self.hermes_source_summary()));
        }
        if let Some((_, summary)) = self.source_root(&resource.resource_id).await? {
            return Ok(detail(summary));
        }
        let stored = self
            .identity
            .stored(&resource.resource_id)
            .map_err(CatalogError::from)?
            .ok_or_else(|| {
                CatalogError::new(CatalogErrorCode::ResourceNotFound, "Resource not found")
            })?;
        let source = match self.provider_source(&stored.source_id).await {
            Ok(source) => source,
            Err(error) if error.code == CatalogErrorCode::SourceUnavailable => {
                return Ok(detail(self.missing_summary(
                    &stored,
                    ResourceAvailability::SourceUnavailable,
                )));
            }
            Err(error) => return Err(error),
        };
        let provider = match self
            .provider_inspect(ProviderInspect {
                source: source.clone(),
                locator: stored.provider_locator.clone(),
            })
            .await
        {
            Ok(resource) => resource,
            Err(error) if error.code == CatalogErrorCode::ResourceNotFound => {
                self.identity
                    .mark_missing(&resource.resource_id)
                    .map_err(CatalogError::from)?;
                return Ok(detail(
                    self.missing_summary(&stored, ResourceAvailability::Missing),
                ));
            }
            Err(error) => return Err(error),
        };
        let mut summaries = self.observe(&source, vec![provider])?;
        let summary = summaries.remove(0);
        if summary.reference.resource_id != resource.resource_id {
            self.identity
                .mark_missing(&resource.resource_id)
                .map_err(CatalogError::from)?;
            return Ok(detail(
                self.missing_summary(&stored, ResourceAvailability::Missing),
            ));
        }
        Ok(detail(summary))
    }

    async fn browse_library(
        &self,
        context: &ReadContext,
        query: BrowseQuery,
        compatibility_unbounded: bool,
    ) -> CatalogResult<ResourcePage> {
        let roots = self.filesystem_sources().await?;
        let mut items = vec![
            self.collection_summary(FAVORITES_ID)?,
            self.collection_summary(MOST_PLAYED_ID)?,
            self.collection_summary(SHARES_ID)?,
        ];
        if roots.len() > 1 {
            items.extend(roots.iter().map(|(_, summary)| summary.clone()));
        } else if let Some((source, _)) = roots.first() {
            if !compatibility_unbounded {
                return self
                    .browse_single_root_library(context, source.clone(), query)
                    .await;
            }
            let page = self
                .provider_browse(ProviderBrowse {
                    source: source.clone(),
                    locator: String::new(),
                    offset: 0,
                    limit: usize::MAX,
                })
                .await?;
            items.extend(self.observe(source, page.items)?);
        }
        sort_legacy_items(&mut items);
        if context.surface == ReadSurface::Workspace && self.hermes.is_some() {
            items.push(self.hermes_source_summary());
        }
        Ok(self.paginate(
            self.library_summary(),
            items,
            &query,
            compatibility_unbounded,
        )?)
    }

    async fn browse_single_root_library(
        &self,
        context: &ReadContext,
        source: ProviderSource,
        query: BrowseQuery,
    ) -> CatalogResult<ResourcePage> {
        let offset = cursor_offset(query.cursor.as_ref())?;
        let limit = page_limit(query.limit);
        let collections = vec![
            self.collection_summary(FAVORITES_ID)?,
            self.collection_summary(MOST_PLAYED_ID)?,
            self.collection_summary(SHARES_ID)?,
        ];
        let collection_count = collections.len();
        let mut items = collections
            .into_iter()
            .skip(offset)
            .take(limit)
            .collect::<Vec<_>>();
        let filesystem_offset = offset.saturating_sub(collection_count);
        let filesystem_limit = limit.saturating_sub(items.len());
        let page = self
            .provider_browse(ProviderBrowse {
                source: source.clone(),
                locator: String::new(),
                offset: filesystem_offset,
                limit: filesystem_limit,
            })
            .await?;
        items.extend(self.observe(&source, page.items)?);
        let hermes_count =
            usize::from(context.surface == ReadSurface::Workspace && self.hermes.is_some());
        let total = collection_count + page.total + hermes_count;
        let hermes_index = collection_count + page.total;
        if hermes_count == 1
            && items.len() < limit
            && offset <= hermes_index
            && hermes_index < offset.saturating_add(limit)
        {
            items.push(self.hermes_source_summary());
        }
        let end = offset.saturating_add(limit).min(total);
        Ok(ResourcePage {
            schema_version: 1,
            parent: self.library_summary(),
            items,
            next_cursor: (end < total).then(|| cursor(end)),
            total: total as u64,
            legacy: LegacyPageFields::default(),
        })
    }

    async fn browse_collection(
        &self,
        query: BrowseQuery,
        compatibility_unbounded: bool,
    ) -> CatalogResult<ResourcePage> {
        let name = collection_name(query.parent.resource_id.as_str()).ok_or_else(|| {
            CatalogError::new(CatalogErrorCode::ResourceNotFound, "Collection not found")
        })?;
        let items = self.collection_items(name).await?;
        let parent = self.collection_summary(query.parent.resource_id.as_str())?;
        Ok(self.paginate(parent, items, &query, compatibility_unbounded)?)
    }

    async fn browse_provider(
        &self,
        source: ProviderSource,
        locator: String,
        parent: ResourceSummary,
        query: BrowseQuery,
        compatibility_unbounded: bool,
    ) -> CatalogResult<ResourcePage> {
        let offset = cursor_offset(query.cursor.as_ref())?;
        let limit = if compatibility_unbounded {
            query.limit.max(1)
        } else {
            page_limit(query.limit)
        };
        let page = self
            .provider_browse(ProviderBrowse {
                source: source.clone(),
                locator,
                offset,
                limit,
            })
            .await?;
        let items = self.observe(&source, page.items)?;
        Ok(ResourcePage {
            schema_version: 1,
            parent,
            items,
            next_cursor: page.next_offset.map(cursor),
            total: page.total as u64,
            legacy: page.legacy,
        })
    }

    async fn provider_browse(&self, query: ProviderBrowse) -> CatalogResult<ProviderPage> {
        match &query.source {
            ProviderSource::Filesystem { .. } => self.filesystem.browse(query).await,
            ProviderSource::Hermes { .. } => {
                self.hermes
                    .as_ref()
                    .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?
                    .browse(query)
                    .await
            }
        }
        .map_err(Into::into)
    }

    async fn provider_inspect(&self, query: ProviderInspect) -> CatalogResult<ProviderResource> {
        match &query.source {
            ProviderSource::Filesystem { .. } => self.filesystem.inspect(query).await,
            ProviderSource::Hermes { .. } => {
                self.hermes
                    .as_ref()
                    .ok_or_else(|| AppError::not_found("Hermes integration is disabled"))?
                    .inspect(query)
                    .await
            }
        }
        .map_err(Into::into)
    }

    fn observe(
        &self,
        source: &ProviderSource,
        resources: Vec<ProviderResource>,
    ) -> CatalogResult<Vec<ResourceSummary>> {
        let observed = resources
            .iter()
            .map(|resource| ObservedResourceIdentity {
                provider_locator: resource.provider_locator.clone(),
                legacy_locator: resource.legacy_locator.clone(),
                kind: kind_key(resource.kind).into(),
                platform_identity: resource.platform_identity.clone(),
                fingerprint: resource.fingerprint.clone(),
            })
            .collect::<Vec<_>>();
        let ids = self
            .identity
            .observe(source.source_id(), &observed)
            .map_err(CatalogError::from)?;
        Ok(resources
            .into_iter()
            .zip(ids)
            .map(|(resource, resource_id)| ResourceSummary {
                reference: ResourceRef {
                    library_id: self.identity.library_id().clone(),
                    resource_id,
                },
                locator: ResourceLocator {
                    source_id: source.source_id().clone(),
                    provider_locator: resource.provider_locator,
                },
                legacy_locator: Some(resource.legacy_locator),
                version: resource.version,
                name: resource.name,
                kind: resource.kind,
                presentation: resource.presentation,
                mime_type: resource.mime_type,
                size: resource.size,
                preview: resource.preview,
                provider_operations: resource.operations,
                availability: ResourceAvailability::Present,
                appearance: resource.appearance,
                open_target: resource.open_target,
                legacy: resource.legacy,
            })
            .collect())
    }

    async fn collection_items(&self, name: &str) -> CatalogResult<Vec<ResourceSummary>> {
        let roots = self.runtime_roots().await;
        let paths = if name == "Shares" {
            let mut values = shares::read(&self.config, &roots);
            values.sort_by_key(|item| std::cmp::Reverse(item.created_at));
            let mut seen = std::collections::HashSet::new();
            values
                .into_iter()
                .filter(|share| seen.insert(share.path.replace('\\', "/")))
                .map(|share| (share.path, None, Some(share.token)))
                .collect::<Vec<_>>()
        } else if name == "Favorites" {
            store::section(
                &self.config.data_path.join("settings.json"),
                &self.config.library_key,
                json!({"viewModes":{},"favorites":[]}),
            )["favorites"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(|path| (path.into(), None, None)))
                .collect()
        } else {
            let section = store::section(
                &self.config.data_path.join("stats.json"),
                &self.config.library_key,
                json!({"views":{}}),
            );
            let mut values = section["views"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(path, value)| (path.clone(), value.as_u64(), None))
                .collect::<Vec<_>>();
            values.sort_by_key(|item| std::cmp::Reverse(item.1));
            values.truncate(50);
            values
        };
        let mut result = Vec::new();
        for (legacy_locator, view_count, share_token) in paths {
            let Ok(source) = self.filesystem_source_for_path(&roots, &legacy_locator) else {
                continue;
            };
            let Ok(resolved) = media::resolve(&self.config, &roots, &legacy_locator) else {
                continue;
            };
            let Ok(mut resource) = self
                .provider_inspect(ProviderInspect {
                    source: source.clone(),
                    locator: resolved.relative,
                })
                .await
            else {
                continue;
            };
            if name == "Most Played" && resource.kind == ResourceKind::Folder {
                continue;
            }
            resource.legacy.view_count = view_count;
            resource.legacy.share_token = share_token;
            result.extend(self.observe(&source, vec![resource])?);
        }
        Ok(result)
    }

    async fn filesystem_sources(&self) -> CatalogResult<Vec<(ProviderSource, ResourceSummary)>> {
        let roots = self.all_roots().await;
        let multiple = roots.len() > 1;
        roots
            .into_iter()
            .map(|root| {
                let (source_id, resource_id) = self
                    .identity
                    .source_for_root(&root.id, &root.path)
                    .map_err(CatalogError::from)?;
                let source = ProviderSource::Filesystem {
                    source_id: source_id.clone(),
                    root: root.clone(),
                    legacy_root_prefix: multiple,
                };
                let summary =
                    self.filesystem_source_summary(source_id, resource_id, &root, multiple);
                Ok((source, summary))
            })
            .collect()
    }

    async fn source_root(
        &self,
        resource_id: &ResourceId,
    ) -> CatalogResult<Option<(Option<ProviderSource>, ResourceSummary)>> {
        let current = self
            .filesystem_sources()
            .await?
            .into_iter()
            .find(|(_, summary)| summary.reference.resource_id == *resource_id);
        if let Some((source, summary)) = current {
            return Ok(Some((Some(source), summary)));
        }
        let Some(stored) = self
            .identity
            .source_by_root_resource(resource_id)
            .map_err(CatalogError::from)?
        else {
            return Ok(None);
        };
        Ok(Some((
            None,
            ResourceSummary {
                reference: ResourceRef {
                    library_id: self.identity.library_id().clone(),
                    resource_id: stored.root_resource_id,
                },
                locator: ResourceLocator {
                    source_id: stored.source_id,
                    provider_locator: String::new(),
                },
                legacy_locator: Some(stored.display_name.clone()),
                version: None,
                name: stored.display_name,
                kind: ResourceKind::Source,
                presentation: ResourcePresentation::Browse,
                mime_type: None,
                size: None,
                preview: None,
                provider_operations: Vec::new(),
                availability: ResourceAvailability::SourceUnavailable,
                appearance: None,
                open_target: None,
                legacy: LegacyResourceFields::default(),
            },
        )))
    }

    async fn provider_source(&self, source_id: &SourceId) -> CatalogResult<ProviderSource> {
        if source_id.as_str() == HERMES_SOURCE_ID {
            if self.hermes.is_none() {
                return Err(CatalogError::new(
                    CatalogErrorCode::SourceUnavailable,
                    "Hermes Source is unavailable",
                ));
            }
            return Ok(ProviderSource::Hermes {
                source_id: source_id.clone(),
            });
        }
        self.filesystem_sources()
            .await?
            .into_iter()
            .find(|(source, _)| source.source_id() == source_id)
            .map(|(source, _)| source)
            .ok_or_else(|| {
                CatalogError::new(
                    CatalogErrorCode::SourceUnavailable,
                    "Filesystem Source is unavailable",
                )
            })
    }

    fn filesystem_source_for_path(
        &self,
        roots: &[MediaRoot],
        path: &str,
    ) -> CatalogResult<ProviderSource> {
        let resolved = media::resolve(&self.config, roots, path).map_err(CatalogError::from)?;
        let (source_id, _) = self
            .identity
            .source_for_root(&resolved.root.id, &resolved.root.path)
            .map_err(CatalogError::from)?;
        Ok(ProviderSource::Filesystem {
            source_id,
            root: resolved.root,
            legacy_root_prefix: self.config.roots.len() + roots.len() > 1,
        })
    }

    async fn all_roots(&self) -> Vec<MediaRoot> {
        let mut roots = self.config.roots.clone();
        roots.extend(self.runtime_roots.read().await.iter().cloned());
        roots
    }

    async fn runtime_roots(&self) -> Vec<MediaRoot> {
        self.runtime_roots.read().await.clone()
    }

    fn paginate(
        &self,
        parent: ResourceSummary,
        items: Vec<ResourceSummary>,
        query: &BrowseQuery,
        compatibility_unbounded: bool,
    ) -> CatalogResult<ResourcePage> {
        let offset = cursor_offset(query.cursor.as_ref())?;
        let limit = if compatibility_unbounded {
            query.limit.max(1)
        } else {
            page_limit(query.limit)
        };
        let total = items.len();
        let end = offset.saturating_add(limit).min(total);
        let items = if offset >= total {
            Vec::new()
        } else {
            items[offset..end].to_vec()
        };
        Ok(ResourcePage {
            schema_version: 1,
            parent,
            items,
            next_cursor: (end < total).then(|| cursor(end)),
            total: total as u64,
            legacy: LegacyPageFields::default(),
        })
    }

    fn reference(&self, resource_id: &str) -> ResourceRef {
        ResourceRef {
            library_id: self.identity.library_id().clone(),
            resource_id: ResourceId::new(resource_id),
        }
    }

    fn library_summary(&self) -> ResourceSummary {
        ResourceSummary {
            reference: self.library_ref(),
            locator: ResourceLocator {
                source_id: SourceId::new(CATALOG_SOURCE_ID),
                provider_locator: String::new(),
            },
            legacy_locator: Some(String::new()),
            version: Some(ResourceVersion::new("catalog:v1")),
            name: "Library".into(),
            kind: ResourceKind::Library,
            presentation: ResourcePresentation::Browse,
            mime_type: None,
            size: None,
            preview: None,
            provider_operations: vec![ProviderOperation::Browse],
            availability: ResourceAvailability::Present,
            appearance: None,
            open_target: None,
            legacy: LegacyResourceFields::default(),
        }
    }

    fn collection_summary(&self, resource_id: &str) -> CatalogResult<ResourceSummary> {
        let name = collection_name(resource_id).ok_or_else(|| {
            CatalogError::new(CatalogErrorCode::ResourceNotFound, "Collection not found")
        })?;
        Ok(ResourceSummary {
            reference: self.reference(resource_id),
            locator: ResourceLocator {
                source_id: SourceId::new(CATALOG_SOURCE_ID),
                provider_locator: format!(
                    "collection/{}",
                    name.to_ascii_lowercase().replace(' ', "-")
                ),
            },
            legacy_locator: Some(name.into()),
            version: Some(ResourceVersion::new("catalog:v1")),
            name: name.into(),
            kind: ResourceKind::Collection,
            presentation: ResourcePresentation::Browse,
            mime_type: None,
            size: None,
            preview: None,
            provider_operations: vec![ProviderOperation::Browse],
            availability: ResourceAvailability::Present,
            appearance: None,
            open_target: None,
            legacy: LegacyResourceFields {
                is_virtual: Some(true),
                ..LegacyResourceFields::default()
            },
        })
    }

    fn filesystem_source_summary(
        &self,
        source_id: SourceId,
        resource_id: ResourceId,
        root: &MediaRoot,
        multiple: bool,
    ) -> ResourceSummary {
        ResourceSummary {
            reference: ResourceRef {
                library_id: self.identity.library_id().clone(),
                resource_id,
            },
            locator: ResourceLocator {
                source_id,
                provider_locator: String::new(),
            },
            legacy_locator: Some(if multiple {
                root.name.clone()
            } else {
                String::new()
            }),
            version: None,
            name: root.name.clone(),
            kind: ResourceKind::Source,
            presentation: ResourcePresentation::Browse,
            mime_type: None,
            size: None,
            preview: None,
            provider_operations: vec![ProviderOperation::Browse, ProviderOperation::Download],
            availability: if root.path.is_dir() {
                ResourceAvailability::Present
            } else {
                ResourceAvailability::SourceUnavailable
            },
            appearance: None,
            open_target: None,
            legacy: LegacyResourceFields::default(),
        }
    }

    fn hermes_source_summary(&self) -> ResourceSummary {
        ResourceSummary {
            reference: self.reference(HERMES_ROOT_ID),
            locator: ResourceLocator {
                source_id: SourceId::new(HERMES_SOURCE_ID),
                provider_locator: String::new(),
            },
            legacy_locator: Some(crate::virtual_directory::HERMES_ROOT.into()),
            version: None,
            name: crate::virtual_directory::HERMES_ROOT.into(),
            kind: ResourceKind::Source,
            presentation: ResourcePresentation::Browse,
            mime_type: None,
            size: None,
            preview: None,
            provider_operations: vec![ProviderOperation::Browse],
            availability: if self.hermes.is_some() {
                ResourceAvailability::Present
            } else {
                ResourceAvailability::SourceUnavailable
            },
            appearance: Some(ResourceAppearance {
                icon: "agent-directory".into(),
                tone: "violet".into(),
                color: None,
            }),
            open_target: None,
            legacy: LegacyResourceFields {
                is_virtual: Some(true),
                ..LegacyResourceFields::default()
            },
        }
    }

    fn missing_summary(
        &self,
        stored: &StoredResourceIdentity,
        availability: ResourceAvailability,
    ) -> ResourceSummary {
        let kind = parse_kind(&stored.kind);
        let name = stored
            .legacy_locator
            .as_deref()
            .unwrap_or(&stored.provider_locator)
            .replace('\\', "/")
            .rsplit('/')
            .next()
            .unwrap_or("Missing Resource")
            .to_string();
        ResourceSummary {
            reference: ResourceRef {
                library_id: self.identity.library_id().clone(),
                resource_id: stored.resource_id.clone(),
            },
            locator: ResourceLocator {
                source_id: stored.source_id.clone(),
                provider_locator: stored.provider_locator.clone(),
            },
            legacy_locator: stored.legacy_locator.clone(),
            version: None,
            name,
            kind,
            presentation: if matches!(kind, ResourceKind::Folder | ResourceKind::Source) {
                ResourcePresentation::Browse
            } else {
                ResourcePresentation::Unsupported
            },
            mime_type: None,
            size: None,
            preview: None,
            provider_operations: Vec::new(),
            availability,
            appearance: None,
            open_target: None,
            legacy: LegacyResourceFields::default(),
        }
    }

    fn require_library(&self, resource: &ResourceRef) -> CatalogResult<()> {
        if resource.library_id != *self.identity.library_id() {
            return Err(CatalogError::new(
                CatalogErrorCode::ResourceNotFound,
                "Resource not found",
            ));
        }
        Ok(())
    }

    async fn require_scope(
        &self,
        context: &ReadContext,
        resource: &ResourceRef,
    ) -> CatalogResult<()> {
        let ReadScope::Grant { root } = &context.scope else {
            return Ok(());
        };
        if root == resource {
            return Ok(());
        }
        let root_path = self.legacy_locator(root).await?;
        let resource_path = self.legacy_locator(resource).await?;
        if path_within(&resource_path, &root_path) {
            return Ok(());
        }
        Err(CatalogError::new(
            CatalogErrorCode::Forbidden,
            "Resource is outside Grant scope",
        ))
    }

    async fn legacy_locator(&self, resource: &ResourceRef) -> CatalogResult<String> {
        if resource.resource_id.as_str() == LIBRARY_ROOT_ID {
            return Ok(String::new());
        }
        if let Some(name) = collection_name(resource.resource_id.as_str()) {
            return Ok(name.into());
        }
        if resource.resource_id.as_str() == HERMES_ROOT_ID {
            return Ok(crate::virtual_directory::HERMES_ROOT.into());
        }
        if let Some((_, summary)) = self.source_root(&resource.resource_id).await? {
            return Ok(summary.legacy_locator.unwrap_or_default());
        }
        self.identity
            .stored(&resource.resource_id)
            .map_err(CatalogError::from)?
            .and_then(|stored| stored.legacy_locator)
            .ok_or_else(|| {
                CatalogError::new(CatalogErrorCode::ResourceNotFound, "Resource not found")
            })
    }
}

pub(crate) struct LegacyCatalogAdapter<'a> {
    catalog: &'a ResourceCatalog,
}

impl LegacyCatalogAdapter<'_> {
    pub(crate) async fn resolve(
        &self,
        path: &str,
        surface: ReadSurface,
    ) -> CatalogResult<ResourceSummary> {
        let normalized = path.replace('\\', "/").trim_matches('/').to_string();
        if normalized.is_empty() {
            return Ok(self.catalog.library_summary());
        }
        if let Some(resource_id) = collection_id(&normalized) {
            return self.catalog.collection_summary(resource_id);
        }
        if normalized == crate::virtual_directory::HERMES_ROOT {
            if surface != ReadSurface::Workspace || self.catalog.hermes.is_none() {
                return Err(CatalogError::new(
                    CatalogErrorCode::ResourceNotFound,
                    "Resource not found",
                ));
            }
            return Ok(self.catalog.hermes_source_summary());
        }
        if let Some(locator) =
            normalized.strip_prefix(&format!("{}/", crate::virtual_directory::HERMES_ROOT))
        {
            if surface != ReadSurface::Workspace {
                return Err(CatalogError::new(
                    CatalogErrorCode::ResourceNotFound,
                    "Resource not found",
                ));
            }
            let source = ProviderSource::Hermes {
                source_id: SourceId::new(HERMES_SOURCE_ID),
            };
            let resource = self
                .catalog
                .provider_inspect(ProviderInspect {
                    source: source.clone(),
                    locator: locator.into(),
                })
                .await?;
            return self
                .catalog
                .observe(&source, vec![resource])?
                .into_iter()
                .next()
                .ok_or_else(|| {
                    CatalogError::new(CatalogErrorCode::ResourceNotFound, "Resource not found")
                });
        }
        let roots = self.catalog.runtime_roots().await;
        let resolved = media::resolve(&self.catalog.config, &roots, &normalized)
            .map_err(CatalogError::from)?;
        let (source_id, resource_id) = self
            .catalog
            .identity
            .source_for_root(&resolved.root.id, &resolved.root.path)
            .map_err(CatalogError::from)?;
        let multiple = roots.len() + self.catalog.config.roots.len() > 1;
        let source = ProviderSource::Filesystem {
            source_id: source_id.clone(),
            root: resolved.root.clone(),
            legacy_root_prefix: multiple,
        };
        if resolved.relative.is_empty() {
            return Ok(self.catalog.filesystem_source_summary(
                source_id,
                resource_id,
                &resolved.root,
                multiple,
            ));
        }
        let resource = self
            .catalog
            .provider_inspect(ProviderInspect {
                source: source.clone(),
                locator: resolved.relative,
            })
            .await?;
        self.catalog
            .observe(&source, vec![resource])?
            .into_iter()
            .next()
            .ok_or_else(|| {
                CatalogError::new(CatalogErrorCode::ResourceNotFound, "Resource not found")
            })
    }

    pub(crate) async fn browse(
        &self,
        context: &ReadContext,
        path: &str,
        cursor: Option<PageCursor>,
        limit: usize,
    ) -> CatalogResult<ResourcePage> {
        let parent = self.resolve(path, context.surface).await?;
        self.catalog
            .browse(
                context,
                BrowseQuery {
                    parent: parent.reference,
                    cursor,
                    limit,
                },
            )
            .await
    }

    pub(crate) async fn browse_compatibility(
        &self,
        context: &ReadContext,
        path: &str,
        cursor: Option<PageCursor>,
        limit: usize,
    ) -> CatalogResult<ResourcePage> {
        let parent = self.resolve(path, context.surface).await?;
        self.catalog
            .browse_internal(
                context,
                BrowseQuery {
                    parent: parent.reference,
                    cursor,
                    limit,
                },
                true,
            )
            .await
    }

    pub(crate) async fn inspect(
        &self,
        context: &ReadContext,
        path: &str,
    ) -> CatalogResult<ResourceDetail> {
        let resource = self.resolve(path, context.surface).await?;
        self.catalog.inspect(context, &resource.reference).await
    }
}

fn cursor(offset: usize) -> PageCursor {
    PageCursor::new(format!("offset:{offset}"))
}

fn cursor_offset(cursor: Option<&PageCursor>) -> CatalogResult<usize> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    cursor
        .as_str()
        .strip_prefix("offset:")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| {
            CatalogError::new(CatalogErrorCode::InvalidRequest, "Page cursor is invalid")
        })
}

fn page_limit(limit: usize) -> usize {
    limit.clamp(1, MAX_PAGE_SIZE)
}

fn detail(summary: ResourceSummary) -> ResourceDetail {
    ResourceDetail {
        schema_version: 1,
        summary,
    }
}

fn collection_name(resource_id: &str) -> Option<&'static str> {
    match resource_id {
        FAVORITES_ID => Some("Favorites"),
        MOST_PLAYED_ID => Some("Most Played"),
        SHARES_ID => Some("Shares"),
        _ => None,
    }
}

fn collection_id(name: &str) -> Option<&'static str> {
    match name {
        "Favorites" => Some(FAVORITES_ID),
        "Most Played" => Some(MOST_PLAYED_ID),
        "Shares" => Some(SHARES_ID),
        _ => None,
    }
}

fn kind_key(kind: ResourceKind) -> &'static str {
    match kind {
        ResourceKind::Library => "library",
        ResourceKind::Source => "source",
        ResourceKind::Folder => "folder",
        ResourceKind::Collection => "collection",
        ResourceKind::File => "file",
        ResourceKind::Conversation => "conversation",
        ResourceKind::ConversationProject => "conversationProject",
        ResourceKind::Draft => "draft",
    }
}

fn parse_kind(kind: &str) -> ResourceKind {
    match kind {
        "library" => ResourceKind::Library,
        "source" => ResourceKind::Source,
        "folder" => ResourceKind::Folder,
        "collection" => ResourceKind::Collection,
        "conversation" => ResourceKind::Conversation,
        "conversationProject" => ResourceKind::ConversationProject,
        "draft" => ResourceKind::Draft,
        _ => ResourceKind::File,
    }
}

fn sort_legacy_items(items: &mut [ResourceSummary]) {
    items.sort_by(|left, right| {
        right
            .legacy
            .is_virtual
            .unwrap_or(false)
            .cmp(&left.legacy.is_virtual.unwrap_or(false))
            .then_with(|| browsable(right).cmp(&browsable(left)))
            .then_with(|| natord::compare_ignore_case(&left.name, &right.name))
    });
}

fn browsable(resource: &ResourceSummary) -> bool {
    matches!(
        resource.kind,
        ResourceKind::Library
            | ResourceKind::Source
            | ResourceKind::Folder
            | ResourceKind::Collection
    )
}

fn path_within(candidate: &str, root: &str) -> bool {
    let candidate = candidate.replace('\\', "/").trim_matches('/').to_string();
    let root = root.replace('\\', "/").trim_matches('/').to_string();
    if cfg!(windows) {
        let candidate = candidate.to_ascii_lowercase();
        let root = root.to_ascii_lowercase();
        candidate == root || candidate.starts_with(&format!("{root}/"))
    } else {
        candidate == root || candidate.starts_with(&format!("{root}/"))
    }
}

pub(crate) fn summary_to_legacy_file(summary: ResourceSummary) -> media::FileItem {
    let path = summary
        .legacy_locator
        .clone()
        .unwrap_or_else(|| summary.locator.provider_locator.clone());
    let is_directory = browsable(&summary);
    let extension = if is_directory {
        String::new()
    } else {
        media::extension(Path::new(&summary.name))
    };
    media::FileItem {
        name: summary.name.clone(),
        path,
        media_type: if is_directory {
            "folder".into()
        } else {
            match summary.presentation {
                ResourcePresentation::Video => "video",
                ResourcePresentation::Audio => "audio",
                ResourcePresentation::Image => "image",
                ResourcePresentation::Text => "text",
                ResourcePresentation::Pdf => "pdf",
                ResourcePresentation::Book => "book",
                _ => "other",
            }
            .into()
        },
        size: summary.size.unwrap_or_default(),
        extension,
        is_directory,
        is_virtual: summary.legacy.is_virtual,
        view_count: summary.legacy.view_count,
        share_token: summary.legacy.share_token.clone(),
        thumbnail_generated: summary.legacy.thumbnail_generated,
        version: summary.legacy.numeric_version(),
        resource: Some(summary),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_error_matches_shared_golden_fixture() {
        let raw = include_str!("../../tests/fixtures/catalog-error-contract.json");
        let expected: serde_json::Value = serde_json::from_str(raw).unwrap();
        let error: CatalogError = serde_json::from_value(expected.clone()).unwrap();
        assert_eq!(error.code, CatalogErrorCode::SourceUnavailable);
        assert_eq!(serde_json::to_value(error).unwrap(), expected);
    }
    use crate::{
        config::{AuthConfig, FileSearchConfig, ImageOptimizationConfig},
        error::AppResult,
        resources::ResourceOpenTarget,
        state_db,
    };
    use futures_util::future::BoxFuture;
    use serde_json::Value;
    use std::{
        collections::VecDeque,
        path::PathBuf,
        sync::Mutex,
        time::{Duration, Instant},
    };

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

    fn fixture(name: &str) -> (PathBuf, Config, IdentityStore) {
        let base =
            std::env::temp_dir().join(format!("derp-catalog-{name}-{}", uuid::Uuid::new_v4()));
        let media = base.join("media");
        std::fs::create_dir_all(&media).unwrap();
        let mut config = Config {
            port: 3000,
            roots: vec![root("config:primary", "Media", media.clone())],
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
        state_db::initialize(&config).unwrap();
        let identity = super::super::initialize_identity(&mut config).unwrap();
        (base, config, identity)
    }

    fn catalog(
        config: Config,
        identity: IdentityStore,
        hermes: Option<Arc<dyn HermesTransport>>,
    ) -> ResourceCatalog {
        let thumbnails = Arc::new(Thumbnailer::new(config.data_path.join("thumbnails")));
        ResourceCatalog::new(
            config,
            Arc::new(RwLock::new(Vec::new())),
            identity,
            thumbnails,
            hermes,
        )
    }

    #[test]
    fn cursor_is_opaque_and_rejects_legacy_offsets() {
        assert_eq!(
            cursor_offset(Some(&PageCursor::new("offset:42"))).unwrap(),
            42
        );
        assert!(cursor_offset(Some(&PageCursor::new("42"))).is_err());
    }

    #[test]
    fn grant_boundary_is_segment_aware() {
        assert!(path_within("Shared/folder/file.mp4", "Shared/folder"));
        assert!(!path_within(
            "Shared/folder-other/file.mp4",
            "Shared/folder"
        ));
    }

    #[tokio::test]
    async fn filesystem_provider_matches_legacy_listing_and_keeps_identity_through_moves() {
        let (base, config, identity) = fixture("filesystem");
        let media = config.roots[0].path.clone();
        std::fs::write(media.join("clip.mp4"), b"first").unwrap();
        std::fs::create_dir(media.join("Folder")).unwrap();
        std::fs::write(media.join("Folder").join("note.txt"), b"note").unwrap();
        std::fs::create_dir(media.join("node_modules")).unwrap();
        std::fs::write(media.join("node_modules").join("hidden.js"), b"hidden").unwrap();

        let legacy = media::list(&config, &[], "").unwrap();
        let catalog = catalog(config.clone(), identity, None);
        let context = ReadContext::owner(ReadSurface::Library);
        let first = catalog
            .browse(&context, BrowseQuery::first(catalog.library_ref()))
            .await
            .unwrap();
        let mut projected = first
            .items
            .iter()
            .cloned()
            .map(summary_to_legacy_file)
            .collect::<Vec<_>>();
        for item in &mut projected {
            item.resource = None;
        }
        assert_eq!(
            serde_json::to_value(projected).unwrap(),
            serde_json::to_value(legacy).unwrap()
        );
        assert!(
            first
                .items
                .iter()
                .filter(|item| item.locator.source_id.as_str() != CATALOG_SOURCE_ID)
                .all(|item| {
                    item.version.is_none()
                        || item
                            .version
                            .as_ref()
                            .is_some_and(|version| version.as_str().contains(":v1:"))
                })
        );
        assert!(!first.items.iter().any(|item| item.name == "node_modules"));

        let clip = first
            .items
            .iter()
            .find(|item| item.name == "clip.mp4")
            .unwrap()
            .clone();
        assert_eq!(
            clip.provider_operations,
            [
                ProviderOperation::Read,
                ProviderOperation::Stream,
                ProviderOperation::Download
            ]
        );
        let original_version = clip.version.clone();
        std::fs::write(media.join("clip.mp4"), b"second-longer").unwrap();
        let changed = catalog.inspect(&context, &clip.reference).await.unwrap();
        assert_ne!(changed.summary.version, original_version);

        std::fs::rename(media.join("clip.mp4"), media.join("renamed.mp4")).unwrap();
        catalog
            .record_move("clip.mp4", "renamed.mp4")
            .await
            .unwrap();
        let moved = catalog.inspect(&context, &clip.reference).await.unwrap();
        assert_eq!(moved.summary.reference, clip.reference);
        assert_eq!(moved.summary.legacy_locator.as_deref(), Some("renamed.mp4"));

        std::fs::rename(media.join("renamed.mp4"), media.join("external.mp4")).unwrap();
        let reconciled = catalog
            .browse(&context, BrowseQuery::first(catalog.library_ref()))
            .await
            .unwrap();
        let external = reconciled
            .items
            .iter()
            .find(|item| item.name == "external.mp4")
            .unwrap();
        assert_eq!(external.reference, clip.reference);

        std::fs::remove_file(media.join("external.mp4")).unwrap();
        let missing = catalog.inspect(&context, &clip.reference).await.unwrap();
        assert_eq!(missing.summary.availability, ResourceAvailability::Missing);
        assert!(missing.summary.provider_operations.is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[tokio::test]
    async fn cold_large_upgrade_pages_identity_backfill_within_stage1_browse_budget() {
        const FIXTURE_ENTRIES: usize = 1_000;
        const FIRST_PAGE_SIZE: usize = 32;
        const STAGE1_BROWSE_BUDGET: Duration = Duration::from_millis(100);

        let (base, config, identity) = fixture("cold-large-upgrade");
        let media = config.roots[0].path.clone();
        for index in 0..FIXTURE_ENTRIES {
            std::fs::write(
                media.join(format!("item-{index:04}.txt")),
                index.to_string(),
            )
            .unwrap();
        }
        let database = identity.database().to_path_buf();
        let catalog = catalog(config, identity, None);
        let context = ReadContext::owner(ReadSurface::Library);

        let listing_started = Instant::now();
        let first = catalog
            .browse(
                &context,
                BrowseQuery {
                    parent: catalog.library_ref(),
                    cursor: None,
                    limit: FIRST_PAGE_SIZE,
                },
            )
            .await
            .unwrap();
        let listing_elapsed = listing_started.elapsed();
        assert_eq!(first.items.len(), FIRST_PAGE_SIZE);
        assert_eq!(first.total, (FIXTURE_ENTRIES + 3) as u64);
        assert!(first.next_cursor.is_some());
        assert!(
            listing_elapsed <= STAGE1_BROWSE_BUDGET,
            "cold first listing took {listing_elapsed:?}, budget {STAGE1_BROWSE_BUDGET:?}"
        );

        let observed_after_page: i64 = state_db::connection(&database)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM resources", [], |row| row.get(0))
            .unwrap();
        assert_eq!(observed_after_page, (FIRST_PAGE_SIZE - 3) as i64);

        let file = first
            .items
            .iter()
            .find(|item| item.kind == ResourceKind::File)
            .unwrap();
        let open_started = Instant::now();
        let detail = catalog.inspect(&context, &file.reference).await.unwrap();
        let open_elapsed = open_started.elapsed();
        assert_eq!(detail.summary.reference, file.reference);
        assert!(
            open_elapsed <= STAGE1_BROWSE_BUDGET,
            "first media inspect took {open_elapsed:?}, budget {STAGE1_BROWSE_BUDGET:?}"
        );
        let observed_after_open: i64 = state_db::connection(&database)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM resources", [], |row| row.get(0))
            .unwrap();
        assert_eq!(observed_after_open, observed_after_page);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[tokio::test]
    async fn retained_source_root_inspects_as_unavailable_after_configuration_removal() {
        let (base, config, identity) = fixture("missing-source-root");
        let (_, root_resource_id) = identity
            .source_for_root(&config.roots[0].id, &config.roots[0].path)
            .unwrap();
        let mut removed = config.clone();
        removed.roots.clear();
        let catalog = catalog(removed, identity, None);
        let reference = ResourceRef {
            library_id: catalog.identity.library_id().clone(),
            resource_id: root_resource_id,
        };
        let detail = catalog
            .inspect(&ReadContext::owner(ReadSurface::Library), &reference)
            .await
            .unwrap();
        assert_eq!(
            detail.summary.availability,
            ResourceAvailability::SourceUnavailable
        );
        assert!(detail.summary.provider_operations.is_empty());
        let error = catalog
            .browse(
                &ReadContext::owner(ReadSurface::Library),
                BrowseQuery::first(reference),
            )
            .await
            .unwrap_err();
        assert_eq!(error.code, CatalogErrorCode::SourceUnavailable);
        std::fs::remove_dir_all(base).unwrap();
    }

    struct FakeHermes {
        gets: Mutex<VecDeque<Value>>,
        rpcs: Mutex<VecDeque<Value>>,
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
                    .ok_or_else(|| AppError::internal("fake exhausted"))
            })
        }

        fn patch<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async { Err(AppError::internal("unexpected patch")) })
        }

        fn post<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
            Box::pin(async { Err(AppError::internal("unexpected post")) })
        }

        fn delete<'a>(&'a self, _path: &'a str) -> BoxFuture<'a, AppResult<()>> {
            Box::pin(async { Err(AppError::internal("unexpected delete")) })
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
                    .ok_or_else(|| AppError::internal("unexpected rpc"))
            })
        }
    }

    #[tokio::test]
    async fn hermes_provider_conforms_without_exposing_fake_identity_paths() {
        let (base, config, identity) = fixture("hermes");
        let hermes = Arc::new(FakeHermes {
            gets: Mutex::new(VecDeque::from([json!({
                "sessions":[{"id":"session-1","title":"One","last_active":1}],
                "total":1
            })])),
            rpcs: Mutex::new(VecDeque::from([json!({"projects":[]})])),
        });
        let catalog = catalog(config, identity, Some(hermes));
        let context = ReadContext::owner(ReadSurface::Workspace);
        let root = catalog
            .browse(&context, BrowseQuery::first(catalog.library_ref()))
            .await
            .unwrap();
        let source = root
            .items
            .iter()
            .find(|item| item.locator.source_id.as_str() == HERMES_SOURCE_ID)
            .unwrap();
        let listing = catalog
            .browse(&context, BrowseQuery::first(source.reference.clone()))
            .await
            .unwrap();
        let session = listing
            .items
            .iter()
            .find(|item| item.kind == ResourceKind::Conversation)
            .unwrap();
        assert_eq!(session.locator.provider_locator, "session/session-1");
        assert_eq!(session.presentation, ResourcePresentation::Conversation);
        assert_eq!(
            session.open_target,
            Some(ResourceOpenTarget::HermesSession {
                session_id: "session-1".into(),
                read_only: false
            })
        );
        assert!(
            session
                .provider_operations
                .contains(&ProviderOperation::Read)
        );
        assert!(
            session
                .provider_operations
                .contains(&ProviderOperation::Export)
        );
        assert_eq!(
            session.legacy_locator.as_deref(),
            Some("Hermes Sessions/session/session-1")
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
