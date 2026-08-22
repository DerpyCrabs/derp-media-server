import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as pdfjs from 'pdfjs-dist'
import type { ReaderPage } from '../../reader-position'
import type { ReaderSelection } from '../../ReaderSelectionMenu'
import type { ReaderSelectionMode } from '../../reader-position'
import { Show, createEffect, createSignal, onSettled } from 'solid-js'
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs'
import { RegionLayer } from '../../RegionLayer'
import 'pdfjs-dist/web/pdf_viewer.css'

export type PdfDocument = pdfjs.PDFDocumentProxy
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export function PdfContent(props: {
  document: PdfDocument
  page: ReaderPage
  pageIndex: number
  zoom: number
  selectionMode: ReaderSelectionMode
  onRegion: (selection: Omit<ReaderSelection, 'id'>) => void
}) {
  let host!: HTMLDivElement
  let canvas!: HTMLCanvasElement
  const [near, setNear] = createSignal(false)

  onSettled(() => {
    if (!host) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => setNear(Boolean(entry?.isIntersecting)),
      {
        rootMargin: '3600px 0px',
      },
    )
    observer.observe(host)
    return () => observer.disconnect()
  })

  createEffect(
    () => ({
      document: props.document,
      pageNumber: props.pageIndex + 1,
      scale: props.zoom,
      renderText: props.selectionMode === 'text',
      near: near(),
    }),
    ({ document, pageNumber, scale, renderText, near: isNear }) => {
      if (!isNear || !host || !canvas) return undefined
      let cancelled = false
      let renderTask: pdfjs.RenderTask | undefined
      let textLayer: InstanceType<typeof TextLayerBuilder> | undefined
      host.querySelectorAll(':scope > .textLayer').forEach((node) => node.remove())
      void document.getPage(pageNumber).then(async (page) => {
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const ratio = window.devicePixelRatio || 1
        const context = canvas.getContext('2d')
        if (!context) return
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        renderTask = page.render({ canvas, canvasContext: context, viewport })
        try {
          await renderTask.promise
        } catch (error) {
          if (cancelled || (error as { name?: string }).name === 'RenderingCancelledException')
            return
          throw error
        }
        if (cancelled || !renderText) return
        textLayer = new TextLayerBuilder({
          pdfPage: page,
          onAppend: (layer: HTMLDivElement) => {
            if (cancelled) return
            layer.dataset.testid = 'pdf-text-layer'
            host.append(layer)
          },
        })
        await textLayer.render({ viewport, images: null! })
      })
      // eslint-disable-next-line solid/reactivity
      return () => {
        cancelled = true
        renderTask?.cancel()
        textLayer?.cancel()
        host?.querySelectorAll(':scope > .textLayer').forEach((node) => node.remove())
      }
    },
  )

  return (
    <div
      ref={(element) => {
        host = element
      }}
      class='relative box-content touch-none overflow-hidden rounded-lg border border-[#c6d0ca] bg-white shadow-[0_7px_20px_rgb(0_0_0/28%)]'
      style={{
        width: `${props.page.width * props.zoom}px`,
        height: `${props.page.height * props.zoom}px`,
        '--scale-factor': String(props.zoom),
        '--user-unit': '1',
        '--total-scale-factor': String(props.zoom),
      }}
    >
      <canvas
        ref={(element) => {
          canvas = element
        }}
        data-testid='pdf-canvas'
        class='block'
        style={{
          width: `${props.page.width * props.zoom}px`,
          height: `${props.page.height * props.zoom}px`,
        }}
      />
      <Show when={props.selectionMode === 'image'}>
        <RegionLayer host={() => host} source={() => canvas} onRegion={props.onRegion} />
      </Show>
    </div>
  )
}
