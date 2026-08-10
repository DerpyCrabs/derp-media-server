import { useBrowserHistory } from '../browser-history'
import {
  type ReaderDefaultAction,
  type ReaderFitMode,
  type ReaderPosition,
  type ReaderSelectionMode,
  type ReaderViewMode,
  loadReaderPosition,
  saveReaderPosition,
} from '@/lib/reader-position'
import { MediaType, type FileItem } from '@/lib/types'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import Settings from 'lucide-solid/icons/settings'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { ReaderSelectionMenu, type ReaderSelection } from './ReaderSelectionMenu'
import { menuPositionForRect, visibleRectForRange } from './reader-geometry'
import { closeReader } from './reader-url'
import { buildAdminMediaUrl } from '../lib/build-media-url'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

let activeReaderRoot: HTMLElement | null = null

type PdfDocument = pdfjs.PDFDocumentProxy
type ReaderPage = {
  id: string
  name: string
  source: string
  width: number
  height: number
  kind: 'pdf' | 'image'
}

const imageUrl = (path: string) => buildAdminMediaUrl(path.replace(/\\/g, '/'))
const basename = (path: string) => path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
const clampZoom = (value: number) => Math.max(0.35, Math.min(3, Number(value.toFixed(2))))
const naturalCompare = (left: FileItem, right: FileItem) =>
  left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
const estimatedPageBlockHeight = (page: ReaderPage | undefined, zoom: number) =>
  (page?.height ?? 900) * zoom + 44
const estimateOffsetForPage = (pages: ReaderPage[], pageIndex: number, zoom: number) =>
  pages
    .slice(0, Math.min(pageIndex, pages.length))
    .reduce((offset, page) => offset + estimatedPageBlockHeight(page, zoom), 0)
const pageFromScroll = (pages: ReaderPage[], scrollTop: number, zoom: number) => {
  let offset = 0
  for (let index = 0; index < pages.length; index += 1) {
    offset += estimatedPageBlockHeight(pages[index], zoom)
    if (scrollTop < offset) return index
  }
  return Math.max(0, pages.length - 1)
}

const loadImageSize = (source: string) =>
  new Promise<{ width: number; height: number }>((resolve) => {
    const image = new Image()
    image.onload = () =>
      resolve({ width: image.naturalWidth || 900, height: image.naturalHeight || 1200 })
    image.onerror = () => resolve({ width: 900, height: 1200 })
    image.src = source
  })

function PdfPage(props: {
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
  const [size, setSize] = createSignal({ width: props.page.width, height: props.page.height })

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setNear(Boolean(entry?.isIntersecting)),
      {
        rootMargin: '1200px 0px',
      },
    )
    observer.observe(host)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    const document = props.document
    const pageNumber = props.pageIndex + 1
    const scale = props.zoom
    const renderText = props.selectionMode === 'text'
    if (!near()) return
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
      setSize({ width: viewport.width, height: viewport.height })
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      renderTask = page.render({ canvas, canvasContext: context, viewport })
      try {
        await renderTask.promise
      } catch (error) {
        if (cancelled || (error as { name?: string }).name === 'RenderingCancelledException') return
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
    onCleanup(() => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      host?.querySelectorAll(':scope > .textLayer').forEach((node) => node.remove())
    })
  })

  return (
    <div
      ref={host}
      class='relative box-content touch-none overflow-hidden rounded-lg border border-[#c6d0ca] bg-white shadow-[0_7px_20px_rgb(0_0_0/28%)]'
      style={{
        width: `${size().width}px`,
        height: `${size().height}px`,
        '--scale-factor': String(props.zoom),
        '--user-unit': '1',
        '--total-scale-factor': String(props.zoom),
      }}
    >
      <canvas ref={canvas} data-testid='pdf-canvas' class='block h-auto w-full' />
      <RegionLayer
        active={props.selectionMode === 'image'}
        host={() => host}
        source={() => canvas}
        onRegion={props.onRegion}
      />
    </div>
  )
}

