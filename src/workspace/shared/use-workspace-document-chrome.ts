import { workspaceTabIconColorKeyToHex } from '@/workspace/model/workspace-tab-icon-colors'
import {
  DEFAULT_FAVICON_DATA_URL,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/ui/dynamic-favicon-core'
import type { WorkspaceRecord } from '@/workspace/model/workspace-registry'
import { createEffect, onSettled, type Accessor } from 'solid-js'

export function useWorkspaceDocumentChrome(
  record: Accessor<WorkspaceRecord | undefined>,
  themeTick: () => void,
) {
  const tabChromeRestore = { title: 'Media Server', href: DEFAULT_FAVICON_DATA_URL }
  let tabFaviconGeneration = 0

  onSettled(() => {
    tabChromeRestore.title = document.title
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null
    if (link?.href) tabChromeRestore.href = link.href
  })

  createEffect(
    () => {
      themeTick()
      return record()
    },
    (workspace) => {
      if (typeof document === 'undefined') return
      const title = workspace?.name?.trim() ?? ''
      document.title = title ? `${title} · Media Server` : 'Workspace · Media Server'
      const iconName = workspace?.icon?.trim() ?? ''
      const generation = ++tabFaviconGeneration
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
      const color =
        workspaceTabIconColorKeyToHex(workspace?.iconColor?.trim() ?? '') ??
        (isDark ? '#ffffff' : '#000000')
      void generateFaviconFromSvg(svg, color).then((data) => {
        if (generation !== tabFaviconGeneration) return
        if (data) setFaviconHref(data)
      })
    },
  )

  onSettled(() => () => {
    if (typeof document === 'undefined') return
    document.title = tabChromeRestore.title
    setFaviconHref(tabChromeRestore.href)
  })
}
