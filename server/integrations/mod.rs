pub(crate) mod contracts;
pub(crate) mod filesystem;
pub(crate) mod hermes;
pub(crate) mod registry;
pub(crate) mod routes;

#[cfg(test)]
pub(crate) mod conformance;

use crate::{config::Config, file_search::FileSearch};
use registry::IntegrationRegistry;
use std::sync::Arc;

pub(crate) async fn build(
    config: &Config,
    client: reqwest::Client,
    file_search: Arc<FileSearch>,
) -> Result<Arc<IntegrationRegistry>, String> {
    let mut modules = vec![filesystem::module(config.clone(), file_search)];
    if let Some(module) = hermes::module(config.hermes.as_ref(), client).await? {
        modules.push(module);
    }
    IntegrationRegistry::new(modules)
}