function ImagePage(props: {
  page: ReaderPage
  zoom: number
  selectionMode: ReaderSelectionMode
  onRegion: (selection: Omit<ReaderSelection, 'id'>) => void
}) {
  let host!: HTMLDivElement
  let image!: HTMLImageElement
  return (
    <div
      ref={host}
      class='relative touch-none overflow-hidden rounded-lg border border-[#c6d0ca] bg-[#fffdf8] shadow-[0_7px_20px_rgb(0_0_0/28%)]'
      style={{ width: `${Math.min(props.page.width * props.zoom, 1400)}px` }}
    >
      <img
        ref={image}
        src={props.page.source}
        alt={props.page.name}
        class='block h-auto w-full select-none'
        draggable={false}
        data-testid='reader-image-page'
      />
      <RegionLayer
        active={props.selectionMode === 'image'}
        host={() => host}
        source={() => image}
        onRegion={props.onRegion}
      />
    </div>
  )
}

function RegionLayer(props: {
  active: boolean
  host: () => HTMLElement
  source: () => HTMLCanvasElement | HTMLImageElement
  onRegion: (selection: Omit<ReaderSelection, 'id'>) => void
}) {
  const [drag, setDrag] = createSignal<{
    pointerId: number
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)
  const [committedRegion, setCommittedRegion] = createSignal<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [sourceSizeVersion, setSourceSizeVersion] = createSignal(0)
  const rect = createMemo(() => {
    const value = drag()
    if (!value) return null
    return {
      left: Math.min(value.startX, value.x),
      top: Math.min(value.startY, value.y),
      width: Math.abs(value.x - value.startX),
      height: Math.abs(value.y - value.startY),
    }
  })
  const point = (event: PointerEvent) => {
    const bounds = props.host().getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }
  const committedRect = createMemo(() => {
    sourceSizeVersion()
    const region = committedRegion()
    if (!region) return null
    const source = props.source()
    const bounds = props.host().getBoundingClientRect()
    const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width
    const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height
    if (!naturalWidth || !naturalHeight || !bounds.width || !bounds.height) return null
    return {
      left: (region.x / naturalWidth) * bounds.width,
      top: (region.y / naturalHeight) * bounds.height,
      width: (region.width / naturalWidth) * bounds.width,
      height: (region.height / naturalHeight) * bounds.height,
    }
  })

  createEffect(() => {
    if (props.active) return
    setDrag(null)
    setCommittedRegion(null)
  })

  onMount(() => {
    const observer = new ResizeObserver(() => setSourceSizeVersion((version) => version + 1))
    observer.observe(props.host())
    observer.observe(props.source())
    onCleanup(() => observer.disconnect())
  })

  const finish = () => {
    const visible = rect()
    const hostRect = props.host().getBoundingClientRect()
    setDrag(null)
    if (!visible || visible.width < 12 || visible.height < 12) return
    const source = props.source()
    const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width
    const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height
    if (!naturalWidth || !naturalHeight) return
    const sx = (visible.left / hostRect.width) * naturalWidth
    const sy = (visible.top / hostRect.height) * naturalHeight
    const sw = (visible.width / hostRect.width) * naturalWidth
    const sh = (visible.height / hostRect.height) * naturalHeight
    const region = { x: sx, y: sy, width: sw, height: sh }
    setCommittedRegion(region)
    const crop = window.document.createElement('canvas')
    crop.width = Math.max(1, Math.round(sw))
    crop.height = Math.max(1, Math.round(sh))
    const context = crop.getContext('2d')
    if (!context) return
    context.drawImage(source, sx, sy, sw, sh, 0, 0, crop.width, crop.height)
    props.onRegion({
      kind: 'image',
      text: '',
      imageData: crop.toDataURL('image/png'),
      anchor: props.host(),
      region,
      ...menuPositionForRect(
        new DOMRect(
          hostRect.left + visible.left,
          hostRect.top + visible.top,
          visible.width,
          visible.height,
        ),
        props.host().closest<HTMLElement>('[data-testid="reader-viewport"]') ?? undefined,
      ),
    })
  }
  return (
    <div
      data-testid='region-layer'
      class='absolute inset-0'
      classList={{ 'cursor-crosshair': props.active }}
      style={{ 'pointer-events': props.active ? 'auto' : 'none', 'z-index': props.active ? 5 : 2 }}
      onPointerDown={(event) => {
        if (!props.active) return
        const next = point(event)
        event.currentTarget.setPointerCapture(event.pointerId)
        setCommittedRegion(null)
        setDrag({ pointerId: event.pointerId, startX: next.x, startY: next.y, ...next })
      }}
      onPointerMove={(event) => {
        if (!drag()) return
        const next = point(event)
        setDrag((value) => (value ? { ...value, ...next } : null))
      }}
      onPointerUp={(event) => {
        if (drag()?.pointerId !== event.pointerId) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        finish()
      }}
    >
      <Show when={rect() ?? committedRect()}>
        {(box) => (
          <div
            class='reader-region-box absolute border-2 border-[rgb(80_120_255/78%)] bg-[rgb(0_0_255/25%)]'
            style={{
              left: `${box().left}px`,
              top: `${box().top}px`,
              width: `${box().width}px`,
              height: `${box().height}px`,
            }}
          />
        )}
      </Show>
    </div>
  )
}

