use super::{
    ChildName, CommandError, CommandErrorCode, CommandReceipt, ContentCommand, ContentCommands,
    ContentOperation, request_digest,
};
use crate::{
    access::RequestContext,
    resources::{CatalogErrorCode, ReadSurface, ResourceKind, ResourceRef},
};
use serde_json::json;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug)]
pub(crate) enum CreatePathMode {
    Folder,
    CreateFile {
        content: Vec<u8>,
        accounted_bytes: u64,
    },
    UploadFile {
        content: Vec<u8>,
        accounted_bytes: u64,
    },
}

impl CreatePathMode {
    fn content(&self) -> Option<(&[u8], u64)> {
        match self {
            Self::Folder => None,
            Self::CreateFile {
                content,
                accounted_bytes,
            }
            | Self::UploadFile {
                content,
                accounted_bytes,
            } => Some((content, *accounted_bytes)),
        }
    }

    fn name(&self) -> &'static str {
        match self {
            Self::Folder => "folder",
            Self::CreateFile { .. } => "createFile",
            Self::UploadFile { .. } => "uploadFile",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct CreatePathResult {
    pub(crate) receipt: CommandReceipt,
    pub(crate) receipts: Vec<CommandReceipt>,
    pub(crate) replayed: bool,
}

impl ContentCommands {
    pub(crate) async fn create_path(
        &self,
        context: &RequestContext,
        idempotency_key: String,
        logical_path: &str,
        request_path: &str,
        mode: CreatePathMode,
        attachment_anchor: Option<ResourceRef>,
    ) -> Result<CreatePathResult, CommandError> {
        let segments = validated_segments(logical_path)?;
        let (content_digest, payload_length, accounted_bytes) = mode
            .content()
            .map(|(content, accounted)| {
                (
                    Some(hex(&Sha256::digest(content))),
                    Some(content.len()),
                    accounted,
                )
            })
            .unwrap_or((None, None, 0));
        let transport_digest = request_digest(&json!({
            "type":"createPath",
            "mode":mode.name(),
            "path":request_path.replace('\\', "/").trim_matches('/'),
            "payloadDigest":content_digest,
            "payloadLength":payload_length,
            "accountedBytes":accounted_bytes,
            "attachmentAnchor":attachment_anchor,
        }))?;
        if let Some(receipt) = self
            .replay_request(
                context,
                &idempotency_key,
                &transport_digest,
                mode.content().map(|(content, _)| content),
            )
            .await?
        {
            return Ok(CreatePathResult {
                receipts: vec![receipt.clone()],
                receipt,
                replayed: true,
            });
        }

        self.access
            .preauthorize_upload(context, accounted_bytes)
            .await
            .map_err(super::access_error)?;

        let final_name = segments.last().cloned().ok_or_else(|| {
            CommandError::new(CommandErrorCode::InvalidRequest, "Path is required")
        })?;
        let mut parent_segments = segments[..segments.len() - 1]
            .iter()
            .map(|segment| segment.as_str().to_string())
            .collect::<Vec<_>>();
        let mut missing = Vec::new();
        let mut parent = loop {
            let parent_path = parent_segments.join("/");
            match self
                .resources
                .compatibility()
                .resolve_filesystem(&parent_path, ReadSurface::Library)
                .await
            {
                Ok(summary)
                    if matches!(summary.kind, ResourceKind::Folder | ResourceKind::Source) =>
                {
                    break summary;
                }
                Ok(_) => {
                    return Err(CommandError::new(
                        CommandErrorCode::Conflict,
                        "Destination parent is not a folder",
                    ));
                }
                Err(error)
                    if matches!(
                        error.code,
                        CatalogErrorCode::ResourceNotFound | CatalogErrorCode::ResourceMissing
                    ) =>
                {
                    let Some(segment) = parent_segments.pop() else {
                        return Err(CommandError::new(
                            CommandErrorCode::NotFound,
                            "Destination parent was not found",
                        ));
                    };
                    missing.push(ChildName::parse(segment)?);
                }
                Err(error) => return Err(error.into()),
            }
        };

        let mut receipts = Vec::new();
        for segment in missing.into_iter().rev() {
            let child_path = join_logical(
                parent.legacy_locator.as_deref().ok_or_else(|| {
                    CommandError::new(
                        CommandErrorCode::NotFound,
                        "Destination parent has no filesystem path",
                    )
                })?,
                segment.as_str(),
            );
            let receipt = self
                .execute(
                    context,
                    ContentCommand {
                        idempotency_key: derived_key(
                            &idempotency_key,
                            &format!("directory:{child_path}"),
                        ),
                        operation: ContentOperation::CreateFolder {
                            destination_parent: parent.reference,
                            child_name: segment,
                            expected_parent_version: None,
                            attachment_anchor: attachment_anchor.clone(),
                        },
                    },
                )
                .await?;
            receipts.push(receipt);
            parent = self
                .resources
                .compatibility()
                .resolve_filesystem(&child_path, ReadSurface::Library)
                .await?;
        }

        let operation = match mode {
            CreatePathMode::Folder => ContentOperation::CreateFolder {
                destination_parent: parent.reference,
                child_name: final_name,
                expected_parent_version: None,
                attachment_anchor,
            },
            CreatePathMode::CreateFile {
                content,
                accounted_bytes,
            } => ContentOperation::CreateFile {
                destination_parent: parent.reference,
                child_name: final_name,
                expected_parent_version: None,
                content,
                accounted_bytes,
                attachment_anchor,
            },
            CreatePathMode::UploadFile {
                content,
                accounted_bytes,
            } => ContentOperation::UploadFile {
                destination_parent: parent.reference,
                child_name: final_name,
                expected_parent_version: None,
                content,
                accounted_bytes,
                attachment_anchor,
            },
        };
        let receipt = self
            .execute_with_request_digest(
                context,
                ContentCommand {
                    idempotency_key,
                    operation,
                },
                transport_digest,
            )
            .await?;
        receipts.push(receipt.clone());
        Ok(CreatePathResult {
            receipt,
            receipts,
            replayed: false,
        })
    }
}

fn validated_segments(path: &str) -> Result<Vec<ChildName>, CommandError> {
    let normalized = path.replace('\\', "/");
    let normalized = normalized.trim_matches('/');
    if normalized.is_empty() || normalized.split('/').any(str::is_empty) {
        return Err(CommandError::new(
            CommandErrorCode::InvalidRequest,
            "Path is required and may not contain empty segments",
        ));
    }
    normalized.split('/').map(ChildName::parse).collect()
}

fn join_logical(parent: &str, child: &str) -> String {
    let parent = parent.replace('\\', "/").trim_matches('/').to_string();
    if parent.is_empty() {
        child.to_string()
    } else {
        format!("{parent}/{child}")
    }
}

fn derived_key(base: &str, scope: &str) -> String {
    let candidate = format!("{base}:{scope}");
    if candidate.len() <= 200 {
        candidate
    } else {
        format!("request-{}", hex(&Sha256::digest(candidate.as_bytes())))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_every_child_segment() {
        assert_eq!(validated_segments("a/b/file.txt").unwrap().len(), 3);
        for path in ["", "a//b", "a/../b", "a\\..\\b"] {
            assert!(validated_segments(path).is_err(), "accepted {path:?}");
        }
    }

    #[test]
    fn derived_keys_remain_valid() {
        let key = derived_key(&"x".repeat(190), "directory:deep/path");
        assert!(key.len() <= 200);
        assert!(!key.chars().any(char::is_whitespace));
    }
}
