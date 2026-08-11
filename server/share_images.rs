use crate::{
    error::{AppError, AppResult},
    markdown_images,
    resources::{ResourceRef, ResourceVersion},
    shares::GrantId,
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::atomic::{AtomicU64, Ordering},
    time::UNIX_EPOCH,
};
use tokio::sync::Mutex;

const PENDING_LIFETIME_MS: u128 = 5 * 60 * 1000;
const MAX_PREVIEWS_PER_SHARE: usize = 128;
const MAX_PREVIEW_SCOPES: usize = 128;
const MAX_ROLLBACK_GRANTS: usize = 512;

#[derive(Clone, Debug)]
pub(crate) struct PendingImageGrant {
    pub image_path: String,
    pub accounted_bytes: u64,
    pub resource: ResourceRef,
    pub version: ResourceVersion,
    grant_id: GrantId,
    expires_at: u128,
    recorded_at: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UploadRegistration {
    pub rollback_id: String,
}

#[derive(Debug)]
struct ImagePreview {
    image_path: String,
    expires_at: u128,
    finalized_at: Option<u64>,
    recorded_at: u64,
}

#[derive(Default)]
struct State {
    grants: HashMap<String, PendingImageGrant>,
    previews: HashMap<(GrantId, ResourceRef), ImagePreview>,
}

pub(crate) struct ShareImages {
    state: Mutex<State>,
    sequence: AtomicU64,
}

impl ShareImages {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(State::default()),
            sequence: AtomicU64::new(0),
        }
    }

    pub(crate) fn begin_markdown_save(&self) -> u64 {
        self.next_sequence()
    }

    pub(crate) async fn finish_markdown_save(
        &self,
        grant_id: &GrantId,
        share_path: &str,
        content: &str,
        knowledge_bases: &[String],
        save_started_at: u64,
    ) {
        let referenced = markdown_images::referenced(content, share_path, knowledge_bases);
        let mut state = self.state.lock().await;
        state.previews.retain(|(candidate, _), preview| {
            candidate != grant_id
                || (!referenced.contains(&preview.image_path)
                    && preview
                        .finalized_at
                        .is_none_or(|sequence| sequence > save_started_at))
        });
        state.grants.retain(|_, grant| {
            &grant.grant_id != grant_id || !referenced.contains(&grant.image_path)
        });
    }

    pub(crate) async fn preview_authorized(
        &self,
        grant_id: &GrantId,
        canonical_path: Option<&str>,
        resource: Option<&ResourceRef>,
        authorized_reference: bool,
        is_directory: bool,
    ) -> bool {
        if is_directory {
            return false;
        }
        let now = timestamp_ms();
        let mut state = self.state.lock().await;
        state
            .previews
            .retain(|_, preview| preview.finalized_at.is_some() || preview.expires_at > now);
        let (Some(path), Some(resource)) = (canonical_path, resource) else {
            return false;
        };
        let key = (grant_id.clone(), resource.clone());
        if authorized_reference {
            state.previews.remove(&key);
            false
        } else {
            if let Some(preview) = state.previews.get_mut(&key) {
                preview.image_path = path.to_string();
                for grant in state.grants.values_mut() {
                    if grant.grant_id == *grant_id && grant.resource == *resource {
                        grant.image_path = path.to_string();
                    }
                }
                true
            } else {
                false
            }
        }
    }

    pub(crate) async fn register_upload(
        &self,
        grant_id: &GrantId,
        is_directory: bool,
        image_path: &str,
        accounted_bytes: u64,
        resource: ResourceRef,
        version: ResourceVersion,
        command_id: &str,
        create_if_missing: bool,
    ) -> UploadRegistration {
        let rollback_id = rollback_id(command_id);
        let expires_at = timestamp_ms() + PENDING_LIFETIME_MS;
        let mut state = self.state.lock().await;

        if state.grants.contains_key(&rollback_id) || !create_if_missing {
            return UploadRegistration { rollback_id };
        }

        if !is_directory {
            let recorded_at = self.next_sequence();
            state.previews.insert(
                (grant_id.clone(), resource.clone()),
                ImagePreview {
                    image_path: image_path.to_string(),
                    expires_at,
                    finalized_at: None,
                    recorded_at,
                },
            );
            prune_previews(&mut state.previews, grant_id);
        }

        let now = timestamp_ms();
        state.grants.retain(|_, grant| grant.expires_at > now);
        while state.grants.len() >= MAX_ROLLBACK_GRANTS {
            let Some(oldest) = state
                .grants
                .iter()
                .min_by_key(|(_, grant)| grant.recorded_at)
                .map(|(id, _)| id.clone())
            else {
                break;
            };
            state.grants.remove(&oldest);
        }
        let recorded_at = self.next_sequence();
        state.grants.insert(
            rollback_id.clone(),
            PendingImageGrant {
                grant_id: grant_id.clone(),
                image_path: image_path.to_string(),
                accounted_bytes,
                resource,
                version,
                expires_at,
                recorded_at,
            },
        );
        UploadRegistration { rollback_id }
    }

    pub(crate) async fn finalize_upload(
        &self,
        grant_id: &GrantId,
        is_directory: bool,
        rollback_id: &str,
    ) -> AppResult<()> {
        let mut state = self.state.lock().await;
        let grant = state.grants.get(rollback_id).cloned();
        if !grant
            .as_ref()
            .is_some_and(|grant| &grant.grant_id == grant_id && grant.expires_at > timestamp_ms())
        {
            return Err(AppError::forbidden("Image upload is no longer pending"));
        }
        let grant = state.grants.remove(rollback_id).unwrap();
        if !is_directory
            && let Some(preview) = state.previews.get_mut(&(grant_id.clone(), grant.resource))
        {
            preview.finalized_at = Some(self.next_sequence());
            preview.expires_at = u128::MAX;
        }
        Ok(())
    }

    pub(crate) async fn take_for_cancel(
        &self,
        grant_id: &GrantId,
        rollback_id: &str,
    ) -> AppResult<PendingImageGrant> {
        let mut state = self.state.lock().await;
        let grant = state.grants.get(rollback_id).cloned();
        if !grant
            .as_ref()
            .is_some_and(|grant| &grant.grant_id == grant_id && grant.expires_at > timestamp_ms())
        {
            return Err(AppError::forbidden("Image upload cannot be cancelled"));
        }
        Ok(state.grants.remove(rollback_id).unwrap())
    }

    pub(crate) async fn restore_cancel(&self, rollback_id: &str, mut grant: PendingImageGrant) {
        if grant.expires_at <= timestamp_ms() {
            return;
        }
        grant.recorded_at = self.next_sequence();
        self.state
            .lock()
            .await
            .grants
            .insert(rollback_id.to_string(), grant);
    }

    pub(crate) async fn complete_cancel(&self, grant_id: &GrantId, resource: &ResourceRef) {
        self.state
            .lock()
            .await
            .previews
            .remove(&(grant_id.clone(), resource.clone()));
    }

    fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst) + 1
    }
}

