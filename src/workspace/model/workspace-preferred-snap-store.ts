import { createStore } from 'solid-js'
import { type AssistGridShape, isAssistGridShape } from './workspace-assist-grid'
import {
  createStoreListeners,
  readPersistedState,
  writePersistedState,
} from '@/lib/state/client-store-utils'

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

function persist(overrides: Partial<Persisted> = {}) {
  writePersistedState(STORAGE_KEY, {
    assistGridShape: overrides.assistGridShape ?? store.assistGridShape,
    snapAssistOnTopDrag: overrides.snapAssistOnTopDrag ?? store.snapAssistOnTopDrag,
    tiledWindowGap: overrides.tiledWindowGap ?? store.tiledWindowGap,
  })
}

function setAssistGridShape(shape: AssistGridShape) {
  setStore((state) => {
    state.assistGridShape = shape
  })
  persist({ assistGridShape: shape })
  listeners.notify()
}

function setSnapAssistOnTopDrag(enabled: boolean) {
  setStore((state) => {
    state.snapAssistOnTopDrag = enabled
  })
  persist({ snapAssistOnTopDrag: enabled })
  listeners.notify()
}

function setTiledWindowGap(gap: number) {
  const normalizedGap = normalizeTiledWindowGap(gap)
  setStore((state) => {
    state.tiledWindowGap = normalizedGap
  })
  persist({ tiledWindowGap: normalizedGap })
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
