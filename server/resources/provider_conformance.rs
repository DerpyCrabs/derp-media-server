use super::{
    FilesystemProvider, HermesProvider, ProviderBrowse, ProviderInspect, ProviderOperation,
    ProviderResource, ProviderSource, ReadProvider, ResourceKind, ResourcePresentation, SourceId,
};
use crate::{
    config::{AuthConfig, Config, FileSearchConfig, ImageOptimizationConfig, MediaRoot},
    error::{AppError, AppResult},
    hermes::HermesTransport,
    thumbnails::Thumbnailer,
};
use futures_util::future::BoxFuture;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};

struct ExpectedResource {
    locator: &'static str,
    legacy_locator: &'static str,
    kind: ResourceKind,
    presentation: ResourcePresentation,
    version_prefix: Option<&'static str>,
    operations: Vec<ProviderOperation>,
}

async fn assert_provider_conformance<P: ReadProvider>(
    provider: &P,
    source: ProviderSource,
    parent_locator: &str,
    expected: &[ExpectedResource],
) {
    let mut observed = Vec::new();
    for offset in 0..expected.len() {
        let page = provider
            .browse(ProviderBrowse {
                source: source.clone(),
                locator: parent_locator.into(),
                offset,
                limit: 1,
            })
            .await
            .unwrap();

        assert_eq!(page.total, expected.len());
        assert_eq!(page.items.len(), 1);
        assert_eq!(
            page.next_offset,
            (offset + 1 < expected.len()).then_some(offset + 1)
        );
        assert!(page.legacy.virtual_directory.is_none());
        assert!(page.legacy.virtual_entries.is_empty());
        assert_resource_contract(&page.items[0], &expected[offset]);
        observed.push(page.items.into_iter().next().unwrap());
    }

    let beyond_end = provider
        .browse(ProviderBrowse {
            source: source.clone(),
            locator: parent_locator.into(),
            offset: expected.len(),
            limit: 1,
        })
        .await
        .unwrap();
    assert_eq!(beyond_end.total, expected.len());
    assert!(beyond_end.items.is_empty());
    assert_eq!(beyond_end.next_offset, None);

    for (listed, expected) in observed.iter().zip(expected) {
        let inspected = provider
            .inspect(ProviderInspect {
                source: source.clone(),
                locator: expected.locator.into(),
            })
            .await
            .unwrap();
        assert_resource_contract(&inspected, expected);
        assert_eq!(inspected.provider_locator, listed.provider_locator);
        assert_eq!(inspected.legacy_locator, listed.legacy_locator);
        assert_eq!(inspected.kind, listed.kind);
        assert_eq!(inspected.presentation, listed.presentation);
        assert_eq!(inspected.version, listed.version);
        assert_eq!(inspected.operations, listed.operations);
    }
}

fn assert_resource_contract(resource: &ProviderResource, expected: &ExpectedResource) {
    assert_eq!(resource.provider_locator, expected.locator);
    assert_eq!(resource.legacy_locator, expected.legacy_locator);
    assert_eq!(resource.kind, expected.kind);
    assert_eq!(resource.presentation, expected.presentation);
    assert_eq!(resource.operations, expected.operations);

    assert!(!resource.name.is_empty());
    assert!(!resource.provider_locator.starts_with('/'));
    assert!(!resource.provider_locator.contains('\\'));
    assert!(
        !resource
            .provider_locator
            .split('/')
            .any(|component| component == "..")
    );
    assert!(!resource.legacy_locator.contains('\\'));
    assert!(!resource.operations.is_empty());
    assert!(resource.operations.windows(2).all(|pair| pair[0] < pair[1]));

    match resource.presentation {
        ResourcePresentation::Browse => {
            assert!(resource.operations.contains(&ProviderOperation::Browse));
        }
        ResourcePresentation::Audio | ResourcePresentation::Video => {
            assert!(resource.operations.contains(&ProviderOperation::Read));
            assert!(resource.operations.contains(&ProviderOperation::Stream));
        }
        ResourcePresentation::Conversation => {
            assert_eq!(resource.kind, ResourceKind::Conversation);
            assert!(resource.operations.contains(&ProviderOperation::Read));
        }
        _ => assert!(resource.operations.contains(&ProviderOperation::Read)),
    }

    match expected.version_prefix {
        Some(prefix) => {
            let version = resource.version.as_ref().expect("opaque version");
            assert!(version.as_str().starts_with(prefix));
            assert!(version.as_str().len() > prefix.len());
        }
        None => assert!(resource.version.is_none()),
    }
}

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

