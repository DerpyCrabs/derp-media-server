import { createStore } from 'solid-js'
import {
  createStoreListeners,
  readPersistedState,
  writePersistedState,
} from '@/lib/state/client-store-utils'

const STORAGE_KEY = 'video-playback-times'

interface VideoPlaybackTimes {
  [filePath: string]: number
}

function loadTimes(): VideoPlaybackTimes {
  const s = readPersistedState<{ playbackTimes?: unknown }>(STORAGE_KEY)
  if (s?.playbackTimes && typeof s.playbackTimes === 'object' && s.playbackTimes !== null) {
    return { ...(s.playbackTimes as VideoPlaybackTimes) }
  }
  return {}
}

const listeners = createStoreListeners()

const [store, setStore] = createStore({
  playbackTimes: loadTimes(),
})

function persist(playbackTimes: VideoPlaybackTimes) {
  writePersistedState(STORAGE_KEY, { playbackTimes: { ...playbackTimes } })
}

function getSavedTime(filePath: string): number | null {
  return store.playbackTimes[filePath] ?? null
}

function saveTime(filePath: string, time: number, duration: number) {
  const next = { ...store.playbackTimes }
  if (duration > 0 && time >= duration * 0.9) {
    delete next[filePath]
    setStore((state) => {
      state.playbackTimes = next
    })
  } else {
    setStore((state) => {
      state.playbackTimes[filePath] = time
    })
    next[filePath] = time
  }
  persist(next)
  listeners.notify()
}

function clearTime(filePath: string) {
  const next = { ...store.playbackTimes }
  delete next[filePath]
  setStore((state) => {
    state.playbackTimes = next
  })
  persist(next)
  listeners.notify()
}

const api = {
  get playbackTimes() {
    return { ...store.playbackTimes }
  },
  getSavedTime,
  saveTime,
  clearTime,
}

export const videoPlaybackProgress = Object.freeze({
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
})
