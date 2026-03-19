import { useCallback, useLayoutEffect } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface ShareTextViewerSettings {
  enabled: boolean
  readOnly: boolean
}

interface Persisted {
  byKey: Record<string, ShareTextViewerSettings>
}

interface ShareTextViewerSettingsStore extends Persisted {
  setSettings: (key: string, next: ShareTextViewerSettings) => void
}

export const useShareTextViewerSettingsStore = create<ShareTextViewerSettingsStore>()(
  persist(
    (set) => ({
      byKey: {},

      setSettings(key, next) {
        set((s) => ({
          byKey: { ...s.byKey, [key]: next },
        }))
      },
    }),
    {
      name: 'share-text-viewer-settings',
      storage: createJSONStorage<Persisted>(() => localStorage),
      partialize: (s): Persisted => ({ byKey: s.byKey }),
    },
  ),
)

export function useShareTextViewerSettings(
  storageKey: string,
  defaults: ShareTextViewerSettings,
): {
  settings: ShareTextViewerSettings
  persistSettings: (enabled: boolean, readOnly?: boolean) => void
} {
  const stored = useShareTextViewerSettingsStore((s) =>
    storageKey ? s.byKey[storageKey] : undefined,
  )
  const setSettings = useShareTextViewerSettingsStore((s) => s.setSettings)

  const settings: ShareTextViewerSettings = stored ?? defaults

  const persistSettings = useCallback(
    (enabled: boolean, readOnly?: boolean) => {
      if (!storageKey) return
      const prev = useShareTextViewerSettingsStore.getState().byKey[storageKey] ?? defaults
      setSettings(storageKey, {
        enabled,
        readOnly: readOnly !== undefined ? readOnly : prev.readOnly,
      })
    },
    [storageKey, defaults, setSettings],
  )

  useLayoutEffect(() => {
    if (!storageKey) return
    const st = useShareTextViewerSettingsStore.getState()
    if (st.byKey[storageKey]) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as { enabled?: boolean; readOnly?: boolean }
      st.setSettings(storageKey, {
        enabled: parsed.enabled ?? defaults.enabled,
        readOnly: parsed.readOnly ?? defaults.readOnly,
      })
      localStorage.removeItem(storageKey)
    } catch {}
  }, [storageKey, defaults.enabled, defaults.readOnly])

  return { settings, persistSettings }
}
