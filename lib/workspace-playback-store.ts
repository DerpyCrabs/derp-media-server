import { createStore } from 'solid-js/store'
import { createStoreListeners } from './client-store-utils'

interface WorkspacePlaybackSlice {
  playing: string | null
  audioOnly: boolean
  dir: string | null
}

const DEFAULT_SLICE: WorkspacePlaybackSlice = {
  playing: null,
  audioOnly: false,
  dir: null,
}

function sliceFor(
  key: string,
  byKey: Record<string, WorkspacePlaybackSlice>,
): WorkspacePlaybackSlice {
  return byKey[key] ?? DEFAULT_SLICE
}

const listeners = createStoreListeners()

const [store, setStore] = createStore<{ byKey: Record<string, WorkspacePlaybackSlice> }>({
  byKey: {},
})

function playFile(key: string, path: string, dir?: string) {
  const prev = sliceFor(key, store.byKey)
  setStore('byKey', key, {
    ...prev,
    playing: path,
    ...(prev.playing !== path ? { audioOnly: false } : {}),
    ...(dir !== undefined ? { dir: dir || null } : {}),
  })
  listeners.notify()
}

function closePlayer(key: string) {
  const prev = sliceFor(key, store.byKey)
  setStore('byKey', key, {
    ...prev,
    playing: null,
    audioOnly: false,
  })
  listeners.notify()
}

function setAudioOnly(key: string, enabled: boolean) {
  const prev = sliceFor(key, store.byKey)
  setStore('byKey', key, {
    ...prev,
    audioOnly: enabled,
  })
  listeners.notify()
}

const api = {
  get byKey() {
    return store.byKey
  },
  playFile,
  closePlayer,
  setAudioOnly,
}

export const useWorkspacePlaybackStore = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}
