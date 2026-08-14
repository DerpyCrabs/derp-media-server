use super::contracts::{
    BrowseRequest, IntegrationActionOutcomeDto, IntegrationActionRequestDto,
    IntegrationDescriptorDto, IntegrationSearchRequest, IntegrationSearchResponseDto,
    ResourceKeyDto, ResourcePageDto, ResourceSummaryDto,
};
use crate::{
    app::Shared,
    application_queries,
    error::{AppError, AppResult},
    extractors::{ApiJson, ApiQuery},
};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use serde::Deserialize;

pub(crate) const API_INTEGRATIONS_PATH: &str = "/api/integrations";
pub(crate) const API_INTEGRATION_SEARCH_PATH: &str = "/api/search";

#[derive(Deserialize)]
struct BrowseQuery {
    id: String,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn integrations(State(state): State<Shared>) -> Json<Vec<IntegrationDescriptorDto>> {
    Json(application_queries::integrations(&state))
}

async fn browse(
    State(state): State<Shared>,
    Path(provider): Path<String>,
    ApiQuery(query): ApiQuery<BrowseQuery>,
) -> AppResult<Json<ResourcePageDto>> {
    let request = BrowseRequest {
        key: ResourceKeyDto::new(&provider, query.id),
        cursor: query.cursor,
        limit: query.limit.unwrap_or(200).clamp(1, 500),
    };
    Ok(Json(state.integrations.browse(&provider, request).await?))
}

#[derive(Deserialize)]
struct InspectQuery {
    id: String,
}

async fn inspect(
    State(state): State<Shared>,
    Path(provider): Path<String>,
    ApiQuery(query): ApiQuery<InspectQuery>,
) -> AppResult<Json<ResourceSummaryDto>> {
    let key = ResourceKeyDto::new(&provider, query.id);
    Ok(Json(state.integrations.inspect(&provider, key).await?))
}

async fn action(
    State(state): State<Shared>,
    Path(provider): Path<String>,
    ApiJson(request): ApiJson<IntegrationActionRequestDto>,
) -> AppResult<Json<IntegrationActionOutcomeDto>> {
    if request.action.trim().is_empty() {
        return Err(AppError::bad("Integration action is required"));
    }
    Ok(Json(
        state
            .integrations
            .perform(&provider, request, &state)
            .await?,
    ))
}

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    limit: Option<usize>,
}

async fn search(
    State(state): State<Shared>,
    ApiQuery(query): ApiQuery<SearchQuery>,
) -> AppResult<Json<IntegrationSearchResponseDto>> {
    let requested_limit = query.limit;
    let query = query
        .q
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::bad("q must be a non-empty string"))?;
    if query.chars().count() > 200 {
        return Err(AppError::bad("Query cannot exceed 200 characters"));
    }
    Ok(Json(
        state
            .integrations
            .search(IntegrationSearchRequest {
                query,
                limit: query_limit(50, requested_limit),
            })
            .await,
    ))
}

fn query_limit(default: usize, requested: Option<usize>) -> usize {
    requested.unwrap_or(default).clamp(1, 200)
}

pub(crate) fn router() -> Router<Shared> {
    Router::new()
        .route(API_INTEGRATIONS_PATH, get(integrations))
        .route("/api/integrations/{provider}/browse", get(browse))
        .route("/api/integrations/{provider}/inspect", get(inspect))
        .route("/api/integrations/{provider}/actions", post(action))
        .route(API_INTEGRATION_SEARCH_PATH, get(search))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_limit_is_bounded() {
        assert_eq!(query_limit(50, None), 50);
        assert_eq!(query_limit(50, Some(0)), 1);
        assert_eq!(query_limit(50, Some(999)), 200);
    }
}
