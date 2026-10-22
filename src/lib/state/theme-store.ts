import { Schema } from 'effect'
import { modelOwner } from 'effectweb'
import { readPersistedState, writePersistedState } from './client-store-utils'

export type ThemePalette = 'default' | 'caffeine' | 'cosmic-night'
export type ThemeMode = 'light' | 'dark' | 'system'

const LEGACY_PALETTE = 'theme-palette'
const LEGACY_MODE = 'theme-mode'

const THEME_PERSIST_KEY = 'app-theme'

const themeSchema = Schema.Struct({
  palette: Schema.Literals(['default', 'caffeine', 'cosmic-night']),
  mode: Schema.Literals(['light', 'dark', 'system']),
})

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
  const fromBlob = readPersistedState(THEME_PERSIST_KEY, themeSchema)
  if (fromBlob) return fromBlob
  return readLegacyPaletteMode()
}

const initialSync = readSyncedPaletteMode()

const owner = modelOwner({ palette: initialSync.palette, mode: initialSync.mode })

function persist(palette: ThemePalette, mode: ThemeMode) {
  writePersistedState(THEME_PERSIST_KEY, { palette, mode })
}

function setTheme(palette: ThemePalette, mode: ThemeMode) {
  owner.patch({ palette, mode })
  persist(palette, mode)
}

export const themeStore = { source: owner.source, read: owner.read, setTheme }
