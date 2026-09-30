import { Schema } from 'effect'
import { modelOwner } from 'effectweb'
import { readPersistedState, writePersistedState } from '@/lib/state/client-store-utils'
type BrowserViewMode = 'list' | 'grid'
const STORAGE_KEY = 'browser-view-mode'
export const browserViewModesSchema = Schema.Struct({
  byKey: Schema.Record(Schema.String, Schema.Literals(['list', 'grid'])),
})
const loaded = readPersistedState(STORAGE_KEY, browserViewModesSchema)
const initialByKey = loaded?.byKey ?? {}
const owner = modelOwner<{ byKey: Record<string, BrowserViewMode> }>({ byKey: { ...initialByKey } })
function persist(byKey: Record<string, BrowserViewMode>) {
  writePersistedState(STORAGE_KEY, { byKey: { ...byKey } })
}
function setViewMode(storageKey: string, mode: BrowserViewMode) {
  const byKey = { ...owner.read().byKey, [storageKey]: mode }
  owner.patch({ byKey })
  persist(byKey)
}
export const browserViewModes = { source: owner.source, read: () => owner.read(), setViewMode }
