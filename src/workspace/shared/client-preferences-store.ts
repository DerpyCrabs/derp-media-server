import { createStore } from 'solid-js'
import type { FileOpenTarget } from '@/lib/models/open-target'
import { type AssistGridShape, isAssistGridShape } from '@/workspace/model/workspace-assist-grid'
import {
  createStoreListeners,
  readPersistedState,
  writePersistedState,
} from '@/lib/state/client-store-utils'

export const FILE_OPEN_TARGET_STORAGE_KEY = 'workspace-file-open-target-v2'
export const WORKSPACE_LAYOUT_STORAGE_KEY = 'workspace-preferred-snap'
export const MAX_TILED_WINDOW_GAP = 24

type FileOpenPersisted = { target?: unknown }
type LayoutPersisted = {
  assistGridShape?: unknown
  snapAssistOnTopDrag?: unknown
  tiledWindowGap?: unknown
}

type ClientPreferences = {
  fileOpenTarget: FileOpenTarget
  assistGridShape: AssistGridShape
  snapAssistOnTopDrag: boolean
  tiledWindowGap: number
}

const DEFAULTS: ClientPreferences = {
  fileOpenTarget: 'new-window',
  assistGridShape: '3x2',
  snapAssistOnTopDrag: true,
  tiledWindowGap: 0,
}

export function normalizeTiledWindowGap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_TILED_WINDOW_GAP, Math.round(value)))
}

function parsePersisted<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { state?: T }
    return parsed.state ?? null
  } catch {
    return null
  }
}

function normalizeFileOpen(value: FileOpenPersisted | null): FileOpenTarget {
  return value?.target === 'new-tab' || value?.target === 'new-window'
    ? value.target
    : DEFAULTS.fileOpenTarget
}

function normalizeLayout(value: LayoutPersisted | null) {
  return {
    assistGridShape:
      typeof value?.assistGridShape === 'string' && isAssistGridShape(value.assistGridShape)
        ? value.assistGridShape
        : DEFAULTS.assistGridShape,
    snapAssistOnTopDrag:
      typeof value?.snapAssistOnTopDrag === 'boolean'
        ? value.snapAssistOnTopDrag
        : DEFAULTS.snapAssistOnTopDrag,
    tiledWindowGap: normalizeTiledWindowGap(value?.tiledWindowGap),
  }
}

const initialFile = readPersistedState<FileOpenPersisted>(FILE_OPEN_TARGET_STORAGE_KEY)
const initialLayout = readPersistedState<LayoutPersisted>(WORKSPACE_LAYOUT_STORAGE_KEY)
const [store, setStore] = createStore<ClientPreferences>({
  ...DEFAULTS,
  fileOpenTarget: normalizeFileOpen(initialFile),
  ...normalizeLayout(initialLayout),
})
const listeners = createStoreListeners()

function persistFileOpen(target: FileOpenTarget = store.fileOpenTarget) {
  writePersistedState(FILE_OPEN_TARGET_STORAGE_KEY, { target })
}

function persistLayout(
  overrides: {
    assistGridShape?: AssistGridShape
    snapAssistOnTopDrag?: boolean
    tiledWindowGap?: number
  } = {},
) {
  writePersistedState(WORKSPACE_LAYOUT_STORAGE_KEY, {
    assistGridShape: overrides.assistGridShape ?? store.assistGridShape,
    snapAssistOnTopDrag: overrides.snapAssistOnTopDrag ?? store.snapAssistOnTopDrag,
    tiledWindowGap: overrides.tiledWindowGap ?? store.tiledWindowGap,
  })
}

export function syncClientPreferenceStorage(key: string, raw: string | null) {
  if (key === FILE_OPEN_TARGET_STORAGE_KEY) {
    const fileOpenTarget = normalizeFileOpen(parsePersisted<FileOpenPersisted>(raw))
    setStore((state) => {
      state.fileOpenTarget = fileOpenTarget
    })
  } else if (key === WORKSPACE_LAYOUT_STORAGE_KEY) {
    const layout = normalizeLayout(parsePersisted<LayoutPersisted>(raw))
    setStore((state) => {
      Object.assign(state, layout)
    })
  } else {
    return
  }
  listeners.notify()
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.storageArea !== localStorage) return
    syncClientPreferenceStorage(event.key ?? '', event.newValue)
  })
}

const api = {
  get fileOpenTarget() {
    return store.fileOpenTarget
  },
  get assistGridShape() {
    return store.assistGridShape
  },
  get snapAssistOnTopDrag() {
    return store.snapAssistOnTopDrag
  },
  get tiledWindowGap() {
    return store.tiledWindowGap
  },
  setFileOpenTarget(value: FileOpenTarget) {
    setStore((state) => {
      state.fileOpenTarget = value
    })
    persistFileOpen(value)
    listeners.notify()
  },
  setAssistGridShape(value: AssistGridShape) {
    setStore((state) => {
      state.assistGridShape = value
    })
    persistLayout({ assistGridShape: value })
    listeners.notify()
  },
  setSnapAssistOnTopDrag(value: boolean) {
    setStore((state) => {
      state.snapAssistOnTopDrag = value
    })
    persistLayout({ snapAssistOnTopDrag: value })
    listeners.notify()
  },
  setTiledWindowGap(value: number) {
    const normalizedGap = normalizeTiledWindowGap(value)
    setStore((state) => {
      state.tiledWindowGap = normalizedGap
    })
    persistLayout({ tiledWindowGap: normalizedGap })
    listeners.notify()
  },
}

export const clientPreferencesStore = {
  getState: () => api,
  subscribe: (listener: () => void) => listeners.subscribe(listener),
}
