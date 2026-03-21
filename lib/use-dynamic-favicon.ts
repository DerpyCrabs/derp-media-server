import { useEffect, useRef } from 'react'
import { useUrlState } from '@/lib/use-url-state'
import { useTheme } from '@/lib/use-theme'
import type { NavigationState } from '@/lib/navigation-session'
import {
  DEFAULT_FAVICON_DATA_URL,
  type DynamicFaviconNavState,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/dynamic-favicon-core'

export function useDynamicFavicon(
  customIcons: Record<string, string>,
  options?: { rootName?: string; state?: NavigationState },
) {
  const { state: urlState } = useUrlState()
  const { resolved: theme } = useTheme()
  const navigationState = options?.state ?? urlState
  const originalTitleRef = useRef<string>('Media Server')
  const originalFaviconRef = useRef<string | null>(null)
  const currentFaviconRef = useRef<string>('default')

  useEffect(() => {
    if (originalTitleRef.current === 'Media Server') {
      originalTitleRef.current = document.title
      const existingFavicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement
      originalFaviconRef.current = existingFavicon?.href ?? DEFAULT_FAVICON_DATA_URL
    }
  }, [])

  useEffect(() => {
    const nav: DynamicFaviconNavState = {
      dir: navigationState.dir,
      viewing: navigationState.viewing,
      playing: navigationState.playing,
    }
    const currentDir = nav.dir || ''
    const playingPath = nav.playing
    const viewingPath = nav.viewing

    let targetPath = currentDir
    let shouldUpdateFavicon = false

    if (playingPath && customIcons[playingPath]) {
      targetPath = playingPath
      shouldUpdateFavicon = true
    } else if (viewingPath && customIcons[viewingPath]) {
      targetPath = viewingPath
      shouldUpdateFavicon = true
    } else if (customIcons[currentDir]) {
      targetPath = currentDir
      shouldUpdateFavicon = true
    }

    const folderName = currentDir
      ? currentDir.split(/[/\\]/).filter(Boolean).at(-1)
      : (options?.rootName ?? 'Home')
    document.title = folderName ? `${folderName} - Media Server` : 'Media Server'

    if (shouldUpdateFavicon) {
      const customIconName = customIcons[targetPath]
      const svgString = customIconName ? getLucideIconSvg(customIconName) : null
      if (svgString) {
        const isDark = document.documentElement.getAttribute('data-theme')?.endsWith('-dark')
        const color = isDark ? '#ffffff' : '#000000'

        void generateFaviconFromSvg(svgString, color).then((data) => {
          if (data && data !== currentFaviconRef.current) {
            setFaviconHref(data)
            currentFaviconRef.current = data
          }
        })
      } else if (currentFaviconRef.current !== 'default') {
        const defaultHref = originalFaviconRef.current ?? DEFAULT_FAVICON_DATA_URL
        setFaviconHref(defaultHref)
        currentFaviconRef.current = 'default'
      }
    } else {
      if (currentFaviconRef.current !== 'default') {
        const defaultHref = originalFaviconRef.current ?? DEFAULT_FAVICON_DATA_URL
        setFaviconHref(defaultHref)
        currentFaviconRef.current = 'default'
      }
    }

    return () => {
      if (shouldUpdateFavicon && currentFaviconRef.current !== 'default') {
        const defaultHref = originalFaviconRef.current ?? DEFAULT_FAVICON_DATA_URL
        setFaviconHref(defaultHref)
        currentFaviconRef.current = 'default'
      }
    }
  }, [
    navigationState.dir,
    navigationState.playing,
    navigationState.viewing,
    customIcons,
    options?.rootName,
    theme,
  ])
}
