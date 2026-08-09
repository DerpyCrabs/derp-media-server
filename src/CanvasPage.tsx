import { api } from '@/lib/api'
import {
  CANVAS_COLLECTION_STORAGE_KEY,
  compareCanvasRecords,
  createCanvasRecord,
  loadCanvasCollection,
  mergeCanvasRecords,
  nextCanvasTimestamp,
  parseCanvasRecords,
  serializeCanvasCollection,
  type CanvasCollection,
} from '@/lib/canvas-persistence'
import { getFileDragData, hasFileDragData, isDirectoryFileDragData } from '@/lib/file-drag-data'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/file-search'
import {
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_WINDOW_HEIGHT,
  CANVAS_MIN_WINDOW_WIDTH,
  CANVAS_MIN_ZOOM,
  CANVAS_STORAGE_KEY,
  canvasContentBounds,
  canvasWindowVisualBounds,
  canvasWindowWorldBounds,
  createEmptyCanvasState,
  findNearestFreeCanvasRect,
  frameAtWindowCenter,
  framesOverlap,
  parseInfiniteCanvasState,
  reconcileFrameMembership,
  rectContainsPoint,
  serializeInfiniteCanvasState,
  snapCanvasRect,
  snapCanvasValue,
  withCanvasWindowWorldBounds,
  type CanvasFrame,
  type CanvasRect,
  type CanvasWindow,
  type CanvasWindowType,
  type InfiniteCanvasState,
} from '@/lib/infinite-canvas'
import { getMediaType } from '@/lib/media-utils'
import { queryKeys } from '@/lib/query-keys'
import { MediaType, type FileItem } from '@/lib/types'
import type { GlobalSettings } from '@/lib/use-settings'
import type {
  PersistedWorkspaceState,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import { workspaceBrowserDirTitle } from '@/lib/workspace-browser-dir-title'
import type { VirtualOpenTarget } from '@/lib/virtual-directory'
import { canCloseHermesWindow } from '@/lib/hermes-session-store'
import { HermesChatPane } from '@/src/workspace/HermesChatPane'
import { useQuery } from '@tanstack/solid-query'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import Copy from 'lucide-solid/icons/copy'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Focus from 'lucide-solid/icons/focus'
import FrameIcon from 'lucide-solid/icons/frame'
import Maximize from 'lucide-solid/icons/maximize'
import MoreHorizontal from 'lucide-solid/icons/more-horizontal'
import Move from 'lucide-solid/icons/move'
import Palette from 'lucide-solid/icons/palette'
import Pencil from 'lucide-solid/icons/pencil'
import Plus from 'lucide-solid/icons/plus'
import Redo2 from 'lucide-solid/icons/redo-2'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Search from 'lucide-solid/icons/search'
import Trash2 from 'lucide-solid/icons/trash-2'
import Undo2 from 'lucide-solid/icons/undo-2'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { CanvasSearchPalette } from './canvas/CanvasSearchPalette'
import { createCanvasPanController } from './canvas/create-canvas-pan-controller'
import { useAdminEventsStream } from './lib/use-admin-events-stream'
import { EMPTY_FILE_ICON_CONTEXT, workspaceTabIcon } from './lib/use-file-icon'
import { WorkspaceBrowserPane } from './workspace/WorkspaceBrowserPane'
import { WorkspaceViewerPane } from './workspace/WorkspaceViewerPane'

const LOCAL_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }
const FRAME_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#84cc16',
  '#f59e0b',
  '#f97316',
  '#ec4899',
  '#8b5cf6',
]
const DEFAULT_WINDOW = { width: 640, height: 480 }
const DEFAULT_FRAME = { width: 1024, height: 672 }
const LIVE_ZOOM = 0.62
const FAR_ZOOM = 0.28

type ContextMenuState =
  | { kind: 'canvas'; clientX: number; clientY: number; worldX: number; worldY: number }
  | { kind: 'frame'; clientX: number; clientY: number; frameId: string }
  | { kind: 'window'; clientX: number; clientY: number; windowId: string }

type Selection = { kind: 'window'; id: string } | null
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type CanvasDialogState =
  | { kind: 'new-canvas' }
  | { kind: 'rename-canvas'; canvasId: string }
  | { kind: 'delete-canvas'; canvasId: string; canvasName: string }
  | { kind: 'new-frame'; point: { x: number; y: number } }
  | { kind: 'rename-frame'; frameId: string }
  | { kind: 'delete-frame'; frameId: string; frameName: string }
  | { kind: 'reset-canvas' }
  | { kind: 'message'; message: string }
type FileDropPreview = { bounds: CanvasRect; frameId: string | null }

function cloneState(state: InfiniteCanvasState): InfiniteCanvasState {
  return (
    parseInfiniteCanvasState(JSON.parse(serializeInfiniteCanvasState(state))) ??
    createEmptyCanvasState()
  )
}

function sameState(a: InfiniteCanvasState, b: InfiniteCanvasState): boolean {
  return serializeInfiniteCanvasState(a) === serializeInfiniteCanvasState(b)
}

function parentPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1) || path
}

function fileItemFromDrag(path: string, isDirectory: boolean): FileItem {
  const extension = isDirectory ? '' : (path.split('.').at(-1) ?? '')
  return {
    path,
    name: fileName(path),
    isDirectory,
    extension,
    size: 0,
    type: isDirectory ? MediaType.FOLDER : getMediaType(extension),
  }
}

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return !!target.closest('input, textarea, [contenteditable="true"], .cm-editor')
}

function resizeRect(
  start: CanvasRect,
  dx: number,
  dy: number,
  direction: ResizeDirection,
): CanvasRect {
  let { x, y, width, height } = start
  if (direction.includes('e')) width = Math.max(CANVAS_MIN_WINDOW_WIDTH, start.width + dx)
  if (direction.includes('s')) height = Math.max(CANVAS_MIN_WINDOW_HEIGHT, start.height + dy)
  if (direction.includes('w')) {
    width = Math.max(CANVAS_MIN_WINDOW_WIDTH, start.width - dx)
    x = start.x + start.width - width
  }
  if (direction.includes('n')) {
    height = Math.max(CANVAS_MIN_WINDOW_HEIGHT, start.height - dy)
    y = start.y + start.height - height
  }
  return snapCanvasRect({ x, y, width, height })
}

function ResizeHandles(props: {
  onStart: (direction: ResizeDirection, event: PointerEvent) => void
}) {
  const handles: Array<{ direction: ResizeDirection; class: string }> = [
    { direction: 'n', class: 'top-[-5px] left-2 right-2 h-2 cursor-n-resize' },
    { direction: 's', class: 'bottom-[-5px] left-2 right-2 h-2 cursor-s-resize' },
    { direction: 'e', class: 'right-[-5px] top-2 bottom-2 w-2 cursor-e-resize' },
    { direction: 'w', class: 'left-[-5px] top-2 bottom-2 w-2 cursor-w-resize' },
    { direction: 'ne', class: 'right-[-6px] top-[-6px] size-3 cursor-ne-resize' },
    { direction: 'nw', class: 'left-[-6px] top-[-6px] size-3 cursor-nw-resize' },
    { direction: 'se', class: 'right-[-6px] bottom-[-6px] size-3 cursor-se-resize' },
    { direction: 'sw', class: 'left-[-6px] bottom-[-6px] size-3 cursor-sw-resize' },
  ]
  return (
    <For each={handles}>
      {(handle) => (
        <div
          class={`absolute z-30 ${handle.class}`}
          data-canvas-resize={handle.direction}
          onPointerDown={(event) => props.onStart(handle.direction, event)}
        />
      )}
    </For>
  )
}

