import { Schema } from 'effect'
import { queryCache as createQueryCache, queryGroup, type Query } from '@effectweb/query'

export const groups = {
  config: queryGroup('config'),
  files: queryGroup('files'),
  settings: queryGroup('settings'),
  stats: queryGroup('stats'),
  content: queryGroup('content'),
  playback: queryGroup('playback'),
  music: queryGroup('music'),
  mediaAi: queryGroup('media-ai'),
  recommendations: queryGroup('recommendations'),
}

export const queryCache = createQueryCache({ retention: 5 * 60_000 })

declare global {
  interface Window {
    __INITIAL_DATA__?: { entries: { key: readonly unknown[]; data: unknown }[] }
  }
}

const bootstrap = new Map(
  (typeof window === 'undefined' ? [] : (window.__INITIAL_DATA__?.entries ?? [])).map(
    (entry) => [JSON.stringify(entry.key), entry.data] as const,
  ),
)

export function initialData(key: readonly unknown[]): unknown {
  const encoded = JSON.stringify(key)
  const value = bootstrap.get(encoded)
  bootstrap.delete(encoded)
  return value
}

export function seedQuery<Args, A, E>(
  definition: Query<Args, A, E>,
  args: Args,
  key: readonly unknown[],
  schema: Schema.Decoder<A>,
): void {
  const encoded = JSON.stringify(key)
  if (!bootstrap.has(encoded)) return
  const value = bootstrap.get(encoded)
  bootstrap.delete(encoded)
  const decoded = Schema.decodeUnknownExit(schema)(value)
  if (decoded._tag === 'Success') queryCache.setQueryData(definition, args, decoded.value)
}

export function invalidateAllQueries(options?: { preserveRecommendations?: boolean }) {
  queryCache.batch(() => {
    for (const group of Object.values(groups)) {
      if (
        options?.preserveRecommendations &&
        (group === groups.music || group === groups.recommendations)
      )
        continue
      queryCache.invalidateGroup(group)
    }
  })
}
