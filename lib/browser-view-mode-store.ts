import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type BrowserViewMode = 'list' | 'grid'

interface Persisted {
  byKey: Record<string, BrowserViewMode>
}

interface BrowserViewModeStore extends Persisted {
  setViewMode: (storageKey: string, mode: BrowserViewMode) => void
  getViewMode: (storageKey: string, fallback: BrowserViewMode) => BrowserViewMode
}

export const useBrowserViewModeStore = create<BrowserViewModeStore>()(
  persist(
    (set, get) => ({
      byKey: {},

      getViewMode(storageKey, fallback) {
        return get().byKey[storageKey] ?? fallback
      },

      setViewMode(storageKey, mode) {
        set((s) => ({
          byKey: { ...s.byKey, [storageKey]: mode },
        }))
      },
    }),
    {
      name: 'browser-view-mode',
      storage: createJSONStorage<Persisted>(() => localStorage),
      partialize: (s): Persisted => ({ byKey: s.byKey }),
    },
  ),
)
