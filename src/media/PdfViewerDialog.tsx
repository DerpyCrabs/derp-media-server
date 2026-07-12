import { getMediaType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { stripSharePrefix } from '@/lib/source-context'
import * as pdfjs from 'pdfjs-dist'
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw'
import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import Download from 'lucide-solid/icons/download'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { buildAdminMediaUrl, buildShareMediaUrl } from '../lib/build-media-url'
import { closeViewer } from '../lib/url-state-actions'

const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Props = { shareContext?: { token: string; sharePath: string } | null }

export function PdfViewerDialog(props: Props) {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const viewingPath = createMemo(() => params().get('viewing'))
  const isPdf = createMemo(() => getMediaType((viewingPath() ?? '').split('.').pop()?.toLowerCase() ?? '') === MediaType.PDF)
  const mediaUrl = createMemo(() => {
    const path = viewingPath()
    if (!path) return ''
    const ctx = props.shareContext
    return ctx ? buildShareMediaUrl(ctx.token, ctx.sharePath, path) : buildAdminMediaUrl(path)
  })
  const fileName = createMemo(() => (viewingPath() ?? '').split(/[/\\]/).pop() ?? '')
  const downloadHref = createMemo(() => {
    const path = viewingPath()
    if (!path) return ''
    const ctx = props.shareContext
    if (!ctx) return `/api/files/download?path=${encodeURIComponent(path)}`
    return `/api/share/${ctx.token}/download?path=${encodeURIComponent(stripSharePrefix(path, ctx.sharePath) || '.')}`
  })
  const [document, setDocument] = createSignal<pdfjs.PDFDocumentProxy>()
  const [page, setPage] = createSignal(1)
  const [scale, setScale] = createSignal(1)
  const [error, setError] = createSignal('')
  let canvas: HTMLCanvasElement | undefined

  createEffect(() => {
    const url = mediaUrl()
    if (!url || !isPdf()) return
    setDocument(undefined)
    setPage(1)
    setScale(1)
    setError('')
    const task = pdfjs.getDocument({ url, withCredentials: true })
    void task.promise.then(setDocument).catch(() => setError('This PDF could not be opened.'))
    onCleanup(() => void task.destroy())
  })

  createEffect(() => {
    const doc = document()
    const target = canvas
    if (!doc || !target) return
    let cancelled = false
    let renderTask: pdfjs.RenderTask | undefined
    void doc.getPage(page()).then((pdfPage) => {
      if (cancelled) return
      const viewport = pdfPage.getViewport({ scale: scale() })
      const ratio = window.devicePixelRatio || 1
      target.width = Math.floor(viewport.width * ratio)
      target.height = Math.floor(viewport.height * ratio)
      target.style.width = `${viewport.width}px`
      target.style.height = `${viewport.height}px`
      const context = target.getContext('2d')!
      renderTask = pdfPage.render({ canvas: target, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      return renderTask.promise
    }).catch((reason: unknown) => {
      if (!cancelled && (reason as { name?: string }).name !== 'RenderingCancelledException') setError('This PDF page could not be rendered.')
    })
    onCleanup(() => {
      cancelled = true
      renderTask?.cancel()
    })
  })

  return (
    <Show when={viewingPath() && isPdf()}>
      <div role='dialog' aria-modal='true' aria-label={`PDF viewer: ${fileName()}`} class='fixed inset-0 z-50 flex flex-col bg-neutral-900'>
        <div class='flex min-h-14 flex-wrap items-center gap-1 bg-black/70 px-2 py-1 text-white'>
          <h2 class='min-w-24 flex-1 truncate text-sm font-medium sm:text-lg'>{fileName()}</h2>
          <button title='Previous page' aria-label='Previous page' class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10' disabled={page() <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft /></button>
          <span class='min-w-16 text-center text-sm'>{page()} / {document()?.numPages ?? '–'}</span>
          <button title='Next page' aria-label='Next page' class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10' disabled={page() >= (document()?.numPages ?? 1)} onClick={() => setPage((value) => value + 1)}><ChevronRight /></button>
          <button title='Zoom out' aria-label='Zoom out' class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10' onClick={() => setScale((value) => Math.max(.5, value - .25))}><ZoomOut /></button>
          <span class='hidden min-w-12 text-center text-sm min-[420px]:inline'>{Math.round(scale() * 100)}%</span>
          <button title='Zoom in' aria-label='Zoom in' class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10' onClick={() => setScale((value) => Math.min(4, value + .25))}><ZoomIn /></button>
          <a title='Download' aria-label='Download' class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10' href={downloadHref()} download={fileName()}><Download /></a>
          <button title='Close' aria-label='Close' class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-white/10' onClick={closeViewer}><X /></button>
        </div>
        <div class='flex flex-1 items-start justify-center overflow-auto p-3'>
          <Show when={!error()} fallback={<p role='alert' class='m-auto text-white'>{error()}</p>}>
            <canvas ref={canvas} data-testid='pdf-canvas' class='bg-white shadow-xl' />
          </Show>
        </div>
      </div>
    </Show>
  )
}
