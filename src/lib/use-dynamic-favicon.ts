import { useThemeStore } from '@/lib/theme-store'
import {
  DEFAULT_FAVICON_DATA_URL,
  type DynamicFaviconNavState,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/dynamic-favicon-core'
import type { Accessor } from 'solid-js'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'

type Options = {
  rootName?: string
  state?: Accessor<DynamicFaviconNavState>
  getSearch?: Accessor<string>
}

function navFromSearch(search: string): DynamicFaviconNavState {
  const sp = new URLSearchParams(search)
  return {
    dir: sp.get('dir'),
    viewing: sp.get('viewing'),
    playing: sp.get('playing'),
  }
}

export function useDynamicFavicon(
  customIcons: Accessor<Record<string, string>>,
  options?: Options,
) {
  const [themeTick, setThemeTick] = createSignal(0)
  const originals = { title: 'Media Server', href: null as string | null }
  let currentFavicon = 'default'

  onMount(() => {
    originals.title = document.title
    const existingFavicon = document.querySelector("link[rel*='icon']") as HTMLLinkElement
    originals.href = existingFavicon?.href ?? DEFAULT_FAVICON_DATA_URL
    const unsub = useThemeStore.subscribe(() => setThemeTick((n) => n + 1))
    onCleanup(unsub)
  })

  createEffect(() => {
    void themeTick()
    const icons = customIcons()
    const nav = options?.state
      ? options.state()
      : navFromSearch(
          options?.getSearch?.() ?? (typeof window !== 'undefined' ? window.location.search : ''),
        )

    const currentDir = nav.dir || ''
    const playingPath = nav.playing
    const viewingPath = nav.viewing

    let targetPath = currentDir
    let shouldUpdateFavicon = false

    if (playingPath && icons[playingPath]) {
      targetPath = playingPath
      shouldUpdateFavicon = true
    } else if (viewingPath && icons[viewingPath]) {
      targetPath = viewingPath
      shouldUpdateFavicon = true
    } else if (icons[currentDir]) {
      targetPath = currentDir
      shouldUpdateFavicon = true
    }

    const folderName = currentDir
      ? currentDir.split(/[/\\]/).filter(Boolean).at(-1)
      : (options?.rootName ?? 'Home')
    document.title = folderName ? `${folderName} - Media Server` : 'Media Server'

    if (shouldUpdateFavicon) {
      const customIconName = icons[targetPath]
      const svgString = customIconName ? getLucideIconSvg(customIconName) : null
      if (svgString) {
        const isDark = document.documentElement.getAttribute('data-theme')?.endsWith('-dark')
        const color = isDark ? '#ffffff' : '#000000'

        void generateFaviconFromSvg(svgString, color).then((data) => {
          if (data && data !== currentFavicon) {
            setFaviconHref(data)
            currentFavicon = data
          }
        })
      } else if (currentFavicon !== 'default') {
        const defaultHref = originals.href ?? DEFAULT_FAVICON_DATA_URL
        setFaviconHref(defaultHref)
        currentFavicon = 'default'
      }
    } else {
      if (currentFavicon !== 'default') {
        const defaultHref = originals.href ?? DEFAULT_FAVICON_DATA_URL
        setFaviconHref(defaultHref)
        currentFavicon = 'default'
      }
    }

    onCleanup(() => {
      if (shouldUpdateFavicon && currentFavicon !== 'default') {
        const defaultHref = originals.href ?? DEFAULT_FAVICON_DATA_URL
        setFaviconHref(defaultHref)
        currentFavicon = 'default'
      }
    })
  })
}
