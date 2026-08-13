import { useBrowserHistory } from '../browser-history'
import {
  DEFAULT_READER_POSITION,
  type ReaderDefaultAction,
  type ReaderFitMode,
  type ReaderPosition,
  type ReaderSelectionMode,
  type ReaderViewMode,
} from './reader-position'
import { MediaType, type FileItem } from '@/lib/types'
import { ApiError } from '@/lib/api'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import Settings from 'lucide-solid/icons/settings'
import PanelLeft from 'lucide-solid/icons/panel-left'
import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type Setter,
} from 'solid-js'
import { Portal } from 'solid-js/web'
import { ReaderSelectionMenu, type ReaderSelection } from './ReaderSelectionMenu'
import { menuPositionForRect, visibleRectForRange } from './reader-geometry'
import { closeReader } from './reader-url'
import { buildMediaUrl } from '../lib/build-media-url'
import { parseBook } from './book-parser'
import { renderBook, type RenderedBook } from './book-sanitize'
import { BookContent } from './BookContent'
import { ReaderOutline, type ReaderOutlineItem } from './ReaderOutline'
import {
  DEFAULT_BOOK_APPEARANCE,
  DEFAULT_READER_PREFERENCES,
  loadReaderPreferences,
  loadSyncedReaderState,
  mergeReaderPreferenceChanges,
  saveReaderPreferences,
  saveSyncedReaderState,
  type BookAppearance,
  type ReaderAiDetail,
  type ReaderPreferences,
  type ReaderSyncedState,
} from './reader-state-client'

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

