import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { useQuery } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/query-keys'
import { getMediaType } from '@/lib/media-utils'
import { stripSharePrefix } from '@/lib/source-context'
import { MediaType } from '@/lib/types'
import type { Accessor } from 'solid-js'
import { createMemo, Show } from 'solid-js'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import type { WorkspaceShareConfig } from './WorkspaceBrowserPane'

type Props = {
  windowId: string
  workspace: Accessor<PersistedWorkspaceState | null>
  sharePanel: Accessor<WorkspaceShareConfig | null>
}

export function WorkspaceViewerPane(props: Props) {
  const win = createMemo(() => props.workspace()?.windows.find((w) => w.id === props.windowId))

  const share = createMemo((): WorkspaceShareConfig | null => {
    const w = win()
    if (w?.source.kind === 'share' && w.source.token) {
      return { token: w.source.token, sharePath: w.source.sharePath ?? '' }
    }
    return props.sharePanel() ?? null
  })

  const viewingPath = createMemo(() => win()?.initialState?.viewing ?? '')

  const mediaUrl = createMemo(() => {
    const path = viewingPath()
    if (!path) return ''
    const sh = share()
    return sh ? buildShareMediaUrl(sh.token, sh.sharePath, path) : buildAdminMediaUrl(path)
  })

  const queryKey = createMemo(() => {
    const path = viewingPath()
    if (!path) return queryKeys.textContent('')
    const sh = share()
    return sh ? queryKeys.shareText(sh.token, path) : queryKeys.textContent(path)
  })

  const mediaType = createMemo(() =>
    getMediaType(viewingPath().split('.').pop()?.toLowerCase() ?? ''),
  )

  const textQuery = useQuery(() => ({
    queryKey: queryKey(),
    enabled: mediaType() === MediaType.TEXT && Boolean(viewingPath()),
    queryFn: async () => {
      const url = mediaUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load file')
      return await res.text()
    },
  }))

  const fileName = createMemo(() => viewingPath().split(/[/\\]/).pop() ?? 'file')

  const downloadHref = createMemo(() => {
    const path = viewingPath()
    if (!path) return '#'
    const sh = share()
    if (sh) {
      const rel = stripSharePrefix(path.replace(/\\/g, '/'), sh.sharePath)
      return `/api/share/${sh.token}/download?path=${encodeURIComponent(rel)}`
    }
    return `/api/files/download?path=${encodeURIComponent(path)}`
  })

  return (
    <div
      class='flex min-h-0 flex-1 flex-col overflow-auto p-3 text-sm'
      data-testid='workspace-window-visible-content'
    >
      <Show when={mediaType() === MediaType.OTHER}>
        <div class='flex flex-1 flex-col items-center justify-center gap-4 p-6'>
          <p class='text-center text-sm text-muted-foreground'>
            This file type cannot be previewed.
          </p>
          <a
            href={downloadHref()}
            download={fileName()}
            class='inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90'
          >
            Download File
          </a>
        </div>
      </Show>

      <Show when={mediaType() === MediaType.TEXT}>
        <Show when={textQuery.isPending}>
          <p class='text-muted-foreground'>Loading…</p>
        </Show>
        <Show when={textQuery.isError}>
          <p class='text-destructive text-sm'>Failed to load file.</p>
        </Show>
        <Show when={textQuery.isSuccess}>
          <pre class='font-sans whitespace-pre-wrap break-words text-foreground'>
            {textQuery.data}
          </pre>
        </Show>
      </Show>
    </div>
  )
}
