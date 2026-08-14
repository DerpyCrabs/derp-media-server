import type {
  SearchContributor,
  SearchHit,
  SearchRequest,
  SearchResponse,
  SearchResult,
} from './contracts'

export function normalizeSearchText(value: string): string {
  return value.replace(/\\/g, '/').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

function requireId(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} id must not be empty`)
  return value
}

function resultIdentity(contributorId: string, result: SearchResult): string {
  const resource = result.resource
  return resource
    ? `resource:${resource.key.provider}:${resource.key.id}`
    : `result:${contributorId}:${result.id}`
}

function textScore(query: string, result: SearchResult): number {
  const title = normalizeSearchText(result.title)
  const detail = normalizeSearchText(`${result.detail ?? ''} ${result.snippet ?? ''}`)
  if (title === query) return 1_000
  if (title.startsWith(query)) return 800
  if (title.includes(query)) return 600
  if (detail.includes(query)) return 400
  const terms = query.split(/\s+/).filter(Boolean)
  if (terms.length && terms.every((term) => `${title} ${detail}`.includes(term))) return 200
  return 0
}

function rankedScore(query: string, result: SearchResult): number {
  const provided = Number.isFinite(result.score) ? result.score! : 0
  return textScore(query, result) + provided
}

function compareHits(query: string, left: SearchHit, right: SearchHit): number {
  return (
    rankedScore(query, right) - rankedScore(query, left) ||
    left.contributorLabel.localeCompare(right.contributorLabel) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  )
}

function validatedResult(value: SearchResult): SearchResult | null {
  if (!value.id.trim() || !value.title.trim()) return null
  if (value.score !== undefined && !Number.isFinite(value.score)) return null
  return value
}

export type SearchCoordinator = Readonly<{
  contributors: readonly SearchContributor[]
  search(request: SearchRequest, contributorIds?: readonly string[]): Promise<SearchResponse>
  execute(hit: SearchHit): Promise<boolean>
}>

type SearchContributorSource = readonly SearchContributor[] | (() => readonly SearchContributor[])

function contributorSnapshot(source: SearchContributorSource): Readonly<{
  contributors: readonly SearchContributor[]
  byId: ReadonlyMap<string, SearchContributor>
}> {
  const contributors = Object.freeze([...(typeof source === 'function' ? source() : source)])
  const byId = new Map<string, SearchContributor>()
  for (const contributor of contributors) {
    requireId(contributor.id, 'Search contributor')
    if (byId.has(contributor.id)) {
      throw new Error(`Duplicate search contributor id: ${contributor.id}`)
    }
    byId.set(contributor.id, contributor)
  }
  return { contributors, byId }
}

export function createSearchCoordinator(source: SearchContributorSource): SearchCoordinator {
  if (typeof source !== 'function') contributorSnapshot(source)

  return Object.freeze({
    get contributors() {
      return contributorSnapshot(source).contributors
    },
    async search(request, contributorIds) {
      const query = normalizeSearchText(request.query)
      if (!query || request.limit <= 0 || !Number.isSafeInteger(request.limit)) {
        return { results: [], contributors: [], truncated: false }
      }
      const snapshot = contributorSnapshot(source)
      const selected = contributorIds
        ? contributorIds.flatMap((id) => {
            const contributor = snapshot.byId.get(id)
            return contributor ? [contributor] : []
          })
        : snapshot.contributors
      const settled = await Promise.allSettled(
        selected.map((contributor) => contributor.search({ ...request, query })),
      )
      const hits: SearchHit[] = []
      const statuses: SearchResponse['contributors'][number][] = []
      for (const [index, result] of settled.entries()) {
        const contributor = selected[index]!
        if (result.status === 'rejected') {
          statuses.push({
            contributorId: contributor.id,
            status: 'error' as const,
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          })
          continue
        }
        for (const raw of result.value.results) {
          const value = validatedResult(raw)
          if (!value) continue
          hits.push({
            ...value,
            contributorId: contributor.id,
            contributorLabel: contributor.label,
          })
        }
        statuses.push({
          contributorId: contributor.id,
          status: 'ready' as const,
          ...(result.value.truncated ? { truncated: true } : {}),
        })
        for (const failure of result.value.failures ?? []) {
          if (!failure.contributorId.trim() || !failure.message.trim()) continue
          statuses.push({
            contributorId: failure.contributorId,
            status: 'error',
            message: failure.message,
          })
        }
      }
      const deduped = new Map<string, SearchHit>()
      for (const hit of hits.sort((left, right) => compareHits(query, left, right))) {
        const identity = resultIdentity(hit.contributorId, hit)
        if (!deduped.has(identity)) deduped.set(identity, hit)
      }
      const all = [...deduped.values()]
      const truncated =
        statuses.some((status) => status.status === 'ready' && status.truncated) ||
        all.length > request.limit
      return {
        results: all.slice(0, request.limit),
        contributors: statuses,
        truncated,
      }
    },
    async execute(hit) {
      const contributor = contributorSnapshot(source).byId.get(hit.contributorId)
      if (!contributor?.execute) return false
      await contributor.execute(hit)
      return true
    },
  })
}
