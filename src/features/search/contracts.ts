import type { ResourceSummary } from '@/lib/domain/resource'

export const SEARCH_MIN_QUERY_LENGTH = 3
export const SEARCH_DEFAULT_LIMIT = 50

export type SearchRequest = Readonly<{
  query: string
  limit: number
  signal?: AbortSignal
}>

export type SearchResult = Readonly<{
  id: string
  title: string
  detail?: string
  snippet?: string
  group?: string
  score?: number
  resource?: ResourceSummary
  actionId?: string
  metadata?: Readonly<Record<string, unknown>>
}>

export type SearchContributorResponse = Readonly<{
  results: readonly SearchResult[]
  truncated?: boolean
  failures?: readonly Readonly<{
    contributorId: string
    message: string
  }>[]
}>

export interface SearchContributor {
  readonly id: string
  readonly label: string
  search(request: SearchRequest): Promise<SearchContributorResponse>
  execute?(result: SearchResult): void | Promise<void>
}

export type SearchHit = SearchResult &
  Readonly<{
    contributorId: string
    contributorLabel: string
  }>

export type SearchContributorStatus = Readonly<{
  contributorId: string
  status: 'ready' | 'error'
  message?: string
  truncated?: boolean
}>

export type SearchResponse = Readonly<{
  results: readonly SearchHit[]
  contributors: readonly SearchContributorStatus[]
  truncated: boolean
}>
