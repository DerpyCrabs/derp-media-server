import { ASSIST_GRID_SHAPES } from '@/lib/workspace-assist-grid'
import { createStore } from 'solid-js/store'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

const SNAP_LAYOUT_VISIBILITY_STORAGE_KEY = 'workspace-snap-layout-visibility'

type PersistedSnapVisibility = {
  visibleIdList?: string[]
}

const listeners = createStoreListeners()

const KNOWN = new Set<string>(ASSIST_GRID_SHAPES)

function normalizeList(list: string[] | undefined): string[] {
  if (!list?.length) return [...ASSIST_GRID_SHAPES]
  const next = list.filter((id) => KNOWN.has(id))
  return next.length > 0 ? next : [...ASSIST_GRID_SHAPES]
}

function loadVisibleIds(): string[] {
  const loaded = readPersistedState<PersistedSnapVisibility>(SNAP_LAYOUT_VISIBILITY_STORAGE_KEY)
  return normalizeList(loaded?.visibleIdList)
}

const [store, setStore] = createStore({
  visibleIdList: loadVisibleIds(),
})

function persist() {
  writePersistedState(SNAP_LAYOUT_VISIBILITY_STORAGE_KEY, {
    visibleIdList: store.visibleIdList,
  })
}

function toggleLayout(id: string) {
  if (!KNOWN.has(id)) return
  const cur = store.visibleIdList
  if (cur.includes(id)) {
    if (cur.length <= 1) return
    setStore(
      'visibleIdList',
      cur.filter((x) => x !== id),
    )
  } else {
    setStore('visibleIdList', [...cur, id])
  }
  persist()
  listeners.notify()
}

function showAllLayouts() {
  setStore('visibleIdList', [...ASSIST_GRID_SHAPES])
  persist()
  listeners.notify()
}

const api = {
  get visibleIdList() {
    return store.visibleIdList
  },
  toggleLayout,
  showAllLayouts,
}

export const useWorkspaceSnapLayoutVisibilityStore = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}
