import { workspaceTabIconColorKeyToHex } from '@/workspace/model/workspace-tab-icon-colors'
import {
  DEFAULT_FAVICON_DATA_URL,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/ui/dynamic-favicon-core'
import type { WorkspaceRecord } from '@/workspace/model/workspace-registry'
import { modelOwner } from 'effectweb'
import { Effect } from 'effect'
export function createWorkspaceDocumentChrome() {
  const previousTitle = document.title
  const previousHref =
    document.querySelector<HTMLLinkElement>("link[rel*='icon']")?.href ?? DEFAULT_FAVICON_DATA_URL
  const owner = modelOwner({})
  const slot = 'workspace-favicon'
  return {
    update(record: WorkspaceRecord | undefined) {
      const title = record?.name?.trim()
      document.title = title ? `${title} · Media Server` : 'Workspace · Media Server'
      const svg = getLucideIconSvg(record?.icon?.trim() ?? '')
      owner.cancel(slot)
      if (!svg) {
        setFaviconHref(previousHref)
        return
      }
      const isDark = document.documentElement.getAttribute('data-theme')?.endsWith('-dark')
      const color =
        workspaceTabIconColorKeyToHex(record?.iconColor?.trim() ?? '') ??
        (isDark ? '#ffffff' : '#000000')
      owner.run(
        slot,
        generateFaviconFromSvg(svg, color).pipe(
          Effect.tap((data) =>
            Effect.sync(() => {
              if (data) setFaviconHref(data)
            }),
          ),
        ),
        'replace',
      )
    },
    dispose() {
      owner.dispose()
      document.title = previousTitle
      setFaviconHref(previousHref)
    },
  }
}
