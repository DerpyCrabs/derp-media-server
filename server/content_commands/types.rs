use crate::{
    resources::{ResourceRef, ResourceVersion},
    shares::GrantId,
};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ChildName(String);

impl ChildName {
    pub(crate) fn parse(value: impl Into<String>) -> Result<Self, CommandError> {
        let value = value.into();
        let stem = value.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$")
            || stem
                .strip_prefix("COM")
                .or_else(|| stem.strip_prefix("LPT"))
                .is_some_and(|number| {
                    number.len() == 1 && matches!(number.as_bytes()[0], b'1'..=b'9')
                });
        let invalid = value.is_empty()
            || value == "."
            || value == ".."
            || value.contains(['/', '\\', '\0', '<', '>', ':', '"', '|', '?', '*'])
            || value.ends_with(['.', ' '])
            || value.chars().any(char::is_control)
            || crate::media::reserved_internal_name(&value)
            || reserved
            || value.encode_utf16().count() > 255;
        if invalid {
            return Err(CommandError::new(
                CommandErrorCode::InvalidRequest,
                "Child name must be one valid file or folder name",
            ));
        }
        Ok(Self(value))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ContentCommand {
    pub(crate) idempotency_key: String,
    pub(crate) operation: ContentOperation,
}

#[derive(Clone, Debug)]
pub(crate) enum ContentOperation {
    CreateFolder {
        destination_parent: ResourceRef,
        child_name: ChildName,
        expected_parent_version: Option<ResourceVersion>,
        attachment_anchor: Option<ResourceRef>,
    },
    CreateFile {
        destination_parent: ResourceRef,
        child_name: ChildName,
        expected_parent_version: Option<ResourceVersion>,
        content: Vec<u8>,
        accounted_bytes: u64,
        attachment_anchor: Option<ResourceRef>,
    },
    UploadFile {
        destination_parent: ResourceRef,
        child_name: ChildName,
        expected_parent_version: Option<ResourceVersion>,
        content: Vec<u8>,
        accounted_bytes: u64,
        attachment_anchor: Option<ResourceRef>,
    },
    ReplaceFile {
        target: ResourceRef,
        expected_version: ResourceVersion,
        content: Vec<u8>,
        accounted_bytes: u64,
    },
    Copy {
        source: ResourceRef,
        destination_parent: ResourceRef,
        target_name: ChildName,
        expected_source_version: Option<ResourceVersion>,
        expected_destination_parent_version: Option<ResourceVersion>,
    },
    Move {
        source: ResourceRef,
        destination_parent: ResourceRef,
        target_name: ChildName,
        expected_source_version: Option<ResourceVersion>,
        expected_destination_parent_version: Option<ResourceVersion>,
    },
    Delete {
        target: ResourceRef,
        expected_version: Option<ResourceVersion>,
        attachment_anchor: Option<ResourceRef>,
        quota_refund: u64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CommandStatus {
    Completed,
    NeedsReconciliation,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ContentEventKind {
    FolderCreated,
    FileCreated,
    FileUploaded,
    FileReplaced,
    ResourceCopied,
    ResourceMoved,
    ResourceDeleted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandEventScope {
    pub(crate) owner: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) grant_ids: Vec<GrantId>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandEventEnvelope {
    pub(crate) schema_version: u16,
    pub(crate) event_id: String,
    pub(crate) command_id: String,
    pub(crate) occurred_at: u64,
    pub(crate) kind: ContentEventKind,
    pub(crate) scope: CommandEventScope,
    pub(crate) affected_refs: Vec<ResourceRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) old_paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) new_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResultingResourceVersion {
    #[serde(rename = "ref")]
    pub(crate) reference: ResourceRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) version: Option<ResourceVersion>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandReceipt {
    pub(crate) schema_version: u16,
    pub(crate) command_id: String,
    pub(crate) idempotency_key: String,
    pub(crate) status: CommandStatus,
    pub(crate) resulting_versions: Vec<ResultingResourceVersion>,
    pub(crate) affected_refs: Vec<ResourceRef>,
    pub(crate) event: CommandEventEnvelope,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CommandErrorCode {
    InvalidRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    VersionMismatch,
    IdempotencyConflict,
    QuotaExceeded,
    NeedsReconciliation,
    Internal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommandError {
    pub(crate) code: CommandErrorCode,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command_id: Option<String>,
    pub(crate) retryable: bool,
}

impl CommandError {
    pub(crate) fn new(code: CommandErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            command_id: None,
            retryable: false,
        }
    }

    pub(crate) fn reconciliation(
        command_id: impl Into<String>,
        message: impl Into<String>,
    ) -> Self {
        Self {
            code: CommandErrorCode::NeedsReconciliation,
            message: message.into(),
            command_id: Some(command_id.into()),
            retryable: true,
        }
    }

    pub(crate) fn status_code(&self) -> StatusCode {
        match self.code {
            CommandErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
            CommandErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
            CommandErrorCode::Forbidden => StatusCode::FORBIDDEN,
            CommandErrorCode::NotFound => StatusCode::NOT_FOUND,
            CommandErrorCode::Conflict
            | CommandErrorCode::VersionMismatch
            | CommandErrorCode::IdempotencyConflict
            | CommandErrorCode::NeedsReconciliation => StatusCode::CONFLICT,
            CommandErrorCode::QuotaExceeded => StatusCode::PAYLOAD_TOO_LARGE,
            CommandErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub(crate) fn into_app_error(self) -> crate::error::AppError {
        crate::error::AppError(self.status_code(), self.message)
    }
}

impl From<crate::error::AppError> for CommandError {
    fn from(error: crate::error::AppError) -> Self {
        let code = match error.0 {
            StatusCode::BAD_REQUEST => CommandErrorCode::InvalidRequest,
            StatusCode::UNAUTHORIZED => CommandErrorCode::Unauthorized,
            StatusCode::FORBIDDEN => CommandErrorCode::Forbidden,
            StatusCode::NOT_FOUND => CommandErrorCode::NotFound,
            StatusCode::CONFLICT => CommandErrorCode::Conflict,
            StatusCode::PAYLOAD_TOO_LARGE => CommandErrorCode::QuotaExceeded,
            _ => CommandErrorCode::Internal,
        };
        Self::new(code, error.1)
    }
}

impl From<crate::resources::CatalogError> for CommandError {
    fn from(error: crate::resources::CatalogError) -> Self {
        Self::from(error.into_app_error())
    }
}

impl IntoResponse for CommandError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let body = serde_json::json!({
            "error":self.message,
            "code":self.code,
            "message":self.message,
            "commandId":self.command_id,
            "retryable":self.retryable,
        });
        (status, axum::Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_name_rejects_paths_and_traversal() {
        for invalid in [
            "",
            ".",
            "..",
            "folder/file",
            "folder\\file",
            "bad\0name",
            "file.txt:stream",
            "bad?.txt",
            "trailing. ",
            "CON.txt",
            "lpt9",
            ".derp-command-staging",
        ] {
            assert!(ChildName::parse(invalid).is_err(), "accepted {invalid:?}");
        }
        assert_eq!(ChildName::parse("notes.md").unwrap().as_str(), "notes.md");
    }
}
