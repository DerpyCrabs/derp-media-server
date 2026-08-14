import { api } from '@/lib/api'
import type {
  IntegrationActionOutcomeDto,
  IntegrationActionRequestDto,
  IntegrationDescriptorDto,
  IntegrationSearchResponseDto,
  ResourcePageDto,
  ResourceSummaryDto,
} from '@/lib/generated/api-contracts'
import { apiRoutes } from '@/lib/generated/api-contracts'
import type { ResourceKey, ResourcePage, ResourceSummary } from '@/lib/domain/resource'
import type { SearchContributor, SearchContributorResponse } from '@/src/features/search/contracts'

export function resourceSummaryFromDto(dto: ResourceSummaryDto): ResourceSummary {
  return {
    key: dto.key,
    name: dto.name,
    kind: dto.kind,
    capabilities: dto.capabilities ?? [],
    ...(dto.mime ? { mime: dto.mime } : {}),
    ...(dto.presentation ? { presentation: dto.presentation } : {}),
    ...(dto.appearance ? { appearance: dto.appearance } : {}),
    ...(dto.size === undefined ? {} : { size: dto.size }),
    ...(dto.metadata ? { metadata: dto.metadata } : {}),
  }
}

function integrationUrl(
  provider: string,
  operation: 'browse' | 'inspect' | 'actions' | 'upload',
): string {
  return `${apiRoutes.integrations}/${encodeURIComponent(provider)}/${operation}`
}

export async function uploadIntegrationFiles(
  key: ResourceKey,
  files: readonly File[],
  signal?: AbortSignal,
): Promise<unknown> {
  const body = new FormData()
  body.append('targetId', key.id)
  for (const file of files) body.append('files', file, file.name)
  return api(integrationUrl(key.provider, 'upload'), { method: 'POST', body, signal })
}

export function loadIntegrationDescriptors(
  signal?: AbortSignal,
): Promise<IntegrationDescriptorDto[]> {
  return api(apiRoutes.integrations, { signal })
}

export async function browseIntegrationResource(request: {
  location: ResourceKey
  cursor?: string
  limit?: number
  signal?: AbortSignal
}): Promise<ResourcePage> {
  const search = new URLSearchParams({ id: request.location.id })
  if (request.cursor) search.set('cursor', request.cursor)
  if (request.limit) search.set('limit', String(request.limit))
  const dto = await api<ResourcePageDto>(
    `${integrationUrl(request.location.provider, 'browse')}?${search}`,
    { signal: request.signal },
  )
  return {
    schemaVersion: 1,
    location: dto.location,
    ...(dto.locationSummary
      ? { locationSummary: resourceSummaryFromDto(dto.locationSummary) }
      : {}),
    breadcrumbs: (dto.breadcrumbs ?? []).map(resourceSummaryFromDto),
    items: dto.items.map(resourceSummaryFromDto),
    ...(dto.recentItems ? { recentItems: dto.recentItems.map(resourceSummaryFromDto) } : {}),
    ...(dto.nextCursor ? { nextCursor: dto.nextCursor } : {}),
    total: dto.total ?? dto.items.length,
  }
}

export async function inspectIntegrationResource(
  key: ResourceKey,
  signal?: AbortSignal,
): Promise<ResourceSummary> {
  const search = new URLSearchParams({ id: key.id })
  return resourceSummaryFromDto(
    await api<ResourceSummaryDto>(`${integrationUrl(key.provider, 'inspect')}?${search}`, {
      signal,
    }),
  )
}

export async function runIntegrationAction(
  key: ResourceKey,
  action: string,
  input?: unknown,
  signal?: AbortSignal,
): Promise<IntegrationActionOutcomeDto> {
  const value =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const request: IntegrationActionRequestDto = {
    key,
    action,
    ...(typeof value.name === 'string' ? { name: value.name } : {}),
    ...(input === undefined
      ? {}
      : {
          metadata:
            typeof value.metadata === 'object' && value.metadata !== null
              ? (value.metadata as Record<string, unknown>)
              : value,
        }),
  }
  return api(integrationUrl(key.provider, 'actions'), {
    method: 'POST',
    signal,
    body: JSON.stringify(request),
  })
}

export function searchContributorResponseFromDto(
  response: IntegrationSearchResponseDto,
): SearchContributorResponse {
  return {
    truncated: response.truncated,
    failures: (response.failures ?? []).map((failure) => ({
      contributorId: failure.contributor,
      message: failure.message,
    })),
    results: response.results.map((result) => ({
      id: result.id,
      title: result.title,
      ...(result.detail ? { detail: result.detail } : {}),
      ...(result.snippet ? { snippet: result.snippet } : {}),
      score: result.score,
      resource: resourceSummaryFromDto(result.resource),
      ...(result.action ? { actionId: result.action } : {}),
      group: result.contributor,
    })),
  }
}

export const serverIntegrationSearchContributor: SearchContributor = {
  id: 'server.integrations',
  label: 'Library',
  async search(request) {
    if (Array.from(request.query).length < 3) return { results: [] }
    const search = new URLSearchParams({ q: request.query, limit: String(request.limit) })
    const response = await api<IntegrationSearchResponseDto>(
      `${apiRoutes.integrationSearch}?${search}`,
      {
        signal: request.signal,
      },
    )
    return searchContributorResponseFromDto(response)
  },
}
