import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemePalette = 'default' | 'caffeine' | 'cosmic-night'
export type ThemeMode = 'light' | 'dark' | 'system'

const LEGACY_PALETTE = 'theme-palette'
const LEGACY_MODE = 'theme-mode'

const THEME_PERSIST_KEY = 'app-theme'

function isPalette(v: unknown): v is ThemePalette {
  return v === 'default' || v === 'caffeine' || v === 'cosmic-night'
}

function isMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system'
}

function readLegacyPaletteMode(): { palette: ThemePalette; mode: ThemeMode } {
  if (typeof window === 'undefined') {
    return { palette: 'default', mode: 'dark' }
  }
  const storedP = localStorage.getItem(LEGACY_PALETTE)
  const palette: ThemePalette =
    storedP === 'caffeine' || storedP === 'cosmic-night' ? storedP : 'default'
  const storedM = localStorage.getItem(LEGACY_MODE)
  const mode: ThemeMode = storedM === 'light' || storedM === 'system' ? storedM : 'dark'
  return { palette, mode }
}

/** Sync read for boot (persist blob or legacy keys). Exported for initTheme. */
export function readSyncedPaletteMode(): { palette: ThemePalette; mode: ThemeMode } {
  if (typeof window === 'undefined') {
    return { palette: 'default', mode: 'dark' }
  }
  try {
    const raw = localStorage.getItem(THEME_PERSIST_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { palette?: unknown; mode?: unknown } }
      const p = parsed.state?.palette
      const m = parsed.state?.mode
      if (isPalette(p) && isMode(m)) return { palette: p, mode: m }
    }
  } catch {}
  return readLegacyPaletteMode()
}

interface ThemeStoreState {
  palette: ThemePalette
  mode: ThemeMode
  setTheme: (palette: ThemePalette, mode: ThemeMode) => void
}

const initialSync = readSyncedPaletteMode()

export const useThemeStore = create<ThemeStoreState>()(
  persist(
    (set) => ({
      palette: initialSync.palette,
      mode: initialSync.mode,
      setTheme(palette, mode) {
        set({ palette, mode })
      },
    }),
    {
      name: THEME_PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ palette: s.palette, mode: s.mode }),
    },
  ),
)