function MenuButton(props: {
  children: unknown
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type='button'
      disabled={props.disabled}
      class={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm disabled:opacity-40 ${
        props.danger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted'
      }`}
      onClick={props.onClick}
    >
      {props.children as never}
    </button>
  )
}

export function CanvasPage() {
  useAdminEventsStream()
  const browserStorage =
    typeof localStorage === 'undefined'
      ? ({ getItem: () => null } as Pick<Storage, 'getItem'>)
      : localStorage
  const hadLocalCanvas = Boolean(
    browserStorage.getItem(CANVAS_COLLECTION_STORAGE_KEY) ??
    browserStorage.getItem(CANVAS_STORAGE_KEY),
  )
  const initialCollection = loadCanvasCollection(browserStorage)
  const initialCanvas = initialCollection.canvases.find(
    (item) => item.id === initialCollection.activeId && !item.deleted,
  )!
  const [collection, setCollection] = createSignal<CanvasCollection>(initialCollection)
  const [state, setState] = createSignal<InfiniteCanvasState>(initialCanvas.state!)
  const [undoStack, setUndoStack] = createSignal<InfiniteCanvasState[]>([])
  const [redoStack, setRedoStack] = createSignal<InfiniteCanvasState[]>([])
  const [selection, setSelection] = createSignal<Selection>(null)
  const [breadcrumbFrameId, setBreadcrumbFrameId] = createSignal<string | null>(null)
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null)
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [searchAnchor, setSearchAnchor] = createSignal<{ x: number; y: number } | null>(null)
  const [overflowOpen, setOverflowOpen] = createSignal(false)
  const [canvasMenuOpen, setCanvasMenuOpen] = createSignal(false)
  const [invalidFrameId, setInvalidFrameId] = createSignal<string | null>(null)
  const [geometryActive, setGeometryActive] = createSignal(false)
  const [cameraAnimating, setCameraAnimating] = createSignal(false)
  const [dialog, setDialog] = createSignal<CanvasDialogState | null>(null)
  const [dialogInput, setDialogInput] = createSignal('')
  const [fileDropPreview, setFileDropPreview] = createSignal<FileDropPreview | null>(null)
  let viewportEl: HTMLDivElement | undefined
  let worldEl: HTMLDivElement | undefined
  let animationTimer: number | undefined
  let persistenceTimer: number | undefined
  let syncTimer: number | undefined
  let syncInterval: number | undefined
  let syncRunning = false
  const panController = createCanvasPanController({
    camera: () => state().camera,
    viewport: () => viewportEl,
    world: () => worldEl,
    commit: (camera) => setState((current) => ({ ...current, camera })),
  })

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
  }))
  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<{ enabled: boolean; editableFolders: string[] }>('/api/auth/config'),
    staleTime: Infinity,
  }))
  const editableFolders = createMemo(() => authQuery.data?.editableFolders ?? [])
  const knowledgeBases = createMemo(() => settingsQuery.data?.knowledgeBases ?? [])
  const fileIconContext = createMemo(() => ({
    ...EMPTY_FILE_ICON_CONTEXT,
    customIcons: settingsQuery.data?.customIcons ?? {},
    knowledgeBases: knowledgeBases(),
  }))
  const fileDropVisualBounds = createMemo(() => {
    const preview = fileDropPreview()
    return preview ? canvasWindowVisualBounds(preview.bounds) : null
  })

  const workspace = createMemo<PersistedWorkspaceState>(() => ({
    windows: state().windows.map((window) => ({
      ...window.definition,
      layout: { ...window.definition.layout, bounds: window.bounds, zIndex: window.zIndex },
    })),
    activeWindowId: selection()?.id ?? null,
    activeTabMap: {},
    nextWindowId: state().nextItemId,
    pinnedTaskbarItems: [],
  }))

  const activeCanvas = createMemo(() =>
    collection().canvases.find((item) => item.id === collection().activeId && !item.deleted),
  )
  const availableCanvases = createMemo(() => collection().canvases.filter((item) => !item.deleted))

  function storeCollection(next: CanvasCollection) {
    localStorage.setItem(CANVAS_COLLECTION_STORAGE_KEY, serializeCanvasCollection(next))
    localStorage.setItem(CANVAS_STORAGE_KEY, serializeInfiniteCanvasState(state()))
  }

  function persistActiveState(): CanvasCollection {
    const serialized = serializeInfiniteCanvasState(state())
    let result = collection()
    setCollection((current) => {
      const active = current.canvases.find((item) => item.id === current.activeId && !item.deleted)
      if (!active || (active.state && serializeInfiniteCanvasState(active.state) === serialized)) {
        result = current
        return current
      }
      const updatedAt = nextCanvasTimestamp(current)
      result = {
        ...current,
        lastTimestamp: updatedAt,
        canvases: current.canvases.map((item) =>
          item.id === current.activeId
            ? { ...item, state: cloneState(state()), updatedAt, writerId: current.writerId }
            : item,
        ),
      }
      return result
    })
    storeCollection(result)
    return result
  }

  function scheduleSync(delay = 700) {
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = undefined
      void syncCanvases()
    }, delay)
  }

  async function syncCanvases(pullFirst = false) {
    if (syncRunning || navigator.onLine === false) {
      return
    }
    syncRunning = true
    try {
      let current = persistActiveState()
      if (pullFirst) {
        const pulled = await api<{ canvases: unknown[] }>('/api/canvases')
        const remote = parseCanvasRecords(pulled.canvases)
        const remoteActive = remote
          .filter((item) => !item.deleted)
          .sort((a, b) => compareCanvasRecords(b, a))[0]
        if (!hadLocalCanvas && remoteActive) {
          current = {
            ...current,
            activeId: remoteActive.id,
            lastTimestamp: Math.max(current.lastTimestamp, remoteActive.updatedAt),
            canvases: remote,
          }
          setCollection(current)
          setState(cloneState(remoteActive.state!))
          setUndoStack([])
          setRedoStack([])
        } else {
          current = { ...current, canvases: mergeCanvasRecords(current.canvases, remote) }
          setCollection(current)
        }
      }
      const response = await api<{ canvases: unknown[] }>('/api/canvases/sync', {
        method: 'POST',
        body: JSON.stringify({ canvases: current.canvases }),
      })
      const latest = collection()
      const canvases = mergeCanvasRecords(latest.canvases, parseCanvasRecords(response.canvases))
      const active = canvases.find((item) => item.id === latest.activeId && !item.deleted)
      const fallback = active ?? canvases.find((item) => !item.deleted)
      if (fallback) {
        const next = {
          ...latest,
          activeId: fallback.id,
          lastTimestamp: Math.max(latest.lastTimestamp, ...canvases.map((item) => item.updatedAt)),
          canvases,
        }
        setCollection(next)
        if (
          serializeInfiniteCanvasState(fallback.state!) !== serializeInfiniteCanvasState(state())
        ) {
          setState(cloneState(fallback.state!))
          setUndoStack([])
          setRedoStack([])
        }
        storeCollection(next)
      } else {
        const record = createCanvasRecord(latest, 'Untitled canvas')
        const next = {
          ...latest,
          activeId: record.id,
          lastTimestamp: record.updatedAt,
          canvases: [...canvases, record],
        }
        setCollection(next)
        setState(cloneState(record.state!))
        storeCollection(next)
        scheduleSync(50)
      }
    } catch {
    } finally {
      syncRunning = false
    }
  }

  onMount(() => {
    const oldHtmlOverflow = document.documentElement.style.overflow
    const oldBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const viewport = viewportEl
    viewport?.addEventListener('pointerdown', beginPan, true)
    const dismissContextMenu = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-canvas-context-menu]')) return
      setMenu(null)
      if (!(event.target as HTMLElement | null)?.closest('[data-canvas-picker]')) {
        setCanvasMenuOpen(false)
      }
    }
    const clearFileDropPreview = () => setFileDropPreview(null)
    const clearFileDropPreviewAfterDrop = () => queueMicrotask(clearFileDropPreview)
    const persistBeforePageTeardown = () => persistActiveState()
    const syncWhenOnline = () => void syncCanvases()
    const updateFileDropPreview = (event: DragEvent) => {
      const transfer = event.dataTransfer
      const rect = viewport?.getBoundingClientRect()
      if (!transfer || !hasFileDragData(transfer) || !rect) return
      if ((event.target as Element | null)?.closest('[data-testid="canvas-window"]')) {
        clearFileDropPreview()
        return
      }
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      ) {
        clearFileDropPreview()
        return
      }
      const type = isDirectoryFileDragData(transfer) ? 'browser' : 'viewer'
      setFileDropPreview(
        fileWindowPlacement(screenToWorld(event.clientX, event.clientY), state(), type),
      )
    }
    document.addEventListener('pointerdown', dismissContextMenu, true)
    document.addEventListener('dragover', updateFileDropPreview, true)
    document.addEventListener('dragend', clearFileDropPreview, true)
    document.addEventListener('drop', clearFileDropPreviewAfterDrop, true)
    window.addEventListener('blur', clearFileDropPreview)
    window.addEventListener('pagehide', persistBeforePageTeardown)
    window.addEventListener('online', syncWhenOnline)
    syncInterval = window.setInterval(() => void syncCanvases(), 30_000)
    void syncCanvases(true)
    onCleanup(() => {
      viewport?.removeEventListener('pointerdown', beginPan, true)
      document.removeEventListener('pointerdown', dismissContextMenu, true)
      document.removeEventListener('dragover', updateFileDropPreview, true)
      document.removeEventListener('dragend', clearFileDropPreview, true)
      document.removeEventListener('drop', clearFileDropPreviewAfterDrop, true)
      window.removeEventListener('blur', clearFileDropPreview)
      window.removeEventListener('pagehide', persistBeforePageTeardown)
      window.removeEventListener('online', syncWhenOnline)
      if (syncInterval !== undefined) window.clearInterval(syncInterval)
      document.documentElement.style.overflow = oldHtmlOverflow
      document.body.style.overflow = oldBodyOverflow
    })
  })

  createEffect(() => {
    serializeInfiniteCanvasState(state())
    if (persistenceTimer !== undefined) window.clearTimeout(persistenceTimer)
    persistenceTimer = window.setTimeout(() => {
      persistActiveState()
      persistenceTimer = undefined
      scheduleSync()
    }, 220)
  })

  onCleanup(() => {
    if (animationTimer !== undefined) window.clearTimeout(animationTimer)
    if (persistenceTimer !== undefined) window.clearTimeout(persistenceTimer)
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    persistActiveState()
    panController.dispose()
  })

  function pushGesture(before: InfiniteCanvasState, after: InfiniteCanvasState) {
    if (sameState(before, after)) return
    setUndoStack((items) => [...items.slice(-99), cloneState(before)])
    setRedoStack([])
  }

  function commit(mutator: (current: InfiniteCanvasState) => InfiniteCanvasState) {
    const before = cloneState(state())
    const after = mutator(cloneState(before))
    if (sameState(before, after)) return
    pushGesture(before, after)
    setState(after)
  }

  function saveCollection(next: CanvasCollection) {
    setCollection(next)
    storeCollection(next)
    scheduleSync(50)
  }

  function switchCanvas(id: string) {
    persistActiveState()
    const target = collection().canvases.find((item) => item.id === id && !item.deleted)
    if (!target?.state) return
    const next = { ...collection(), activeId: id }
    setCollection(next)
    setState(cloneState(target.state))
    setUndoStack([])
    setRedoStack([])
    clearSelection()
    setCanvasMenuOpen(false)
    storeCollection(next)
  }

  function createNamedCanvas() {
    const current = persistActiveState()
    const record = createCanvasRecord(current, dialogInput())
    const next = {
      ...current,
      activeId: record.id,
      lastTimestamp: record.updatedAt,
      canvases: [...current.canvases, record],
    }
    setCollection(next)
    setState(cloneState(record.state!))
    setUndoStack([])
    setRedoStack([])
    clearSelection()
    storeCollection(next)
    scheduleSync(50)
    setDialog(null)
  }

  function renameCanvas(canvasId: string) {
    const name = dialogInput().trim()
    if (!name) return
    const current = persistActiveState()
    const updatedAt = nextCanvasTimestamp(current)
    saveCollection({
      ...current,
      lastTimestamp: updatedAt,
      canvases: current.canvases.map((item) =>
        item.id === canvasId ? { ...item, name, updatedAt, writerId: current.writerId } : item,
      ),
    })
    setDialog(null)
  }

  function deleteCanvas(canvasId: string) {
    const current = persistActiveState()
    const updatedAt = nextCanvasTimestamp(current)
    let canvases = current.canvases.map((item) =>
      item.id === canvasId
        ? {
            ...item,
            state: null,
            deleted: true,
            updatedAt,
            writerId: current.writerId,
          }
        : item,
    )
    let fallback = canvases.find((item) => item.id === current.activeId && !item.deleted)
    fallback ??= canvases.find((item) => !item.deleted)
    if (!fallback) {
      fallback = createCanvasRecord({ ...current, lastTimestamp: updatedAt }, 'Untitled canvas')
      canvases = [...canvases, fallback]
    }
    const next = {
      ...current,
      activeId: fallback.id,
      lastTimestamp: Math.max(updatedAt, fallback.updatedAt),
      canvases,
    }
    setCollection(next)
    if (current.activeId === canvasId) {
      setState(cloneState(fallback.state!))
      setUndoStack([])
      setRedoStack([])
      clearSelection()
    }
    storeCollection(next)
    scheduleSync(50)
    setDialog(null)
  }

  function undo() {
    const stack = undoStack()
    const previous = stack.at(-1)
    if (!previous) return
    const current = cloneState(state())
    setUndoStack(stack.slice(0, -1))
    setRedoStack((items) => [...items, current])
    setState({ ...cloneState(previous), camera: current.camera })
    clearSelection()
  }

  function redo() {
    const stack = redoStack()
    const next = stack.at(-1)
    if (!next) return
    const current = cloneState(state())
    setRedoStack(stack.slice(0, -1))
    setUndoStack((items) => [...items, current])
    setState({ ...cloneState(next), camera: current.camera })
    clearSelection()
  }

  function screenToWorld(clientX: number, clientY: number) {
    const rect = viewportEl?.getBoundingClientRect()
    const camera = state().camera
    return {
      x: (clientX - (rect?.left ?? 0) - camera.x) / camera.zoom,
      y: (clientY - (rect?.top ?? 0) - camera.y) / camera.zoom,
    }
  }

  function viewportCenterWorld() {
    const rect = viewportEl?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function animateCamera(camera: InfiniteCanvasState['camera']) {
    setCameraAnimating(true)
    if (animationTimer !== undefined) window.clearTimeout(animationTimer)
    setState((current) => ({ ...current, camera }))
    animationTimer = window.setTimeout(() => setCameraAnimating(false), 240)
  }

  function fitBounds(bounds: CanvasRect, maxZoom = CANVAS_MAX_ZOOM) {
    const viewport = viewportEl?.getBoundingClientRect()
    if (!viewport) return
    const padding = 72
    const zoom = Math.min(
      Math.min(maxZoom, CANVAS_MAX_ZOOM),
      Math.max(
        CANVAS_MIN_ZOOM,
        Math.min(
          (viewport.width - padding * 2) / bounds.width,
          (viewport.height - padding * 2) / bounds.height,
        ),
      ),
    )
    animateCamera({
      zoom,
      x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    })
  }

  function fitAll() {
    const bounds = canvasContentBounds(state())
    if (bounds) fitBounds(bounds, 1)
    else animateCamera({ x: 0, y: 0, zoom: 1 })
  }

  function clearSelection() {
    setSelection(null)
    setBreadcrumbFrameId(null)
  }

  function selectWindow(windowId: string) {
    setSelection({ kind: 'window', id: windowId })
    setBreadcrumbFrameId(null)
  }

  function focusFrame(frameId: string) {
    const frame = state().frames.find((candidate) => candidate.id === frameId)
    if (!frame) return
    setSelection(null)
    setBreadcrumbFrameId(frameId)
    fitBounds(frame.bounds)
  }

  function focusWindow(windowId: string) {
    const item = state().windows.find((candidate) => candidate.id === windowId)
    if (!item) return
    bringToFront(windowId)
    selectWindow(windowId)
    fitBounds(canvasWindowWorldBounds(item, state().frames), 1)
  }

  function bringToFront(windowId: string) {
    setState((current) => ({
      ...current,
      windows: current.windows.map((window) =>
        window.id === windowId ? { ...window, zIndex: current.nextZIndex } : window,
      ),
      nextZIndex: current.nextZIndex + 1,
    }))
  }

  function placementObstacles(frameId: string | null, current: InfiniteCanvasState) {
    const windows = current.windows
      .filter((window) => window.frameId === frameId)
      .map((window) => canvasWindowWorldBounds(window, current.frames))
    return frameId ? windows : [...windows, ...current.frames.map((frame) => frame.bounds)]
  }

  function fileWindowPlacement(
    point: { x: number; y: number },
    current: InfiniteCanvasState,
    type: CanvasWindowType,
  ): FileDropPreview {
    const frameId =
      current.frames.find((frame) => rectContainsPoint(frame.bounds, point.x, point.y))?.id ?? null
    const size = current.windowSizeByType[type] ?? DEFAULT_WINDOW
    const desired = {
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      ...size,
    }
    return {
      bounds: findNearestFreeCanvasRect(desired, placementObstacles(frameId, current)),
      frameId,
    }
  }

  function makeDefinition(id: string, file?: FileItem, dir = ''): WorkspaceWindowDefinition {
    if (!file || file.isDirectory) {
      const path = file?.path ?? dir
      return {
        id,
        type: 'browser',
        title: workspaceBrowserDirTitle(path),
        iconPath: path,
        iconType: MediaType.FOLDER,
        source: LOCAL_SOURCE,
        initialState: path ? { dir: path } : {},
        tabGroupId: null,
      }
    }
    return {
      id,
      type: 'viewer',
      title: file.name || fileName(file.path),
      iconPath: file.path,
      iconType: file.type,
      source: LOCAL_SOURCE,
      initialState: { viewing: file.path, dir: parentPath(file.path) },
      tabGroupId: null,
    }
  }

  function existingWindowForFile(file: FileItem) {
    return state().windows.find((window) =>
      file.isDirectory
        ? window.definition.type === 'browser' && window.definition.initialState.dir === file.path
        : window.definition.type === 'viewer' &&
          window.definition.initialState.viewing === file.path,
    )
  }

  function addFileWindow(
    file: FileItem | null,
    point: { x: number; y: number },
    options: { duplicate?: boolean; frameId?: string | null; worldBounds?: CanvasRect } = {},
  ) {
    if (file && !options.duplicate) {
      const existing = existingWindowForFile(file)
      if (existing) {
        focusWindow(existing.id)
        return existing.id
      }
    }
    let createdId = ''
    commit((current) => {
      const id = `canvas-window-${current.nextItemId}`
      createdId = id
      const definition = makeDefinition(id, file ?? undefined)
      const containingFrame = current.frames.find((frame) =>
        rectContainsPoint(frame.bounds, point.x, point.y),
      )
      const frameId =
        options.frameId === undefined ? (containingFrame?.id ?? null) : options.frameId
      const worldBounds =
        options.worldBounds ??
        findNearestFreeCanvasRect(
          { ...point, ...(current.windowSizeByType[definition.type] ?? DEFAULT_WINDOW) },
          placementObstacles(frameId, current),
        )
      const base: CanvasWindow = {
        id,
        definition,
        bounds: worldBounds,
        frameId: null,
        zIndex: current.nextZIndex,
      }
      const nextWindow = withCanvasWindowWorldBounds(
        base,
        worldBounds,
        frameId ?? null,
        current.frames,
      )
      return {
        ...current,
        windows: [...current.windows, nextWindow],
        nextItemId: current.nextItemId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
    })
    if (createdId) selectWindow(createdId)
    return createdId
  }

  function requestAddFrame(point: { x: number; y: number }) {
    setDialogInput('New project')
    setDialog({ kind: 'new-frame', point })
  }

  function addFrame(point: { x: number; y: number }, requestedName: string) {
    const name = requestedName.trim()
    if (!name) return
    commit((current) => {
      const id = `canvas-frame-${current.nextItemId}`
      const bounds = findNearestFreeCanvasRect(
        { x: point.x, y: point.y, ...DEFAULT_FRAME },
        current.frames.map((frame) => frame.bounds),
      )
      const next = {
        ...current,
        frames: [
          ...current.frames,
          { id, name, color: FRAME_COLORS[current.frames.length % FRAME_COLORS.length]!, bounds },
        ],
        nextItemId: current.nextItemId + 1,
      }
      return reconcileFrameMembership(next, id)
    })
  }

  function openFromBrowser(sourceWindowId: string, file: FileItem, duplicate = false) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source) return
    if (!duplicate) {
      const existing = existingWindowForFile(file)
      if (existing) {
        focusWindow(existing.id)
        return
      }
    }
    const bounds = canvasWindowWorldBounds(source, state().frames)
    addFileWindow(
      file,
      { x: bounds.x + bounds.width + CANVAS_GRID_SIZE, y: bounds.y },
      { duplicate, frameId: source.frameId },
    )
  }

  function openHermesFromBrowser(
    sourceWindowId: string,
    file: FileItem,
    target: VirtualOpenTarget,
  ) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source) return
    if (target.sessionId) {
      const existing = state().windows.find(
        (window) =>
          window.definition.type === 'hermes' &&
          window.definition.hermes?.sessionId === target.sessionId,
      )
      if (existing) {
        focusWindow(existing.id)
        return
      }
    }
    const sourceBounds = canvasWindowWorldBounds(source, state().frames)
    addHermesWindow(
      file,
      target,
      { x: sourceBounds.x + sourceBounds.width + CANVAS_GRID_SIZE, y: sourceBounds.y },
      source.frameId,
    )
  }

  function addHermesWindow(
    file: FileItem,
    target: VirtualOpenTarget,
    point: { x: number; y: number },
    requestedFrameId?: string | null,
    requestedBounds?: CanvasRect,
  ) {
    if (target.sessionId) {
      const existing = state().windows.find(
        (window) =>
          window.definition.type === 'hermes' &&
          window.definition.hermes?.sessionId === target.sessionId,
      )
      if (existing) {
        focusWindow(existing.id)
        return
      }
    }
    commit((current) => {
      const id = `canvas-window-${current.nextItemId}`
      const definition: WorkspaceWindowDefinition = {
        id,
        type: 'hermes',
        title: target.type === 'hermesDraft' ? 'New Hermes session' : file.name,
        iconName: null,
        iconPath: file.path,
        iconIsVirtual: true,
        source: LOCAL_SOURCE,
        initialState: {},
        tabGroupId: null,
        hermes: {
          sessionId: target.sessionId,
          draftId: target.type === 'hermesDraft' ? crypto.randomUUID() : undefined,
          cwd: target.projectPath,
          readOnly: target.readOnly,
        },
      }
      const worldBounds = findNearestFreeCanvasRect(
        { ...point, ...(current.windowSizeByType.hermes ?? DEFAULT_WINDOW) },
        placementObstacles(requestedFrameId ?? null, current),
      )
      const bounds = requestedBounds ?? worldBounds
      const base: CanvasWindow = {
        id,
        definition,
        bounds,
        frameId: null,
        zIndex: current.nextZIndex,
      }
      return {
        ...current,
        windows: [
          ...current.windows,
          withCanvasWindowWorldBounds(base, bounds, requestedFrameId ?? null, current.frames),
        ],
        nextItemId: current.nextItemId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
    })
  }

  function bindHermesSession(windowId: string, sessionId: string) {
    updateDefinition(windowId, (definition) => ({
      ...definition,
      title: definition.title === 'New Hermes session' ? 'Hermes session' : definition.title,
      iconPath: `Hermes Sessions/session/${sessionId}`,
      hermes: { ...definition.hermes, sessionId, draftId: undefined },
    }))
  }

  function updateDefinition(
    windowId: string,
    update: (definition: WorkspaceWindowDefinition) => WorkspaceWindowDefinition,
  ) {
    setState((current) => {
      const window = current.windows.find((candidate) => candidate.id === windowId)
      if (!window) return current
      window.definition = update(window.definition)
      return { ...current, windows: [...current.windows] }
    })
  }

  function navigateDir(windowId: string, dir: string) {
    updateDefinition(windowId, (definition) => ({
      ...definition,
      title: workspaceBrowserDirTitle(dir),
      iconPath: dir,
      iconType: MediaType.FOLDER,
      initialState: { ...definition.initialState, dir },
    }))
  }

  function updateViewing(windowId: string, path: string) {
    updateDefinition(windowId, (definition) => ({
      ...definition,
      title: fileName(path),
      iconPath: path,
      iconType: getMediaType(path.split('.').at(-1) ?? ''),
      initialState: { ...definition.initialState, viewing: path, dir: parentPath(path) },
    }))
  }

  function closeWindow(windowId: string) {
    const target = state().windows.find((window) => window.id === windowId)
    if (!canCloseHermesWindow(target?.definition.hermes)) return
    commit((current) => ({
      ...current,
      windows: current.windows.filter((window) => window.id !== windowId),
    }))
    if (selection()?.id === windowId) clearSelection()
  }

  function duplicateWindow(windowId: string) {
    const source = state().windows.find((window) => window.id === windowId)
    if (!source) return
    if (source.definition.type === 'hermes') {
      focusWindow(windowId)
      return
    }
    const world = canvasWindowWorldBounds(source, state().frames)
    const file =
      source.definition.type === 'browser'
        ? fileItemFromDrag(source.definition.initialState.dir ?? '', true)
        : fileItemFromDrag(source.definition.initialState.viewing ?? '', false)
    addFileWindow(
      file,
      { x: world.x + CANVAS_GRID_SIZE * 2, y: world.y + CANVAS_GRID_SIZE * 2 },
      { duplicate: true, frameId: source.frameId },
    )
  }

  function moveWindowToFrame(windowId: string, frameId: string | null) {
    commit((current) => ({
      ...current,
      windows: current.windows.map((window) => {
        if (window.id !== windowId) return window
        return withCanvasWindowWorldBounds(
          window,
          canvasWindowWorldBounds(window, current.frames),
          frameId,
          current.frames,
        )
      }),
    }))
  }

  function deleteFrame(frameId: string) {
    const frame = state().frames.find((candidate) => candidate.id === frameId)
    if (!frame) return
    const hasChildren = state().windows.some((window) => window.frameId === frameId)
    if (hasChildren) {
      setDialog({ kind: 'delete-frame', frameId, frameName: frame.name })
      return
    }
    deleteFrameNow(frameId)
  }

  function deleteFrameNow(frameId: string) {
    commit((current) => {
      const windows = current.windows.map((window) => {
        if (window.frameId !== frameId) return window
        return withCanvasWindowWorldBounds(
          window,
          canvasWindowWorldBounds(window, current.frames),
          null,
          current.frames,
        )
      })
      return {
        ...current,
        frames: current.frames.filter((candidate) => candidate.id !== frameId),
        windows,
      }
    })
    clearSelection()
  }

  function renameFrame(frameId: string) {
    const frame = state().frames.find((candidate) => candidate.id === frameId)
    if (!frame) return
    setDialogInput(frame.name)
    setDialog({ kind: 'rename-frame', frameId })
  }

  function applyFrameName(frameId: string, requestedName: string) {
    const name = requestedName.trim()
    if (!name) return
    commit((current) => ({
      ...current,
      frames: current.frames.map((candidate) =>
        candidate.id === frameId ? { ...candidate, name } : candidate,
      ),
    }))
  }

  function colorFrame(frameId: string, color: string) {
    commit((current) => ({
      ...current,
      frames: current.frames.map((frame) => (frame.id === frameId ? { ...frame, color } : frame)),
    }))
  }

  function resizeFrameToContents(frameId: string) {
    const current = state()
    const frame = current.frames.find((candidate) => candidate.id === frameId)
    if (!frame) return
    const children = current.windows.filter((window) => window.frameId === frameId)
    if (!children.length) return
    const rects = children.map((window) => canvasWindowWorldBounds(window, current.frames))
    const left = Math.min(...rects.map((rect) => rect.x)) - CANVAS_GRID_SIZE
    const top = Math.min(...rects.map((rect) => rect.y)) - CANVAS_GRID_SIZE * 2
    const right = Math.max(...rects.map((rect) => rect.x + rect.width)) + CANVAS_GRID_SIZE
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height)) + CANVAS_GRID_SIZE
    const bounds = snapCanvasRect({ x: left, y: top, width: right - left, height: bottom - top })
    if (framesOverlap(current.frames, frameId, bounds)) {
      setDialog({
        kind: 'message',
        message: 'Cannot resize frame because it would overlap another frame.',
      })
      return
    }
    commit((draft) => {
      const worldById = new Map(
        draft.windows
          .filter((window) => window.frameId === frameId)
          .map((window) => [window.id, canvasWindowWorldBounds(window, draft.frames)]),
      )
      const frames = draft.frames.map((candidate) =>
        candidate.id === frameId ? { ...candidate, bounds } : candidate,
      )
      const windows = draft.windows.map((window) => {
        const world = worldById.get(window.id)
        return world ? withCanvasWindowWorldBounds(window, world, frameId, frames) : window
      })
      return reconcileFrameMembership({ ...draft, frames, windows }, frameId)
    })
  }

  function startWindowMove(windowId: string, event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    bringToFront(windowId)
    selectWindow(windowId)
    const before = cloneState(state())
    const item = before.windows.find((window) => window.id === windowId)
    if (!item) return
    const start = canvasWindowWorldBounds(item, before.frames)
    const startX = event.clientX
    const startY = event.clientY
    setGeometryActive(true)
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / state().camera.zoom
      const dy = (next.clientY - startY) / state().camera.zoom
      const bounds = {
        ...start,
        x: snapCanvasValue(start.x + dx),
        y: snapCanvasValue(start.y + dy),
      }
      setState((current) => ({
        ...current,
        windows: current.windows.map((window) =>
          window.id === windowId
            ? withCanvasWindowWorldBounds(window, bounds, window.frameId, current.frames)
            : window,
        ),
      }))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      setGeometryActive(false)
      const current = state()
      const moved = current.windows.find((window) => window.id === windowId)
      if (!moved) return
      const world = canvasWindowWorldBounds(moved, current.frames)
      const target = frameAtWindowCenter(world, current.frames)
      const after = {
        ...current,
        windows: current.windows.map((window) =>
          window.id === windowId
            ? withCanvasWindowWorldBounds(window, world, target?.id ?? null, current.frames)
            : window,
        ),
      }
      setState(after)
      pushGesture(before, after)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function startWindowResize(windowId: string, direction: ResizeDirection, event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const before = cloneState(state())
    const item = before.windows.find((window) => window.id === windowId)
    if (!item) return
    const start = canvasWindowWorldBounds(item, before.frames)
    const startX = event.clientX
    const startY = event.clientY
    setGeometryActive(true)
    const move = (next: PointerEvent) => {
      const bounds = resizeRect(
        start,
        (next.clientX - startX) / state().camera.zoom,
        (next.clientY - startY) / state().camera.zoom,
        direction,
      )
      setState((current) => ({
        ...current,
        windows: current.windows.map((window) =>
          window.id === windowId
            ? withCanvasWindowWorldBounds(window, bounds, window.frameId, current.frames)
            : window,
        ),
      }))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      setGeometryActive(false)
      const current = state()
      const resized = current.windows.find((window) => window.id === windowId)
      if (!resized) return
      const world = canvasWindowWorldBounds(resized, current.frames)
      const target = frameAtWindowCenter(world, current.frames)
      const after = {
        ...current,
        windowSizeByType: {
          ...current.windowSizeByType,
          [resized.definition.type]: { width: world.width, height: world.height },
        },
        windows: current.windows.map((window) =>
          window.id === windowId
            ? withCanvasWindowWorldBounds(window, world, target?.id ?? null, current.frames)
            : window,
        ),
      }
      setState(after)
      pushGesture(before, after)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function startFrameMove(frameId: string, event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    clearSelection()
    const before = cloneState(state())
    const frame = before.frames.find((candidate) => candidate.id === frameId)
    if (!frame) return
    const startX = event.clientX
    const startY = event.clientY
    setGeometryActive(true)
    const move = (next: PointerEvent) => {
      const bounds = {
        ...frame.bounds,
        x: snapCanvasValue(frame.bounds.x + (next.clientX - startX) / state().camera.zoom),
        y: snapCanvasValue(frame.bounds.y + (next.clientY - startY) / state().camera.zoom),
      }
      setInvalidFrameId(framesOverlap(state().frames, frameId, bounds) ? frameId : null)
      setState((current) => ({
        ...current,
        frames: current.frames.map((candidate) =>
          candidate.id === frameId ? { ...candidate, bounds } : candidate,
        ),
      }))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      setGeometryActive(false)
      if (invalidFrameId() === frameId) {
        setState(before)
        setInvalidFrameId(null)
        return
      }
      const after = reconcileFrameMembership(state(), frameId)
      setState(after)
      pushGesture(before, after)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function startFrameResize(frameId: string, direction: ResizeDirection, event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const before = cloneState(state())
    const frame = before.frames.find((candidate) => candidate.id === frameId)
    if (!frame) return
    const startX = event.clientX
    const startY = event.clientY
    const childWorldBounds = new Map(
      before.windows
        .filter((window) => window.frameId === frameId)
        .map((window) => [window.id, canvasWindowWorldBounds(window, before.frames)]),
    )
    setGeometryActive(true)
    const move = (next: PointerEvent) => {
      const bounds = resizeRect(
        frame.bounds,
        (next.clientX - startX) / state().camera.zoom,
        (next.clientY - startY) / state().camera.zoom,
        direction,
      )
      setInvalidFrameId(framesOverlap(state().frames, frameId, bounds) ? frameId : null)
      setState((current) => {
        const frames = current.frames.map((candidate) =>
          candidate.id === frameId ? { ...candidate, bounds } : candidate,
        )
        const windows = current.windows.map((window) => {
          const world = childWorldBounds.get(window.id)
          return world ? withCanvasWindowWorldBounds(window, world, frameId, frames) : window
        })
        return { ...current, frames, windows }
      })
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      setGeometryActive(false)
      if (invalidFrameId() === frameId) {
        setState(before)
        setInvalidFrameId(null)
        return
      }
      const after = reconcileFrameMembership(state(), frameId)
      setState(after)
      pushGesture(before, after)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function beginPan(event: PointerEvent) {
    if (event.button !== 1) return
    setMenu(null)
    panController.begin(event)
  }

  function zoomAt(clientX: number, clientY: number, nextZoom: number) {
    const rect = viewportEl?.getBoundingClientRect()
    if (!rect) return
    const current = state().camera
    const zoom = Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, nextZoom))
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const worldX = (sx - current.x) / current.zoom
    const worldY = (sy - current.y) / current.zoom
    setState((value) => ({
      ...value,
      camera: { zoom, x: sx - worldX * zoom, y: sy - worldY * zoom },
    }))
  }

  function zoomBy(factor: number) {
    const rect = viewportEl?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state().camera.zoom * factor)
  }

  function onCanvasContextMenu(event: MouseEvent) {
    event.preventDefault()
    const world = screenToWorld(event.clientX, event.clientY)
    setMenu({
      kind: 'canvas',
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: world.x,
      worldY: world.y,
    })
  }

  function openSearch(anchor: { x: number; y: number } | null) {
    setSearchAnchor(anchor)
    setSearchOpen(true)
    setMenu(null)
  }

  function searchPlacement() {
    const anchor = searchAnchor()
    if (anchor) return anchor
    return viewportCenterWorld()
  }

  function onLibrarySearchResult(result: FileSearchResult) {
    addFileWindow(fileSearchResultToFileItem(result), searchPlacement())
  }

  function resetCanvas() {
    setDialog({ kind: 'reset-canvas' })
  }

  function resetCanvasNow() {
    commit(() => createEmptyCanvasState())
    clearSelection()
    setOverflowOpen(false)
  }

  createEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        openSearch(null)
        return
      }
      if (editableTarget(event.target)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      } else if (event.key === 'Escape') {
        setMenu(null)
        clearSelection()
      }
    }
    window.addEventListener('keydown', keydown)
    onCleanup(() => window.removeEventListener('keydown', keydown))
  })

  const selectedWindow = createMemo(() => {
    const selected = selection()
    return selected ? state().windows.find((window) => window.id === selected.id) : undefined
  })
  const selectedFrame = createMemo(() => {
    const selected = selectedWindow()
    const frameId = selected ? selected.frameId : breadcrumbFrameId()
    return frameId ? state().frames.find((frame) => frame.id === frameId) : undefined
  })

  return (
    <div class='canvas-layout fixed inset-0 flex select-none flex-col overflow-hidden bg-background text-foreground'>
      <header class='relative z-[100000] flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-2 shadow-sm backdrop-blur'>
        <div class='relative' data-canvas-picker>
          <button
            type='button'
            data-testid='canvas-name-trigger'
            class='max-w-56 truncate rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-muted'
            onClick={() => setCanvasMenuOpen((open) => !open)}
          >
            {activeCanvas()?.name ?? 'Canvas'}
          </button>
          <Show when={canvasMenuOpen()}>
            <div class='absolute top-10 left-0 w-64 rounded-lg border border-border bg-popover p-1 shadow-xl'>
              <div class='max-h-64 overflow-auto'>
                <For each={availableCanvases()}>
                  {(canvas) => (
                    <div
                      data-testid='canvas-list-item'
                      class={`group flex h-9 w-full items-center rounded-md text-sm hover:bg-muted ${
                        canvas.id === collection().activeId ? 'bg-muted font-medium' : ''
                      }`}
                    >
                      <button
                        type='button'
                        class='min-w-0 flex-1 self-stretch truncate px-2.5 text-left'
                        onClick={() => switchCanvas(canvas.id)}
                      >
                        {canvas.name}
                      </button>
                      <div
                        data-canvas-row-actions
                        class='pointer-events-none flex shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
                      >
                        <button
                          type='button'
                          aria-label={`Rename ${canvas.name}`}
                          title='Rename canvas'
                          class='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground'
                          onClick={() => {
                            setDialogInput(canvas.name)
                            setDialog({ kind: 'rename-canvas', canvasId: canvas.id })
                            setCanvasMenuOpen(false)
                          }}
                        >
                          <Pencil class='size-4' />
                        </button>
                        <button
                          type='button'
                          aria-label={`Delete ${canvas.name}`}
                          title='Delete canvas'
                          class='mr-0.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
                          onClick={() => {
                            setDialog({
                              kind: 'delete-canvas',
                              canvasId: canvas.id,
                              canvasName: canvas.name,
                            })
                            setCanvasMenuOpen(false)
                          }}
                        >
                          <Trash2 class='size-4' />
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <div class='my-1 border-t border-border' />
              <MenuButton
                onClick={() => {
                  setDialogInput('')
                  setDialog({ kind: 'new-canvas' })
                  setCanvasMenuOpen(false)
                }}
              >
                <Plus class='size-4' />
                New canvas
              </MenuButton>
            </div>
          </Show>
        </div>
        <Show when={selectedFrame()}>
          {(frame) => (
            <>
              <ChevronRight class='size-4 text-muted-foreground' />
              <button
                type='button'
                data-testid='canvas-frame-breadcrumb'
                class='max-w-48 truncate rounded px-2 py-1 text-sm hover:bg-muted'
                onClick={() => focusFrame(frame().id)}
              >
                {frame().name}
              </button>
            </>
          )}
        </Show>
        <Show when={selectedWindow()}>
          {(item) => (
            <>
              <ChevronRight class='size-4 text-muted-foreground' />
              <button
                type='button'
                data-testid='canvas-window-breadcrumb'
                class='max-w-48 truncate rounded px-2 py-1 text-sm hover:bg-muted'
                onClick={() => focusWindow(item().id)}
              >
                {item().definition.title}
              </button>
            </>
          )}
        </Show>
        <div class='ml-auto flex items-center gap-1'>
          <button
            type='button'
            data-testid='canvas-search-trigger'
            class='inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted'
            onClick={() => openSearch(null)}
          >
            <Search class='size-4' />
            Search
          </button>
          <button
            type='button'
            title='Undo'
            disabled={!undoStack().length}
            class='inline-flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-35'
            onClick={undo}
          >
            <Undo2 class='size-4' />
          </button>
          <button
            type='button'
            title='Redo'
            disabled={!redoStack().length}
            class='inline-flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-35'
            onClick={redo}
          >
            <Redo2 class='size-4' />
          </button>
          <button
            type='button'
            title='Fit all'
            class='inline-flex size-8 items-center justify-center rounded-md hover:bg-muted'
            onClick={fitAll}
          >
            <Maximize class='size-4' />
          </button>
          <button
            type='button'
            title='Zoom out'
            class='inline-flex size-8 items-center justify-center rounded-md hover:bg-muted'
            onClick={() => zoomBy(0.8)}
          >
            <ZoomOut class='size-4' />
          </button>
          <button
            type='button'
            title='Reset zoom'
            class='h-8 min-w-14 rounded-md px-2 text-xs tabular-nums hover:bg-muted'
            onClick={() => zoomBy(1 / state().camera.zoom)}
          >
            {Math.round(state().camera.zoom * 100)}%
          </button>
          <button
            type='button'
            title='Zoom in'
            disabled={state().camera.zoom >= CANVAS_MAX_ZOOM}
            class='inline-flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-35'
            onClick={() => zoomBy(1.25)}
          >
            <ZoomIn class='size-4' />
          </button>
          <div class='relative'>
            <button
              type='button'
              title='More'
              class='inline-flex size-8 items-center justify-center rounded-md hover:bg-muted'
              onClick={() => setOverflowOpen((open) => !open)}
            >
              <MoreHorizontal class='size-4' />
            </button>
            <Show when={overflowOpen()}>
              <div class='absolute top-10 right-0 w-44 rounded-lg border border-border bg-popover p-1 shadow-xl'>
                <MenuButton
                  onClick={() => {
                    setState((current) => ({ ...current, camera: { x: 0, y: 0, zoom: 1 } }))
                    setOverflowOpen(false)
                  }}
                >
                  <RotateCcw class='size-4' />
                  Reset view
                </MenuButton>
                <MenuButton danger onClick={resetCanvas}>
                  <X class='size-4' />
                  Reset canvas
                </MenuButton>
              </div>
            </Show>
          </div>
        </div>
      </header>

      <div
        ref={(element) => (viewportEl = element)}
        data-testid='infinite-canvas'
        class='relative min-h-0 flex-1 overflow-hidden bg-muted/20 outline-none'
        classList={{ 'cursor-grabbing': false }}
        style={{
          'background-image':
            state().camera.zoom < FAR_ZOOM
              ? 'none'
              : 'radial-gradient(circle, color-mix(in oklab, var(--muted-foreground) 36%, transparent) 1px, transparent 1px)',
          'background-size': `${CANVAS_GRID_SIZE * state().camera.zoom}px ${CANVAS_GRID_SIZE * state().camera.zoom}px`,
          'background-position': `${state().camera.x}px ${state().camera.y}px`,
          'background-color': geometryActive()
            ? 'color-mix(in oklab, var(--muted) 45%, var(--background))'
            : undefined,
        }}
        tabindex={-1}
        onPointerDown={(event) => {
          if (fileDropPreview()) setFileDropPreview(null)
          if (event.button === 0 && event.target === event.currentTarget) {
            clearSelection()
            setMenu(null)
            event.currentTarget.focus()
          }
        }}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          zoomAt(
            event.clientX,
            event.clientY,
            state().camera.zoom * Math.exp(-event.deltaY * 0.002),
          )
        }}
        onContextMenu={onCanvasContextMenu}
        onDragOver={(event) => {
          if (!event.dataTransfer || !hasFileDragData(event.dataTransfer)) return
          if ((event.target as Element | null)?.closest('[data-testid="canvas-window"]')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          const nextTarget = event.relatedTarget as Node | null
          if (!nextTarget || !event.currentTarget.contains(nextTarget)) setFileDropPreview(null)
        }}
        onDragEnd={() => setFileDropPreview(null)}
        onDrop={(event) => {
          const transfer = event.dataTransfer
          if (!transfer) return
          if ((event.target as Element | null)?.closest('[data-testid="canvas-window"]')) return
          const data = getFileDragData(transfer)
          if (!data || data.sourceKind !== 'local') return
          event.preventDefault()
          const point = screenToWorld(event.clientX, event.clientY)
          const placement =
            fileDropPreview() ??
            fileWindowPlacement(
              point,
              state(),
              data.virtualOpenTarget ? 'hermes' : data.isDirectory ? 'browser' : 'viewer',
            )
          setFileDropPreview(null)
          if (data.virtualOpenTarget) {
            addHermesWindow(
              fileItemFromDrag(data.path, false),
              data.virtualOpenTarget,
              point,
              placement.frameId,
              placement.bounds,
            )
            return
          }
          addFileWindow(fileItemFromDrag(data.path, data.isDirectory), point, {
            duplicate: true,
            frameId: placement.frameId,
            worldBounds: placement.bounds,
          })
        }}
      >
        <div
          ref={(element) => (worldEl = element)}
          data-testid='canvas-world'
          class='absolute top-0 left-0 origin-top-left will-change-transform'
          classList={{ 'transition-transform duration-200 ease-out': cameraAnimating() }}
          style={{
            transform: `translate3d(${state().camera.x}px, ${state().camera.y}px, 0) scale(${state().camera.zoom})`,
          }}
        >
          <For each={state().frames}>
            {(frame) => (
              <div
                data-testid='canvas-frame'
                data-frame-id={frame.id}
                class='absolute rounded-lg border bg-card/10 shadow-sm'
                classList={{
                  'border-destructive bg-destructive/10': invalidFrameId() === frame.id,
                }}
                style={{
                  left: `${frame.bounds.x}px`,
                  top: `${frame.bounds.y}px`,
                  width: `${frame.bounds.width}px`,
                  height: `${frame.bounds.height}px`,
                  'border-color': invalidFrameId() === frame.id ? undefined : frame.color,
                }}
                onPointerDown={(event) => {
                  if (event.button === 0 && event.target === event.currentTarget) {
                    clearSelection()
                    setMenu(null)
                    viewportEl?.focus()
                  }
                }}
                onDblClick={() => focusFrame(frame.id)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu({
                    kind: 'frame',
                    clientX: event.clientX,
                    clientY: event.clientY,
                    frameId: frame.id,
                  })
                }}
              >
                <div
                  data-testid='canvas-frame-header'
                  class='absolute top-0 right-0 left-0 flex h-8 cursor-move items-center gap-2 rounded-t-lg px-2.5 text-xs font-medium'
                  style={{ background: `color-mix(in srgb, ${frame.color} 12%, transparent)` }}
                  onPointerDown={(event) => startFrameMove(frame.id, event)}
                >
                  <span class='size-2.5 rounded-full' style={{ background: frame.color }} />
                  <span class='truncate'>{frame.name}</span>
                  <Show when={state().camera.zoom < FAR_ZOOM}>
                    <span class='ml-auto text-xs font-normal text-muted-foreground'>
                      {state().windows.filter((window) => window.frameId === frame.id).length}{' '}
                      windows
                    </span>
                  </Show>
                </div>
                <ResizeHandles
                  onStart={(direction, event) => startFrameResize(frame.id, direction, event)}
                />
              </div>
            )}
          </For>

          <For each={state().windows.map((window) => window.id)}>
            {(windowId) => {
              const item = createMemo(() =>
                state().windows.find((window) => window.id === windowId),
              )
              const worldBounds = createMemo(() => canvasWindowWorldBounds(item()!, state().frames))
              const visualBounds = createMemo(() => canvasWindowVisualBounds(worldBounds()))
              const selected = () => selection()?.id === windowId
              return (
                <div
                  data-testid='canvas-window'
                  data-window-id={windowId}
                  class='absolute overflow-visible rounded-lg border border-border bg-background shadow-2xl outline outline-1 -outline-offset-1 outline-border'
                  classList={{
                    'border-border shadow-black/20': selected(),
                    'invisible pointer-events-none': state().camera.zoom < FAR_ZOOM,
                  }}
                  style={{
                    left: `${visualBounds().x}px`,
                    top: `${visualBounds().y}px`,
                    width: `${visualBounds().width}px`,
                    height: `${visualBounds().height}px`,
                    'z-index': selected() ? 1000000 + item()!.zIndex : item()!.zIndex,
                  }}
                  onPointerDown={() => {
                    selectWindow(windowId)
                  }}
                  onDblClick={() => state().camera.zoom < LIVE_ZOOM && focusWindow(windowId)}
                  onContextMenu={(event) => {
                    if ((event.target as HTMLElement).closest('[data-canvas-window-content]'))
                      return
                    event.preventDefault()
                    event.stopPropagation()
                    setMenu({
                      kind: 'window',
                      clientX: event.clientX,
                      clientY: event.clientY,
                      windowId,
                    })
                  }}
                >
                  <div
                    class='flex h-8 cursor-grab items-center gap-2 rounded-t-lg border-b border-border px-2 text-xs font-medium select-none active:cursor-grabbing'
                    classList={{
                      'bg-muted text-foreground': selected(),
                      'bg-muted/50 text-muted-foreground': !selected(),
                    }}
                    onPointerDown={(event) => startWindowMove(windowId, event)}
                  >
                    <span class='shrink-0'>
                      {workspaceTabIcon(item()!.definition, fileIconContext(), 'sm')}
                    </span>
                    <span class='min-w-0 flex-1 truncate'>{item()!.definition.title}</span>
                    <button
                      type='button'
                      class='inline-flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                      aria-label={`Close ${item()!.definition.title}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => closeWindow(windowId)}
                    >
                      <X class='size-3.5' stroke-width={2} />
                    </button>
                  </div>
                  <div
                    data-canvas-window-content
                    class='absolute top-8 right-0 bottom-0 left-0 overflow-hidden rounded-b-lg text-sm text-muted-foreground'
                    onContextMenu={(event) => event.stopPropagation()}
                  >
                    <div
                      class='h-full'
                      classList={{
                        'invisible pointer-events-none': state().camera.zoom < LIVE_ZOOM,
                      }}
                    >
                      <Show when={item()!.definition.type === 'browser'}>
                        <WorkspaceBrowserPane
                          windowId={windowId}
                          workspace={workspace}
                          sharePanel={() => null}
                          fileIconContext={fileIconContext}
                          shareAllowUpload={false}
                          shareCanEdit={false}
                          shareCanDelete={false}
                          shareIsKnowledgeBase={false}
                          editableFolders={editableFolders()}
                          onNavigateDir={navigateDir}
                          onOpenViewer={(windowId, file) => openFromBrowser(windowId, file)}
                          onOpenVirtualTarget={openHermesFromBrowser}
                          onAddToTaskbar={() => {}}
                          onOpenInNewTab={(windowId, file) =>
                            openFromBrowser(windowId, fileItemFromDrag(file.path, file.isDirectory))
                          }
                          onOpenInSplitView={(windowId, file) => openFromBrowser(windowId, file)}
                          onRequestPlay={(_source, path) =>
                            openFromBrowser(windowId, fileItemFromDrag(path, false))
                          }
                          onOpenFileInNewFloatingWindow={(windowId, file) =>
                            openFromBrowser(windowId, file, true)
                          }
                        />
                      </Show>
                      <Show when={item()!.definition.type === 'viewer'}>
                        <WorkspaceViewerPane
                          windowId={windowId}
                          storageKey={CANVAS_STORAGE_KEY}
                          contentVisible={() => true}
                          workspace={workspace}
                          sharePanel={() => null}
                          editableFolders={editableFolders()}
                          knowledgeBases={knowledgeBases()}
                          shareCanEdit={false}
                          shareCanUpload={false}
                          onUpdateViewing={updateViewing}
                        />
                      </Show>
                      <Show when={item()!.definition.type === 'hermes'}>
                        <HermesChatPane
                          window={() => item()!.definition}
                          onSessionCreated={(id) => bindHermesSession(windowId, id)}
                          onTitleChanged={(title) =>
                            updateDefinition(windowId, (definition) => ({ ...definition, title }))
                          }
                        />
                      </Show>
                    </div>
                    <Show when={state().camera.zoom < LIVE_ZOOM}>
                      <div class='absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/40 p-8 text-center'>
                        <span class='scale-150'>
                          {workspaceTabIcon(item()!.definition, fileIconContext(), 'md')}
                        </span>
                        <p class='max-w-[80%] truncate text-lg font-semibold'>
                          {item()!.definition.title}
                        </p>
                        <p class='text-sm text-muted-foreground'>Double-click to focus</p>
                      </div>
                    </Show>
                  </div>
                  <Show when={selected()}>
                    <ResizeHandles
                      onStart={(direction, event) => startWindowResize(windowId, direction, event)}
                    />
                  </Show>
                </div>
              )
            }}
          </For>
          <Show when={state().camera.zoom < FAR_ZOOM}>
            <For each={state().windows}>
              {(item) => {
                const bounds = canvasWindowVisualBounds(
                  canvasWindowWorldBounds(item, state().frames),
                )
                return (
                  <button
                    type='button'
                    data-testid='canvas-window-summary'
                    data-window-id={item.id}
                    class='absolute flex items-center justify-center overflow-hidden rounded-lg border border-border bg-card text-left shadow-lg'
                    style={{
                      left: `${bounds.x}px`,
                      top: `${bounds.y}px`,
                      width: `${bounds.width}px`,
                      height: `${bounds.height}px`,
                      'z-index': item.zIndex,
                    }}
                    onClick={() => selectWindow(item.id)}
                    onDblClick={() => focusWindow(item.id)}
                  >
                    <span class='flex max-w-[80%] items-center gap-3 rounded-lg bg-background/75 px-4 py-3 shadow-sm'>
                      {workspaceTabIcon(item.definition, fileIconContext(), 'md')}
                      <span class='min-w-0 truncate font-semibold'>{item.definition.title}</span>
                    </span>
                  </button>
                )
              }}
            </For>
          </Show>
          <div
            data-testid='canvas-drop-preview'
            class='pointer-events-none absolute overflow-hidden rounded-lg border-2 border-dashed border-primary bg-primary/10 shadow-xl'
            classList={{ invisible: !fileDropVisualBounds() }}
            style={{
              left: `${fileDropVisualBounds()?.x ?? 0}px`,
              top: `${fileDropVisualBounds()?.y ?? 0}px`,
              width: `${fileDropVisualBounds()?.width ?? 0}px`,
              height: `${fileDropVisualBounds()?.height ?? 0}px`,
              'z-index': 1000000,
            }}
          >
            <div class='flex h-8 items-center justify-between border-b border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary'>
              <span>New window</span>
              <span class='tabular-nums'>
                {fileDropPreview()?.bounds.width ?? 0} × {fileDropPreview()?.bounds.height ?? 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      <Show when={menu()}>
        {(current) => (
          <div
            data-canvas-context-menu
            class='fixed z-[120000] max-h-[70vh] w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-2xl'
            style={{
              left: `${Math.min(current().clientX, window.innerWidth - 252)}px`,
              top: `${Math.min(current().clientY, window.innerHeight - 340)}px`,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Show when={current().kind === 'canvas'}>
              <MenuButton
                onClick={() => {
                  const value = current() as Extract<ContextMenuState, { kind: 'canvas' }>
                  requestAddFrame({ x: value.worldX, y: value.worldY })
                  setMenu(null)
                }}
              >
                <FrameIcon class='size-4' />
                New frame
              </MenuButton>
              <MenuButton
                onClick={() => {
                  const value = current() as Extract<ContextMenuState, { kind: 'canvas' }>
                  openSearch({ x: value.worldX, y: value.worldY })
                }}
              >
                <Search class='size-4' />
                Search library
              </MenuButton>
              <MenuButton
                onClick={() => {
                  const value = current() as Extract<ContextMenuState, { kind: 'canvas' }>
                  addFileWindow(null, { x: value.worldX, y: value.worldY })
                  setMenu(null)
                }}
              >
                <FolderOpen class='size-4' />
                Open file browser
              </MenuButton>
              <div class='my-1 border-t border-border' />
              <MenuButton
                onClick={() => {
                  fitAll()
                  setMenu(null)
                }}
              >
                <Maximize class='size-4' />
                Fit all
              </MenuButton>
              <MenuButton
                onClick={() => {
                  animateCamera({ x: 0, y: 0, zoom: 1 })
                  setMenu(null)
                }}
              >
                <RotateCcw class='size-4' />
                Reset view
              </MenuButton>
            </Show>
            <Show when={current().kind === 'frame'}>
              {(() => {
                const frameId = (current() as Extract<ContextMenuState, { kind: 'frame' }>).frameId
                return (
                  <>
                    <MenuButton
                      onClick={() => {
                        focusFrame(frameId)
                        setMenu(null)
                      }}
                    >
                      <Focus class='size-4' />
                      Focus frame
                    </MenuButton>
                    <MenuButton
                      onClick={() => {
                        renameFrame(frameId)
                        setMenu(null)
                      }}
                    >
                      <FrameIcon class='size-4' />
                      Rename
                    </MenuButton>
                    <div class='px-2.5 py-2'>
                      <p class='mb-2 flex items-center gap-2 text-xs text-muted-foreground'>
                        <Palette class='size-3.5' />
                        Color
                      </p>
                      <div class='flex flex-wrap gap-2'>
                        <For each={FRAME_COLORS}>
                          {(color) => (
                            <button
                              type='button'
                              aria-label={`Set frame color ${color}`}
                              class='size-6 rounded-full border-2 border-background shadow ring-1 ring-border'
                              style={{ background: color }}
                              onClick={() => {
                                colorFrame(frameId, color)
                                setMenu(null)
                              }}
                            />
                          )}
                        </For>
                      </div>
                    </div>
                    <MenuButton
                      onClick={() => {
                        resizeFrameToContents(frameId)
                        setMenu(null)
                      }}
                    >
                      <Maximize class='size-4' />
                      Resize to contents
                    </MenuButton>
                    <MenuButton
                      danger
                      onClick={() => {
                        deleteFrame(frameId)
                        setMenu(null)
                      }}
                    >
                      <X class='size-4' />
                      Delete frame
                    </MenuButton>
                  </>
                )
              })()}
            </Show>
            <Show when={current().kind === 'window'}>
              {(() => {
                const windowId = (current() as Extract<ContextMenuState, { kind: 'window' }>)
                  .windowId
                return (
                  <>
                    <MenuButton
                      onClick={() => {
                        focusWindow(windowId)
                        setMenu(null)
                      }}
                    >
                      <Focus class='size-4' />
                      Focus
                    </MenuButton>
                    <MenuButton
                      onClick={() => {
                        duplicateWindow(windowId)
                        setMenu(null)
                      }}
                    >
                      <Copy class='size-4' />
                      Open another copy
                    </MenuButton>
                    <p class='px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                      Move to frame
                    </p>
                    <MenuButton
                      onClick={() => {
                        moveWindowToFrame(windowId, null)
                        setMenu(null)
                      }}
                    >
                      <Move class='size-4' />
                      Top level
                    </MenuButton>
                    <For each={state().frames}>
                      {(frame) => (
                        <MenuButton
                          onClick={() => {
                            moveWindowToFrame(windowId, frame.id)
                            setMenu(null)
                          }}
                        >
                          <span class='size-3 rounded-full' style={{ background: frame.color }} />
                          {frame.name}
                        </MenuButton>
                      )}
                    </For>
                    <div class='my-1 border-t border-border' />
                    <MenuButton
                      danger
                      onClick={() => {
                        closeWindow(windowId)
                        setMenu(null)
                      }}
                    >
                      <X class='size-4' />
                      Close
                    </MenuButton>
                  </>
                )
              })()}
            </Show>
          </div>
        )}
      </Show>

      <Show when={searchOpen()}>
        <CanvasSearchPalette
          frames={state().frames}
          windows={state().windows}
          fileIconContext={fileIconContext()}
          onClose={() => setSearchOpen(false)}
          onWindow={focusWindow}
          onFrame={focusFrame}
          onFile={onLibrarySearchResult}
        />
      </Show>

      <Show when={dialog()}>
        {(current) => (
          <div
            class='fixed inset-0 z-[1300000] flex items-center justify-center bg-black/55 p-4'
            onPointerDown={(event) => event.target === event.currentTarget && setDialog(null)}
          >
            <div
              role='dialog'
              aria-modal='true'
              class='w-full max-w-sm rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl'
            >
              <Show
                when={
                  current().kind === 'new-canvas' ||
                  current().kind === 'rename-canvas' ||
                  current().kind === 'new-frame' ||
                  current().kind === 'rename-frame'
                }
              >
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const value = dialogInput().trim()
                    if (!value) return
                    const valueDialog = current()
                    if (valueDialog.kind === 'new-canvas') createNamedCanvas()
                    else if (valueDialog.kind === 'rename-canvas')
                      renameCanvas(valueDialog.canvasId)
                    else if (valueDialog.kind === 'new-frame') addFrame(valueDialog.point, value)
                    else if (valueDialog.kind === 'rename-frame')
                      applyFrameName(valueDialog.frameId, value)
                    if (valueDialog.kind === 'new-frame' || valueDialog.kind === 'rename-frame') {
                      setDialog(null)
                    }
                  }}
                >
                  <h2 class='text-base font-semibold'>
                    {current().kind === 'new-canvas'
                      ? 'New canvas'
                      : current().kind === 'rename-canvas'
                        ? 'Rename canvas'
                        : current().kind === 'new-frame'
                          ? 'New frame'
                          : 'Rename frame'}
                  </h2>
                  <label class='mt-4 block text-sm text-muted-foreground'>Name</label>
                  <input
                    autofocus
                    aria-label='Name'
                    maxlength={120}
                    class='mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                    value={dialogInput()}
                    onInput={(event) => setDialogInput(event.currentTarget.value)}
                  />
                  <div class='mt-5 flex justify-end gap-2'>
                    <button
                      type='button'
                      class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                      onClick={() => setDialog(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type='submit'
                      class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground'
                    >
                      Save
                    </button>
                  </div>
                </form>
              </Show>
              <Show when={current().kind === 'delete-canvas'}>
                <h2 class='text-base font-semibold'>Delete canvas?</h2>
                <p class='mt-2 text-sm text-muted-foreground'>
                  “{(current() as Extract<CanvasDialogState, { kind: 'delete-canvas' }>).canvasName}
                  ” will be removed on every synced device. Underlying files remain untouched.
                </p>
                <div class='mt-5 flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                    onClick={() => setDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    class='h-9 rounded-md bg-destructive px-3 text-sm text-white'
                    onClick={() =>
                      deleteCanvas(
                        (current() as Extract<CanvasDialogState, { kind: 'delete-canvas' }>)
                          .canvasId,
                      )
                    }
                  >
                    Delete canvas
                  </button>
                </div>
              </Show>
              <Show when={current().kind === 'delete-frame'}>
                <h2 class='text-base font-semibold'>Delete frame?</h2>
                <p class='mt-2 text-sm text-muted-foreground'>
                  Windows in “
                  {(current() as Extract<CanvasDialogState, { kind: 'delete-frame' }>).frameName}”
                  will move to top level. Files remain untouched.
                </p>
                <div class='mt-5 flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                    onClick={() => setDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    class='h-9 rounded-md bg-destructive px-3 text-sm text-white'
                    onClick={() => {
                      deleteFrameNow(
                        (current() as Extract<CanvasDialogState, { kind: 'delete-frame' }>).frameId,
                      )
                      setDialog(null)
                    }}
                  >
                    Delete frame
                  </button>
                </div>
              </Show>
              <Show when={current().kind === 'reset-canvas'}>
                <h2 class='text-base font-semibold'>Reset local canvas?</h2>
                <p class='mt-2 text-sm text-muted-foreground'>
                  Frames and canvas windows will be removed. Underlying files remain untouched.
                </p>
                <div class='mt-5 flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                    onClick={() => setDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    class='h-9 rounded-md bg-destructive px-3 text-sm text-white'
                    onClick={() => {
                      resetCanvasNow()
                      setDialog(null)
                    }}
                  >
                    Reset canvas
                  </button>
                </div>
              </Show>
              <Show when={current().kind === 'message'}>
                <h2 class='text-base font-semibold'>Canvas</h2>
                <p class='mt-2 text-sm text-muted-foreground'>
                  {(current() as Extract<CanvasDialogState, { kind: 'message' }>).message}
                </p>
                <div class='mt-5 flex justify-end'>
                  <button
                    type='button'
                    class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground'
                    onClick={() => setDialog(null)}
                  >
                    OK
                  </button>
                </div>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
