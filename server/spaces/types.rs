use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

pub(crate) const SPACE_SCHEMA_VERSION: i64 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SpaceOrigin {
    Canvas,
    Workspace,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PaneKind {
    Browser,
    Viewer,
    Assistant,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PaneContent {
    pub(crate) kind: PaneKind,
    pub(crate) state: Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpaceArrangements {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) tiled: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) spatial: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Space {
    pub(crate) schema_version: i64,
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) revision: i64,
    pub(crate) origin: SpaceOrigin,
    pub(crate) panes: BTreeMap<String, PaneContent>,
    pub(crate) arrangements: SpaceArrangements,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) deleted_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpaceSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) revision: i64,
    pub(crate) origin: SpaceOrigin,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) deleted_at: Option<i64>,
    pub(crate) pane_count: usize,
}

impl From<&Space> for SpaceSummary {
    fn from(space: &Space) -> Self {
        Self {
            id: space.id.clone(),
            name: space.name.clone(),
            revision: space.revision,
            origin: space.origin,
            created_at: space.created_at,
            updated_at: space.updated_at,
            deleted_at: space.deleted_at,
            pane_count: space.panes.len(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpaceRevisionSummary {
    pub(crate) revision: i64,
    pub(crate) name: String,
    pub(crate) command_type: String,
    pub(crate) created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) deleted_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpaceImportRecord {
    pub(crate) source_kind: String,
    pub(crate) source_key: String,
    pub(crate) source_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) space_id: Option<String>,
    pub(crate) status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    pub(crate) imported_at: i64,
    pub(crate) raw: Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceImportRequest {
    pub(crate) source_key: String,
    pub(crate) raw: Value,
    #[serde(default)]
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) panes: BTreeMap<String, PaneContent>,
    #[serde(default)]
    pub(crate) arrangements: SpaceArrangements,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ArrangementPresentation {
    Tiled,
    Spatial,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum SpaceCommand {
    Create {
        #[serde(default)]
        id: Option<String>,
        name: String,
        origin: SpaceOrigin,
        #[serde(default)]
        panes: BTreeMap<String, PaneContent>,
        #[serde(default)]
        arrangements: SpaceArrangements,
    },
    Rename {
        name: String,
    },
    Delete,
    Duplicate {
        #[serde(default)]
        source_revision: Option<i64>,
        #[serde(default)]
        new_id: Option<String>,
        #[serde(default)]
        name: Option<String>,
    },
    AddPane {
        pane_id: String,
        pane: PaneContent,
    },
    RemovePane {
        pane_id: String,
    },
    UpdatePane {
        pane_id: String,
        pane: PaneContent,
    },
    ApplyArrangement {
        presentation: ArrangementPresentation,
        #[serde(default)]
        arrangement: Option<Value>,
    },
    RestoreRevision {
        revision: i64,
    },
}

impl SpaceCommand {
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Create { .. } => "create",
            Self::Rename { .. } => "rename",
            Self::Delete => "delete",
            Self::Duplicate { .. } => "duplicate",
            Self::AddPane { .. } => "addPane",
            Self::RemovePane { .. } => "removePane",
            Self::UpdatePane { .. } => "updatePane",
            Self::ApplyArrangement { .. } => "applyArrangement",
            Self::RestoreRevision { .. } => "restoreRevision",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplySpaceCommand {
    #[serde(default)]
    pub(crate) command_id: Option<String>,
    #[serde(default)]
    pub(crate) space_id: Option<String>,
    #[serde(default)]
    pub(crate) expected_revision: Option<i64>,
    pub(crate) command: SpaceCommand,
}

#[derive(Clone, Debug)]
pub(crate) enum SpaceErrorKind {
    Invalid,
    AlreadyExists,
    NotFound,
    Conflict,
    HistoryExpired,
    Internal,
}

#[derive(Clone, Debug)]
pub(crate) struct SpaceError {
    pub(crate) kind: SpaceErrorKind,
    pub(crate) message: String,
    pub(crate) expected_revision: Option<i64>,
    pub(crate) current: Option<Box<Space>>,
    pub(crate) oldest_retained_revision: Option<i64>,
}

impl SpaceError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::new(SpaceErrorKind::Invalid, message)
    }

    pub(crate) fn not_found(message: impl Into<String>) -> Self {
        Self::new(SpaceErrorKind::NotFound, message)
    }

    pub(crate) fn already_exists(current: Space) -> Self {
        Self {
            kind: SpaceErrorKind::AlreadyExists,
            message: "Space already exists".into(),
            expected_revision: Some(0),
            current: Some(Box::new(current)),
            oldest_retained_revision: None,
        }
    }

    pub(crate) fn conflict(expected_revision: i64, current: Space) -> Self {
        Self {
            kind: SpaceErrorKind::Conflict,
            message: "Space changed".into(),
            expected_revision: Some(expected_revision),
            current: Some(Box::new(current)),
            oldest_retained_revision: None,
        }
    }

    pub(crate) fn history_expired(oldest_retained_revision: i64) -> Self {
        Self {
            kind: SpaceErrorKind::HistoryExpired,
            message: "Space revision is no longer retained".into(),
            expected_revision: None,
            current: None,
            oldest_retained_revision: Some(oldest_retained_revision),
        }
    }

    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self::new(SpaceErrorKind::Internal, message)
    }

    fn new(kind: SpaceErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            expected_revision: None,
            current: None,
            oldest_retained_revision: None,
        }
    }
}

impl IntoResponse for SpaceError {
    fn into_response(self) -> Response {
        let status = match self.kind {
            SpaceErrorKind::Invalid => StatusCode::BAD_REQUEST,
            SpaceErrorKind::AlreadyExists => StatusCode::CONFLICT,
            SpaceErrorKind::NotFound => StatusCode::NOT_FOUND,
            SpaceErrorKind::Conflict => StatusCode::CONFLICT,
            SpaceErrorKind::HistoryExpired => StatusCode::GONE,
            SpaceErrorKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = match self.kind {
            SpaceErrorKind::Conflict => {
                let current_revision = self.current.as_ref().map(|space| space.revision);
                json!({
                    "error":"space_revision_conflict",
                    "message":self.message,
                    "expectedRevision":self.expected_revision,
                    "currentRevision":current_revision,
                    "current":self.current,
                })
            }
            SpaceErrorKind::AlreadyExists => json!({
                "error":"space_already_exists",
                "message":self.message,
                "current":self.current,
            }),
            SpaceErrorKind::HistoryExpired => json!({
                "error":"space_history_expired",
                "message":self.message,
                "oldestRetainedRevision":self.oldest_retained_revision,
            }),
            _ => json!({"error":self.message}),
        };
        (status, Json(body)).into_response()
    }
}

impl From<rusqlite::Error> for SpaceError {
    fn from(error: rusqlite::Error) -> Self {
        Self::internal(error.to_string())
    }
}

impl From<serde_json::Error> for SpaceError {
    fn from(error: serde_json::Error) -> Self {
        Self::internal(error.to_string())
    }
}
