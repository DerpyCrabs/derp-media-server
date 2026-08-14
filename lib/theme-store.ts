import { createStore } from 'solid-js/store'
import { createStoreListeners, readPersistedState, writePersistedState } from './client-store-utils'

export type ThemePalette = 'default' | 'caffeine' | 'cosmic-night'
export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_PERSIST_KEY = 'app-theme'

function isPalette(v: unknown): v is ThemePalette {
  return v === 'default' || v === 'caffeine' || v === 'cosmic-night'
}

function isMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system'
}

/** Sync read for boot. Exported for initTheme. */
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
  return { palette: 'default', mode: 'dark' }
}

const initialSync = readSyncedPaletteMode()

const listeners = createStoreListeners()

const [store, setStore] = createStore({
  palette: initialSync.palette,
  mode: initialSync.mode,
})

function persist() {
  writePersistedState(THEME_PERSIST_KEY, { palette: store.palette, mode: store.mode })
}

function setTheme(palette: ThemePalette, mode: ThemeMode) {
  setStore('palette', palette)
  setStore('mode', mode)
  persist()
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
