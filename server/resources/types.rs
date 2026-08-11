use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

macro_rules! opaque_id {
    ($name:ident) => {
        #[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub(crate) struct $name(pub(crate) String);

        impl $name {
            pub(crate) fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub(crate) fn as_str(&self) -> &str {
                &self.0
            }
        }
    };
}

opaque_id!(LibraryId);
opaque_id!(SourceId);
opaque_id!(ResourceId);
opaque_id!(ResourceVersion);
opaque_id!(PageCursor);

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceRef {
    pub(crate) library_id: LibraryId,
    pub(crate) resource_id: ResourceId,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceLocator {
    pub(crate) source_id: SourceId,
    pub(crate) provider_locator: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResourceKind {
    Library,
    Source,
    Folder,
    Collection,
    File,
    Conversation,
    ConversationProject,
    Draft,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResourcePresentation {
    Browse,
    Video,
    Audio,
    Image,
    Text,
    Pdf,
    Book,
    Conversation,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderOperation {
    Browse,
    Read,
    Stream,
    Download,
    Export,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResourceAvailability {
    Present,
    Missing,
    SourceUnavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceAppearance {
    pub(crate) icon: String,
    pub(crate) tone: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) color: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ResourcePreviewKind {
    Thumbnail,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourcePreview {
    pub(crate) kind: ResourcePreviewKind,
    pub(crate) available: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ResourceOpenTarget {
    HermesSession {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "readOnly")]
        read_only: bool,
    },
    HermesDraft {
        #[serde(rename = "projectPath", skip_serializing_if = "Option::is_none")]
        project_path: Option<String>,
        #[serde(rename = "readOnly")]
        read_only: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceSummary {
    #[serde(rename = "ref")]
    pub(crate) reference: ResourceRef,
    pub(crate) locator: ResourceLocator,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) legacy_locator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) version: Option<ResourceVersion>,
    pub(crate) name: String,
    pub(crate) kind: ResourceKind,
    pub(crate) presentation: ResourcePresentation,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) preview: Option<ResourcePreview>,
    pub(crate) provider_operations: Vec<ProviderOperation>,
    pub(crate) availability: ResourceAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) appearance: Option<ResourceAppearance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) open_target: Option<ResourceOpenTarget>,
    #[serde(skip)]
    pub(crate) legacy: LegacyResourceFields,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct LegacyResourceFields {
    pub(crate) numeric_version_bits: Option<u64>,
    pub(crate) is_virtual: Option<bool>,
    pub(crate) view_count: Option<u64>,
    pub(crate) share_token: Option<String>,
    pub(crate) thumbnail_generated: Option<bool>,
}

impl LegacyResourceFields {
    pub(crate) fn numeric_version(&self) -> Option<f64> {
        self.numeric_version_bits.map(f64::from_bits)
    }

    pub(crate) fn with_numeric_version(mut self, value: Option<f64>) -> Self {
        self.numeric_version_bits = value.map(f64::to_bits);
        self
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct LegacyPageFields {
    pub(crate) virtual_directory: Option<Value>,
    pub(crate) virtual_entries: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourcePage {
    pub(crate) schema_version: u16,
    pub(crate) parent: ResourceSummary,
    pub(crate) items: Vec<ResourceSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_cursor: Option<PageCursor>,
    pub(crate) total: u64,
    #[serde(skip)]
    pub(crate) legacy: LegacyPageFields,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceDetail {
    pub(crate) schema_version: u16,
    pub(crate) summary: ResourceSummary,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_contract_matches_shared_golden_fixture() {
        let raw = include_str!("../../tests/fixtures/resource-contract.json");
        let expected: serde_json::Value = serde_json::from_str(raw).unwrap();
        let page: ResourcePage = serde_json::from_value(expected.clone()).unwrap();

        assert_eq!(page.schema_version, 1);
        assert_eq!(
            page.items[0].reference.resource_id.as_str(),
            "resource-video"
        );
        assert_eq!(serde_json::to_value(page).unwrap(), expected);
    }
}
