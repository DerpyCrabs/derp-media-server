import { useThemeStore } from '@/lib/theme-store'
import {
  applyTheme,
  initThemeFromStorage,
  resolveTheme,
  subscribeSystemPreference,
} from '@/lib/theme-dom'
import { onCleanup, onMount } from 'solid-js'

export function SolidThemeSync() {
  onMount(() => {
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
    onCleanup(() => {
      unsubStore()
      unsubMedia()
    })
  })
  return null
}