type ReaderDialogProps = {
  sourcePath?: string
  sourceKind?: 'pdf' | 'folder'
  embedded?: boolean
  showClose?: boolean
  onClose?: () => void
}

export function ReaderDialog(props: ReaderDialogProps = {}) {
  const history = useBrowserHistory()
  let readerRoot!: HTMLDivElement
  let viewport!: HTMLDivElement
  const menuHost = document.createElement('div')
  let saveTimer: number | undefined
  let selectionId = 0
  let pendingScrollTop = 0
  const params = createMemo(() => new URLSearchParams(history().search))
  const path = createMemo(() => props.sourcePath ?? params().get('reader') ?? '')
  const sourceKind = createMemo(
    () => props.sourceKind ?? (params().get('readerKind') === 'folder' ? 'folder' : 'pdf'),
  )
  const [pages, setPages] = createSignal<ReaderPage[]>([])
  const [pdfDocument, setPdfDocument] = createSignal<PdfDocument>()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal('')
  const [currentPage, setCurrentPage] = createSignal(0)
  const [zoom, setZoom] = createSignal(1)
  const [viewMode, setViewMode] = createSignal<ReaderViewMode>('continuous')
  const [fitMode, setFitMode] = createSignal<ReaderFitMode>('manual')
  const [selectionMode, setSelectionMode] = createSignal<ReaderSelectionMode>('text')
  const [defaultAction, setDefaultAction] = createSignal<ReaderDefaultAction>('define')
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [pageJumpOpen, setPageJumpOpen] = createSignal(false)
  const [pageInput, setPageInput] = createSignal('1')
  const [fullscreen, setFullscreen] = createSignal(false)
  const [selection, setSelection] = createSignal<ReaderSelection | null>(null)

  const title = createMemo(() => basename(path()))
  const renderedPages = createMemo(() =>
    viewMode() === 'page' ? pages().slice(currentPage(), currentPage() + 1) : pages(),
  )
  const close = () => {
    persist()
    if (props.onClose) props.onClose()
    else closeReader()
  }
  const toggleFullscreen = async () => {
    if (document.fullscreenElement === readerRoot) {
      await document.exitFullscreen()
      return
    }
    if (document.fullscreenElement) await document.exitFullscreen()
    await readerRoot.requestFullscreen()
  }

  const applyPosition = (position: ReaderPosition) => {
    pendingScrollTop = position.scrollTop
    setCurrentPage(position.pageIndex)
    setZoom(position.zoom)
    setViewMode(position.viewMode)
    setFitMode(position.fitMode)
    setSelectionMode(position.selectionMode)
    setDefaultAction(position.defaultAction)
  }

  const restorePositionAfterLoad = (pageCount: number) => {
    setCurrentPage((value) => Math.max(0, Math.min(pageCount - 1, value)))
    requestAnimationFrame(() =>
      requestAnimationFrame(() => viewport?.scrollTo({ top: pendingScrollTop })),
    )
  }

  createEffect(() => {
    const activePath = path()
    const kind = sourceKind()
    setPages([])
    setPdfDocument(undefined)
    setSelection(null)
    setSettingsOpen(false)
    setError('')
    if (!activePath) return
    applyPosition(loadReaderPosition(activePath))
    setLoading(true)
    let cancelled = false
    if (kind === 'folder') {
      void fetch(`/api/files?dir=${encodeURIComponent(activePath)}`)
        .then(async (response) => {
          const payload = await response.json()
          if (!response.ok) throw new Error(payload?.error ?? 'Could not open image folder')
          const files = ((payload.files ?? []) as FileItem[])
            .filter((file) => !file.isDirectory && file.type === MediaType.IMAGE)
            .sort(naturalCompare)
          if (files.length === 0) throw new Error('Folder contains no supported images')
          const loaded = await Promise.all(
            files.map(async (file) => {
              const source = imageUrl(file.path)
              const size = await loadImageSize(source)
              return {
                id: file.path,
                name: file.name,
                source,
                ...size,
                kind: 'image' as const,
              }
            }),
          )
          if (!cancelled) {
            setPages(loaded)
            restorePositionAfterLoad(loaded.length)
          }
        })
        .catch(
          (reason) =>
            !cancelled && setError(reason instanceof Error ? reason.message : String(reason)),
        )
        .finally(() => !cancelled && setLoading(false))
    } else {
      const task = pdfjs.getDocument({ url: imageUrl(activePath), withCredentials: true })
      void task.promise
        .then(async (document) => {
          const loaded = await Promise.all(
            Array.from({ length: document.numPages }, async (_, index) => {
              const page = await document.getPage(index + 1)
              const viewport = page.getViewport({ scale: 1 })
              return {
                id: `${activePath}#${index + 1}`,
                name: `Page ${index + 1}`,
                source: imageUrl(activePath),
                width: viewport.width,
                height: viewport.height,
                kind: 'pdf' as const,
              }
            }),
          )
          if (!cancelled) {
            setPdfDocument(document)
            setPages(loaded)
            restorePositionAfterLoad(loaded.length)
          }
        })
        .catch(
          (reason) =>
            !cancelled && setError(reason instanceof Error ? reason.message : 'Could not open PDF'),
        )
        .finally(() => !cancelled && setLoading(false))
      onCleanup(() => void task.destroy())
    }
    onCleanup(() => {
      cancelled = true
    })
  })

  const persist = () => {
    const activePath = path()
    if (!activePath) return
    saveReaderPosition(activePath, {
      pageIndex: currentPage(),
      scrollTop: viewport?.scrollTop ?? 0,
      zoom: zoom(),
      viewMode: viewMode(),
      fitMode: fitMode(),
      selectionMode: selectionMode(),
      defaultAction: defaultAction(),
    })
  }

  createEffect(() => {
    path()
    currentPage()
    zoom()
    viewMode()
    fitMode()
    selectionMode()
    defaultAction()
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(persist, 250)
    onCleanup(() => window.clearTimeout(saveTimer))
  })

  const fit = () => {
    if (!viewport || fitMode() === 'manual') return
    const page = pages()[currentPage()] ?? pages()[0]
    if (!page) return
    const widthScale = Math.max(320, viewport.clientWidth - 24) / page.width
    const heightScale = Math.max(320, viewport.clientHeight - 28) / page.height
    setZoom(clampZoom(fitMode() === 'width' ? widthScale : heightScale))
  }

  createEffect(() => {
    pages().length
    currentPage()
    viewMode()
    fitMode()
    if (fitMode() !== 'manual') requestAnimationFrame(fit)
  })

  const goToPage = (index: number) => {
    const next = Math.max(0, Math.min(pages().length - 1, index))
    setCurrentPage(next)
    setSelection(null)
    if (viewMode() === 'continuous') {
      requestAnimationFrame(() => {
        viewport?.scrollTo({
          top: estimateOffsetForPage(pages(), next, zoom()),
          behavior: 'smooth',
        })
      })
    } else viewport?.scrollTo({ top: 0 })
  }

  const commitPageJump = () => {
    const pageNumber = Number.parseInt(pageInput(), 10)
    setPageJumpOpen(false)
    if (Number.isFinite(pageNumber)) goToPage(pageNumber - 1)
  }

  const captureTextSelection = (pointer: { x: number; y: number }) => {
    if (selectionMode() !== 'text') return
    const nativeSelection = window.getSelection()
    if (!nativeSelection || nativeSelection.isCollapsed || nativeSelection.rangeCount === 0) return
    const range = nativeSelection.getRangeAt(0)
    const node = range.commonAncestorContainer
    const element = node instanceof Element ? node : node.parentElement
    if (!element || !viewport?.contains(element)) return
    const text = nativeSelection.toString().replace(/\s+/g, ' ').trim()
    if (!text) return
    const menuRect = visibleRectForRange(
      range,
      nativeSelection.focusNode,
      nativeSelection.focusOffset,
      pointer,
      viewport,
    )
    if (!menuRect) return
    setSelection({
      id: ++selectionId,
      kind: 'text',
      text,
      ...menuPositionForRect(menuRect, viewport),
    })
  }

  const syncSelectionMenu = () => {
    const active = selection()
    if (active?.kind === 'image' && active.anchor?.isConnected && active.region) {
      const source = active.anchor.querySelector<HTMLCanvasElement | HTMLImageElement>(
        'canvas, img',
      )
      const bounds = active.anchor.getBoundingClientRect()
      const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source?.width
      const naturalHeight =
        source instanceof HTMLImageElement ? source.naturalHeight : source?.height
      if (naturalWidth && naturalHeight) {
        const rect = new DOMRect(
          bounds.left + (active.region.x / naturalWidth) * bounds.width,
          bounds.top + (active.region.y / naturalHeight) * bounds.height,
          (active.region.width / naturalWidth) * bounds.width,
          (active.region.height / naturalHeight) * bounds.height,
        )
        setSelection({ ...active, ...menuPositionForRect(rect, viewport) })
      }
      return
    }
    const nativeSelection = window.getSelection()
    if (
      active?.kind !== 'text' ||
      !nativeSelection ||
      nativeSelection.rangeCount === 0 ||
      nativeSelection.isCollapsed ||
      !nativeSelection.toString().trim()
    )
      return
    const rect = visibleRectForRange(
      nativeSelection.getRangeAt(0),
      nativeSelection.focusNode,
      nativeSelection.focusOffset,
      null,
      viewport,
    )
    if (rect) setSelection({ ...active, ...menuPositionForRect(rect, viewport) })
  }

  onMount(() => {
    document.body.append(menuHost)
    if (!activeReaderRoot || !props.embedded) activeReaderRoot = readerRoot
    const resize = new ResizeObserver(() => fit())
    if (viewport) resize.observe(viewport)
    const fullscreenChange = () => {
      const active = document.fullscreenElement === readerRoot
      setFullscreen(active)
      if (active) readerRoot.append(menuHost)
      else if (menuHost.isConnected) document.body.append(menuHost)
    }
    let selectionCaptureFrame = 0
    const captureFromRelease = (event: MouseEvent | PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-testid="reader-selection-menu"]'))
        return
      window.cancelAnimationFrame(selectionCaptureFrame)
      selectionCaptureFrame = window.requestAnimationFrame(() => {
        selectionCaptureFrame = 0
        captureTextSelection({ x: event.clientX, y: event.clientY })
      })
    }
    document.addEventListener('fullscreenchange', fullscreenChange)
    document.addEventListener('pointerup', captureFromRelease)
    document.addEventListener('mouseup', captureFromRelease)
    onCleanup(() => {
      resize.disconnect()
      window.cancelAnimationFrame(selectionCaptureFrame)
      document.removeEventListener('fullscreenchange', fullscreenChange)
      document.removeEventListener('pointerup', captureFromRelease)
      document.removeEventListener('mouseup', captureFromRelease)
      menuHost.remove()
      if (activeReaderRoot === readerRoot) activeReaderRoot = null
    })
  })

  createEffect(() => {
    if (!path()) return
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const targetReader = target?.closest<HTMLElement>('[data-testid="reader-dialog"]')
      const ownsEvent = targetReader
        ? targetReader === readerRoot
        : document.fullscreenElement === readerRoot || activeReaderRoot === readerRoot
      if (!ownsEvent) return
      if (event.key === 'Escape') {
        if (settingsOpen() || pageJumpOpen()) {
          setSettingsOpen(false)
          setPageJumpOpen(false)
        } else if (selection()) setSelection(null)
        else if (!props.embedded || props.onClose) close()
        return
      }
      if (target?.closest('input, textarea, button, [contenteditable=true]')) return
      const targets: Record<string, number> = {
        ArrowRight: currentPage() + 1,
        PageDown: currentPage() + 1,
        ArrowLeft: currentPage() - 1,
        PageUp: currentPage() - 1,
        Home: 0,
        End: pages().length - 1,
      }
      if (targets[event.key] === undefined) return
      event.preventDefault()
      goToPage(targets[event.key]!)
    }
    document.addEventListener('keydown', keydown)
    onCleanup(() => document.removeEventListener('keydown', keydown))
  })

  return (
    <Show when={path()}>
      <div
        ref={readerRoot}
        role='dialog'
        aria-modal='true'
        aria-label={`Reader: ${title()}`}
        class='inset-0 flex flex-col bg-neutral-900 text-white'
        classList={{ 'fixed z-[70]': !props.embedded, 'absolute z-20': !!props.embedded }}
        data-testid='reader-dialog'
        onPointerDown={() => (activeReaderRoot = readerRoot)}
        onFocusIn={() => (activeReaderRoot = readerRoot)}
      >
        <header class='relative z-30 grid h-[39px] shrink-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1.5 border-b border-[#303030] bg-[#121212] px-1.5 py-[3px]'>
          <div class='absolute top-[3px] bottom-[3px] left-1/2 -translate-x-1/2'>
            <div class='relative grid h-full place-items-center'>
              <button
                type='button'
                aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                class='absolute top-1/2 right-[calc(100%+8px)] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                onClick={() => void toggleFullscreen()}
              >
                <Show when={fullscreen()} fallback={<Maximize2 size={18} />}>
                  <Minimize2 size={18} />
                </Show>
              </button>
              <div class='relative'>
                <button
                  type='button'
                  data-testid='reader-page-indicator'
                  class='flex h-8 min-w-[104px] items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#181818] px-2 text-sm tabular-nums hover:border-[#777]'
                  title='Go to page'
                  onClick={() => {
                    setSettingsOpen(false)
                    setPageInput(String(currentPage() + 1))
                    setPageJumpOpen(true)
                  }}
                >
                  Page {Math.min(currentPage() + 1, Math.max(1, pages().length))} /{' '}
                  {Math.max(1, pages().length)}
                </button>
                <Show when={pageJumpOpen()}>
                  <div class='absolute top-[38px] left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#3a3a3a] bg-[#181818] p-[5px] shadow-[0_14px_34px_rgb(0_0_0/42%)]'>
                    <input
                      data-testid='reader-page-input'
                      class='h-8 w-20 rounded-md border border-[#3a3a3a] bg-[#202020] px-2 text-center text-sm outline-none focus:border-[#777]'
                      value={pageInput()}
                      inputMode='numeric'
                      autofocus
                      onInput={(event) => setPageInput(event.currentTarget.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={commitPageJump}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                        if (event.key === 'Escape') setPageJumpOpen(false)
                      }}
                    />
                  </div>
                </Show>
              </div>
            </div>
          </div>
          <div class='absolute top-1/2 left-[calc(50%+64px)] -translate-y-1/2'>
            <div class='relative'>
              <button
                type='button'
                aria-label='Reader settings'
                data-testid='reader-settings-button'
                class='flex h-8 w-8 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                onClick={() => {
                  setPageJumpOpen(false)
                  setSettingsOpen((value) => !value)
                }}
              >
                <Settings size={18} />
              </button>
              <Show when={settingsOpen()}>
                <div
                  class='absolute top-[38px] right-0 grid min-w-[216px] gap-2 rounded-lg border border-[#3a3a3a] bg-[#181818] p-[5px] shadow-[0_14px_34px_rgb(0_0_0/42%)]'
                  data-testid='reader-settings'
                >
                  <ReaderSetting label='View'>
                    <Segmented
                      values={['continuous', 'page']}
                      value={viewMode()}
                      onChange={(value) => {
                        setViewMode(value as ReaderViewMode)
                        setSettingsOpen(false)
                      }}
                    />
                  </ReaderSetting>
                  <ReaderSetting label='Fit'>
                    <Segmented
                      values={['width', 'height']}
                      value={fitMode()}
                      onChange={(value) => {
                        setFitMode(value as ReaderFitMode)
                        setSettingsOpen(false)
                      }}
                    />
                  </ReaderSetting>
                  <ReaderSetting label='Zoom'>
                    <div class='grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center'>
                      <button
                        type='button'
                        aria-label='Reader zoom out'
                        class='flex h-8 w-full items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                        onClick={() => {
                          setFitMode('manual')
                          setZoom((value) => clampZoom(value - 0.1))
                        }}
                      >
                        <ZoomOut size={17} />
                      </button>
                      <span class='text-center text-sm text-[#b8b8b8] tabular-nums'>
                        {Math.round(zoom() * 100)}%
                      </span>
                      <button
                        type='button'
                        aria-label='Reader zoom in'
                        class='flex h-8 w-full items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                        onClick={() => {
                          setFitMode('manual')
                          setZoom((value) => clampZoom(value + 0.1))
                        }}
                      >
                        <ZoomIn size={17} />
                      </button>
                    </div>
                  </ReaderSetting>
                  <ReaderSetting label='Select'>
                    <Segmented
                      values={['text', 'image']}
                      value={selectionMode()}
                      onChange={(value) => {
                        setSelectionMode(value as ReaderSelectionMode)
                        setSelection(null)
                        window.getSelection()?.removeAllRanges()
                        setSettingsOpen(false)
                      }}
                    />
                  </ReaderSetting>
                  <ReaderSetting label='Default action'>
                    <Segmented
                      values={['define', 'translate', 'none']}
                      value={defaultAction()}
                      onChange={(value) => {
                        setDefaultAction(value as ReaderDefaultAction)
                        setSettingsOpen(false)
                      }}
                    />
                  </ReaderSetting>
                </div>
              </Show>
            </div>
          </div>
          <Show when={props.showClose !== false}>
            <button
              type='button'
              title='Close'
              aria-label='Close reader'
              class='col-start-3 flex h-8 w-8 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
              onClick={close}
            >
              <X size={20} />
            </button>
          </Show>
        </header>

        <div
          ref={viewport}
          data-testid='reader-viewport'
          class='reader-viewport min-h-0 flex-1 overflow-auto bg-[#191919] px-2 pt-1 pb-2 [scrollbar-color:#555_#181818]'
          classList={{ 'cursor-text': selectionMode() === 'text' }}
          onPointerDown={(event) => {
            setSettingsOpen(false)
            setPageJumpOpen(false)
            if (!(event.target as Element).closest('[data-testid="reader-selection-menu"]'))
              setSelection(null)
          }}
          onScroll={(event) => {
            syncSelectionMenu()
            if (viewMode() === 'continuous') {
              setCurrentPage(pageFromScroll(pages(), event.currentTarget.scrollTop, zoom()))
            }
            window.clearTimeout(saveTimer)
            saveTimer = window.setTimeout(persist, 250)
          }}
        >
          <Show when={loading()}>
            <div class='flex h-full items-center justify-center text-sm text-white/60'>
              Opening...
            </div>
          </Show>
          <Show when={error()}>
            <div
              role='alert'
              class='flex h-full items-center justify-center p-8 text-center text-red-300'
            >
              {error()}
            </div>
          </Show>
          <Show when={!loading() && !error()}>
            <For each={renderedPages()}>
              {(page) => {
                const pageIndex = () => pages().indexOf(page)
                return (
                  <article
                    data-page-id={page.id}
                    data-page-index={pageIndex()}
                    data-reader-page-index={pageIndex()}
                    class='mx-auto mb-2 w-fit scroll-mt-1'
                    classList={{
                      'max-w-none': page.kind === 'pdf',
                      'max-w-full': page.kind !== 'pdf',
                    }}
                    aria-label={`Page ${pageIndex() + 1}`}
                  >
                    <Show
                      when={page.kind === 'pdf' && pdfDocument()}
                      fallback={
                        <ImagePage
                          page={page}
                          zoom={zoom()}
                          selectionMode={selectionMode()}
                          onRegion={(next) => setSelection({ ...next, id: ++selectionId })}
                        />
                      }
                    >
                      {(document) => (
                        <PdfPage
                          document={document()}
                          page={page}
                          pageIndex={pageIndex()}
                          zoom={zoom()}
                          selectionMode={selectionMode()}
                          onRegion={(next) => setSelection({ ...next, id: ++selectionId })}
                        />
                      )}
                    </Show>
                  </article>
                )
              }}
            </For>
          </Show>
        </div>
        <Portal mount={menuHost}>
          <Show when={selection()}>
            {(active) => (
              <ReaderSelectionMenu
                selection={active()}
                defaultAction={defaultAction()}
                onTextChange={(text) =>
                  setSelection((value) => (value ? { ...value, text } : null))
                }
              />
            )}
          </Show>
        </Portal>
      </div>
    </Show>
  )
}

function ReaderSetting(props: { label: string; children: unknown }) {
  return (
    <section class='grid gap-[5px]'>
      <h2 class='text-xs font-semibold text-white/60'>{props.label}</h2>
      {props.children as any}
    </section>
  )
}

function Segmented(props: { values: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div class='flex min-h-8 gap-[3px] rounded-lg bg-[#2a2a2a] p-0.5'>
      <For each={props.values}>
        {(value) => (
          <button
            type='button'
            class='min-w-0 flex-1 rounded-md border border-transparent px-2 py-1 text-xs capitalize hover:border-[#777]'
            classList={{
              'border-[#7a7a7a] bg-[#303030] text-white': props.value === value,
              'text-white/60': props.value !== value,
            }}
            onClick={() => props.onChange(value)}
          >
            {value}
          </button>
        )}
      </For>
    </div>
  )
}
