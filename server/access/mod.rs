use crate::{
    config::{Config, MediaRoot},
    media,
    resources::{
        CatalogErrorCode, ReadContext, ReadSurface, ResourceCatalog, ResourceDetail, ResourceKind,
        ResourceRef,
    },
    shares::{self, GrantId, Share},
    store,
};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Principal {
    Owner,
    Grant(GrantId),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RequestContext {
    pub(crate) principal: Principal,
    pub(crate) request_id: String,
}

impl RequestContext {
    pub(crate) fn owner() -> Self {
        Self {
            principal: Principal::Owner,
            request_id: format!("request-{}", uuid::Uuid::new_v4()),
        }
    }

    fn grant(grant_id: GrantId) -> Self {
        Self {
            principal: Principal::Grant(grant_id),
            request_id: format!("request-{}", uuid::Uuid::new_v4()),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) enum Action {
    Read,
    Create,
    Upload { bytes: u64 },
    Replace { bytes: u64 },
    Copy { bytes: u64 },
    Move,
    Delete,
    CreateAttachmentDirectory { anchor: ResourceRef },
    UploadAttachment { anchor: ResourceRef, bytes: u64 },
    DeleteAttachment { anchor: ResourceRef },
}

impl Action {
    fn requested_bytes(&self) -> u64 {
        match self {
            Self::Upload { bytes }
            | Self::Replace { bytes }
            | Self::Copy { bytes }
            | Self::UploadAttachment { bytes, .. } => *bytes,
            _ => 0,
        }
    }

    fn attachment_anchor(&self) -> Option<&ResourceRef> {
        match self {
            Self::CreateAttachmentDirectory { anchor }
            | Self::UploadAttachment { anchor, .. }
            | Self::DeleteAttachment { anchor } => Some(anchor),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EffectiveCapabilities {
    pub(crate) read: bool,
    pub(crate) create: bool,
    pub(crate) upload: bool,
    pub(crate) replace: bool,
    pub(crate) copy: bool,
    pub(crate) move_resource: bool,
    pub(crate) delete: bool,
}

#[derive(Clone, Debug)]
pub(crate) struct GrantFacts {
    pub(crate) root_path: String,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthorizedResource {
    pub(crate) detail: ResourceDetail,
    pub(crate) logical_path: String,
    pub(crate) resolved: media::ResolvedPath,
    pub(crate) capabilities: EffectiveCapabilities,
    pub(crate) grant: Option<GrantFacts>,
    pub(crate) attachment_dir: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthorizedDestination {
    pub(crate) parent: AuthorizedResource,
    pub(crate) logical_path: String,
    pub(crate) resolved: media::ResolvedPath,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthenticatedGrant {
    pub(crate) context: RequestContext,
    pub(crate) share: Share,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AccessErrorCode {
    Unauthorized,
    Forbidden,
    ResourceNotFound,
    GrantUnavailable,
    QuotaExceeded,
    Internal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccessError {
    pub(crate) code: AccessErrorCode,
    pub(crate) message: String,
}

impl AccessError {
    fn new(code: AccessErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub(crate) fn status_code(&self) -> StatusCode {
        match self.code {
            AccessErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
            AccessErrorCode::Forbidden => StatusCode::FORBIDDEN,
            AccessErrorCode::ResourceNotFound => StatusCode::NOT_FOUND,
            AccessErrorCode::GrantUnavailable => StatusCode::GONE,
            AccessErrorCode::QuotaExceeded => StatusCode::PAYLOAD_TOO_LARGE,
            AccessErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub(crate) fn into_app_error(self) -> crate::error::AppError {
        crate::error::AppError(self.status_code(), self.message)
    }
}

impl From<crate::error::AppError> for AccessError {
    fn from(error: crate::error::AppError) -> Self {
        let code = match error.0 {
            StatusCode::UNAUTHORIZED => AccessErrorCode::Unauthorized,
            StatusCode::FORBIDDEN | StatusCode::BAD_REQUEST | StatusCode::CONFLICT => {
                AccessErrorCode::Forbidden
            }
            StatusCode::NOT_FOUND => AccessErrorCode::ResourceNotFound,
            StatusCode::GONE => AccessErrorCode::GrantUnavailable,
            StatusCode::PAYLOAD_TOO_LARGE => AccessErrorCode::QuotaExceeded,
            _ => AccessErrorCode::Internal,
        };
        Self::new(code, error.1)
    }
}

impl From<crate::resources::CatalogError> for AccessError {
    fn from(error: crate::resources::CatalogError) -> Self {
        let code = match error.code {
            CatalogErrorCode::Forbidden => AccessErrorCode::Forbidden,
            CatalogErrorCode::ResourceNotFound | CatalogErrorCode::ResourceMissing => {
                AccessErrorCode::ResourceNotFound
            }
            CatalogErrorCode::SourceUnavailable => AccessErrorCode::GrantUnavailable,
            CatalogErrorCode::InvalidRequest | CatalogErrorCode::Unsupported => {
                AccessErrorCode::Forbidden
            }
            CatalogErrorCode::Internal => AccessErrorCode::Internal,
        };
        Self::new(code, error.message)
    }
}

pub(crate) struct AccessPolicy {
    config: Config,
    runtime_roots: Arc<RwLock<Vec<MediaRoot>>>,
    resources: Arc<ResourceCatalog>,
}

impl AccessPolicy {
    pub(crate) fn new(
        config: Config,
        runtime_roots: Arc<RwLock<Vec<MediaRoot>>>,
        resources: Arc<ResourceCatalog>,
    ) -> Self {
        Self {
            config,
            runtime_roots,
            resources,
        }
    }

    pub(crate) async fn authenticate_grant(
        &self,
        token: &str,
        cookies: &HashMap<String, String>,
    ) -> Result<AuthenticatedGrant, AccessError> {
        let runtime = self.runtime_roots.read().await;
        let share = shares::find(&self.config, &runtime, token)
            .map_err(AccessError::from)?
            .ok_or_else(|| {
                AccessError::new(AccessErrorCode::ResourceNotFound, "Share not found")
            })?;
        if share.unavailable == Some(true) {
            return Err(AccessError::new(
                AccessErrorCode::GrantUnavailable,
                "Share mount is unavailable",
            ));
        }
        if !shares::authorized(&self.config, &share, cookies) {
            return Err(AccessError::new(
                AccessErrorCode::Unauthorized,
                "Passcode required",
            ));
        }
        let grant_id = share.grant_id.clone().ok_or_else(|| {
            AccessError::new(AccessErrorCode::Internal, "Grant internal ID is missing")
        })?;
        Ok(AuthenticatedGrant {
            context: RequestContext::grant(grant_id),
            share,
        })
    }

    pub(crate) async fn authorize(
        &self,
        context: &RequestContext,
        action: Action,
        resource: &ResourceRef,
    ) -> Result<AuthorizedResource, AccessError> {
        match &context.principal {
            Principal::Owner => self.authorize_owner(action, resource).await,
            Principal::Grant(grant_id) => self.authorize_grant(grant_id, action, resource).await,
        }
    }

    pub(crate) async fn preauthorize_upload(
        &self,
        context: &RequestContext,
        bytes: u64,
    ) -> Result<(), AccessError> {
        let Principal::Grant(grant_id) = &context.principal else {
            return Ok(());
        };
        let runtime = self.runtime_roots.read().await;
        let share = shares::find_by_id(&self.config, &runtime, grant_id)
            .map_err(AccessError::from)?
            .ok_or_else(|| {
                AccessError::new(AccessErrorCode::ResourceNotFound, "Share not found")
            })?;
        let root = self
            .resources
            .compatibility()
            .resolve_filesystem(&share.path, ReadSurface::Share)
            .await?;
        drop(runtime);
        self.authorize_grant(grant_id, Action::Upload { bytes }, &root.reference)
            .await
            .map(|_| ())
    }

    pub(crate) async fn authorize_child(
        &self,
        context: &RequestContext,
        action: Action,
        parent: &ResourceRef,
        child_name: &str,
    ) -> Result<AuthorizedDestination, AccessError> {
        // Moving checks editability on source and final destination. The parent may
        // legitimately sit just outside an editable boundary.
        let parent_action = if matches!(action, Action::Move) {
            Action::Read
        } else {
            action.clone()
        };
        let authorized = self.authorize(context, parent_action, parent).await?;
        if matches!(action, Action::Move) && matches!(context.principal, Principal::Grant(_)) {
            require_capability(&action, &authorized.capabilities)?;
        }
        let logical_path = join_logical(&authorized.logical_path, child_name);
        let runtime = self.runtime_roots.read().await;
        let resolved = media::resolve(&self.config, &runtime, &logical_path)?;
        if !media::editable(&self.config, &runtime, &logical_path) {
            return Err(AccessError::new(
                AccessErrorCode::Forbidden,
                "Path is not in an editable folder",
            ));
        }
        if let Some(grant) = &authorized.grant {
            if let Some(attachment_dir) = &authorized.attachment_dir {
                let allowed = match action {
                    Action::CreateAttachmentDirectory { .. } => logical_path == *attachment_dir,
                    Action::UploadAttachment { .. } => {
                        authorized.logical_path == *attachment_dir
                            && parent_logical(&logical_path) == *attachment_dir
                    }
                    _ => false,
                };
                if !allowed {
                    return Err(AccessError::new(
                        AccessErrorCode::Forbidden,
                        "Path is outside attachment scope",
                    ));
                }
            } else {
                shares::authorize_grant_logical_path(
                    &self.config,
                    &runtime,
                    &grant.root_path,
                    &logical_path,
                )?;
            }
        }
        Ok(AuthorizedDestination {
            parent: authorized,
            logical_path,
            resolved,
        })
    }

    async fn authorize_owner(
        &self,
        action: Action,
        resource: &ResourceRef,
    ) -> Result<AuthorizedResource, AccessError> {
        let detail = self
            .resources
            .inspect(&ReadContext::owner(ReadSurface::Library), resource)
            .await?;
        let logical_path = filesystem_logical(&detail)?;
        let runtime = self.runtime_roots.read().await;
        let resolved = media::resolve(&self.config, &runtime, &logical_path)?;
        let editable = media::editable(&self.config, &runtime, &logical_path);
        if matches!(
            action,
            Action::Replace { .. } | Action::Move | Action::Delete
        ) && !editable
        {
            return Err(AccessError::new(
                AccessErrorCode::Forbidden,
                "Path is not in an editable folder",
            ));
        }
        Ok(AuthorizedResource {
            detail,
            logical_path,
            resolved,
            capabilities: EffectiveCapabilities {
                read: true,
                create: true,
                upload: true,
                replace: editable,
                copy: true,
                move_resource: editable,
                delete: editable,
            },
            grant: None,
            attachment_dir: None,
        })
    }

    async fn authorize_grant(
        &self,
        grant_id: &GrantId,
        action: Action,
        resource: &ResourceRef,
    ) -> Result<AuthorizedResource, AccessError> {
        let runtime = self.runtime_roots.read().await;
        let share = shares::find_by_id(&self.config, &runtime, grant_id)
            .map_err(AccessError::from)?
            .ok_or_else(|| {
                AccessError::new(AccessErrorCode::ResourceNotFound, "Share not found")
            })?;
        if share.unavailable == Some(true) {
            return Err(AccessError::new(
                AccessErrorCode::GrantUnavailable,
                "Share mount is unavailable",
            ));
        }
        let root = self
            .resources
            .compatibility()
            .resolve_filesystem(&share.path, ReadSurface::Share)
            .await?;
        let read_context = if share.is_directory {
            ReadContext::grant(ReadSurface::Share, root.reference.clone())
        } else {
            ReadContext::grant_exact(ReadSurface::Share, root.reference.clone())
        };
        let attachment_dir = if action.attachment_anchor().is_some() {
            Some(
                self.validate_attachment_anchor(&share, &read_context, &root.reference, &action)
                    .await?,
            )
        } else {
            None
        };
        let detail = match self.resources.inspect(&read_context, resource).await {
            Ok(detail) => detail,
            Err(error) if attachment_dir.is_some() && error.code == CatalogErrorCode::Forbidden => {
                self.resources
                    .inspect(&ReadContext::owner(ReadSurface::Share), resource)
                    .await?
            }
            Err(error) => return Err(error.into()),
        };
        let logical_path = filesystem_logical(&detail)?;
        if let Some(images) = &attachment_dir {
            let allowed = match action {
                Action::CreateAttachmentDirectory { .. } => logical_path == parent_logical(images),
                Action::UploadAttachment { .. } => logical_path == *images,
                Action::DeleteAttachment { .. } => parent_logical(&logical_path) == *images,
                _ => false,
            };
            if !allowed {
                return Err(AccessError::new(
                    AccessErrorCode::Forbidden,
                    "Resource is outside attachment scope",
                ));
            }
        }
        let resolved = media::resolve(&self.config, &runtime, &logical_path)?;
        let restrictions = shares::effective(&share);
        let capabilities = EffectiveCapabilities {
            read: true,
            create: share.editable && restrictions.allow_upload == Some(true),
            upload: share.editable && restrictions.allow_upload == Some(true),
            replace: share.editable && restrictions.allow_edit == Some(true),
            copy: share.editable && restrictions.allow_upload == Some(true),
            move_resource: share.editable && restrictions.allow_edit == Some(true),
            delete: share.editable && restrictions.allow_delete == Some(true),
        };
        require_capability(&action, &capabilities)?;
        let requested = action.requested_bytes();
        let maximum = restrictions
            .max_upload_bytes
            .unwrap_or(2.0 * 1024.0 * 1024.0 * 1024.0);
        if maximum != 0.0 {
            let remaining = (maximum - share.used_bytes.unwrap_or(0) as f64).max(0.0);
            if requested as f64 > remaining {
                return Err(AccessError::new(
                    AccessErrorCode::QuotaExceeded,
                    "Upload quota exceeded for this share",
                ));
            }
        }
        if matches!(action, Action::Delete) && *resource == root.reference {
            return Err(AccessError::new(
                AccessErrorCode::Forbidden,
                "Cannot delete share root",
            ));
        }
        if matches!(
            action,
            Action::Replace { .. }
                | Action::Move
                | Action::Delete
                | Action::DeleteAttachment { .. }
        ) && !media::editable(&self.config, &runtime, &logical_path)
        {
            return Err(AccessError::new(
                AccessErrorCode::Forbidden,
                "Path is not in an editable folder",
            ));
        }
        Ok(AuthorizedResource {
            detail,
            logical_path,
            resolved,
            capabilities,
            grant: Some(GrantFacts {
                root_path: share.path,
            }),
            attachment_dir,
        })
    }

    async fn validate_attachment_anchor(
        &self,
        share: &Share,
        read_context: &ReadContext,
        root: &ResourceRef,
        action: &Action,
    ) -> Result<String, AccessError> {
        let anchor = action.attachment_anchor().unwrap();
        self.resources.inspect(read_context, anchor).await?;
        if !share.is_directory && anchor != root {
            return Err(AccessError::new(
                AccessErrorCode::Forbidden,
                "Attachment anchor is outside Grant scope",
            ));
        }
        if !share.is_directory && !share.path.to_ascii_lowercase().ends_with(".md") {
            return Err(AccessError::new(
                AccessErrorCode::Forbidden,
                "Only Markdown Grants may manage linked images",
            ));
        }
        let scope_root = knowledge_base_root(&self.config, &share.path).unwrap_or_else(|| {
            if share.is_directory {
                share.path.clone()
            } else {
                parent_logical(&share.path)
            }
        });
        Ok(join_logical(&scope_root, "images"))
    }
}

fn require_capability(
    action: &Action,
    capabilities: &EffectiveCapabilities,
) -> Result<(), AccessError> {
    let allowed = match action {
        Action::Read => capabilities.read,
        Action::Create | Action::CreateAttachmentDirectory { .. } => capabilities.create,
        Action::Upload { .. } | Action::UploadAttachment { .. } => capabilities.upload,
        Action::Replace { .. } => capabilities.replace,
        Action::Copy { .. } => capabilities.copy,
        Action::Move => capabilities.move_resource,
        Action::Delete => capabilities.delete,
        // A short-lived rollback capability is the authority for cancellation;
        // Grant settings may change after the upload. Scope/editability still apply.
        Action::DeleteAttachment { .. } => true,
    };
    if allowed {
        Ok(())
    } else {
        Err(AccessError::new(
            AccessErrorCode::Forbidden,
            "Action is not allowed for this Grant",
        ))
    }
}

fn filesystem_logical(detail: &ResourceDetail) -> Result<String, AccessError> {
    if !matches!(
        detail.summary.kind,
        ResourceKind::Source | ResourceKind::Folder | ResourceKind::File
    ) {
        return Err(AccessError::new(
            AccessErrorCode::Forbidden,
            "Resource is not filesystem content",
        ));
    }
    detail.summary.legacy_locator.clone().ok_or_else(|| {
        AccessError::new(
            AccessErrorCode::ResourceNotFound,
            "Resource has no filesystem locator",
        )
    })
}

fn knowledge_base_root(config: &Config, path: &str) -> Option<String> {
    let normalized = path.replace('\\', "/");
    let settings = store::section(
        &config.data_path.join("settings.json"),
        &config.library_key,
        serde_json::json!({"knowledgeBases":[]}),
    );
    settings["knowledgeBases"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str())
        .map(|root| root.replace('\\', "/"))
        .find(|root| normalized == *root || normalized.starts_with(&format!("{root}/")))
}

pub(crate) fn join_logical(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        child.to_string()
    } else {
        format!("{}/{child}", parent.trim_end_matches('/'))
    }
}

pub(crate) fn parent_logical(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit_once('/')
        .map(|value| value.0.into())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_path_helpers_keep_root_simple() {
        assert_eq!(join_logical("", "notes.md"), "notes.md");
        assert_eq!(join_logical("Notes/", "notes.md"), "Notes/notes.md");
        assert_eq!(parent_logical("Notes/notes.md"), "Notes");
    }
}
