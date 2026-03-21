import { createStore } from 'solid-js/store'
import { ALL_SNAP_LAYOUT_IDS } from '@/lib/workspace-snap-layouts'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

const KNOWN = new Set(ALL_SNAP_LAYOUT_IDS)

const SNAP_LAYOUT_VISIBILITY_STORAGE_KEY = 'workspace-snap-layout-visibility'

type PersistedSnapVisibility = { visibleIdList: string[] }

function cleanIds(ids: string[]): string[] {
  return ids.filter((id) => KNOWN.has(id))
}

function initialVisibleIds(): string[] {
  const loaded = readPersistedState<PersistedSnapVisibility>(SNAP_LAYOUT_VISIBILITY_STORAGE_KEY)
  if (loaded?.visibleIdList?.length) {
    const cleaned = cleanIds(loaded.visibleIdList)
    if (cleaned.length > 0) return cleaned
  }
  return [...ALL_SNAP_LAYOUT_IDS]
}

const listeners = createStoreListeners()

const [store, setStore] = createStore({
  visibleIdList: initialVisibleIds(),
})

function persist() {
  writePersistedState(SNAP_LAYOUT_VISIBILITY_STORAGE_KEY, {
    visibleIdList: [...store.visibleIdList],
  })
}

function setVisibleIds(ids: Set<string>) {
  setStore('visibleIdList', cleanIds([...ids]))
  persist()
  listeners.notify()
}

function toggleLayout(id: string) {
  if (!KNOWN.has(id)) return
  const setLike = new Set(store.visibleIdList)
  if (setLike.has(id)) setLike.delete(id)
  else setLike.add(id)
  setStore('visibleIdList', [...setLike])
  persist()
  listeners.notify()
}

function showAllLayouts() {
  setStore('visibleIdList', [...ALL_SNAP_LAYOUT_IDS])
  persist()
  listeners.notify()
}

const api = {
  get visibleIdList() {
    return [...store.visibleIdList]
  },
  setVisibleIds,
  toggleLayout,
  showAllLayouts,
}

export const useWorkspaceSnapLayoutVisibilityStore = {
  getState: () => api,
  subscribe: listeners.subscribe,
}
