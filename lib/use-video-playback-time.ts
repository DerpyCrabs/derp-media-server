import { createStore } from 'solid-js/store'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

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

function persist() {
  writePersistedState(STORAGE_KEY, { playbackTimes: { ...store.playbackTimes } })
}

function getSavedTime(filePath: string): number | null {
  return store.playbackTimes[filePath] ?? null
}

function saveTime(filePath: string, time: number, duration: number) {
  if (duration > 0 && time >= duration * 0.9) {
    const next = { ...store.playbackTimes }
    delete next[filePath]
    setStore('playbackTimes', next)
  } else {
    setStore('playbackTimes', filePath, time)
  }
  persist()
  listeners.notify()
}

function clearTime(filePath: string) {
  const next = { ...store.playbackTimes }
  delete next[filePath]
  setStore('playbackTimes', next)
  persist()
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

export const useVideoPlaybackTime = {
  getState: () => api,
  subscribe: listeners.subscribe,
}
