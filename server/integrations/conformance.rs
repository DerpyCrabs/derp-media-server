#[cfg(test)]
mod tests {
    use super::super::{
        contracts::{
            BrowseRequest, INTEGRATION_SCHEMA_VERSION, IntegrationActionOutcomeDto,
            IntegrationActionRequestDto, IntegrationCapabilityDto, IntegrationDescriptorDto,
            IntegrationOpenTargetDto, IntegrationSearchRequest, IntegrationSearchResultDto,
            ResourceKeyDto, ResourcePageDto, ResourceSummaryDto,
        },
        filesystem, hermes,
        registry::{
            ActionCapability, BrowseCapability, InspectCapability, IntegrationModule,
            IntegrationRegistry, SearchCapability, SearchContribution, validate_page,
            validate_summary,
        },
    };
    use crate::{
        app::AppState,
        config::{Config, FileSearchConfig, ImageOptimizationConfig, MediaRoot},
        error::{AppError, AppResult},
        file_commands::FileCommandService,
        file_search::FileSearch,
        image_variants::ImageVariants,
        integrations::hermes::{
            config::{HermesConfig, HermesFilesystemMode},
            runtime::HermesRuntime,
            transport::HermesTransport,
        },
        store,
        thumbnails::Thumbnailer,
    };
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode, header},
    };
    use futures_util::future::BoxFuture;
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use std::{
        collections::{HashSet, VecDeque},
        sync::{Arc, Mutex},
    };
    use tower::ServiceExt;

    fn summary(provider: &str, id: &str, name: &str, kind: &str) -> ResourceSummaryDto {
        ResourceSummaryDto {
            key: ResourceKeyDto::new(provider, id),
            name: name.into(),
            kind: kind.into(),
            mime: None,
            capabilities: if kind == "folder" || kind == "root" {
                vec!["browse".into()]
            } else {
                vec!["read".into()]
            },
            presentation: Some(if kind == "file" { "text" } else { "browse" }.into()),
            appearance: None,
            size: None,
            metadata: None,
        }
    }

    fn assert_declared_contract(module: &IntegrationModule) {
        module.validate().unwrap();
        let claimed = module.claimed_capabilities();
        assert_eq!(claimed, module.implemented_capabilities());
        if claimed.contains(&IntegrationCapabilityDto::Browse) {
            assert!(module.descriptor.root.is_some(), "browse requires a root");
        }
        if let Some(root) = module.descriptor.root.as_ref() {
            validate_summary(&module.descriptor.id, root).unwrap();
            assert!(!root.key.id.contains("Hermes Sessions"));
        }
    }

    fn app_state(config: Config, integrations: Arc<IntegrationRegistry>) -> AppState {
        let (application_events, _) = tokio::sync::broadcast::channel(8);
        AppState {
            file_commands: FileCommandService::new(config.clone()),
            dev: false,
            vite_port: 0,
            client: reqwest::Client::new(),
            application_events,
            reader_state_db: tokio::sync::Mutex::new(()),
            thumbnails: Thumbnailer::new(config.data_path.join("thumbnails")),
            image_variants: ImageVariants::new(
                config.data_path.join("image-variants"),
                config.image_optimization.clone(),
            ),
            config,
            integrations,
        }
    }

    async fn assert_registry_contract(
        registry: &Arc<IntegrationRegistry>,
        provider: &str,
        state: &AppState,
        action: &str,
        search_query: &str,
    ) {
        let descriptor = registry
            .descriptors()
            .into_iter()
            .find(|descriptor| descriptor.id == provider)
            .unwrap();
        let claimed = descriptor
            .capabilities
            .iter()
            .copied()
            .collect::<HashSet<_>>();
        let root = descriptor
            .root
            .expect("conformance providers expose a root");

        let mut resources = vec![root.clone()];
        if claimed.contains(&IntegrationCapabilityDto::Browse) {
            let page = registry
                .browse(
                    provider,
                    BrowseRequest {
                        key: root.key.clone(),
                        cursor: None,
                        limit: 100,
                    },
                )
                .await
                .unwrap();
            validate_page(provider, &page).unwrap();
            assert_eq!(page.location, root.key);
            assert_eq!(page.location_summary.as_ref().unwrap().key, page.location);
            assert!(page.items.len() <= page.total);
            resources.extend(page.breadcrumbs);
            resources.extend(page.items);
            resources.extend(page.recent_items);
        }

        if claimed.contains(&IntegrationCapabilityDto::Inspect) {
            for resource in resources {
                let inspected = registry
                    .inspect(provider, resource.key.clone())
                    .await
                    .unwrap();
                validate_summary(provider, &inspected).unwrap();
                assert_eq!(inspected.key, resource.key);
            }
        }

        if claimed.contains(&IntegrationCapabilityDto::Actions) {
            assert!(action.starts_with(&format!("{provider}.")));
            let outcome = registry
                .perform(
                    provider,
                    IntegrationActionRequestDto {
                        key: root.key.clone(),
                        action: action.into(),
                        name: None,
                        metadata: None,
                    },
                    state,
                )
                .await
                .unwrap();
            assert!(outcome.success);

            let alias = action.strip_prefix(&format!("{provider}.")).unwrap();
            let alias_error = registry
                .perform(
                    provider,
                    IntegrationActionRequestDto {
                        key: root.key.clone(),
                        action: alias.into(),
                        name: None,
                        metadata: None,
                    },
                    state,
                )
                .await
                .unwrap_err();
            assert_eq!(alias_error.0, StatusCode::BAD_REQUEST);

            let mismatch_error = registry
                .perform(
                    provider,
                    IntegrationActionRequestDto {
                        key: ResourceKeyDto::new("other", root.key.id.clone()),
                        action: action.into(),
                        name: None,
                        metadata: None,
                    },
                    state,
                )
                .await
                .unwrap_err();
            assert_eq!(mismatch_error.0, StatusCode::BAD_REQUEST);
        }

        if claimed.contains(&IntegrationCapabilityDto::Search) {
            let response = registry
                .search(IntegrationSearchRequest {
                    query: search_query.into(),
                    limit: 10,
                    contributors: None,
                    scope: None,
                })
                .await;
            assert_eq!(response.schema_version, INTEGRATION_SCHEMA_VERSION);
            assert!(response.failures.is_empty(), "{:?}", response.failures);
            assert!(!response.results.is_empty());
            assert!(response.results.len() <= 10);
            for result in response.results {
                assert_eq!(result.resource.key.provider, provider);
                validate_summary(provider, &result.resource).unwrap();
                let inspected = registry
                    .inspect(provider, result.resource.key.clone())
                    .await
                    .unwrap();
                assert_eq!(inspected.key, result.resource.key);
                if let Some(search_action) = result.action {
                    assert!(search_action.starts_with(&format!("{provider}.")));
                    let outcome = registry
                        .perform(
                            provider,
                            IntegrationActionRequestDto {
                                key: result.resource.key,
                                action: search_action,
                                name: None,
                                metadata: None,
                            },
                            state,
                        )
                        .await
                        .unwrap();
                    assert!(outcome.success);
                }
            }
        }
    }

    fn filesystem_config() -> (Config, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "derp-integration-conformance-{}",
            uuid::Uuid::new_v4()
        ));
        let media = base.join("media");
        let data = base.join("data");
        std::fs::create_dir_all(media.join("Knowledge")).unwrap();
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(
            media.join("Knowledge/fixture.txt"),
            "unique conformance needle",
        )
        .unwrap();
        let config = Config {
            port: 3000,
            roots: vec![MediaRoot {
                id: "media".into(),
                name: "Media".into(),
                path: media,
                editable_folders: Vec::new(),
            }],
            library_key: "library".into(),
            data_path: data.clone(),
            file_search: FileSearchConfig {
                enabled: false,
                index_path: data.join("search.sqlite"),
                watch_mode: "off".into(),
                max_recursive_watchers: 0,
                max_fs_concurrency: 1,
                reconcile_directories_per_second: 1,
            },
            image_optimization: ImageOptimizationConfig::default(),
            hermes: None,
        };
        crate::state_db::initialize(&config).unwrap();
        store::update(
            &config,
            store::StateDocument::SettingsV1,
            crate::app::default_settings(),
            |settings| {
                settings["knowledgeBases"] = json!(["Knowledge"]);
                Ok(())
            },
        )
        .unwrap();
        (config, base)
    }

    #[tokio::test]
    async fn filesystem_provider_conforms() {
        let (config, base) = filesystem_config();
        let search = FileSearch::new(config.file_search.clone(), config.roots.clone());
        let module = filesystem::module(config.clone(), search);
        assert_declared_contract(&module);
        let registry = IntegrationRegistry::new(vec![module]).unwrap();
        let state = app_state(config, registry.clone());
        assert_registry_contract(
            &registry,
            filesystem::PROVIDER_ID,
            &state,
            "filesystem.download",
            "unique conformance needle",
        )
        .await;
        let _ = std::fs::remove_dir_all(base);
    }

    struct FakeHermesTransport {
        gets: Mutex<VecDeque<Value>>,
        rpcs: Mutex<VecDeque<Value>>,
    }

    impl HermesTransport for FakeHermesTransport {
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
                    .ok_or_else(|| AppError::internal("fake get exhausted"))
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
                    .ok_or_else(|| AppError::internal("fake rpc exhausted"))
            })
        }
    }

    fn hermes_module() -> IntegrationModule {
        let config = HermesConfig {
            gateway_url: url::Url::parse("http://127.0.0.1:4000/").unwrap(),
            token: None,
            profile: Some("test".into()),
            filesystem_mode: HermesFilesystemMode::Upload,
            auto_start: false,
            home: None,
        };
        let session = json!({
            "id":"session-1",
            "title":"Unique conformance session",
            "last_active":1,
            "archived":false
        });
        let transport: Arc<dyn HermesTransport> = Arc::new(FakeHermesTransport {
            gets: Mutex::new(VecDeque::from([
                json!({"sessions":[],"total":0}),
                json!({"sessions":[session.clone()],"total":1}),
                json!({"sessions":[],"total":0}),
                session.clone(),
                session,
            ])),
            rpcs: Mutex::new(VecDeque::from([json!({"projects":[]})])),
        });
        let (events, _) = tokio::sync::broadcast::channel(8);
        hermes::module_from_runtime(HermesRuntime::new(config, transport, events, None))
    }

    #[tokio::test]
    async fn hermes_provider_conforms_with_opaque_resources_only() {
        let module = hermes_module();
        assert_declared_contract(&module);
        let root = module.descriptor.root.as_ref().unwrap().key.clone();
        assert_eq!(root.id, "v1:4:root");
        let registry = IntegrationRegistry::new(vec![module]).unwrap();
        let (config, base) = filesystem_config();
        let state = app_state(config, registry.clone());
        assert_registry_contract(
            &registry,
            hermes::PROVIDER_ID,
            &state,
            "hermes.createFile",
            "unique conformance",
        )
        .await;
        let serialized = serde_json::to_string(&registry.descriptors()).unwrap();
        assert!(!serialized.contains("Hermes Sessions/"));
        let _ = std::fs::remove_dir_all(base);
    }

    struct FixtureIntegration;

    impl FixtureIntegration {
        fn root() -> ResourceSummaryDto {
            summary("fixture", "root", "Fixture", "root")
        }

        fn item() -> ResourceSummaryDto {
            summary("fixture", "item-1", "Fixture item", "file")
        }
    }

    impl BrowseCapability for FixtureIntegration {
        fn browse<'a>(
            &'a self,
            request: BrowseRequest,
        ) -> BoxFuture<'a, AppResult<ResourcePageDto>> {
            Box::pin(async move {
                if request.key != Self::root().key {
                    return Err(AppError::not_found("Fixture location not found"));
                }
                Ok(ResourcePageDto {
                    schema_version: INTEGRATION_SCHEMA_VERSION,
                    location: request.key,
                    location_summary: Some(Self::root()),
                    breadcrumbs: Vec::new(),
                    items: vec![Self::item()],
                    recent_items: Vec::new(),
                    next_cursor: None,
                    total: 1,
                })
            })
        }
    }

    impl InspectCapability for FixtureIntegration {
        fn inspect<'a>(
            &'a self,
            key: ResourceKeyDto,
        ) -> BoxFuture<'a, AppResult<ResourceSummaryDto>> {
            Box::pin(async move {
                if key == Self::root().key {
                    Ok(Self::root())
                } else if key == Self::item().key {
                    Ok(Self::item())
                } else {
                    Err(AppError::not_found("Fixture resource not found"))
                }
            })
        }
    }

    impl ActionCapability for FixtureIntegration {
        fn perform<'a>(
            &'a self,
            request: IntegrationActionRequestDto,
            _state: &'a AppState,
        ) -> BoxFuture<'a, AppResult<IntegrationActionOutcomeDto>> {
            Box::pin(async move {
                if request.action != "fixture.open" {
                    return Err(AppError::bad("Unsupported fixture action"));
                }
                Ok(IntegrationActionOutcomeDto {
                    success: true,
                    resource: Some(Self::item()),
                    open_target: Some(IntegrationOpenTargetDto {
                        kind: "resource".into(),
                        resource: Some(Self::item().key),
                        read_only: true,
                        payload: None,
                    }),
                    data: None,
                })
            })
        }
    }

    impl SearchCapability for FixtureIntegration {
        fn search<'a>(
            &'a self,
            request: IntegrationSearchRequest,
        ) -> BoxFuture<'a, AppResult<SearchContribution>> {
            Box::pin(async move {
                let results = request
                    .query
                    .contains("fixture")
                    .then(|| IntegrationSearchResultDto {
                        id: "fixture:item-1".into(),
                        contributor: "fixture.search".into(),
                        resource: Self::item(),
                        title: "Fixture item".into(),
                        detail: None,
                        snippet: None,
                        score: 1.0,
                        action: Some("fixture.open".into()),
                    })
                    .into_iter()
                    .collect();
                Ok(SearchContribution {
                    results,
                    truncated: false,
                })
            })
        }
    }

    fn fixture_module() -> IntegrationModule {
        let runtime = Arc::new(FixtureIntegration);
        IntegrationModule {
            descriptor: IntegrationDescriptorDto {
                id: "fixture".into(),
                name: "Fixture".into(),
                capabilities: vec![
                    IntegrationCapabilityDto::Browse,
                    IntegrationCapabilityDto::Inspect,
                    IntegrationCapabilityDto::Actions,
                    IntegrationCapabilityDto::Search,
                ],
                root: Some(FixtureIntegration::root()),
            },
            browse: Some(runtime.clone()),
            inspect: Some(runtime.clone()),
            actions: Some(runtime.clone()),
            search: Some(runtime),
            change: None,
            shutdown: None,
            routes: Router::new(),
        }
    }

    async fn response_json(router: &Router, request: Request<Body>) -> Value {
        let response = router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
    }

    #[tokio::test]
    async fn fixture_module_single_registration_reaches_registry_http_and_ssr() {
        let module = fixture_module();
        assert_declared_contract(&module);
        let registry = IntegrationRegistry::new(vec![module]).unwrap();
        let (config, base) = filesystem_config();
        let state = Arc::new(app_state(config, registry.clone()));
        assert_registry_contract(&registry, "fixture", &state, "fixture.open", "fixture").await;

        let router = crate::server::build_router(state.clone());
        let descriptors = response_json(
            &router,
            Request::builder()
                .uri("/api/integrations")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(descriptors[0]["id"], "fixture");

        let browsed = response_json(
            &router,
            Request::builder()
                .uri("/api/integrations/fixture/browse?id=root")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(browsed["items"][0]["key"]["id"], "item-1");

        let inspected = response_json(
            &router,
            Request::builder()
                .uri("/api/integrations/fixture/inspect?id=item-1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(inspected["key"]["id"], "item-1");

        let action = response_json(
            &router,
            Request::builder()
                .method("POST")
                .uri("/api/integrations/fixture/actions")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({
                        "key":{"provider":"fixture","id":"root"},
                        "action":"fixture.open"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await;
        assert_eq!(action["openTarget"]["resource"]["id"], "item-1");

        let searched = response_json(
            &router,
            Request::builder()
                .uri("/api/search?q=fixture&limit=10")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(searched["results"][0]["resource"]["key"]["id"], "item-1");

        let dehydrated = crate::html::dehydrated(&state, &"/".parse().unwrap()).await;
        let bootstrap = dehydrated["queries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|query| query["queryKey"] == json!(["integrations"]))
            .unwrap()["state"]["data"]
            .clone();
        assert_eq!(bootstrap, descriptors);
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn duplicate_registration_and_capability_drift_are_rejected() {
        let (config, base) = filesystem_config();
        let search = FileSearch::new(config.file_search.clone(), config.roots.clone());
        let first = filesystem::module(config.clone(), search.clone());
        let mut drifted = filesystem::module(config.clone(), search.clone());
        drifted.actions = None;
        assert!(drifted.validate().is_err());
        let duplicate = filesystem::module(config, search);
        assert!(IntegrationRegistry::new(vec![first, duplicate]).is_err());
        let _ = std::fs::remove_dir_all(base);
    }
}
