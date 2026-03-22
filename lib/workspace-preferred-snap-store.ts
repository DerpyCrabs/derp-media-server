import { createStore } from 'solid-js/store'
import {
  type AssistGridShape,
  isAssistGridShape,
  migrateTemplateIdToAssistShape,
} from '@/lib/workspace-assist-grid'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

const STORAGE_KEY = 'workspace-preferred-snap'

const DEFAULT_SHAPE: AssistGridShape = '3x2'

type Persisted = {
  assistGridShape?: string
  /** @deprecated migrated to assistGridShape */
  templateId?: string
  snapAssistOnTopDrag?: boolean
}

function loadPersisted(): { shape: AssistGridShape; snapAssistOnTopDrag: boolean } {
  const loaded = readPersistedState<Persisted>(STORAGE_KEY)
  let shape: AssistGridShape = DEFAULT_SHAPE
  if (loaded?.assistGridShape && isAssistGridShape(loaded.assistGridShape)) {
    shape = loaded.assistGridShape
  } else if (loaded?.templateId) {
    shape = migrateTemplateIdToAssistShape(loaded.templateId)
  }
  const snapAssistOnTopDrag =
    typeof loaded?.snapAssistOnTopDrag === 'boolean' ? loaded.snapAssistOnTopDrag : true
  return { shape, snapAssistOnTopDrag }
}

const listeners = createStoreListeners()

const initial = loadPersisted()
const [store, setStore] = createStore({
  assistGridShape: initial.shape,
  snapAssistOnTopDrag: initial.snapAssistOnTopDrag,
})

function persist() {
  writePersistedState(STORAGE_KEY, {
    assistGridShape: store.assistGridShape,
    snapAssistOnTopDrag: store.snapAssistOnTopDrag,
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

const api = {
  get assistGridShape() {
    return store.assistGridShape
  },
  get snapAssistOnTopDrag() {
    return store.snapAssistOnTopDrag
  },
  setAssistGridShape,
  setSnapAssistOnTopDrag,
}

export const useWorkspacePreferredSnapStore = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}