const basename = (path: string) => path.split(/[/\\]/).filter(Boolean).at(-1) ?? path
const clampZoom = (value: number) => Math.max(0.35, Math.min(3, Number(value.toFixed(2))))
const naturalCompare = (left: FileItem, right: FileItem) =>
  left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
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
      resolve({
        width: image.naturalWidth || 900,
        height: image.naturalHeight || 1200,
      })
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
  const [size, setSize] = createSignal({
    width: props.page.width,
    height: props.page.height,
  })

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
      style={{
        'pointer-events': props.active ? 'auto' : 'none',
        'z-index': props.active ? 5 : 2,
      }}
      onPointerDown={(event) => {
        if (!props.active) return
        const next = point(event)
        event.currentTarget.setPointerCapture(event.pointerId)
        setCommittedRegion(null)
        setDrag({
          pointerId: event.pointerId,
          startX: next.x,
          startY: next.y,
          ...next,
        })
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
  sourceKind?: 'pdf' | 'folder' | 'book'
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
  let preferenceTimer: number | undefined
  let saveQueue: Promise<void> = Promise.resolve()
  let preferenceQueue: Promise<void> = Promise.resolve()
  let preferenceBase: ReaderPreferences = {
    ...DEFAULT_READER_PREFERENCES,
    bookAppearance: { ...DEFAULT_READER_PREFERENCES.bookAppearance },
  }
  let preferenceGeneration = 0
  let closePersisted = false
  let selectionId = 0
  let pendingScrollTop = 0
  let pendingBookAnchor: string | undefined
  let pendingBookProgress = 0
  let pendingOutlineExpanded: string[] | undefined
  const params = createMemo(() => new URLSearchParams(history().search))
  const path = createMemo(() => props.sourcePath ?? params().get('reader') ?? '')
  const sourceKind = createMemo(
    () =>
      props.sourceKind ??
      (params().get('readerKind') === 'folder'
        ? 'folder'
        : params().get('readerKind') === 'book'
          ? 'book'
          : 'pdf'),
  )
  const [pages, setPages] = createSignal<ReaderPage[]>([])
  const [pdfDocument, setPdfDocument] = createSignal<PdfDocument>()
  const [bookDocument, setBookDocument] = createSignal<RenderedBook>()
  const [outline, setOutline] = createSignal<ReaderOutlineItem[]>([])
  const [outlineOpen, setOutlineOpen] = createSignal(true)
  const [outlineExpanded, setOutlineExpanded] = createSignal<string[]>([])
  const [currentChapterId, setCurrentChapterId] = createSignal('')
  const [currentChapterProgress, setCurrentChapterProgress] = createSignal(0)
  const [bookHistory, setBookHistory] = createSignal<Array<{ chapterId: string; anchor?: string }>>(
    [],
  )
  const [bookHistoryIndex, setBookHistoryIndex] = createSignal(-1)
  const [bookAppearance, setBookAppearance] = createSignal<BookAppearance>({
    ...DEFAULT_BOOK_APPEARANCE,
  })
  const [preferencesReady, setPreferencesReady] = createSignal(false)
  const [preferencesRevision, setPreferencesRevision] = createSignal(0)
  const [stateRevision, setStateRevision] = createSignal(0)
  const [stateFingerprint, setStateFingerprint] = createSignal('')
  const [syncBlocked, setSyncBlocked] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal('')
  const [currentPage, setCurrentPage] = createSignal(0)
  const [zoom, setZoom] = createSignal(1)
  const [viewMode, setViewMode] = createSignal<ReaderViewMode>('continuous')
  const [fitMode, setFitMode] = createSignal<ReaderFitMode>('manual')
  const [selectionMode, setSelectionMode] = createSignal<ReaderSelectionMode>('text')
  const [preferredSelectionMode, setPreferredSelectionMode] =
    createSignal<ReaderSelectionMode>('text')
  const [defaultAction, setDefaultAction] = createSignal<ReaderDefaultAction>('define')
  const [aiDetail, setAiDetail] = createSignal<ReaderAiDetail>('compact')
  const [settingsOpen, setSettingsOpen] = createSignal(false)
  const [pageJumpOpen, setPageJumpOpen] = createSignal(false)
  const [pageInput, setPageInput] = createSignal('1')
  const [fullscreen, setFullscreen] = createSignal(false)
  const [selection, setSelection] = createSignal<ReaderSelection | null>(null)

  const title = createMemo(() => bookDocument()?.metadata.title || basename(path()))
  const bookNavigationChapterIds = createMemo(() => {
    const targets: string[] = []
    const collect = (items: ReaderOutlineItem[]) => {
      for (const item of items) {
        if (typeof item.target === 'string' && !targets.includes(item.target)) {
          targets.push(item.target)
        }
        collect(item.children)
      }
    }
    collect(outline())
    return targets.length ? targets : (bookDocument()?.chapters.map((chapter) => chapter.id) ?? [])
  })
  const bookProgress = createMemo(() => {
    const document = bookDocument()
    if (!document) return 0
    const index = Math.max(
      0,
      document.chapters.findIndex((chapter) => chapter.id === currentChapterId()),
    )
    const total = document.chapters.reduce(
      (sum, chapter) => sum + Math.max(1, chapter.textLength),
      0,
    )
    const before = document.chapters
      .slice(0, index)
      .reduce((sum, chapter) => sum + Math.max(1, chapter.textLength), 0)
    const currentLength = Math.max(1, document.chapters[index]?.textLength ?? 1)
    return total ? (before + currentLength * currentChapterProgress()) / total : 0
  })
  const renderedPages = createMemo(() =>
    viewMode() === 'page' ? pages().slice(currentPage(), currentPage() + 1) : pages(),
  )
  const readPreferences = (): ReaderPreferences => ({
    bookAppearance: { ...bookAppearance() },
    selectionMode: preferredSelectionMode(),
    defaultAction: defaultAction(),
    aiDetail: aiDetail(),
    outlineOpen: outlineOpen(),
  })
  const capturePreferences = () => ({
    desired: readPreferences(),
    generation: ++preferenceGeneration,
  })
  const persistPreferences = (snapshot = capturePreferences()) => {
    const { desired, generation } = snapshot
    const save = async () => {
      if (generation !== preferenceGeneration) return
      if (JSON.stringify(desired) === JSON.stringify(preferenceBase)) return
      const base = preferenceBase
      let preferences = desired
      let baseRevision = preferencesRevision()
      try {
        const revision = await saveReaderPreferences(preferences, baseRevision)
        setPreferencesRevision(revision)
        preferenceBase = preferences
        return
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 409) throw reason
      }

      const latest = await loadReaderPreferences()
      preferences = mergeReaderPreferenceChanges(latest.preferences, base, desired)
      baseRevision = latest.revision
      const revision = await saveReaderPreferences(preferences, baseRevision)
      setPreferencesRevision(revision)
      preferenceBase = preferences
      if (
        generation === preferenceGeneration &&
        JSON.stringify(preferences) !== JSON.stringify(desired)
      ) {
        setBookAppearance(preferences.bookAppearance)
        setPreferredSelectionMode(preferences.selectionMode)
        setDefaultAction(preferences.defaultAction)
        setAiDetail(preferences.aiDetail)
        setOutlineOpen(preferences.outlineOpen)
      }
    }
    const queued = preferenceQueue.then(save, save)
    preferenceQueue = queued.catch(() => {})
    return queued
  }
  const close = async () => {
    window.clearTimeout(saveTimer)
    window.clearTimeout(preferenceTimer)
    await Promise.all([persist(), persistPreferences()])
    closePersisted = true
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

  const mediaUrl = (activePath: string) => buildMediaUrl(activePath.replace(/\\/g, '/'))

  const bookChapterElement = (chapterId: string) =>
    viewport?.querySelector<HTMLElement>(`[data-book-chapter="${CSS.escape(chapterId)}"]`) ?? null

  const scrollBookViewport = (
    chapterId: string,
    anchor?: string,
    behavior: ScrollBehavior = 'auto',
  ) => {
    if (!viewport) return null
    const chapter = bookChapterElement(chapterId)
    const target = anchor ? chapter?.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`) : chapter
    if (!target) return chapter
    const viewportRect = viewport.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    viewport.scrollTo({
      top: viewport.scrollTop + targetRect.top - viewportRect.top,
      behavior,
    })
    return target
  }

  const mapPdfOutline = async (
    document: PdfDocument,
    items: Awaited<ReturnType<PdfDocument['getOutline']>>,
  ): Promise<ReaderOutlineItem[]> =>
    Promise.all(
      (items ?? []).map(async (item, index) => {
        let target = 0
        try {
          const destination =
            typeof item.dest === 'string' ? await document.getDestination(item.dest) : item.dest
          if (destination?.[0])
            target = await document.getPageIndex(
              destination[0] as Parameters<PdfDocument['getPageIndex']>[0],
            )
        } catch {
          target = 0
        }
        return {
          id: `pdf-outline-${index}-${item.title}`,
          label: item.title || `Page ${target + 1}`,
          target,
          children: await mapPdfOutline(document, item.items),
        }
      }),
    )

  createEffect(() => {
    const activePath = path()
    const kind = sourceKind()
    if (untrack(preferencesReady)) {
      window.clearTimeout(preferenceTimer)
      void persistPreferences(untrack(capturePreferences)).catch(() => {})
    }
    setPages([])
    setPdfDocument(undefined)
    setBookDocument((current) => {
      current?.release()
      return undefined
    })
    setOutline([])
    setOutlineExpanded([])
    setCurrentChapterId('')
    setCurrentChapterProgress(0)
    setBookHistory([])
    setBookHistoryIndex(-1)
    setSelection(null)
    setSettingsOpen(false)
    setError('')
    pendingBookAnchor = undefined
    pendingBookProgress = 0
    pendingOutlineExpanded = undefined
    setSyncBlocked(false)
    pendingScrollTop = DEFAULT_READER_POSITION.scrollTop
    applyPosition(DEFAULT_READER_POSITION)
    setPreferencesReady(false)
    setStateRevision(0)
    setStateFingerprint('')
    if (!activePath) return
    setLoading(true)
    let cancelled = false
    let pdfTask: ReturnType<typeof pdfjs.getDocument> | undefined
    void Promise.all([
      loadSyncedReaderState(activePath).catch(() => null),
      preferenceQueue
        .then(() => loadReaderPreferences())
        .catch(() => ({
          preferences: preferenceBase,
          revision: preferencesRevision(),
        })),
    ])
      .then(async ([saved, preferenceEnvelope]) => {
        if (cancelled) return
        const preferences = preferenceEnvelope.preferences
        setPreferencesRevision(preferenceEnvelope.revision)
        preferenceBase = preferences
        if (saved) {
          setStateRevision(saved.revision)
          setStateFingerprint(saved.fingerprint)
          if (saved.state) {
            applyPosition(saved.state)
            setCurrentChapterId(saved.state.chapterId ?? '')
            pendingBookAnchor = saved.state.anchor
            pendingBookProgress = saved.state.chapterProgress ?? 0
            pendingOutlineExpanded = saved.state.outlineExpanded
          }
        }
        setSelectionMode(preferences.selectionMode)
        setPreferredSelectionMode(preferences.selectionMode)
        setDefaultAction(preferences.defaultAction)
        setAiDetail(preferences.aiDetail)
        setOutlineOpen(preferences.outlineOpen)
        setBookAppearance(preferences.bookAppearance)
        setPreferencesReady(true)
        if (kind === 'folder') setSelectionMode('image')
        if (kind === 'book') setSelectionMode('text')

        if (kind === 'folder') {
          const listUrl = `/api/files?dir=${encodeURIComponent(activePath)}`
          const response = await fetch(listUrl)
          const payload = await response.json()
          if (!response.ok) throw new Error(payload?.error ?? 'Could not open image folder')
          const files = ((payload.files ?? []) as FileItem[])
            .filter((file) => !file.isDirectory && file.type === MediaType.IMAGE)
            .sort(naturalCompare)
          if (files.length === 0) throw new Error('Folder contains no supported images')
          const loaded = await Promise.all(
            files.map(async (file) => {
              const source = mediaUrl(file.path)
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
          return
        }

        if (kind === 'book') {
          const response = await fetch(mediaUrl(activePath), {
            credentials: 'include',
          })
          if (!response.ok) throw new Error(`Could not open book (${response.status})`)
          const parsed = await parseBook(await response.arrayBuffer(), basename(activePath))
          if (cancelled) return
          const rendered = renderBook(parsed)
          setBookDocument(rendered)
          const map = (items: typeof rendered.outline): ReaderOutlineItem[] =>
            items.map((item) => ({
              id: item.id,
              label: item.label,
              target: item.chapterId,
              anchor: item.anchor,
              children: map(item.children),
            }))
          const mappedOutline = map(rendered.outline)
          const firstOutlineTarget = (items: ReaderOutlineItem[]): string | undefined => {
            for (const item of items) {
              if (typeof item.target === 'string') return item.target
              const childTarget = firstOutlineTarget(item.children)
              if (childTarget) return childTarget
            }
          }
          const initialChapter =
            currentChapterId() ||
            firstOutlineTarget(mappedOutline) ||
            rendered.chapters[0]?.id ||
            ''
          setCurrentChapterId(initialChapter)
          setOutline(mappedOutline)
          const allIds = (items: ReaderOutlineItem[]): string[] =>
            items.flatMap((item) => [item.id, ...allIds(item.children)])
          setOutlineExpanded(pendingOutlineExpanded ?? allIds(mappedOutline))
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const restoreByProgress = pendingBookProgress > 0
              const target = scrollBookViewport(
                initialChapter,
                restoreByProgress ? undefined : pendingBookAnchor,
              )
              if (restoreByProgress && target && viewport)
                viewport.scrollTop += target.offsetHeight * Math.min(1, pendingBookProgress)
            }),
          )
          return
        }

        pdfTask = pdfjs.getDocument({
          url: mediaUrl(activePath),
          withCredentials: true,
        })
        const loadedPdf = await pdfTask.promise
        const loaded = await Promise.all(
          Array.from({ length: loadedPdf.numPages }, async (_, index) => {
            const page = await loadedPdf.getPage(index + 1)
            const viewport = page.getViewport({ scale: 1 })
            return {
              id: `${activePath}#${index + 1}`,
              name: `Page ${index + 1}`,
              source: mediaUrl(activePath),
              width: viewport.width,
              height: viewport.height,
              kind: 'pdf' as const,
            }
          }),
        )
        if (!cancelled) {
          setPdfDocument(loadedPdf)
          setPages(loaded)
          const mappedOutline = await mapPdfOutline(loadedPdf, await loadedPdf.getOutline())
          setOutline(mappedOutline)
          const allIds = (items: ReaderOutlineItem[]): string[] =>
            items.flatMap((item) => [item.id, ...allIds(item.children)])
          setOutlineExpanded(pendingOutlineExpanded ?? allIds(mappedOutline))
          restorePositionAfterLoad(loaded.length)
        }
      })
      .catch(
        (reason) =>
          !cancelled &&
          setError(reason instanceof Error ? reason.message : 'Could not open document'),
      )
      .finally(() => !cancelled && setLoading(false))
    onCleanup(() => {
      cancelled = true
      void pdfTask?.destroy()
    })
  })

  const capturePersistedState = () => {
    const activePath = path()
    if (!activePath || !stateFingerprint() || syncBlocked()) return null
    const currentBookChapter = viewport?.querySelector<HTMLElement>(
      `[data-book-chapter="${CSS.escape(currentChapterId())}"]`,
    )
    const viewportTop = viewport?.getBoundingClientRect().top ?? 0
    const currentBookChapterRect = currentBookChapter?.getBoundingClientRect()
    const liveChapterProgress = currentBookChapterRect
      ? Math.max(
          0,
          Math.min(
            1,
            (viewportTop - currentBookChapterRect.top) / Math.max(1, currentBookChapterRect.height),
          ),
        )
      : currentChapterProgress()
    const currentAnchor = currentBookChapter
      ? [...currentBookChapter.querySelectorAll<HTMLElement>('[id]')].find((element) => {
          const top = element.getBoundingClientRect().top
          return top >= viewportTop - 4 && top <= viewportTop + 24
        })?.id
      : undefined
    const next: ReaderSyncedState = {
      pageIndex: currentPage(),
      scrollTop: viewport?.scrollTop ?? 0,
      zoom: zoom(),
      viewMode: viewMode(),
      fitMode: fitMode(),
      selectionMode: preferredSelectionMode(),
      defaultAction: defaultAction(),
      chapterId: sourceKind() === 'book' ? currentChapterId() : undefined,
      anchor: sourceKind() === 'book' ? currentAnchor : undefined,
      progress: sourceKind() === 'book' ? bookProgress() : undefined,
      chapterProgress: sourceKind() === 'book' ? liveChapterProgress : undefined,
      outlineExpanded: outlineExpanded(),
    }
    return {
      activePath,
      next,
      revision: stateRevision(),
      fingerprint: stateFingerprint(),
    }
  }

  const persistNow = async (snapshot: NonNullable<ReturnType<typeof capturePersistedState>>) => {
    const { activePath, next, revision, fingerprint } = snapshot
    const saved = await saveSyncedReaderState(
      activePath,
      next,
      stateRevision() === revision ? revision : stateRevision(),
      stateFingerprint() === fingerprint ? fingerprint : stateFingerprint(),
    ).catch(() => null)
    if (!saved) {
      setSyncBlocked(true)
      const latest = await loadSyncedReaderState(activePath).catch(() => null)
      if (latest) {
        setStateRevision(latest.revision)
        setStateFingerprint(latest.fingerprint)
        if (latest.state && readerRoot.isConnected) {
          applyPosition(latest.state)
          setOutlineExpanded(latest.state.outlineExpanded ?? [])
          if (sourceKind() === 'book' && latest.state.chapterId) {
            setCurrentChapterProgress(latest.state.chapterProgress ?? 0)
            const restoreByProgress = (latest.state.chapterProgress ?? 0) > 0
            goToBookChapter(
              latest.state.chapterId,
              restoreByProgress ? undefined : latest.state.anchor,
            )
            if (restoreByProgress)
              requestAnimationFrame(() => {
                const target = bookChapterElement(latest.state!.chapterId!)
                if (target && viewport)
                  viewport.scrollTop += target.offsetHeight * (latest.state!.chapterProgress ?? 0)
              })
          } else restorePositionAfterLoad(pages().length)
        }
      }
      window.setTimeout(() => setSyncBlocked(false), 1_500)
      return
    }
    setStateRevision(saved.revision)
    setStateFingerprint(saved.fingerprint)
  }

  const persist = () => {
    const snapshot = capturePersistedState()
    if (!snapshot) return Promise.resolve()
    const queued = saveQueue.then(
      () => persistNow(snapshot),
      () => persistNow(snapshot),
    )
    saveQueue = queued.catch(() => {})
    return queued
  }

  createEffect(() => {
    path()
    currentPage()
    zoom()
    viewMode()
    fitMode()
    selectionMode()
    defaultAction()
    currentChapterId()
    outlineExpanded()
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => void persist(), 1_000)
    onCleanup(() => window.clearTimeout(saveTimer))
  })

  createEffect(() => {
    if (!preferencesReady()) return
    const snapshot = capturePreferences()
    window.clearTimeout(preferenceTimer)
    preferenceTimer = window.setTimeout(() => void persistPreferences(snapshot), 350)
    onCleanup(() => window.clearTimeout(preferenceTimer))
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

  const goToBookChapter = (chapterId: string, anchor?: string, recordHistory = false) => {
    if (!chapterId) return
    if (recordHistory) {
      const next =
        bookHistoryIndex() < 0
          ? [{ chapterId: currentChapterId() }]
          : bookHistory().slice(0, bookHistoryIndex() + 1)
      next.push({ chapterId, anchor })
      setBookHistory(next)
      setBookHistoryIndex(next.length - 1)
    }
    setCurrentChapterId(chapterId)
    setCurrentChapterProgress(0)
    setSelection(null)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        scrollBookViewport(chapterId, anchor, 'smooth')
      }),
    )
  }

  const adjacentBookChapter = (offset: number) => {
    const chapters = bookDocument()?.chapters ?? []
    const navigationIds = bookNavigationChapterIds()
    if (!navigationIds.length) return
    const currentNavigationIndex = navigationIds.indexOf(currentChapterId())
    let targetIndex: number
    if (currentNavigationIndex >= 0) {
      targetIndex = currentNavigationIndex + offset
    } else {
      const currentSpineIndex = chapters.findIndex((chapter) => chapter.id === currentChapterId())
      const navigationSpineIndexes = navigationIds.map((id) =>
        chapters.findIndex((chapter) => chapter.id === id),
      )
      targetIndex =
        offset > 0
          ? navigationSpineIndexes.findIndex((index) => index > currentSpineIndex)
          : navigationSpineIndexes.findLastIndex((index) => index < currentSpineIndex)
      if (targetIndex < 0) targetIndex = offset > 0 ? 0 : navigationIds.length - 1
    }
    const targetId = navigationIds[Math.max(0, Math.min(navigationIds.length - 1, targetIndex))]
    if (targetId) goToBookChapter(targetId, undefined, true)
  }

  const moveBookHistory = (offset: number) => {
    const index = bookHistoryIndex() + offset
    const entry = bookHistory()[index]
    if (!entry) return
    setBookHistoryIndex(index)
    goToBookChapter(entry.chapterId, entry.anchor)
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
      window.clearTimeout(saveTimer)
      window.clearTimeout(preferenceTimer)
      if (!closePersisted) void persist()
      if (!closePersisted && preferencesReady()) void persistPreferences()
      bookDocument()?.release()
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
        else if (!props.embedded || props.onClose) void close()
        return
      }
      if (target?.closest('input, textarea, button, [contenteditable=true]')) return
      if (sourceKind() === 'book') return
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
        classList={{
          'fixed z-[70]': !props.embedded,
          'absolute z-20': !!props.embedded,
        }}
        data-testid='reader-dialog'
        onPointerDown={() => (activeReaderRoot = readerRoot)}
        onFocusIn={() => (activeReaderRoot = readerRoot)}
      >
        <header class='relative z-30 grid h-[39px] shrink-0 grid-cols-[32px_minmax(0,1fr)_32px] items-center gap-1.5 border-b border-[#303030] bg-[#121212] px-1.5 py-[3px]'>
          <Show when={outline().length}>
            <button
              type='button'
              aria-label='Toggle document outline'
              data-testid='reader-outline-button'
              class='col-start-1 flex h-8 w-8 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
              onClick={() => setOutlineOpen((value) => !value)}
            >
              <PanelLeft size={18} />
            </button>
          </Show>
          <Show when={sourceKind() === 'book' && bookDocument()}>
            {(book) => (
              <div
                class='absolute left-11 hidden max-w-[24%] truncate text-xs text-white/65 lg:block'
                title={[book().metadata.title, ...book().metadata.authors]
                  .filter(Boolean)
                  .join(' — ')}
              >
                {book().metadata.title || basename(path())}
                <Show when={book().metadata.authors.length}>
                  <span class='text-white/40'> — {book().metadata.authors.join(', ')}</span>
                </Show>
              </div>
            )}
          </Show>
          <div class='col-start-2 row-start-1 flex min-w-0 items-center justify-center gap-1'>
            <div class='contents'>
              <button
                type='button'
                aria-label={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                title={fullscreen() ? 'Exit fullscreen' : 'Enter fullscreen'}
                class='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                onClick={() => void toggleFullscreen()}
              >
                <Show when={fullscreen()} fallback={<Maximize2 size={18} />}>
                  <Minimize2 size={18} />
                </Show>
              </button>
              <div class='relative'>
                <Show
                  when={sourceKind() === 'book'}
                  fallback={
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
                  }
                >
                  <div class='flex items-center gap-1'>
                    <button
                      type='button'
                      aria-label='Previous chapter'
                      class='grid h-8 w-8 place-items-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                      onClick={() => adjacentBookChapter(-1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <button
                      type='button'
                      data-testid='reader-book-progress'
                      class='flex h-8 w-[clamp(72px,28vw,260px)] min-w-0 items-center justify-center truncate rounded-lg border border-[#3a3a3a] bg-[#181818] px-2 text-sm hover:border-[#777]'
                      onClick={() => setOutlineOpen(true)}
                    >
                      <span class='truncate'>
                        {bookDocument()?.chapters.find(
                          (chapter) => chapter.id === currentChapterId(),
                        )?.title ?? 'Book'}
                      </span>
                    </button>
                    <button
                      type='button'
                      aria-label='Next chapter'
                      class='grid h-8 w-8 place-items-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                      onClick={() => adjacentBookChapter(1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </Show>
                <Show when={pageJumpOpen() && sourceKind() !== 'book'}>
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
            <div class='relative shrink-0'>
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
                    class='absolute top-[38px] right-0 z-50 grid gap-2 rounded-lg border border-[#3a3a3a] bg-[#181818] p-[5px] shadow-[0_14px_34px_rgb(0_0_0/42%)]'
                    classList={{
                      'w-[min(384px,calc(100vw-16px))]': sourceKind() === 'book',
                      'min-w-[216px]': sourceKind() !== 'book',
                    }}
                    data-testid='reader-settings'
                  >
                    <Show when={sourceKind() !== 'book'}>
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
                    </Show>
                    <Show when={sourceKind() === 'book'}>
                      <BookAppearanceSettings
                        value={bookAppearance()}
                        onChange={setBookAppearance}
                      />
                    </Show>
                    <ReaderSetting label='Select'>
                      <Segmented
                        values={sourceKind() === 'book' ? ['text'] : ['text', 'image']}
                        value={selectionMode()}
                        onChange={(value) => {
                          setSelectionMode(value as ReaderSelectionMode)
                          setPreferredSelectionMode(value as ReaderSelectionMode)
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
                    <ReaderSetting label='AI results'>
                      <Segmented
                        values={['compact', 'detailed']}
                        value={aiDetail()}
                        onChange={(value) => {
                          setAiDetail(value as ReaderAiDetail)
                          setSettingsOpen(false)
                        }}
                      />
                    </ReaderSetting>
                  </div>
                </Show>
              </div>
            </div>
          </div>
          <Show when={props.showClose !== false}>
            <button
              type='button'
              title='Close'
              aria-label='Close reader'
              class='col-start-3 flex h-8 w-8 items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
              onClick={() => void close()}
            >
              <X size={20} />
            </button>
          </Show>
        </header>

        <div class='relative flex min-h-0 flex-1'>
          <Show when={outlineOpen() && outline().length}>
            <ReaderOutline
              title='Contents'
              items={outline()}
              active={sourceKind() === 'book' ? currentChapterId() : currentPage()}
              onNavigate={(target, anchor) => {
                if (typeof target === 'number') goToPage(target)
                else goToBookChapter(target, anchor, true)
              }}
              onClose={() => setOutlineOpen(false)}
              expanded={outlineExpanded()}
              onToggle={(id) =>
                setOutlineExpanded((items) =>
                  items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
                )
              }
            />
          </Show>
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
              if (sourceKind() === 'book') {
                const top = event.currentTarget.getBoundingClientRect().top + 8
                const chapters = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>('[data-book-chapter]'),
                ]
                const atEnd =
                  event.currentTarget.scrollHeight -
                    event.currentTarget.clientHeight -
                    event.currentTarget.scrollTop <=
                  2
                const current = atEnd
                  ? chapters.at(-1)
                  : chapters.find((chapter) => chapter.getBoundingClientRect().bottom > top)
                if (current?.dataset.bookChapter) {
                  setCurrentChapterId(current.dataset.bookChapter)
                  const rect = current.getBoundingClientRect()
                  setCurrentChapterProgress(
                    Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height))),
                  )
                }
              } else if (viewMode() === 'continuous') {
                setCurrentPage(pageFromScroll(pages(), event.currentTarget.scrollTop, zoom()))
              }
              window.clearTimeout(saveTimer)
              saveTimer = window.setTimeout(() => void persist(), 1_000)
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
                class='flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-red-300'
              >
                <p>{error()}</p>
                <a
                  class='rounded border border-white/25 px-3 py-1.5 text-sm text-white hover:border-white/60'
                  href={mediaUrl(path())}
                  download={basename(path())}
                >
                  Download original
                </a>
              </div>
            </Show>
            <Show when={!loading() && !error()}>
              <Show
                when={sourceKind() === 'book' && bookDocument()}
                fallback={
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
                }
              >
                {(document) => (
                  <BookContent
                    document={document()}
                    appearance={bookAppearance()}
                    currentChapterId={currentChapterId()}
                    viewport={viewport}
                    onNavigate={goToBookChapter}
                  />
                )}
              </Show>
            </Show>
          </div>
        </div>
        <Portal mount={menuHost}>
          <Show when={selection()}>
            {(active) => (
              <ReaderSelectionMenu
                selection={active()}
                defaultAction={defaultAction()}
                aiDetail={aiDetail()}
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

function BookAppearanceSettings(props: {
  value: BookAppearance
  onChange: Setter<BookAppearance>
}) {
  const update = (next: Partial<BookAppearance>) =>
    props.onChange((current) => ({ ...current, ...next }))
  const adjust = (
    key: 'fontScale' | 'lineHeight' | 'contentWidth',
    amount: number,
    fallback: number,
  ) => {
    const bounds = {
      fontScale: [0.5, 3],
      lineHeight: [0.8, 3],
      contentWidth: [20, 100],
    } as const
    const [minimum, maximum] = bounds[key]
    const value = Math.max(minimum, Math.min(maximum, (props.value[key] ?? fallback) + amount))
    update({ [key]: Number(value.toFixed(2)) })
  }
  return (
    <>
      <ReaderSetting label='Font'>
        <Segmented
          values={['publisher', 'serif', 'sans']}
          value={props.value.fontFamily}
          onChange={(value) => update({ fontFamily: value as BookAppearance['fontFamily'] })}
        />
      </ReaderSetting>
      <ReaderSetting label='Theme'>
        <Segmented
          values={['publisher', 'light', 'dark', 'sepia']}
          value={props.value.theme}
          onChange={(value) => update({ theme: value as BookAppearance['theme'] })}
        />
      </ReaderSetting>
      <ReaderSetting label='Font size'>
        <StepSetting
          value={
            props.value.fontScale === null
              ? 'Publisher'
              : `${Math.round(props.value.fontScale * 100)}%`
          }
          onDecrease={() => adjust('fontScale', -0.1, 1)}
          onIncrease={() => adjust('fontScale', 0.1, 1)}
        />
      </ReaderSetting>
      <ReaderSetting label='Line height'>
        <StepSetting
          value={props.value.lineHeight === null ? 'Publisher' : props.value.lineHeight.toFixed(2)}
          onDecrease={() => adjust('lineHeight', -0.1, 1.65)}
          onIncrease={() => adjust('lineHeight', 0.1, 1.65)}
        />
      </ReaderSetting>
      <ReaderSetting label='Content width'>
        <StepSetting
          value={props.value.contentWidth === null ? 'Publisher' : `${props.value.contentWidth}rem`}
          onDecrease={() => adjust('contentWidth', -4, 48)}
          onIncrease={() => adjust('contentWidth', 4, 48)}
        />
      </ReaderSetting>
      <button
        type='button'
        class='h-8 rounded-md border border-[#3a3a3a] bg-[#202020] text-xs hover:border-[#777]'
        onClick={() => props.onChange({ ...DEFAULT_BOOK_APPEARANCE })}
      >
        Reset appearance
      </button>
    </>
  )
}

function StepSetting(props: { value: string; onDecrease: () => void; onIncrease: () => void }) {
  return (
    <div class='grid grid-cols-[32px_minmax(82px,1fr)_32px] items-center'>
      <button
        type='button'
        aria-label='Decrease'
        class='h-8 rounded-md border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
        onClick={props.onDecrease}
      >
        −
      </button>
      <span class='text-center text-xs text-white/70'>{props.value}</span>
      <button
        type='button'
        aria-label='Increase'
        class='h-8 rounded-md border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
        onClick={props.onIncrease}
      >
        +
      </button>
    </div>
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
