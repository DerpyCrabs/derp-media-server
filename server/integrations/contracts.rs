use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use ts_rs::TS;

pub(crate) const INTEGRATION_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceKeyDto {
    pub provider: String,
    pub id: String,
}

impl ResourceKeyDto {
    pub(crate) fn new(provider: impl Into<String>, id: impl Into<String>) -> Self {
        Self {
            provider: provider.into(),
            id: id.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) enum IntegrationCapabilityDto {
    Browse,
    Inspect,
    Actions,
    Search,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceAppearanceDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub tone: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceSummaryDto {
    pub key: ResourceKeyDto,
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mime: Option<String>,
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub presentation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub appearance: Option<ResourceAppearanceDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, unknown>")]
    pub metadata: Option<HashMap<String, Value>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourcePageDto {
    #[ts(type = "1")]
    pub schema_version: u32,
    pub location: ResourceKeyDto,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub location_summary: Option<ResourceSummaryDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub breadcrumbs: Vec<ResourceSummaryDto>,
    pub items: Vec<ResourceSummaryDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recent_items: Vec<ResourceSummaryDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_cursor: Option<String>,
    pub total: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationDescriptorDto {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<IntegrationCapabilityDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub root: Option<ResourceSummaryDto>,
}

#[derive(Clone, Debug)]
pub(crate) struct BrowseRequest {
    pub key: ResourceKeyDto,
    pub cursor: Option<String>,
    pub limit: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationActionRequestDto {
    pub key: ResourceKeyDto,
    pub action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, unknown> | null")]
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationOpenTargetDto {
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub resource: Option<ResourceKeyDto>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, unknown> | null")]
    pub payload: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationActionOutcomeDto {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub resource: Option<ResourceSummaryDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub open_target: Option<IntegrationOpenTargetDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "unknown")]
    pub data: Option<Value>,
}

#[derive(Clone, Debug)]
pub(crate) struct IntegrationSearchRequest {
    pub query: String,
    pub limit: usize,
    pub contributors: Option<Vec<String>>,
    pub scope: Option<ResourceKeyDto>,
}

impl IntegrationSearchRequest {
    pub(crate) fn includes(&self, contributor: &str) -> bool {
        self.contributors
            .as_ref()
            .is_none_or(|values| values.iter().any(|value| value == contributor))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationSearchResultDto {
    pub id: String,
    pub contributor: String,
    pub resource: ResourceSummaryDto,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub snippet: Option<String>,
    pub score: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub action: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationSearchFailureDto {
    pub contributor: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IntegrationSearchResponseDto {
    #[ts(type = "1")]
    pub schema_version: u32,
    pub results: Vec<IntegrationSearchResultDto>,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub failures: Vec<IntegrationSearchFailureDto>,
}
