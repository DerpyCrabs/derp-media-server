import { useCallback, useLayoutEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type BrowserViewMode = 'list' | 'grid'

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

export function useBrowserViewMode(storageKey: string, fallback: BrowserViewMode) {
  const viewMode = useBrowserViewModeStore((s) => s.byKey[storageKey] ?? fallback)
  const setStoreMode = useBrowserViewModeStore((s) => s.setViewMode)
  const setViewMode = useCallback(
    (mode: BrowserViewMode) => {
      setStoreMode(storageKey, mode)
    },
    [storageKey, setStoreMode],
  )

  useLayoutEffect(() => {
    const st = useBrowserViewModeStore.getState()
    if (st.byKey[storageKey]) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw === 'list' || raw === 'grid') {
        st.setViewMode(storageKey, raw)
        localStorage.removeItem(storageKey)
      }
    } catch {}
  }, [storageKey])

  return { viewMode, setViewMode }
}
