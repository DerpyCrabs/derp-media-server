import { available, modelOwner } from 'effectweb'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { postEffect } from '@/lib/api/client'
import { statsQuery, type ViewStats } from '@/lib/api/queries'
import { groups, queryCache } from '@/lib/api/cache'
import { observeQuery } from '@effectweb/query'
const incrementSlots = (key: string | number) => ['increment-view', key] as const
export function createViewStats(options?: { includeCounts?: boolean }) {
  const owner = modelOwner({ result: AsyncResult.initial<ViewStats, Error>() })
  const query = observeQuery(owner, queryCache, statsQuery, 'result')
  if (options?.includeCounts !== false) query.select(true)
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    incrementView: (filePath: string) =>
      owner.run(
        incrementSlots(filePath),
        postEffect('/api/stats/views', { filePath }).pipe(
          Effect.tap(() => Effect.sync(() => queryCache.invalidateGroup(groups.stats))),
          Effect.catch(() => Effect.void),
        ),
        'queue',
      ),
    snapshot: (state: ReturnType<typeof owner.read>) => ({
      views: available(state.result)?.views ?? {},
    }),
  }
}
