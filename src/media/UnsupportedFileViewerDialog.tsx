import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { MediaType, type FileItem } from '@/lib/types'
import { formatFileSize } from '@/lib/media-utils'
import { stripSharePrefix } from '@/lib/source-context'
import FileQuestion from 'lucide-solid/icons/file-question'
import FileText from 'lucide-solid/icons/file-text'
import X from 'lucide-solid/icons/x'
import { Show, createMemo, type JSX } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import { closeViewer } from '../lib/url-state-actions'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

type ShareCtx = { token: string; sharePath: string }

function useDirFromUrl() {
  const history = useBrowserHistory()
  const sp = createUrlSearchParamsMemo(history)
  const dir = createMemo(() => {
    const p = sp()
    return p.get('dir') ?? ''
  })
  return dir
}

function useDirToFetch(viewingPath: () => string, dirFromUrl: () => string) {
  const dirToFetchMemo = createMemo(() => {
    let dir = dirFromUrl()
    if (!dir && viewingPath()) {
      const pathParts = viewingPath().split(/[/\\]/)
      pathParts.pop()
      dir = pathParts.join('/')
    }
    return dir
  })
  return dirToFetchMemo
}

function Inner(props: {
  viewingPath: string
  shareContext: ShareCtx | null
  allFiles: () => FileItem[]
}): JSX.Element {
  const fileInfo = createMemo(() => {
    const vp = props.viewingPath
    const f = props.allFiles().find((x) => x.path === vp)
    if (f && f.type === MediaType.OTHER) return f
    return null
  })

  const mediaHref = createMemo(() => {
    const f = fileInfo()
    if (!f) return ''
    const ctx = props.shareContext
    return ctx ? buildShareMediaUrl(ctx.token, ctx.sharePath, f.path) : buildAdminMediaUrl(f.path)
  })

  return (
    <Show when={fileInfo()} keyed>
      {(f) => (
        <div
          role='dialog'
          aria-modal='true'
          aria-labelledby='unsupported-file-title'
          class='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
          onClick={(e) => {
            if (e.target === e.currentTarget) closeViewer()
          }}
        >
          <div
            class='bg-card text-card-foreground max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-border shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <div class='flex items-start justify-between gap-2 border-b border-border p-4'>
              <div class='flex min-w-0 flex-1 items-start gap-3'>
                <FileQuestion class='h-8 w-8 shrink-0 text-yellow-500' stroke-width={2} />
                <div class='min-w-0'>
                  <h2 id='unsupported-file-title' class='truncate text-lg font-semibold'>
                    {f.name}
                  </h2>
                  <p class='text-muted-foreground text-xs'>
                    {f.extension ? `.${f.extension.toUpperCase()}` : 'Unknown'} file •{' '}
                    {formatFileSize(f.size)}
                  </p>
                </div>
              </div>
              <button
                type='button'
                title='Close'
                class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
                onClick={() => closeViewer()}
              >
                <X class='h-4 w-4' stroke-width={2} />
              </button>
            </div>
            <div class='bg-muted/50 flex flex-col items-center space-y-4 rounded-b-xl p-8 text-center'>
              <FileText class='text-muted-foreground h-16 w-16 opacity-50' stroke-width={1.5} />
              <div>
                <h3 class='mb-2 text-lg font-medium'>Unsupported File Type</h3>
                <p class='text-muted-foreground text-sm'>
                  This file type is not supported for preview. The media server currently supports
                  video, audio, and image files.
                </p>
              </div>
              <div class='pt-2'>
                <a
                  href={mediaHref()}
                  download={f.name}
                  class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                >
                  Download File
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  )
}

function BodyAdmin(props: { viewingPath: string }): JSX.Element {
  const dirFromUrl = useDirFromUrl()
  const dirToFetch = useDirToFetch(() => props.viewingPath, dirFromUrl)
  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.files(dirToFetch()),
    queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(dirToFetch())}`),
  }))
  const allFiles = () => filesQuery.data?.files ?? []
  return <Inner viewingPath={props.viewingPath} shareContext={null} allFiles={allFiles} />
}

function BodyShare(props: { viewingPath: string; shareContext: ShareCtx }): JSX.Element {
  const dirFromUrl = useDirFromUrl()
  const dirToFetch = useDirToFetch(() => props.viewingPath, dirFromUrl)
  const filesQuery = useQuery(() => {
    const qDir = stripSharePrefix(dirToFetch(), props.shareContext.sharePath)
    return {
      queryKey: queryKeys.shareFiles(props.shareContext.token, qDir),
      queryFn: () =>
        api<{ files: FileItem[] }>(
          `/api/share/${props.shareContext.token}/files?dir=${encodeURIComponent(qDir)}`,
        ),
    }
  })
  const allFiles = () => filesQuery.data?.files ?? []
  return (
    <Inner viewingPath={props.viewingPath} shareContext={props.shareContext} allFiles={allFiles} />
  )
}

export function UnsupportedFileViewerDialog(props: Props): JSX.Element {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const viewingPath = createMemo(() => urlSearchParams().get('viewing'))

  return (
    <Show when={viewingPath()}>
      {(vp) => (
        <Show when={props.shareContext} fallback={<BodyAdmin viewingPath={vp()} />}>
          {(ctx) => <BodyShare viewingPath={vp()} shareContext={ctx()!} />}
        </Show>
      )}
    </Show>
  )
}
