import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { post } from '@/lib/api'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { queryKeys } from '@/lib/query-keys'
import { isPathEditable } from '@/lib/utils'
import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { useBrowserHistory } from '../browser-history'
import { closeViewer } from '../lib/url-state-actions'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import { MarkdownPane } from './MarkdownPane'

export type TextViewerShareContext = {
  token: string
  sharePath: string
  isDirectory: boolean
}

type Props = {
  shareContext?: TextViewerShareContext | null
  /** When browsing as admin; ignored if shareContext is set. */
  editableFolders?: string[]
  /** Share link allows editing (editable + allowEdit). */
  shareCanEdit?: boolean
}

function shareEditRelativePath(viewingPath: string, sharePath: string): string {
  const sp = sharePath.replace(/\\/g, '/')
  const fileFwd = viewingPath.replace(/\\/g, '/')
  return fileFwd.startsWith(sp + '/') ? fileFwd.slice(sp.length + 1) : fileFwd
}

function buildResolveImageUrl(
  viewingPath: string,
  share: TextViewerShareContext | null,
): (src: string) => string | null {
  return (rawSrc: string) => {
    let src = rawSrc
    try {
      src = decodeURIComponent(src)
    } catch {
      /* noop */
    }

    if (share) {
      if (src.startsWith('http://') || src.startsWith('https://')) return src
      const fileDir = viewingPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
      const shareRoot = share.sharePath.replace(/\\/g, '/')
      const firstSeg = (p: string) => p.split('/').filter(Boolean)[0] ?? ''
      const isAbsolute =
        src.startsWith('/') ||
        (fileDir && (src === fileDir || src.startsWith(fileDir + '/'))) ||
        (shareRoot && (src === shareRoot || src.startsWith(shareRoot + '/'))) ||
        (firstSeg(src) && firstSeg(src) === firstSeg(viewingPath))
      let resolvedPath = isAbsolute
        ? src.startsWith('/')
          ? src.slice(1)
          : src
        : `${fileDir ? fileDir + '/' : ''}${src}`.replace(/\/+/g, '/').replace(/^\/+/, '')
      if (share.isDirectory && shareRoot && resolvedPath.startsWith(shareRoot + '/')) {
        resolvedPath = resolvedPath.slice(shareRoot.length).replace(/^\/+/, '')
      } else if (share.isDirectory && shareRoot && resolvedPath === shareRoot) {
        return null
      } else if (!share.isDirectory && resolvedPath !== shareRoot) {
        return null
      }
      const encoded = resolvedPath
        .split('/')
        .filter(Boolean)
        .map((s) => encodeURIComponent(s))
        .join('/')
      return encoded ? `/api/share/${share.token}/media/${encoded}` : null
    }

    return `/api/media/${src.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
  }
}

function TextViewerBody(props: {
  viewingPath: string
  shareContext?: TextViewerShareContext | null
  editableFolders: string[]
  shareCanEdit: boolean
}): JSX.Element {
  const queryClient = useQueryClient()
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

  const fileEditable = createMemo(() => {
    if (props.shareContext) return props.shareCanEdit
    return isPathEditable(props.viewingPath, props.editableFolders)
  })

  const ext = createMemo(() => props.viewingPath.split('.').pop()?.toLowerCase() || '')
  const isMarkdown = createMemo(() => ext() === 'md')

  const [readOnlyView, setReadOnlyView] = createSignal(false)
  const [editContent, setEditContent] = createSignal('')
  const [copied, setCopied] = createSignal(false)

  let lastPath = ''
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  const saveMutation = useMutation(() => ({
    mutationFn: async (content: string) => {
      const ctx = props.shareContext
      if (ctx) {
        const rel = shareEditRelativePath(props.viewingPath, ctx.sharePath)
        await post(`/api/share/${ctx.token}/edit`, { path: rel, content })
      } else {
        await post('/api/files/edit', { path: props.viewingPath, content })
      }
      return content
    },
    onSuccess: (content: string) => {
      const key = queryKey()
      queryClient.setQueryData(key, content)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  }))

  async function saveInternal(quiet: boolean) {
    if (editContent() === (textQuery.data ?? '')) return
    try {
      await saveMutation.mutateAsync(editContent())
    } catch (e) {
      if (!quiet) {
        window.alert(e instanceof Error ? e.message : 'Failed to save file')
      }
    }
  }

  createEffect(() => {
    const path = props.viewingPath
    const data = textQuery.data
    if (!path || data === undefined) return
    if (path !== lastPath) {
      lastPath = path
      setReadOnlyView(false)
      setEditContent(data)
    }
  })

  createEffect(() => {
    onCleanup(() => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer)
        autosaveTimer = null
      }
    })
    if (!fileEditable() || readOnlyView()) return
    if (editContent() === (textQuery.data ?? '')) return
    autosaveTimer = setTimeout(() => {
      void saveInternal(true)
    }, 2000)
  })

  async function handleClose() {
    if (autosaveTimer) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
    if (fileEditable() && !readOnlyView() && editContent() !== (textQuery.data ?? '')) {
      await saveInternal(true)
    }
    closeViewer()
  }

  async function handleCopy() {
    const src = textQuery.data ?? ''
    if (!src) return
    try {
      await navigator.clipboard.writeText(src)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const resolveImageUrl = createMemo(() =>
    buildResolveImageUrl(props.viewingPath, props.shareContext ?? null),
  )

  const fileName = createMemo(() => props.viewingPath.split(/[/\\]/).pop() || '')
  const showEditor = createMemo(() => fileEditable() && !readOnlyView())

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='text-viewer-title'
      class='fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm'
    >
      <header class='border-border bg-background/90 flex h-auto min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2'>
        <h2 id='text-viewer-title' class='min-w-0 flex-1 truncate text-sm font-medium'>
          {fileName()}
        </h2>
        <div class='flex flex-wrap items-center gap-2'>
          <Show when={showEditor()}>
            <button
              type='button'
              class='hover:bg-muted rounded-md px-2 py-1 text-sm disabled:opacity-50'
              disabled={saveMutation.isPending}
              onClick={() => setReadOnlyView(true)}
            >
              Read only
            </button>
            <Show when={!saveMutation.isPending && saveMutation.isError}>
              <span class='text-destructive text-xs'>Save failed</span>
            </Show>
          </Show>
          <Show when={!showEditor()}>
            <Show when={fileEditable()}>
              <button
                type='button'
                class='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-2 py-1 text-sm'
                onClick={() => {
                  setReadOnlyView(false)
                  setEditContent(textQuery.data ?? '')
                }}
              >
                Edit
              </button>
            </Show>
            <button
              type='button'
              title='Copy to clipboard'
              class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
              onClick={() => void handleCopy()}
            >
              <span class='sr-only'>Copy to clipboard</span>
              {copied() ? '✓' : '⎘'}
            </button>
          </Show>
          <button
            type='button'
            title='Close'
            class='hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
            onClick={() => void handleClose()}
          >
            <span class='sr-only'>Close</span>×
          </button>
        </div>
      </header>
      <div class='min-h-0 flex-1 overflow-hidden'>
        <Show when={textQuery.isPending}>
          <p class='text-muted-foreground p-4 text-sm'>Loading…</p>
        </Show>
        <Show when={textQuery.isError}>
          <p class='text-destructive p-4 text-sm'>Failed to load file.</p>
        </Show>
        <Show when={!textQuery.isPending && !textQuery.isError}>
          <Show
            when={showEditor()}
            fallback={
              <Show
                when={isMarkdown()}
                fallback={
                  <div class='h-full overflow-auto p-4'>
                    <pre class='font-mono text-sm wrap-break-word whitespace-pre-wrap'>
                      {textQuery.data ?? ''}
                    </pre>
                  </div>
                }
              >
                <MarkdownPane content={textQuery.data ?? ''} resolveImageUrl={resolveImageUrl()} />
              </Show>
            }
          >
            <div class='h-full p-4'>
              <textarea
                class='border-input bg-background focus-visible:ring-ring h-full w-full resize-none rounded-lg border p-4 font-mono text-sm focus-visible:ring-2 focus-visible:outline-none'
                value={editContent()}
                spellcheck={false}
                placeholder='Enter text…'
                onInput={(e) => setEditContent(e.currentTarget.value)}
                onBlur={() => void saveInternal(true)}
                onKeyDown={(e) => {
                  if (
                    e.key === 'ArrowLeft' ||
                    e.key === 'ArrowRight' ||
                    e.key === 'ArrowUp' ||
                    e.key === 'ArrowDown' ||
                    e.key === 'Home' ||
                    e.key === 'End' ||
                    e.key === 'PageUp' ||
                    e.key === 'PageDown'
                  ) {
                    e.stopPropagation()
                  }
                }}
              />
            </div>
          </Show>
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

  const folders = () => props.editableFolders ?? []
  const shareEdit = () => props.shareCanEdit ?? false

  return (
    <Show when={viewingPath() && isText()}>
      <TextViewerBody
        viewingPath={viewingPath()!}
        shareContext={props.shareContext ?? null}
        editableFolders={folders()}
        shareCanEdit={shareEdit()}
      />
    </Show>
  )
}