fn prune_previews(
    previews: &mut HashMap<(GrantId, ResourceRef), ImagePreview>,
    grant_id: &GrantId,
) {
    while previews
        .keys()
        .filter(|(candidate, _)| candidate == grant_id)
        .count()
        > MAX_PREVIEWS_PER_SHARE
    {
        let oldest = previews
            .iter()
            .filter(|((candidate, _), _)| candidate == grant_id)
            .min_by_key(|(_, preview)| preview.recorded_at)
            .map(|(key, _)| key.clone());
        if let Some(key) = oldest {
            previews.remove(&key);
        } else {
            break;
        }
    }
    while previews
        .keys()
        .map(|(candidate, _)| candidate)
        .collect::<HashSet<_>>()
        .len()
        > MAX_PREVIEW_SCOPES
    {
        let mut scope_activity = HashMap::new();
        for ((candidate, _), preview) in previews.iter() {
            scope_activity
                .entry(candidate.clone())
                .and_modify(|latest: &mut u64| *latest = (*latest).max(preview.recorded_at))
                .or_insert(preview.recorded_at);
        }
        let oldest_scope = scope_activity
            .into_iter()
            .min_by_key(|(_, latest)| *latest)
            .map(|(scope, _)| scope);
        if let Some(scope) = oldest_scope {
            previews.retain(|(candidate, _), _| candidate != &scope);
        } else {
            break;
        }
    }
}

