import {
  clientPreferencesStore,
  MAX_TILED_WINDOW_GAP,
  normalizeTiledWindowGap,
} from '@/workspace/shared/client-preferences-store'

export { MAX_TILED_WINDOW_GAP, normalizeTiledWindowGap }

export const workspaceLayoutPreferences = {
  source: clientPreferencesStore.source,
  read: clientPreferencesStore.read,
  setAssistGridShape: clientPreferencesStore.setAssistGridShape,
  setSnapAssistOnTopDrag: clientPreferencesStore.setSnapAssistOnTopDrag,
  setTiledWindowGap: clientPreferencesStore.setTiledWindowGap,
}
