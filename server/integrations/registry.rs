use super::contracts::{
    BrowseRequest, INTEGRATION_SCHEMA_VERSION, IntegrationActionOutcomeDto,
    IntegrationActionRequestDto, IntegrationCapabilityDto, IntegrationDescriptorDto,
    IntegrationSearchFailureDto, IntegrationSearchRequest, IntegrationSearchResponseDto,
    IntegrationSearchResultDto, ResourceKeyDto, ResourcePageDto, ResourceSummaryDto,
};
use crate::{
    app::{AppState, Shared},
    error::{AppError, AppResult},
};
use axum::Router;
use futures_util::future::{BoxFuture, join_all};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

pub(crate) trait BrowseCapability: Send + Sync {
    fn browse<'a>(&'a self, request: BrowseRequest) -> BoxFuture<'a, AppResult<ResourcePageDto>>;
}

pub(crate) trait InspectCapability: Send + Sync {
    fn inspect<'a>(&'a self, key: ResourceKeyDto) -> BoxFuture<'a, AppResult<ResourceSummaryDto>>;
}

pub(crate) trait ActionCapability: Send + Sync {
    fn perform<'a>(
        &'a self,
        request: IntegrationActionRequestDto,
        state: &'a AppState,
    ) -> BoxFuture<'a, AppResult<IntegrationActionOutcomeDto>>;
}

#[derive(Clone, Debug)]
pub(crate) struct SearchContribution {
    pub results: Vec<IntegrationSearchResultDto>,
    pub truncated: bool,
}

pub(crate) trait SearchCapability: Send + Sync {
    fn search<'a>(
        &'a self,
        request: IntegrationSearchRequest,
    ) -> BoxFuture<'a, AppResult<SearchContribution>>;
}

pub(crate) trait ChangeCapability: Send + Sync {
    fn changed(&self, locator: &str);
}

pub(crate) trait ShutdownCapability: Send + Sync {
    fn shutdown<'a>(&'a self) -> BoxFuture<'a, ()>;
}

pub(crate) struct IntegrationModule {
    pub descriptor: IntegrationDescriptorDto,
    pub browse: Option<Arc<dyn BrowseCapability>>,
    pub inspect: Option<Arc<dyn InspectCapability>>,
    pub actions: Option<Arc<dyn ActionCapability>>,
    pub search: Option<Arc<dyn SearchCapability>>,
    pub change: Option<Arc<dyn ChangeCapability>>,
    pub shutdown: Option<Arc<dyn ShutdownCapability>>,
    pub routes: Router<Shared>,
}

impl IntegrationModule {
    pub(crate) fn claimed_capabilities(&self) -> HashSet<IntegrationCapabilityDto> {
        self.descriptor.capabilities.iter().copied().collect()
    }

    pub(crate) fn implemented_capabilities(&self) -> HashSet<IntegrationCapabilityDto> {
        [
            (self.browse.is_some(), IntegrationCapabilityDto::Browse),
            (self.inspect.is_some(), IntegrationCapabilityDto::Inspect),
            (self.actions.is_some(), IntegrationCapabilityDto::Actions),
            (self.search.is_some(), IntegrationCapabilityDto::Search),
        ]
        .into_iter()
        .filter_map(|(present, capability)| present.then_some(capability))
        .collect()
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        let id = self.descriptor.id.trim();
        if id.is_empty() || id.contains(['/', '\\']) || id == "." || id == ".." {
            return Err("integration id must be a stable path-free identifier".into());
        }
        if self.descriptor.name.trim().is_empty() {
            return Err(format!("integration {id} has no display name"));
        }
        if self.claimed_capabilities() != self.implemented_capabilities() {
            return Err(format!(
                "integration {id} capability claims do not match implementations"
            ));
        }
        if let Some(root) = self.descriptor.root.as_ref() {
            validate_key(&root.key, id)?;
            if root.name.trim().is_empty() || root.kind.trim().is_empty() {
                return Err(format!("integration {id} has an invalid root resource"));
            }
        }
        Ok(())
    }
}

pub(crate) struct IntegrationRegistry {
    modules: HashMap<String, Arc<IntegrationModule>>,
    order: Vec<String>,
}

