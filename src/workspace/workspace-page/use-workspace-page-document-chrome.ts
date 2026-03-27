import { workspaceTabIconColorKeyToHex } from '@/lib/workspace-tab-icon-colors'
import {
  DEFAULT_FAVICON_DATA_URL,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/dynamic-favicon-core'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { createEffect, onCleanup, onMount, type Accessor } from 'solid-js'

export function useWorkspacePageDocumentChrome(
  workspace: Accessor<PersistedWorkspaceState | null>,
  themeTick: () => void,
) {
  const tabChromeRestore = { title: 'Media Server', href: DEFAULT_FAVICON_DATA_URL }
  let tabFaviconGen = 0

  onMount(() => {
    tabChromeRestore.title = document.title
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null
    if (link?.href) tabChromeRestore.href = link.href
  })

  createEffect(() => {
    themeTick()
    const w = workspace()
    if (typeof document === 'undefined') return
    if (!w) return
    const title = (w.browserTabTitle ?? '').trim()
    document.title = title ? `${title} · Media Server` : 'Workspace · Media Server'
    const iconName = (w.browserTabIcon ?? '').trim()
    const gen = ++tabFaviconGen
    if (!iconName) {
      setFaviconHref(tabChromeRestore.href)
      return
    }
    const svg = getLucideIconSvg(iconName)
    if (!svg) {
      setFaviconHref(tabChromeRestore.href)
      return
    }
    const isDark = document.documentElement.getAttribute('data-theme')?.endsWith('-dark')
    const colorKey = (w.browserTabIconColor ?? '').trim()
    const color = workspaceTabIconColorKeyToHex(colorKey) ?? (isDark ? '#ffffff' : '#000000')
    void generateFaviconFromSvg(svg, color).then((data) => {
      if (gen !== tabFaviconGen) return
      if (data) setFaviconHref(data)
    })
  })

  onCleanup(() => {
    if (typeof document === 'undefined') return
    document.title = tabChromeRestore.title
    setFaviconHref(tabChromeRestore.href)
  })
}
