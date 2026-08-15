import { useThemeStore } from '@/lib/state/theme-store'
import {
  applyTheme,
  initThemeFromStorage,
  resolveTheme,
  subscribeSystemPreference,
} from '@/lib/state/theme-dom'
import { onSettled } from 'solid-js'

export function SolidThemeSync() {
  onSettled(() => {
    initThemeFromStorage()
    let lastPalette: string | undefined
    let lastMode: string | undefined
    const unsubStore = useThemeStore.subscribe(() => {
      const s = useThemeStore.getState()
      if (s.palette === lastPalette && s.mode === lastMode) return
      lastPalette = s.palette
      lastMode = s.mode
      applyTheme(resolveTheme(s.palette, s.mode))
    })
    const unsubMedia = subscribeSystemPreference(() => {
      const { palette, mode } = useThemeStore.getState()
      applyTheme(resolveTheme(palette, mode))
    })
    return () => {
      unsubStore()
      unsubMedia()
    }
  })
  return null
}
