import { themeStore } from '@/lib/state/theme-store'
import { modelOwner } from 'effectweb'
import { Effect } from 'effect'
import {
  DEFAULT_FAVICON_DATA_URL,
  type DynamicFaviconNavState,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/ui/dynamic-favicon-core'
export type FaviconInput = {
  icons: Readonly<Record<string, string>>
  nav: DynamicFaviconNavState
  rootName?: string
}
const renderFavicon = 'render-favicon'
export function createDynamicFavicon() {
  const owner = modelOwner({})
  const originalTitle = document.title
  const originalHref =
    document.querySelector<HTMLLinkElement>("link[rel*='icon']")?.href ?? DEFAULT_FAVICON_DATA_URL
  let input: FaviconInput | undefined
  let previousKey = ''
  const render = () => {
    if (!input) return
    const { icons, nav, rootName } = input
    const directory = nav.dir || ''
    const name = directory ? directory.split(/[/\\]/).filter(Boolean).at(-1) : (rootName ?? 'Home')
    document.title = name ? `${name} - Media Server` : 'Media Server'
    const path = [nav.playing, nav.viewing, directory].find((path) => path != null && icons[path])
    const icon = path == null ? undefined : icons[path]
    const color = document.documentElement.getAttribute('data-theme')?.endsWith('-dark')
      ? '#ffffff'
      : '#000000'
    const key = `${icon ?? ''}:${color}`
    if (key === previousKey) return
    previousKey = key
    const svg = icon ? getLucideIconSvg(icon) : null
    owner.run(
      renderFavicon,
      svg
        ? generateFaviconFromSvg(svg, color).pipe(
            Effect.tap((data) => Effect.sync(() => setFaviconHref(data ?? originalHref))),
            Effect.catch(() => Effect.void),
          )
        : Effect.sync(() => setFaviconHref(originalHref)),
      'replace',
    )
  }
  const unsubscribe = themeStore.source.subscribe(render)
  return {
    update(next: FaviconInput) {
      input = next
      render()
    },
    dispose() {
      unsubscribe()
      owner.dispose()
      document.title = originalTitle
      setFaviconHref(originalHref)
    },
  }
}
