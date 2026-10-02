import { themeStore } from '@/lib/state/theme-store'
import {
  applyTheme,
  initThemeFromStorage,
  resolveTheme,
  subscribeSystemPreference,
} from '@/lib/state/theme-dom'

export function createThemeLifetime() {
  initThemeFromStorage()
  let lastPalette: string | undefined
  let lastMode: string | undefined
  const unsubStore = themeStore.source.subscribe(() => {
    const s = themeStore.read()
    if (s.palette === lastPalette && s.mode === lastMode) return
    lastPalette = s.palette
    lastMode = s.mode
    applyTheme(resolveTheme(s.palette, s.mode))
  })
  const unsubMedia = subscribeSystemPreference(() => {
    const { palette, mode } = themeStore.read()
    applyTheme(resolveTheme(palette, mode))
  })
  return {
    dispose: () => {
      unsubStore()
      unsubMedia()
    },
  }
}