impl IntegrationRegistry {
    pub(crate) fn new(modules: Vec<IntegrationModule>) -> Result<Arc<Self>, String> {
        let mut by_id = HashMap::new();
        let mut order = Vec::new();
        for module in modules {
            module.validate()?;
            let id = module.descriptor.id.clone();
            if by_id.insert(id.clone(), Arc::new(module)).is_some() {
                return Err(format!("duplicate integration id: {id}"));
            }
            order.push(id);
        }
        Ok(Arc::new(Self {
            modules: by_id,
            order,
        }))
    }

    pub(crate) fn descriptors(&self) -> Vec<IntegrationDescriptorDto> {
        self.order
            .iter()
            .filter_map(|id| self.modules.get(id))
            .map(|module| module.descriptor.clone())
            .collect()
    }

    pub(crate) fn router(&self) -> Router<Shared> {
        self.order
            .iter()
            .filter_map(|id| self.modules.get(id))
            .fold(Router::new(), |router, module| {
                router.merge(module.routes.clone())
            })
    }

    pub(crate) async fn browse(
        &self,
        provider: &str,
        request: BrowseRequest,
    ) -> AppResult<ResourcePageDto> {
        validate_provider_key(provider, &request.key)?;
        let capability = self
            .modules
            .get(provider)
            .and_then(|module| module.browse.clone())
            .ok_or_else(|| AppError::not_found("Browse capability is unavailable"))?;
        let page = capability.browse(request).await?;
        validate_page(provider, &page).map_err(AppError::internal)?;
        Ok(page)
    }

    pub(crate) async fn inspect(
        &self,
        provider: &str,
        key: ResourceKeyDto,
    ) -> AppResult<ResourceSummaryDto> {
        validate_provider_key(provider, &key)?;
        let capability = self
            .modules
            .get(provider)
            .and_then(|module| module.inspect.clone())
            .ok_or_else(|| AppError::not_found("Inspect capability is unavailable"))?;
        let summary = capability.inspect(key).await?;
        validate_summary(provider, &summary).map_err(AppError::internal)?;
        Ok(summary)
    }

    pub(crate) async fn perform(
        &self,
        provider: &str,
        request: IntegrationActionRequestDto,
        state: &AppState,
    ) -> AppResult<IntegrationActionOutcomeDto> {
        validate_provider_key(provider, &request.key)?;
        validate_action_id(provider, &request.action).map_err(AppError::bad)?;
        let capability = self
            .modules
            .get(provider)
            .and_then(|module| module.actions.clone())
            .ok_or_else(|| AppError::not_found("Action capability is unavailable"))?;
        let outcome = capability.perform(request, state).await?;
        validate_action_outcome(provider, &outcome).map_err(AppError::internal)?;
        if let Some(resource) = outcome
            .open_target
            .as_ref()
            .and_then(|target| target.resource.as_ref())
            && !self.modules.contains_key(&resource.provider)
        {
            return Err(AppError::internal(
                "integration action returned an unregistered resource provider",
            ));
        }
        Ok(outcome)
    }

    pub(crate) async fn search(
        &self,
        request: IntegrationSearchRequest,
    ) -> IntegrationSearchResponseDto {
        let futures = self
            .order
            .iter()
            .filter_map(|id| {
                self.modules
                    .get(id)
                    .and_then(|module| module.search.clone())
                    .map(|capability| (id.clone(), capability))
            })
            .map(|(id, capability)| {
                let request = request.clone();
                async move { (id, capability.search(request).await) }
            });
        let mut results = Vec::new();
        let mut failures = Vec::new();
        let mut truncated = false;
        for (contributor, result) in join_all(futures).await {
            match result {
                Ok(contribution) => {
                    truncated |= contribution.truncated;
                    for result in contribution.results {
                        if validate_search_result(&contributor, &result).is_ok() {
                            results.push(result);
                        } else {
                            failures.push(IntegrationSearchFailureDto {
                                contributor: contributor.clone(),
                                message: "contributor returned an invalid resource".into(),
                            });
                        }
                    }
                }
                Err(error) => failures.push(IntegrationSearchFailureDto {
                    contributor,
                    message: error.1,
                }),
            }
        }
        results.sort_by(|left, right| {
            right
                .score
                .total_cmp(&left.score)
                .then_with(|| natord::compare_ignore_case(&left.title, &right.title))
                .then_with(|| left.id.cmp(&right.id))
        });
        let mut seen = HashSet::new();
        results.retain(|result| {
            seen.insert((
                result.resource.key.provider.clone(),
                result.resource.key.id.clone(),
            ))
        });
        truncated |= results.len() > request.limit;
        results.truncate(request.limit);
        IntegrationSearchResponseDto {
            schema_version: INTEGRATION_SCHEMA_VERSION,
            results,
            truncated,
            failures,
        }
    }

