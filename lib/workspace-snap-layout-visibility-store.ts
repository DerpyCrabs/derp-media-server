import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { ALL_SNAP_LAYOUT_IDS } from '@/lib/workspace-snap-layouts'

const KNOWN = new Set(ALL_SNAP_LAYOUT_IDS)

const SNAP_LAYOUT_VISIBILITY_STORAGE_KEY = 'workspace-snap-layout-visibility'

type PersistedSnapVisibility = { visibleIdList: string[] }

function cleanIds(ids: string[]): string[] {
  return ids.filter((id) => KNOWN.has(id))
}

interface WorkspaceSnapLayoutVisibilityState {
  /** Persisted: which template ids appear in the snap picker. */
  visibleIdList: string[]
  setVisibleIds: (ids: Set<string>) => void
  toggleLayout: (id: string) => void
  showAllLayouts: () => void
}

export const useWorkspaceSnapLayoutVisibilityStore = create<WorkspaceSnapLayoutVisibilityState>()(
  persist(
    (set, get) => ({
      visibleIdList: [...ALL_SNAP_LAYOUT_IDS],

      setVisibleIds: (ids) => {
        set({ visibleIdList: cleanIds([...ids]) })
      },

      toggleLayout: (id) => {
        if (!KNOWN.has(id)) return
        const setLike = new Set(get().visibleIdList)
        if (setLike.has(id)) setLike.delete(id)
        else setLike.add(id)
        set({ visibleIdList: [...setLike] })
      },

      showAllLayouts: () => set({ visibleIdList: [...ALL_SNAP_LAYOUT_IDS] }),
    }),
    {
      name: SNAP_LAYOUT_VISIBILITY_STORAGE_KEY,
      storage: createJSONStorage<PersistedSnapVisibility>(() => localStorage),
      partialize: (s): PersistedSnapVisibility => ({ visibleIdList: s.visibleIdList }),
    },
  ),
)
