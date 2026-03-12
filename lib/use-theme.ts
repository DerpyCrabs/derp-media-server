import { useSyncExternalStore, useCallback, useEffect } from 'react'

const STORAGE_PALETTE = 'theme-palette'
const STORAGE_MODE = 'theme-mode'

export type ThemePalette = 'default' | 'caffeine' | 'cosmic-night'
export type ThemeMode = 'light' | 'dark' | 'system'

export type ResolvedTheme =
  | 'default-light'
  | 'default-dark'
  | 'caffeine-light'
  | 'caffeine-dark'
  | 'cosmic-night-light'
  | 'cosmic-night-dark'

const COSMIC_NIGHT_FONTS_ID = 'theme-fonts-cosmic-night'
const COSMIC_NIGHT_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolveTheme(palette: ThemePalette, mode: ThemeMode): ResolvedTheme {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemPrefersDark())
  return `${palette}-${isDark ? 'dark' : 'light'}` as ResolvedTheme
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
  if (resolved.startsWith('cosmic-night')) {
    ensureCosmicNightFonts()
  } else {
    removeCosmicNightFonts()
  }
}

function ensureCosmicNightFonts() {
  let link = document.getElementById(COSMIC_NIGHT_FONTS_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = COSMIC_NIGHT_FONTS_ID
    link.rel = 'stylesheet'
    link.href = COSMIC_NIGHT_FONTS_HREF
    document.head.appendChild(link)
  }
}

function removeCosmicNightFonts() {
  document.getElementById(COSMIC_NIGHT_FONTS_ID)?.remove()
}

function getStoredPalette(): ThemePalette {
  if (typeof window === 'undefined') return 'default'
  const stored = localStorage.getItem(STORAGE_PALETTE)
  if (stored === 'caffeine' || stored === 'cosmic-night') return stored
  return 'default'
}

function getStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem(STORAGE_MODE)
  if (stored === 'light' || stored === 'system') return stored
  return 'dark'
}

function getSnapshotResolved(): ResolvedTheme {
  return resolveTheme(getStoredPalette(), getStoredMode())
}

const THEME_CHANGE_EVENT = 'theme-change'

function subscribe(callback: () => void): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => callback()
  media.addEventListener('change', handler)
  window.addEventListener(THEME_CHANGE_EVENT, handler)
  return () => {
    media.removeEventListener('change', handler)
    window.removeEventListener(THEME_CHANGE_EVENT, handler)
  }
}

export function useTheme() {
  const resolved = useSyncExternalStore(subscribe, getSnapshotResolved, getSnapshotResolved)

  const palette = getStoredPalette()
  const mode = getStoredMode()

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setTheme = useCallback((newPalette: ThemePalette, newMode: ThemeMode) => {
    localStorage.setItem(STORAGE_PALETTE, newPalette)
    localStorage.setItem(STORAGE_MODE, newMode)
    const next = resolveTheme(newPalette, newMode)
    applyTheme(next)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }, [])

  return { palette, mode, resolved, setTheme }
}

export function initTheme(): ResolvedTheme {
  const palette = getStoredPalette()
  const mode = getStoredMode()
  const resolved = resolveTheme(palette, mode)
  applyTheme(resolved)
  return resolved
}