    pub(crate) fn changed(&self, provider: &str, locator: &str) {
        if let Some(capability) = self
            .modules
            .get(provider)
            .and_then(|module| module.change.as_ref())
        {
            capability.changed(locator);
        }
    }

    pub(crate) async fn shutdown(&self) {
        for id in self.order.iter().rev() {
            if let Some(capability) = self
                .modules
                .get(id)
                .and_then(|module| module.shutdown.as_ref())
            {
                capability.shutdown().await;
            }
        }
    }
}

fn validate_provider_key(provider: &str, key: &ResourceKeyDto) -> AppResult<()> {
    if key.provider != provider {
        return Err(AppError::bad(
            "Resource provider does not match route provider",
        ));
    }
    validate_key(key, provider).map_err(AppError::bad)
}

pub(crate) fn validate_key(key: &ResourceKeyDto, provider: &str) -> Result<(), String> {
    if key.provider != provider || key.id.trim().is_empty() || key.id.contains(['\\', '\n', '\r']) {
        return Err("resource key is invalid".into());
    }
    Ok(())
}

pub(crate) fn validate_summary(provider: &str, summary: &ResourceSummaryDto) -> Result<(), String> {
    validate_key(&summary.key, provider)?;
    if summary.name.trim().is_empty() || summary.kind.trim().is_empty() {
        return Err("resource summary is incomplete".into());
    }
    Ok(())
}

pub(crate) fn validate_page(provider: &str, page: &ResourcePageDto) -> Result<(), String> {
    if page.schema_version != INTEGRATION_SCHEMA_VERSION {
        return Err("resource page schema version is unsupported".into());
    }
    validate_key(&page.location, provider)?;
    for summary in page
        .location_summary
        .iter()
        .chain(page.breadcrumbs.iter())
        .chain(page.items.iter())
        .chain(page.recent_items.iter())
    {
        validate_summary(provider, summary)?;
    }
    Ok(())
}

fn validate_action_outcome(
    provider: &str,
    outcome: &IntegrationActionOutcomeDto,
) -> Result<(), String> {
    if let Some(resource) = outcome.resource.as_ref() {
        validate_summary(provider, resource)?;
    }
    if let Some(target) = outcome.open_target.as_ref() {
        if target.kind.trim().is_empty() {
            return Err("integration action returned an invalid open target".into());
        }
        if let Some(resource) = target.resource.as_ref() {
            let target_provider = resource.provider.clone();
            validate_key(resource, &target_provider)?;
        }
    }
    Ok(())
}

pub(crate) fn validate_action_id(provider: &str, action: &str) -> Result<(), String> {
    let namespace = format!("{provider}.");
    let Some(id) = action.strip_prefix(&namespace) else {
        return Err("integration action id is outside the provider namespace".into());
    };
    if id.is_empty() || id.contains(['.', '/', '\\', '\n', '\r']) {
        return Err("integration action id is invalid".into());
    }
    Ok(())
}

fn validate_search_result(
    provider: &str,
    result: &IntegrationSearchResultDto,
) -> Result<(), String> {
    validate_summary(provider, &result.resource)?;
    let contributor_namespace = format!("{provider}.");
    if result.id.trim().is_empty()
        || result.contributor.trim().is_empty()
        || (result.contributor != provider
            && !result.contributor.starts_with(&contributor_namespace))
        || result.title.trim().is_empty()
        || !result.score.is_finite()
        || result
            .action
            .as_ref()
            .is_some_and(|action| validate_action_id(provider, action).is_err())
    {
        return Err("integration search result is invalid".into());
    }
    Ok(())
}
