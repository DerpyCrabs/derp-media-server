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
    const unsubStore = useThemeStore.subscribe((state, prev) => {
      if (prev && state.palette === prev.palette && state.mode === prev.mode) return
      applyTheme(resolveTheme(state.palette, state.mode))
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
