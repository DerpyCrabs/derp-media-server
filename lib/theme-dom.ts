import { readSyncedPaletteMode, type ThemeMode, type ThemePalette } from '@/lib/theme-store'

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

export function resolveTheme(palette: ThemePalette, mode: ThemeMode): ResolvedTheme {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemPrefersDark())
  return `${palette}-${isDark ? 'dark' : 'light'}` as ResolvedTheme
}

export function applyTheme(resolved: ResolvedTheme) {
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
