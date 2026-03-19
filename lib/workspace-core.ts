import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useWorkspaceFocusStore } from '@/lib/workspace-focus-store'

export function hydrateFocusFromPersisted(storageKey: string, persisted: PersistedWorkspaceState) {
  const layoutByWindowId: Record<string, { zIndex?: number; minimized?: boolean }> = {}
  for (const w of persisted.windows) {
    if (w.layout && (w.layout.zIndex != null || w.layout.minimized != null)) {
      layoutByWindowId[w.id] = {
        ...(w.layout.zIndex != null && { zIndex: w.layout.zIndex }),
        ...(w.layout.minimized != null && { minimized: w.layout.minimized }),
      }
    }
  }
  useWorkspaceFocusStore.getState().replaceFocusState(storageKey, {
    activeWindowId: persisted.activeWindowId,
    activeTabMap: persisted.activeTabMap ?? {},
    layoutByWindowId: Object.keys(layoutByWindowId).length > 0 ? layoutByWindowId : undefined,
  })
}