fn rollback_id(command_id: &str) -> String {
    let digest = Sha256::digest(command_id.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    uuid::Uuid::from_bytes(bytes).to_string()
}

fn timestamp_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::resources::{LibraryId, ResourceId};

    fn resource(name: &str) -> (ResourceRef, ResourceVersion) {
        (
            ResourceRef {
                library_id: LibraryId::new("library"),
                resource_id: ResourceId::new(format!("resource-{name}")),
            },
            ResourceVersion::new(format!("version-{name}")),
        )
    }

    fn grant(name: &str) -> GrantId {
        GrantId::from_stored(format!("grant-{name}"))
    }

    #[tokio::test]
    async fn pending_preview_finalization_and_cancel_are_scoped() {
        let images = ShareImages::new();
        let grant_a = grant("a");
        let grant_b = grant("b");
        let (reference, version) = resource("a");
        let registration = images
            .register_upload(
                &grant_a,
                false,
                "notes/images/a.png",
                12,
                reference.clone(),
                version,
                "cmd-a",
                true,
            )
            .await;

        assert!(
            images
                .preview_authorized(
                    &grant_a,
                    Some("notes/images/a.png"),
                    Some(&reference),
                    false,
                    false,
                )
                .await
        );
        assert!(
            images
                .take_for_cancel(&grant_b, &registration.rollback_id)
                .await
                .is_err()
        );
        images
            .finalize_upload(&grant_a, false, &registration.rollback_id)
            .await
            .unwrap();
        assert!(
            images
                .preview_authorized(
                    &grant_a,
                    Some("notes/images/a.png"),
                    Some(&reference),
                    false,
                    false,
                )
                .await
        );
        assert!(
            images
                .take_for_cancel(&grant_a, &registration.rollback_id)
                .await
                .is_err()
        );

        let (reference, version) = resource("a");
        images
            .register_upload(
                &grant_a,
                false,
                "moved/images/a.png",
                12,
                reference,
                version,
                "cmd-a",
                false,
            )
            .await;
        assert!(
            images
                .take_for_cancel(&grant_a, &registration.rollback_id)
                .await
                .is_err(),
            "replayed upload resurrected finalized rollback authority"
        );
    }

    #[tokio::test]
    async fn markdown_save_discards_referenced_capability_and_preview() {
        let images = ShareImages::new();
        let grant = grant("markdown");
        let (reference, version) = resource("a");
        let registration = images
            .register_upload(
                &grant,
                false,
                "notes/images/a.png",
                9,
                reference.clone(),
                version,
                "cmd",
                true,
            )
            .await;
        assert!(
            images
                .preview_authorized(
                    &grant,
                    Some("moved/images/a.png"),
                    Some(&reference),
                    false,
                    false,
                )
                .await,
            "preview did not follow its stable ResourceRef after Grant root move"
        );
        let started = images.begin_markdown_save();
        images
            .finish_markdown_save(&grant, "moved/a.md", "![image](images/a.png)", &[], started)
            .await;

        assert!(
            !images
                .preview_authorized(
                    &grant,
                    Some("moved/images/a.png"),
                    Some(&reference),
                    false,
                    false,
                )
                .await
        );
        assert!(
            images
                .take_for_cancel(&grant, &registration.rollback_id)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn failed_cancel_can_restore_capability() {
        let images = ShareImages::new();
        let grant_id = grant("cancel");
        let (reference, version) = resource("a");
        let registration = images
            .register_upload(
                &grant_id,
                false,
                "notes/images/a.png",
                17,
                reference,
                version,
                "cmd",
                true,
            )
            .await;
        let grant = images
            .take_for_cancel(&grant_id, &registration.rollback_id)
            .await
            .unwrap();
        assert_eq!(grant.accounted_bytes, 17);
        images
            .restore_cancel(&registration.rollback_id, grant)
            .await;
        assert!(
            images
                .take_for_cancel(&grant_id, &registration.rollback_id)
                .await
                .is_ok()
        );
    }
}
