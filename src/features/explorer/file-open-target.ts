import { createStore } from 'solid-js'
import {
  createStoreListeners,
  readPersistedState,
  writePersistedState,
} from '@/lib/state/client-store-utils'

import type { FileOpenTarget } from '@/lib/models/open-target'

export type { FileOpenTarget } from '@/lib/models/open-target'

const LEGACY_STORAGE_KEY = 'workspace-file-open-target'
const PERSIST_KEY = 'workspace-file-open-target-v2'
const DEFAULT: FileOpenTarget = 'new-window'

function parseStored(raw: string | null): FileOpenTarget {
  if (raw === 'new-tab' || raw === 'new-window') return raw
  return DEFAULT
}

function readLegacyTarget(): FileOpenTarget | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (raw == null) return null
  return parseStored(raw)
}

function initialTarget(): FileOpenTarget {
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

function persist(target: FileOpenTarget) {
  writePersistedState(PERSIST_KEY, { target })
}

function setTarget(value: FileOpenTarget) {
  setStore((state) => {
    state.target = value
  })
  persist(value)
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

export const fileOpenTargetStore = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}

/** Non-reactive read (e.g. inside event handlers). */
export function getFileOpenTarget(): FileOpenTarget {
  return fileOpenTargetStore.getState().target
}
