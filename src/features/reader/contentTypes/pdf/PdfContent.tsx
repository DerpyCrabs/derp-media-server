import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as pdfjs from 'pdfjs-dist'
import { Effect } from 'effect'
import { domBinding, component, modelOwner, view, type Snapshot } from 'effectweb'
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { ReaderPage, ReaderSelectionMode } from '../../reader-position'
import type { ReaderSelection } from '../../ReaderSelectionMenu'
import { RegionLayer } from '../../RegionLayer'
import 'pdfjs-dist/web/pdf_viewer.css'
export type PdfDocument = pdfjs.PDFDocumentProxy
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
interface Props {
  document: PdfDocument
  page: ReaderPage
  pageIndex: number
  zoom: number
  selectionMode: ReaderSelectionMode
  onRegion: (selection: Omit<ReaderSelection, 'id'>) => void
}
const renderSlot = 'pdf-page-render'
const renderPage = (
  host: HTMLDivElement,
  current: () => Snapshot<Props> & { onError: (error: string) => void },
) => {
  const owner = modelOwner({})
  let near = false
  let signature = ''
  const draw = () => {
    const props = current()
    const key = `${props.page.id}:${props.zoom}:${props.selectionMode}:${near}`
    if (signature === key) return
    signature = key
    owner.run(
      renderSlot,
      Effect.gen(function* () {
        if (!near) return
        props.onError('')
        const canvas = host.querySelector('canvas')!
        const page = yield* Effect.tryPromise({
          try: () => props.document.getPage(props.pageIndex + 1),
          catch: (error) => error,
        })
        const viewport = page.getViewport({ scale: props.zoom })
        const ratio = window.devicePixelRatio || 1
        const context = canvas.getContext('2d')
        if (!context) return
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        const task = page.render({ canvas, canvasContext: context, viewport })
        let textLayer: InstanceType<typeof TextLayerBuilder> | undefined
        let cancelled = false
        yield* Effect.gen(function* () {
          yield* Effect.tryPromise({ try: () => task.promise, catch: (error) => error })
          host.querySelectorAll(':scope > .textLayer').forEach((node) => node.remove())
          if (props.selectionMode === 'text') {
            const layer = new TextLayerBuilder({
              pdfPage: page,
              onAppend: (element: HTMLDivElement) => {
                if (!cancelled) {
                  element.dataset.testid = 'pdf-text-layer'
                  host.append(element)
                }
              },
            })
            textLayer = layer
            yield* Effect.tryPromise({
              try: () => layer.render({ viewport, images: null! }),
              catch: (error) => error,
            })
          }
          yield* Effect.never
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              cancelled = true
              task.cancel()
              textLayer?.cancel()
              host.querySelectorAll(':scope > .textLayer').forEach((node) => node.remove())
            }),
          ),
        )
      }).pipe(Effect.catch((error) => Effect.sync(() => current().onError(String(error))))),
      'replace',
    )
  }
  const observer = new IntersectionObserver(
    ([entry]) => {
      near = Boolean(entry?.isIntersecting)
      draw()
    },
    { rootMargin: '3600px 0px' },
  )
  observer.observe(host)
  return {
    update: draw,
    dispose: () => {
      observer.disconnect()
      owner.dispose()
      host.querySelectorAll(':scope > .textLayer').forEach((node) => node.remove())
    },
  }
}
export const PdfContent = component<Props, { error: string }>(
  { init: () => ({ error: '' }), identity: (props) => props.page.id },
  view((model, patch) => {
    const props = model.props
    return (
      <div
        use={domBinding({ ...props, onError: (error: string) => patch({ error }) }, renderPage)}
        class='pdf-content relative box-content touch-none overflow-hidden rounded-lg border border-[#c6d0ca] bg-white shadow-[0_7px_20px_rgb(0_0_0/28%)]'
        style={{
          width: `${props.page.width * props.zoom}px`,
          height: `${props.page.height * props.zoom}px`,
          '--scale-factor': String(props.zoom),
          '--user-unit': '1',
          '--total-scale-factor': String(props.zoom),
        }}
      >
        <canvas
          data-testid='pdf-canvas'
          class='block'
          style={{
            width: `${props.page.width * props.zoom}px`,
            height: `${props.page.height * props.zoom}px`,
          }}
        />
        {model.error ? (
          <div
            role='alert'
            class='absolute inset-0 flex items-center justify-center bg-background p-4 text-destructive'
          >
            Could not render this page: {model.error}
          </div>
        ) : null}
        {props.selectionMode === 'image' ? <RegionLayer onRegion={props.onRegion} /> : null}
      </div>
    )
  }),
)