fn filesystem_fixture(name: &str) -> (PathBuf, Config, MediaRoot) {
    let base = std::env::temp_dir().join(format!(
        "derp-provider-conformance-{name}-{}",
        uuid::Uuid::new_v4()
    ));
    let media = base.join("media");
    std::fs::create_dir_all(&media).unwrap();
    let root = root("source-filesystem", "Media", media.clone());
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
    (base, config, root)
}

#[tokio::test]
async fn filesystem_read_provider_conforms() {
    let (base, config, root) = filesystem_fixture("filesystem");
    std::fs::write(root.path.join("alpha.txt"), b"alpha").unwrap();
    std::fs::write(root.path.join("beta.mp3"), b"beta").unwrap();
    let provider = FilesystemProvider::new(
        config.clone(),
        Arc::new(Thumbnailer::new(config.data_path.join("thumbnails"))),
    );

    assert_provider_conformance(
        &provider,
        ProviderSource::Filesystem {
            source_id: SourceId::new("source-filesystem"),
            root,
            legacy_root_prefix: true,
        },
        "",
        &[
            ExpectedResource {
                locator: "alpha.txt",
                legacy_locator: "Media/alpha.txt",
                kind: ResourceKind::File,
                presentation: ResourcePresentation::Text,
                version_prefix: Some("fs:v1:"),
                operations: vec![ProviderOperation::Read, ProviderOperation::Download],
            },
            ExpectedResource {
                locator: "beta.mp3",
                legacy_locator: "Media/beta.mp3",
                kind: ResourceKind::File,
                presentation: ResourcePresentation::Audio,
                version_prefix: Some("fs:v1:"),
                operations: vec![
                    ProviderOperation::Read,
                    ProviderOperation::Stream,
                    ProviderOperation::Download,
                ],
            },
        ],
    )
    .await;

    drop(provider);
    std::fs::remove_dir_all(base).unwrap();
}

struct ConformanceHermes;

impl HermesTransport for ConformanceHermes {
    fn profile(&self) -> Option<&str> {
        Some("conformance")
    }

    fn get<'a>(
        &'a self,
        path: &'a str,
        _query: &'a [(&'a str, String)],
    ) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(async move {
            match path {
                "api/sessions" => Ok(json!({
                    "sessions": [
                        {"id":"new","title":"New","last_active":2},
                        {"id":"old","title":"Old","last_active":1}
                    ],
                    "total": 2
                })),
                "api/sessions/new" => Ok(json!({"id":"new","title":"New","last_active":2})),
                "api/sessions/old" => Ok(json!({"id":"old","title":"Old","last_active":1})),
                _ => Err(AppError::internal("unexpected Hermes conformance get")),
            }
        })
    }

    fn patch<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(async { Err(AppError::internal("unexpected Hermes conformance patch")) })
    }

    fn post<'a>(&'a self, _path: &'a str, _body: Value) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(async { Err(AppError::internal("unexpected Hermes conformance post")) })
    }

    fn delete<'a>(&'a self, _path: &'a str) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async { Err(AppError::internal("unexpected Hermes conformance delete")) })
    }

    fn ensure_events<'a>(&'a self) -> BoxFuture<'a, AppResult<()>> {
        Box::pin(async { Ok(()) })
    }

    fn rpc<'a>(&'a self, method: &'a str, _params: Value) -> BoxFuture<'a, AppResult<Value>> {
        Box::pin(async move {
            match method {
                "projects.list" => Ok(json!({"projects": []})),
                _ => Err(AppError::internal("unexpected Hermes conformance rpc")),
            }
        })
    }
}

#[tokio::test]
async fn hermes_read_provider_conforms() {
    let provider = HermesProvider::new(Arc::new(ConformanceHermes));

    assert_provider_conformance(
        &provider,
        ProviderSource::Hermes {
            source_id: SourceId::new("source-hermes"),
        },
        "",
        &[
            ExpectedResource {
                locator: "archived",
                legacy_locator: "Hermes Sessions/archived",
                kind: ResourceKind::Folder,
                presentation: ResourcePresentation::Browse,
                version_prefix: None,
                operations: vec![ProviderOperation::Browse],
            },
            ExpectedResource {
                locator: "session/new",
                legacy_locator: "Hermes Sessions/session/new",
                kind: ResourceKind::Conversation,
                presentation: ResourcePresentation::Conversation,
                version_prefix: Some("hermes:v1:"),
                operations: vec![ProviderOperation::Read, ProviderOperation::Export],
            },
            ExpectedResource {
                locator: "session/old",
                legacy_locator: "Hermes Sessions/session/old",
                kind: ResourceKind::Conversation,
                presentation: ResourcePresentation::Conversation,
                version_prefix: Some("hermes:v1:"),
                operations: vec![ProviderOperation::Read, ProviderOperation::Export],
            },
        ],
    )
    .await;
}
