import { createStore } from 'solid-js/store'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

type BrowserViewMode = 'list' | 'grid'

const STORAGE_KEY = 'browser-view-mode'

type Persisted = { byKey: Record<string, BrowserViewMode> }

const listeners = createStoreListeners()

const loaded = readPersistedState<Persisted>(STORAGE_KEY)
const initialByKey = loaded?.byKey && typeof loaded.byKey === 'object' ? loaded.byKey : {}

const [store, setStore] = createStore<{ byKey: Record<string, BrowserViewMode> }>({
  byKey: { ...initialByKey },
})

function persist() {
  writePersistedState(STORAGE_KEY, { byKey: { ...store.byKey } })
}

function getViewMode(storageKey: string, fallback: BrowserViewMode): BrowserViewMode {
  return store.byKey[storageKey] ?? fallback
}

function setViewMode(storageKey: string, mode: BrowserViewMode) {
  setStore('byKey', storageKey, mode)
  persist()
  listeners.notify()
}

const api = {
  get byKey() {
    return { ...store.byKey }
  },
  getViewMode,
  setViewMode,
}

export const useBrowserViewModeStore = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}
