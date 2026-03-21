import { createStore } from 'solid-js/store'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

interface Position {
  x: number
  y: number
}

const STORAGE_KEY = 'video-player-position'

const defaultPosition: Position = { x: 0, y: 0 }

function loadPosition(): Position {
  const s = readPersistedState<{ position?: unknown }>(STORAGE_KEY)
  if (s?.position && typeof s.position === 'object' && s.position !== null) {
    const p = s.position as { x?: unknown; y?: unknown }
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      return { x: p.x, y: p.y }
    }
  }
  return defaultPosition
}

const listeners = createStoreListeners()

const [store, setStore] = createStore({
  position: loadPosition(),
})

function persist() {
  writePersistedState(STORAGE_KEY, { position: { ...store.position } })
}

function setPosition(position: Position) {
  setStore('position', { ...position })
  persist()
  listeners.notify()
}

function resetPosition() {
  setStore('position', { ...defaultPosition })
  persist()
  listeners.notify()
}

const api = {
  get position() {
    return store.position
  },
  setPosition,
  resetPosition,
}

export const useVideoPlayerPosition = {
  getState: () => api,
  subscribe: (fn: (s: typeof api) => void) =>
    listeners.subscribe(() => {
      fn(api)
    }),
}

export function validatePosition(position: Position): Position {
  if (typeof window === 'undefined') return position

  const constrainedX = Math.max(0, Math.min(position.x, window.innerWidth - 100))
  const constrainedY = Math.max(0, Math.min(position.y, window.innerHeight - 100))

  return { x: constrainedX, y: constrainedY }
}

export function getDefaultPosition(): Position {
  if (typeof window === 'undefined') return defaultPosition

  const defaultX = window.innerWidth - 320 - 16
  const defaultY = window.innerHeight - 300 - 80

  return {
    x: Math.max(0, defaultX),
    y: Math.max(0, defaultY),
  }
}
