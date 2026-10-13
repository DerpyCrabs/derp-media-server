import { available, modelOwner } from 'effectweb'
import { AsyncResult } from 'effect/reactivity'
import { settingsQuery } from '@/lib/api/queries'
import { queryCache } from '@/lib/api/cache'
import type { GlobalSettings } from '@/lib/models/settings-types'
import { observeQuery } from '@effectweb/query'
export function createExplorerSettings() {
  const owner = modelOwner({
    result: AsyncResult.initial<GlobalSettings, Error>() as AsyncResult.AsyncResult<
      GlobalSettings,
      Error
    >,
  })
  const query = observeQuery(owner, queryCache, settingsQuery, 'result')
  query.select(true)
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    refresh: query.refresh,
    snapshot: (state: ReturnType<typeof owner.read>) => {
      const settings = available(state.result)
      return {
        settings,
        knowledgeBases: settings?.knowledgeBases ?? [],
        customIcons: settings?.customIcons ?? {},
      }
    },
  }
}
