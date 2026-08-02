import { createStore } from 'solid-js/store'
import { type AssistGridShape, isAssistGridShape } from '@/lib/workspace-assist-grid'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

const STORAGE_KEY = 'workspace-preferred-snap'

const DEFAULT_SHAPE: AssistGridShape = '3x2'

type Persisted = {
  assistGridShape?: string
  snapAssistOnTopDrag?: boolean
  tiledWindowGap?: number
}

export const MAX_TILED_WINDOW_GAP = 24

export function normalizeTiledWindowGap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_TILED_WINDOW_GAP, Math.round(value)))
}

function loadPersisted(): {
  shape: AssistGridShape
  snapAssistOnTopDrag: boolean
  tiledWindowGap: number
} {
  const loaded = readPersistedState<Persisted>(STORAGE_KEY)
  let shape: AssistGridShape = DEFAULT_SHAPE
  if (loaded?.assistGridShape && isAssistGridShape(loaded.assistGridShape)) {
    shape = loaded.assistGridShape
  }
  const snapAssistOnTopDrag =
    typeof loaded?.snapAssistOnTopDrag === 'boolean' ? loaded.snapAssistOnTopDrag : true
  return {
    shape,
    snapAssistOnTopDrag,
    tiledWindowGap: normalizeTiledWindowGap(loaded?.tiledWindowGap),
  }
}

const listeners = createStoreListeners()

const initial = loadPersisted()
const [store, setStore] = createStore({
  assistGridShape: initial.shape,
  snapAssistOnTopDrag: initial.snapAssistOnTopDrag,
  tiledWindowGap: initial.tiledWindowGap,
})

function persist() {
  writePersistedState(STORAGE_KEY, {
    assistGridShape: store.assistGridShape,
    snapAssistOnTopDrag: store.snapAssistOnTopDrag,
    tiledWindowGap: store.tiledWindowGap,
  })
}

function setAssistGridShape(shape: AssistGridShape) {
  setStore('assistGridShape', shape)
  persist()
  listeners.notify()
}

function setSnapAssistOnTopDrag(enabled: boolean) {
  setStore('snapAssistOnTopDrag', enabled)
  persist()
  listeners.notify()
}

function setTiledWindowGap(gap: number) {
  setStore('tiledWindowGap', normalizeTiledWindowGap(gap))
  persist()
  listeners.notify()
}

const api = {
  get assistGridShape() {
    return store.assistGridShape
  },
  get snapAssistOnTopDrag() {
    return store.snapAssistOnTopDrag
  },
  get tiledWindowGap() {
    return store.tiledWindowGap
  },
  setAssistGridShape,
  setSnapAssistOnTopDrag,
  setTiledWindowGap,
}

export const useWorkspacePreferredSnapStore = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}
