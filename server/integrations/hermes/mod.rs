pub(crate) mod browser;
pub(crate) mod config;
mod process;
mod routes;
pub(crate) mod runtime;
pub(crate) mod transport;

use super::{
    contracts::{IntegrationCapabilityDto, IntegrationDescriptorDto},
    registry::IntegrationModule,
};
use std::sync::Arc;

pub(crate) const PROVIDER_ID: &str = "hermes";

pub(crate) async fn module(
    configured: Option<&config::HermesConfig>,
    client: reqwest::Client,
) -> Result<Option<IntegrationModule>, String> {
    let mut managed = match process::start(configured).await {
        Ok(managed) => managed,
        Err(error) => {
            eprintln!("Failed to auto-start Hermes backend: {error}");
            None
        }
    };
    let mut config = configured.cloned();
    if let (Some(config), Some(token)) = (
        config.as_mut(),
        managed.as_ref().and_then(|managed| managed.token.clone()),
    ) {
        config.token = Some(token);
    }
    let Some(config) = config else {
        return Ok(None);
    };
    let (events, _) = tokio::sync::broadcast::channel(1024);
    let (transport_events, _) = tokio::sync::broadcast::channel(1024);
    let transport: Arc<dyn transport::HermesTransport> = Arc::new(transport::HermesHub::new(
        config.clone(),
        client,
        transport_events.clone(),
    ));
    let runtime = runtime::HermesRuntime::new(config, transport, events, managed.take());
    routes::start_event_bridge(&runtime, transport_events.subscribe());
    Ok(Some(module_from_runtime(runtime)))
}

pub(crate) fn module_from_runtime(runtime: Arc<runtime::HermesRuntime>) -> IntegrationModule {
    IntegrationModule {
        descriptor: IntegrationDescriptorDto {
            id: PROVIDER_ID.into(),
            name: "Hermes".into(),
            capabilities: vec![
                IntegrationCapabilityDto::Browse,
                IntegrationCapabilityDto::Inspect,
                IntegrationCapabilityDto::Actions,
                IntegrationCapabilityDto::Search,
            ],
            root: Some(browser::root_summary()),
        },
        browse: Some(runtime.clone()),
        inspect: Some(runtime.clone()),
        actions: Some(runtime.clone()),
        search: Some(runtime.clone()),
        change: None,
        shutdown: Some(runtime.clone()),
        routes: routes::router(runtime),
    }
}
