import { createStore } from 'solid-js/store'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

export type WorkspaceFileOpenTarget = 'new-tab' | 'new-window'

const LEGACY_STORAGE_KEY = 'workspace-file-open-target'
const PERSIST_KEY = 'workspace-file-open-target-v2'
const DEFAULT: WorkspaceFileOpenTarget = 'new-window'

function parseStored(raw: string | null): WorkspaceFileOpenTarget {
  if (raw === 'new-tab' || raw === 'new-window') return raw
  return DEFAULT
}

function readLegacyTarget(): WorkspaceFileOpenTarget | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (raw == null) return null
  return parseStored(raw)
}

function initialTarget(): WorkspaceFileOpenTarget {
  const fromV2 = readPersistedState<{ target?: unknown }>(PERSIST_KEY)
  if (fromV2 && (fromV2.target === 'new-tab' || fromV2.target === 'new-window')) {
    return fromV2.target
  }
  const legacy = readLegacyTarget()
  if (legacy != null) return legacy
  return DEFAULT
}

const listeners = createStoreListeners()

const [store, setStore] = createStore({
  target: initialTarget(),
})

function persist() {
  writePersistedState(PERSIST_KEY, { target: store.target })
}

function setTarget(value: WorkspaceFileOpenTarget) {
  setStore('target', value)
  persist()
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {}
  }
  listeners.notify()
}

const api = {
  get target() {
    return store.target
  },
  setTarget,
}

export const useWorkspaceFileOpenTargetStore = {
  getState: () => api,
  subscribe: listeners.subscribe,
}

/** Non-reactive read (e.g. inside event handlers). */
export function getWorkspaceFileOpenTarget(): WorkspaceFileOpenTarget {
  return useWorkspaceFileOpenTargetStore.getState().target
}
