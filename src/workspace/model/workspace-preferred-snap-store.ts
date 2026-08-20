import type { AssistGridShape } from './workspace-assist-grid'
import {
  clientPreferencesStore,
  MAX_TILED_WINDOW_GAP,
  normalizeTiledWindowGap,
} from '@/workspace/shared/client-preferences-store'

export { MAX_TILED_WINDOW_GAP, normalizeTiledWindowGap }

const api = {
  get assistGridShape() {
    return clientPreferencesStore.getState().assistGridShape
  },
  get snapAssistOnTopDrag() {
    return clientPreferencesStore.getState().snapAssistOnTopDrag
  },
  get tiledWindowGap() {
    return clientPreferencesStore.getState().tiledWindowGap
  },
  setAssistGridShape(value: AssistGridShape) {
    clientPreferencesStore.getState().setAssistGridShape(value)
  },
  setSnapAssistOnTopDrag(value: boolean) {
    clientPreferencesStore.getState().setSnapAssistOnTopDrag(value)
  },
  setTiledWindowGap(value: number) {
    clientPreferencesStore.getState().setTiledWindowGap(value)
  },
}

export const useWorkspacePreferredSnapStore = {
  getState: () => api,
  subscribe: clientPreferencesStore.subscribe,
}
