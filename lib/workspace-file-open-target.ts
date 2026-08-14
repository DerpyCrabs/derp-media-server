import { createStore } from 'solid-js/store'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

export type WorkspaceFileOpenTarget = 'new-tab' | 'new-window'

const PERSIST_KEY = 'workspace-file-open-target-v2'
const DEFAULT: WorkspaceFileOpenTarget = 'new-window'

function initialTarget(): WorkspaceFileOpenTarget {
  const fromV2 = readPersistedState<{ target?: unknown }>(PERSIST_KEY)
  if (fromV2 && (fromV2.target === 'new-tab' || fromV2.target === 'new-window')) {
    return fromV2.target
  }
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
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}

/** Non-reactive read (e.g. inside event handlers). */
export function getWorkspaceFileOpenTarget(): WorkspaceFileOpenTarget {
  return useWorkspaceFileOpenTargetStore.getState().target
}
