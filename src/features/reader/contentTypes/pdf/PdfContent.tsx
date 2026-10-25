import type { PdfForms } from './pdf-forms'
import { resolvePdfDestination } from './pdf-destination'
import { createDocumentSearchHighlights } from '../../document-search-highlights'
import type { DocumentMatch } from '../../document-search'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as pdfjs from 'pdfjs-dist'
import { Effect } from 'effect'
import { domBinding, component, modelOwner, view } from 'effectweb'
import {
  TextLayerBuilder,
  AnnotationLayerBuilder,
  PDFLinkService,
  EventBus,
  LinkTarget,
} from 'pdfjs-dist/web/pdf_viewer.mjs'
import type { ReaderPage, ReaderSelectionMode } from '../../reader-position'
import type { ReaderSelection } from '../../ReaderSelectionMenu'
import { RegionLayer } from '../../RegionLayer'
import 'pdfjs-dist/web/pdf_viewer.css'
export type PdfDocument = pdfjs.PDFDocumentProxy
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
interface Props {
  forms?: PdfForms
  formRevision?: number
  formPending?: boolean
  document: PdfDocument
  page: ReaderPage
  pageIndex: number
  searchQuery?: string
  activeMatch?: DocumentMatch
  zoom: number
  selectionMode: ReaderSelectionMode
  onNavigatePage: (index: number) => void
  onRegion: (selection: Omit<ReaderSelection, 'id'>) => void
}
const renderSlot = 'pdf-page-render'
const renderPage = (
  host: HTMLDivElement,
  current: () => Props & { onError: (error: string) => void },
) => {
  const owner = modelOwner({})
  const highlights = createDocumentSearchHighlights(host, current)
  let near = false
  let signature = ''
  const draw = () => {
    const props = current()
    host.querySelectorAll<HTMLElement>(':scope > .annotationLayer').forEach((layer) => {
      layer.inert = Boolean(props.formPending)
    })
    const key = `${props.formRevision}:${props.page.id}:${props.zoom}:${props.selectionMode}:${Boolean(props.searchQuery)}:${near}`
    if (signature === key) {
      highlights.update()
      return
    }
    signature = key
    owner.run(
      renderSlot,
      Effect.gen(function* () {
        if (!near) return undefined
        props.onError('')
        const canvas = host.querySelector('canvas')!
        const page = yield* Effect.tryPromise({
          try: () => props.document.getPage(props.pageIndex + 1),
          catch: (error) => error,
        })
        const viewport = page.getViewport({ scale: props.zoom })
        const ratio = window.devicePixelRatio || 1
        const context = canvas.getContext('2d')
        if (!context) return undefined
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        const annotationCanvasMap = new Map<string, HTMLCanvasElement>()
        const task = page.render({
          annotationCanvasMap,
          canvas,
          canvasContext: context,
          viewport,
          annotationMode:
            props.forms && props.selectionMode === 'text'
              ? pdfjs.AnnotationMode.ENABLE_FORMS
              : pdfjs.AnnotationMode.ENABLE_STORAGE,
        })
        let textLayer: InstanceType<typeof TextLayerBuilder> | undefined
        let annotations: InstanceType<typeof AnnotationLayerBuilder> | undefined
        let cancelled = false
        const links = new PDFLinkService({
          eventBus: new EventBus(),
          externalLinkTarget: LinkTarget.BLANK,
          externalLinkRel: 'noopener noreferrer',
        })
        links.setDocument(props.document)
        links.setViewer({
          get currentPageNumber() {
            return current().pageIndex + 1
          },
          set currentPageNumber(page: number) {
            if (!cancelled) current().onNavigatePage(page - 1)
          },
          isInPresentationMode: false,
          scrollPageIntoView: ({ pageNumber }: { pageNumber: number }) => {
            if (!cancelled) current().onNavigatePage(pageNumber - 1)
          },
          nextPage: () => {
            if (!cancelled) current().onNavigatePage(current().pageIndex + 1)
          },
          previousPage: () => {
            if (!cancelled) current().onNavigatePage(current().pageIndex - 1)
          },
          pageLabelToPageNumber: (label: string) => Number(label),
        })
        links.goToDestination = async (destination: unknown) => {
          try {
            const index = await resolvePdfDestination(props.document, destination)
            if (!cancelled && index !== null) current().onNavigatePage(index)
          } catch {
            /* Broken destinations must not replace the document with an error. */
          }
        }
        links.executeSetOCGState = async () => {}

        return yield* Effect.gen(function* () {
          yield* Effect.tryPromise({ try: () => task.promise, catch: (error) => error })
          host.querySelectorAll(':scope > .textLayer').forEach((node) => node.remove())
          if (props.selectionMode === 'text' || props.searchQuery) {
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
          if (props.selectionMode === 'text') {
            annotations = new AnnotationLayerBuilder({
              pdfPage: page,
              linkService: links,
              renderForms: Boolean(props.forms),
              annotationStorage: props.document.annotationStorage,
              annotationCanvasMap,
              fieldObjectsPromise: Promise.resolve(
                (props.forms?.fields ?? null) as unknown as Record<string, object[]> | null,
              ),
              enableScripting: false,
              onAppend: (element: HTMLDivElement) => {
                if (!cancelled) {
                  element.dataset.testid = 'pdf-annotations'
                  element.inert = Boolean(current().formPending)
                  host.append(element)
                }
              },
            })
            yield* Effect.tryPromise({
              try: () => annotations!.render({ viewport }),
              catch: (error) => error,
            })
            annotations.div
              ?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
                'input, select, textarea',
              )
              .forEach((field) => {
                if (!field.getAttribute('aria-label'))
                  field.setAttribute(
                    'aria-label',
                    field.closest('[title]')?.getAttribute('title') ||
                      field.name ||
                      'PDF form field',
                  )
              })
            annotations.div
              ?.querySelectorAll<HTMLAnchorElement>('[data-internal-link] a')
              .forEach((link) => link.setAttribute('aria-label', link.title || 'Go to linked page'))
          }
          highlights.update()
          return yield* Effect.never
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              cancelled = true
              task.cancel()
              textLayer?.cancel()
              annotations?.cancel()
              annotations?.div?.remove()
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
  const changed = () => queueMicrotask(() => current().forms?.changed())
  host.addEventListener('input', changed)
  host.addEventListener('change', changed)
  return {
    update: draw,
    dispose: () => {
      host.removeEventListener('input', changed)
      host.removeEventListener('change', changed)
      observer.disconnect()
      owner.dispose()
      highlights.dispose()
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
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
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
