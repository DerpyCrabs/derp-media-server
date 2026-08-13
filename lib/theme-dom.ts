import { readSyncedPaletteMode, type ThemeMode, type ThemePalette } from '@/lib/theme-store'

export type ResolvedTheme =
  | 'default-light'
  | 'default-dark'
  | 'caffeine-light'
  | 'caffeine-dark'
  | 'cosmic-night-light'
  | 'cosmic-night-dark'

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(palette: ThemePalette, mode: ThemeMode): ResolvedTheme {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemPrefersDark())
  return `${palette}-${isDark ? 'dark' : 'light'}` as ResolvedTheme
}

export function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
}

export function subscribeSystemPreference(cb: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => cb()
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

export function initThemeFromStorage(): ResolvedTheme {
  const { palette, mode } = readSyncedPaletteMode()
  const resolved = resolveTheme(palette, mode)
  applyTheme(resolved)
  return resolved
}
