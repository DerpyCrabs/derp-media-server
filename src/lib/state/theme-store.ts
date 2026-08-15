import { createStore } from 'solid-js'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

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
  const fromBlob = readPersistedState<{ palette?: unknown; mode?: unknown }>(THEME_PERSIST_KEY)
  if (fromBlob) {
    const p = fromBlob.palette
    const m = fromBlob.mode
    if (isPalette(p) && isMode(m)) return { palette: p, mode: m }
  }
  return readLegacyPaletteMode()
}

const initialSync = readSyncedPaletteMode()

const listeners = createStoreListeners()

const [store, setStore] = createStore({
  palette: initialSync.palette,
  mode: initialSync.mode,
})

function persist(palette: ThemePalette, mode: ThemeMode) {
  writePersistedState(THEME_PERSIST_KEY, { palette, mode })
}

function setTheme(palette: ThemePalette, mode: ThemeMode) {
  setStore((state) => {
    state.palette = palette
    state.mode = mode
  })
  persist(palette, mode)
  listeners.notify()
}

const api = {
  get palette() {
    return store.palette
  },
  get mode() {
    return store.mode
  },
  setTheme,
}

export const useThemeStore = {
  getState: () => api,
  subscribe: (fn: () => void) => listeners.subscribe(fn),
}
