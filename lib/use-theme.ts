import { useSyncExternalStore, useCallback, useEffect, useMemo } from 'react'
import { useThemeStore, type ThemeMode, type ThemePalette } from '@/lib/theme-store'
import {
  applyTheme,
  initThemeFromStorage,
  resolveTheme,
  subscribeSystemPreference,
  type ResolvedTheme,
} from '@/lib/theme-dom'
import { getSystemPrefersDark } from '@/lib/theme-dom'

export type { ThemePalette, ThemeMode } from '@/lib/theme-store'
export type { ResolvedTheme } from '@/lib/theme-dom'
export { resolveTheme } from '@/lib/theme-dom'

export function useTheme() {
  const palette = useThemeStore((s) => s.palette)
  const mode = useThemeStore((s) => s.mode)
  const setStoreTheme = useThemeStore((s) => s.setTheme)

  const systemDark = useSyncExternalStore(
    subscribeSystemPreference,
    getSystemPrefersDark,
    getSystemPrefersDark,
  )

  const resolved = useMemo((): ResolvedTheme => {
    const isDark = mode === 'dark' || (mode === 'system' && systemDark)
    return `${palette}-${isDark ? 'dark' : 'light'}` as ResolvedTheme
  }, [palette, mode, systemDark])

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setTheme = useCallback(
    (newPalette: ThemePalette, newMode: ThemeMode) => {
      setStoreTheme(newPalette, newMode)
      applyTheme(resolveTheme(newPalette, newMode))
    },
    [setStoreTheme],
  )

  return { palette, mode, resolved, setTheme }
}

export function initTheme(): ResolvedTheme {
  return initThemeFromStorage()
}
