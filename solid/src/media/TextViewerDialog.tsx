import { useQuery } from '@tanstack/solid-query'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { queryKeys } from '@/lib/query-keys'
import { Show, createMemo, type JSX } from 'solid-js'
import { useBrowserHistory } from '../browser-history'
import { closeViewer } from '../lib/url-state-actions'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

function TextViewerBody(props: {
  viewingPath: string
  shareContext?: { token: string; sharePath: string } | null
}): JSX.Element {
  const mediaUrl = createMemo(() => {
    const path = props.viewingPath
    const ctx = props.shareContext
    return ctx ? buildShareMediaUrl(ctx.token, ctx.sharePath, path) : buildAdminMediaUrl(path)
  })

  const queryKey = createMemo(() => {
    const ctx = props.shareContext
    return ctx
      ? queryKeys.shareText(ctx.token, props.viewingPath)
      : queryKeys.textContent(props.viewingPath)
  })

  const textQuery = useQuery(() => ({
    queryKey: queryKey(),
    queryFn: async () => {
      const url = mediaUrl()
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load file')
      return await res.text()
    },
  }))

  const fileName = createMemo(() => (props.viewingPath || '').split('/').pop() || '')

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='text-viewer-title'
      class='fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm'
    >
      <header class='border-border bg-background/90 flex h-12 shrink-0 items-center justify-between border-b px-3'>
        <h2 id='text-viewer-title' class='truncate text-sm font-medium'>
          {fileName()}
        </h2>
        <button
          type='button'
          title='Close'
          class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
          onClick={() => closeViewer()}
        >
          <span class='sr-only'>Close</span>×
        </button>
      </header>
      <div class='min-h-0 flex-1 overflow-auto p-4'>
        <Show when={textQuery.isPending}>
          <p class='text-muted-foreground text-sm'>Loading…</p>
        </Show>
        <Show when={textQuery.isError}>
          <p class='text-destructive text-sm'>Failed to load file.</p>
        </Show>
        <Show when={!textQuery.isPending && !textQuery.isError}>
          <pre class='font-mono text-sm whitespace-pre-wrap'>{textQuery.data ?? ''}</pre>
        </Show>
      </div>
    </div>
  )
}

export function TextViewerDialog(props: Props) {
  const history = useBrowserHistory()

  const viewingPath = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('viewing')
  })

  const extension = createMemo(() => (viewingPath() || '').split('.').pop()?.toLowerCase() || '')
  const mediaType = createMemo(() => getMediaType(extension()))
  const isText = createMemo(() => !!viewingPath() && mediaType() === MediaType.TEXT)

  return (
    <Show when={viewingPath() && isText()}>
      <TextViewerBody viewingPath={viewingPath()!} shareContext={props.shareContext} />
    </Show>
  )
}
