import { api } from '@/lib/api/client'
import { createCanvasExport, parseCanvasExport } from '@/canvas/model/canvas-features'
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
  type PersistedCanvas,
} from '@/canvas/model/canvas-persistence'
import {
  getFileDragData,
  hasFileDragData,
  isDirectoryFileDragData,
} from '@/lib/files/file-drag-data'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/files/file-search'
import {
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_WINDOW_HEIGHT,
  CANVAS_MIN_WINDOW_WIDTH,
  CANVAS_MIN_ZOOM,
  CANVAS_STORAGE_KEY,
  canvasWindowVisualBounds,
  cloneInfiniteCanvasState,
  equalInfiniteCanvasState,
  findNearestFreeCanvasRect,
  reconcileInfiniteCanvasState,
  serializeInfiniteCanvasState,
  snapCanvasRect,
  snapCanvasValue,
  type CanvasRect,
  type CanvasWindow,
  type CanvasWindowSize,
  type CanvasWindowSizeKey,
  type InfiniteCanvasState,
} from '@/canvas/model/infinite-canvas'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { queryKeys } from '@/lib/api/query-keys'
import { MediaType, type FileItem } from '@/lib/files/types'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import type { GlobalSettings } from '@/lib/models/settings-types'
import type {
  PersistedWindowState,
  WindowSource,
  WindowDefinition,
} from '@/lib/models/window-model'
import { directoryTitle } from '@/lib/files/directory-title'
import { applyCanvasPathMutation } from '@/canvas/model/canvas-path-mutation'
import type { PathMutation } from '@/lib/files/path-mutation'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import { canCloseHermesWindow, discardHermesDraft } from '@/features/hermes/hermes-session-store'
import { useQuery } from '@tanstack/solid-query'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import Download from 'lucide-solid/icons/download'
import FileText from 'lucide-solid/icons/file-text'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import MoreHorizontal from 'lucide-solid/icons/more-horizontal'
import Pencil from 'lucide-solid/icons/pencil'
import Plus from 'lucide-solid/icons/plus'
import MessageSquare from 'lucide-solid/icons/message-square'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import PanelLeft from 'lucide-solid/icons/panel-left'
import Upload from 'lucide-solid/icons/upload'
import Redo2 from 'lucide-solid/icons/redo-2'
import Search from 'lucide-solid/icons/search'
import Trash2 from 'lucide-solid/icons/trash-2'
import Undo2 from 'lucide-solid/icons/undo-2'
import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import { CanvasSearchPalette } from './CanvasSearchPalette'
import { canvasEdgeAutoPanVelocity } from './canvas-edge-auto-pan'
import { createCanvasPanController } from './create-canvas-pan-controller'
import { bindReadingProgress as bindReadingProgressEvents } from './reading-progress'
import { useAdminEventsStream } from '@/lib/api/use-admin-events-stream'
import { EMPTY_FILE_ICON_CONTEXT, windowIcon } from '@/features/explorer/use-file-icon'
import { ApplicationWindowContent } from '@/features/panes/ApplicationWindowContent'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'

const LOCAL_SOURCE: WindowSource = { kind: 'local', rootPath: null }
const DEFAULT_WINDOW_SIZE: Record<CanvasWindowSizeKey, CanvasWindowSize> = {
  browser: { width: 640, height: 480 },
  viewer: { width: 640, height: 480 },
  hermes: { width: 640, height: 480 },
  'viewer-audio': { width: 576, height: 288 },
  'viewer-video': { width: 800, height: 480 },
  'viewer-image': { width: 640, height: 480 },
  'viewer-text': { width: 768, height: 544 },
  'viewer-pdf': { width: 768, height: 544 },
  'viewer-other': { width: 480, height: 320 },
}
const LIVE_ZOOM = 0.62
const FAR_ZOOM = 0.28
const CANVAS_READING_POSITION_PREFIX = 'canvas-reading-position-v1'

type ContextMenuState = {
  kind: 'canvas'
  clientX: number
  clientY: number
  worldX: number
  worldY: number
}

type Selection = { kind: 'window'; id: string } | null
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type CanvasDialogState =
  | { kind: 'new-canvas' }
  | {
      kind: 'new-note'
      point: { x: number; y: number }
      initialContent: string
    }
  | { kind: 'rename-canvas'; canvasId: string }
  | { kind: 'delete-canvas'; canvasId: string; canvasName: string }
  | { kind: 'shortcuts' }
  | { kind: 'import-canvas' }
  | { kind: 'message'; message: string }
type FileDropPreview = { bounds: CanvasRect }

function cloneState(state: InfiniteCanvasState): InfiniteCanvasState {
  return cloneInfiniteCanvasState(state)
}

function sameState(a: InfiniteCanvasState, b: InfiniteCanvasState): boolean {
  return equalInfiniteCanvasState(a, b)
}

function persistentCanvasRecords(collection: CanvasCollection): PersistedCanvas[] {
  return (JSON.parse(serializeCanvasCollection(collection)) as CanvasCollection).canvases
}

function persistenceSafeCanvasRecords(canvases: PersistedCanvas[]): PersistedCanvas[] {
  return canvases.map((canvas) =>
    canvas.state
      ? { ...canvas, state: JSON.parse(serializeInfiniteCanvasState(canvas.state)) }
      : canvas,
  )
}

function mergeCanvasRecordsWithRuntime(
  local: PersistedCanvas[],
  remote: PersistedCanvas[],
): PersistedCanvas[] {
  const localById = new Map(local.map((canvas) => [canvas.id, canvas]))
  return mergeCanvasRecords(persistenceSafeCanvasRecords(local), remote).map((canvas) => {
    const runtime = localById.get(canvas.id)?.state
    return runtime && canvas.state
      ? { ...canvas, state: reconcileInfiniteCanvasState(runtime, canvas.state) }
      : canvas
  })
}

function canvasWindowDetails(definition: WindowDefinition): {
  kind: string
  path: string | null
} {
  if (definition.type === 'hermes') {
    return {
      kind: definition.hermes?.readOnly ? 'Hermes session · Read only' : 'Hermes session',
      path: definition.hermes?.cwd ?? null,
    }
  }

  const path = definition.initialState.viewing ?? definition.initialState.dir ?? null
  if (definition.type === 'browser') {
    return {
      kind: definition.iconIsVirtual ? 'Collection' : path ? 'Folder' : 'File browser',
      path,
    }
  }
  if (definition.initialState.readerKind === 'folder') {
    return { kind: 'Image folder reader', path }
  }
  if (definition.initialState.readerKind === 'pdf') {
    return { kind: 'PDF reader', path }
  }
  if (definition.initialState.readerKind === 'book') {
    return { kind: 'Book reader', path }
  }

  const kind =
    {
      [MediaType.AUDIO]: 'Audio',
      [MediaType.VIDEO]: 'Video',
      [MediaType.IMAGE]: 'Image',
      [MediaType.TEXT]: 'Document',
      [MediaType.PDF]: 'PDF',
      [MediaType.BOOK]: 'Book',
      [MediaType.FOLDER]: 'Folder',
      [MediaType.OTHER]: 'File',
    }[definition.iconType ?? MediaType.OTHER] ?? 'File'
  return { kind, path }
}

function fileItemFromDrag(path: string, isDirectory: boolean): FileItem {
  const extension = isDirectory ? '' : (path.split('.').at(-1) ?? '')
  return {
    path,
    name: fileNameFromPath(path),
    isDirectory,
    extension,
    size: 0,
    type: isDirectory ? MediaType.FOLDER : getMediaTypeFromPath(path),
  }
}

function mediaWindowSizeKey(mediaType: MediaType): CanvasWindowSizeKey {
  switch (mediaType) {
    case MediaType.AUDIO:
      return 'viewer-audio'
    case MediaType.VIDEO:
      return 'viewer-video'
    case MediaType.IMAGE:
      return 'viewer-image'
    case MediaType.TEXT:
      return 'viewer-text'
    case MediaType.PDF:
    case MediaType.BOOK:
      return 'viewer-pdf'
    case MediaType.FOLDER:
    case MediaType.OTHER:
      return 'viewer-other'
  }
  return 'viewer-other'
}

function windowSizeKey(definition: WindowDefinition): CanvasWindowSizeKey {
  if (definition.type !== 'viewer') return definition.type
  const path = definition.initialState.viewing ?? ''
  return mediaWindowSizeKey(getMediaTypeFromPath(path))
}

function unionRects(rects: CanvasRect[]): CanvasRect {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
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
      onClick={() => props.onClick()}
    >
      {props.children as never}
    </button>
  )
}

function canvasDialogLabel(dialog: CanvasDialogState): string {
  switch (dialog.kind) {
    case 'new-canvas':
      return 'New canvas'
    case 'rename-canvas':
      return 'Edit canvas title'
    case 'new-note':
      return 'New document'
    case 'shortcuts':
      return 'Canvas shortcuts'
    case 'delete-canvas':
      return 'Delete canvas'
    case 'import-canvas':
      return 'Import canvas'
    case 'message':
      return 'Canvas message'
  }
  throw new Error('Unhandled canvas dialog')
}

export function CanvasPage() {
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const browserStorage =
    typeof localStorage === 'undefined'
      ? ({ getItem: () => null } as Pick<Storage, 'getItem'>)
      : localStorage
  const hadLocalCanvas = Boolean(
    browserStorage.getItem(CANVAS_COLLECTION_STORAGE_KEY) ??
    browserStorage.getItem(CANVAS_STORAGE_KEY),
  )
  const loadedCollection = loadCanvasCollection(browserStorage)
  const initialCollection = loadedCollection
  const initialCanvas = initialCollection.canvases.find(
    (item) => item.id === initialCollection.activeId && !item.deleted,
  )!
  const [collection, setCollection] = createSignal<CanvasCollection>(initialCollection)
  const [state, setState] = createSignal<InfiniteCanvasState>(cloneState(initialCanvas.state!))
  useAdminEventsStream(true, applyPathMutation)
  const maximizedWindowId = () => state().maximizedWindowId
  const [undoStack, setUndoStack] = createSignal<InfiniteCanvasState[]>([])
  const [redoStack, setRedoStack] = createSignal<InfiniteCanvasState[]>([])
  const [selection, setSelection] = createSignal<Selection>(null)
  const [selectedIds, setSelectedIds] = createSignal<string[]>([])
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null)
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [searchAnchor, setSearchAnchor] = createSignal<{ x: number; y: number } | null>(null)
  const [overflowOpen, setOverflowOpen] = createSignal(false)
  const [addMenuOpen, setAddMenuOpen] = createSignal(false)
  const [outlineOpen, setOutlineOpen] = createSignal(false)
  const [viewportSize, setViewportSize] = createSignal({ width: 1, height: 1 })
  const [canvasMenuOpen, setCanvasMenuOpen] = createSignal(false)
  const [canvasQuery, setCanvasQuery] = createSignal('')
  const [geometryActive, setGeometryActive] = createSignal(false)
  const [cameraAnimating, setCameraAnimating] = createSignal(false)
  const [dialog, setDialog] = createSignal<CanvasDialogState | null>(null)
  const [dialogInput, setDialogInput] = createSignal('')
  const [noteDirectory, setNoteDirectory] = createSignal('')
  const [fileDropPreview, setFileDropPreview] = createSignal<FileDropPreview | null>(null)
  const [lastAudioWindowId, setLastAudioWindowId] = createSignal<string | null>(null)
  const [syncStatus, setSyncStatus] = createSignal<'saved' | 'saving' | 'error'>('saved')
  const readOnlyMode = () => false
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  let importInputEl: HTMLInputElement | undefined
  let dialogEl: HTMLDivElement | undefined
  let viewportEl: HTMLDivElement | undefined
  let worldEl: HTMLDivElement | undefined
  let animationTimer: number | undefined
  let persistenceTimer: number | undefined
  let syncTimer: number | undefined
  let syncInterval: number | undefined
  let syncRunning = false
  let syncQueued = false
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
  const serverConfigQuery = useQuery(() => ({
    queryKey: queryKeys.serverConfig(),
    queryFn: () => api<{ editableFolders: string[] }>('/api/config'),
    staleTime: Infinity,
  }))
  const editableFolders = createMemo(() => serverConfigQuery.data?.editableFolders ?? [])
  const knowledgeBases = createMemo(() => settingsQuery.data?.knowledgeBases ?? [])
  const writableDirectories = createMemo(() =>
    [...new Set([...knowledgeBases(), ...editableFolders()])].map((path) =>
      path.replace(/\\/g, '/').replace(/\/$/, ''),
    ),
  )
  const fileIconContext = createMemo(() => ({
    ...EMPTY_FILE_ICON_CONTEXT,
    customIcons: settingsQuery.data?.customIcons ?? {},
    knowledgeBases: knowledgeBases(),
  }))
  const fileDropVisualBounds = createMemo(() => {
    const preview = fileDropPreview()
    return preview ? canvasWindowVisualBounds(preview.bounds) : null
  })

  const workspace = createMemo<PersistedWindowState>(() => ({
    windows: state().windows.map((window) => ({
      ...window.definition,
      layout: { ...window.definition.layout, bounds: window.bounds, zIndex: window.zIndex },
    })),
    activeWindowId: selection()?.kind === 'window' ? selection()!.id : null,
    activeTabMap: {},
    nextWindowId: state().nextItemId,
    pinnedTaskbarItems: [],
  }))

  const activeCanvas = createMemo(() =>
    collection().canvases.find((item) => item.id === collection().activeId && !item.deleted),
  )
  const availableCanvases = createMemo(() => collection().canvases.filter((item) => !item.deleted))
  const filteredCanvases = createMemo(() => {
    const query = canvasQuery().trim().toLocaleLowerCase()
    const canvases = [...availableCanvases()].sort((a, b) => b.updatedAt - a.updatedAt)
    return query
      ? canvases.filter((item) => item.name.toLocaleLowerCase().includes(query))
      : canvases
  })

  createEffect(() => {
    const current = dialog()
    if (!current) return
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    queueMicrotask(() => {
      const focusable = dialogEl?.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]',
      )
      focusable?.focus()
    })
    const handleDialogKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDialog(null)
        return
      }
      if (event.key !== 'Tab' || !dialogEl) return
      const focusable = [
        ...dialogEl.querySelectorAll<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]',
        ),
      ].filter((element) => element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeydown)
    onCleanup(() => {
      document.removeEventListener('keydown', handleDialogKeydown)
      queueMicrotask(() => {
        if (previousFocus?.isConnected) previousFocus.focus()
        else document.querySelector<HTMLElement>('[data-testid="canvas-name-trigger"]')?.focus()
      })
    })
  })

  function storeCollection(next: CanvasCollection) {
    localStorage.setItem(CANVAS_COLLECTION_STORAGE_KEY, serializeCanvasCollection(next))
    localStorage.setItem(CANVAS_STORAGE_KEY, serializeInfiniteCanvasState(state()))
  }

  function persistActiveState(): CanvasCollection {
    if (readOnlyMode()) return collection()
    const liveState = state()
    let result = collection()
    setCollection((current) => {
      const active = current.canvases.find((item) => item.id === current.activeId && !item.deleted)
      if (!active || (active.state && sameState(active.state, liveState))) {
        result = current
        return current
      }
      const persistentChanged =
        !active.state ||
        serializeInfiniteCanvasState(active.state) !== serializeInfiniteCanvasState(liveState)
      const updatedAt = persistentChanged ? nextCanvasTimestamp(current) : active.updatedAt
      result = {
        ...current,
        lastTimestamp: persistentChanged ? updatedAt : current.lastTimestamp,
        canvases: current.canvases.map((item) =>
          item.id === current.activeId
            ? {
                ...item,
                state: cloneState(liveState),
                ...(persistentChanged ? { updatedAt, writerId: current.writerId } : {}),
              }
            : item,
        ),
      }
      return result
    })
    storeCollection(result)
    return result
  }

  function applyPathMutation(mutation: PathMutation) {
    const current = collection()
    const currentState = state()
    const activeState = applyCanvasPathMutation(currentState, mutation)
    let lastTimestamp = current.lastTimestamp
    let changed = false
    const canvases = current.canvases.map((canvas) => {
      if (!canvas.state || canvas.deleted) return canvas
      const source = canvas.id === current.activeId ? currentState : canvas.state
      const nextState =
        canvas.id === current.activeId ? activeState : applyCanvasPathMutation(source, mutation)
      if (nextState === source) return canvas
      changed = true
      const updatedAt = nextCanvasTimestamp({ ...current, lastTimestamp })
      lastTimestamp = updatedAt
      return { ...canvas, state: nextState, updatedAt, writerId: current.writerId }
    })
    if (!changed) return
    const next = { ...current, lastTimestamp, canvases }
    setState(activeState)
    setCollection(next)
    setUndoStack([])
    setRedoStack([])
    setSelection((selection) =>
      selection?.kind === 'window' &&
      !activeState.windows.some((window) => window.id === selection.id)
        ? null
        : selection,
    )
    setSelectedIds((ids) =>
      ids.filter((id) => activeState.windows.some((window) => window.id === id)),
    )
    storeCollection(next)
    scheduleSync(50)
  }

  function scheduleSync(delay = 700) {
    if (readOnlyMode()) return
    setSyncStatus('saving')
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = undefined
      void syncCanvases()
    }, delay)
  }

  async function syncCanvases(pullFirst = false) {
    if (syncRunning) {
      syncQueued = true
      return
    }
    syncRunning = true
    setSyncStatus('saving')
    try {
      let current = persistActiveState()
      if (pullFirst) {
        const pulled = await api<{ canvases: unknown[] }>('/api/canvases')
        const remote = parseCanvasRecords(pulled.canvases)
        const remoteActive = remote
          .filter((item) => !item.deleted)
          .sort((a, b) => compareCanvasRecords(b, a))[0]
        if (!hadLocalCanvas && remoteActive) {
          const nextActiveState = reconcileInfiniteCanvasState(state(), remoteActive.state!)
          current = {
            ...current,
            activeId: remoteActive.id,
            lastTimestamp: Math.max(current.lastTimestamp, remoteActive.updatedAt),
            canvases: remote.map((canvas) =>
              canvas.id === remoteActive.id ? { ...canvas, state: nextActiveState } : canvas,
            ),
          }
          setCollection(current)
          setState(nextActiveState)
          setUndoStack([])
          setRedoStack([])
        } else {
          current = {
            ...current,
            canvases: mergeCanvasRecordsWithRuntime(current.canvases, remote),
          }
          setCollection(current)
        }
      }
      if (readOnlyMode()) {
        setSyncStatus('saved')
        return
      }
      const response = await api<{ canvases: unknown[] }>('/api/canvases/sync', {
        method: 'POST',
        body: JSON.stringify({ canvases: persistentCanvasRecords(current) }),
      })
      const latest = collection()
      const canvases = mergeCanvasRecordsWithRuntime(
        latest.canvases,
        parseCanvasRecords(response.canvases),
      )
      const previousActive = latest.canvases.find(
        (item) => item.id === latest.activeId && !item.deleted,
      )
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
        const remoteStateWins =
          fallback.id !== latest.activeId || fallback.updatedAt > (previousActive?.updatedAt ?? 0)
        if (
          remoteStateWins &&
          (fallback.id !== latest.activeId ||
            serializeInfiniteCanvasState(fallback.state!) !== serializeInfiniteCanvasState(state()))
        ) {
          setState((activeState) =>
            fallback.id === latest.activeId
              ? reconcileInfiniteCanvasState(activeState, fallback.state!)
              : cloneState(fallback.state!),
          )
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
      setSyncStatus('saved')
    } catch {
      setSyncStatus('error')
    } finally {
      syncRunning = false
      if (syncQueued) {
        syncQueued = false
        scheduleSync(50)
      }
    }
  }

  onMount(() => {
    const oldHtmlOverflow = document.documentElement.style.overflow
    const oldBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const viewport = viewportEl
    const viewportObserver = new ResizeObserver(() => {
      setViewportSize({
        width: viewport?.clientWidth ?? 1,
        height: viewport?.clientHeight ?? 1,
      })
    })
    if (viewport) viewportObserver.observe(viewport)
    viewport?.addEventListener('pointerdown', beginPan, true)
    const dismissContextMenu = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-canvas-context-menu]')) return
      setMenu(null)
      if (!(event.target as HTMLElement | null)?.closest('[data-canvas-picker]')) {
        setCanvasMenuOpen(false)
      }
      if (!(event.target as HTMLElement | null)?.closest('[data-canvas-add]')) setAddMenuOpen(false)
      if (!(event.target as HTMLElement | null)?.closest('[data-canvas-overflow]')) {
        setOverflowOpen(false)
      }
    }
    const clearFileDropPreview = () => setFileDropPreview(null)
    const clearFileDropPreviewAfterDrop = () => queueMicrotask(clearFileDropPreview)
    const persistBeforePageTeardown = () => persistActiveState()
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
      const data = getFileDragData(transfer)
      const sizeKey = data?.virtualOpenTarget
        ? 'hermes'
        : isDirectoryFileDragData(transfer)
          ? 'browser'
          : data
            ? mediaWindowSizeKey(getMediaTypeFromPath(data.path))
            : 'viewer'
      setFileDropPreview(
        fileWindowPlacement(screenToWorld(event.clientX, event.clientY), state(), sizeKey),
      )
    }
    document.addEventListener('pointerdown', dismissContextMenu, true)
    document.addEventListener('dragover', updateFileDropPreview, true)
    document.addEventListener('dragend', clearFileDropPreview, true)
    document.addEventListener('drop', clearFileDropPreviewAfterDrop, true)
    window.addEventListener('blur', clearFileDropPreview)
    window.addEventListener('pagehide', persistBeforePageTeardown)
    syncInterval = window.setInterval(() => void untrack(syncCanvases), 30_000)
    void syncCanvases(true)
    onCleanup(() => {
      viewport?.removeEventListener('pointerdown', beginPan, true)
      viewportObserver.disconnect()
      document.removeEventListener('pointerdown', dismissContextMenu, true)
      document.removeEventListener('dragover', updateFileDropPreview, true)
      document.removeEventListener('dragend', clearFileDropPreview, true)
      document.removeEventListener('drop', clearFileDropPreviewAfterDrop, true)
      window.removeEventListener('blur', clearFileDropPreview)
      window.removeEventListener('pagehide', persistBeforePageTeardown)
      if (syncInterval !== undefined) window.clearInterval(syncInterval)
      document.documentElement.style.overflow = oldHtmlOverflow
      document.body.style.overflow = oldBodyOverflow
    })
  })

  createEffect(() => {
    serializeInfiniteCanvasState(state())
    if (persistenceTimer !== undefined) window.clearTimeout(persistenceTimer)
    persistenceTimer = window.setTimeout(
      () =>
        untrack(() => {
          persistActiveState()
          persistenceTimer = undefined
          scheduleSync()
        }),
      220,
    )
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

  function setMaximizedWindowId(windowId: string | null) {
    setState((current) => {
      const nextId =
        windowId !== null && current.windows.some((window) => window.id === windowId)
          ? windowId
          : null
      return current.maximizedWindowId === nextId
        ? current
        : { ...current, maximizedWindowId: nextId }
    })
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
    setLastAudioWindowId(null)
    setSelection(null)
    setSelectedIds([])
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
    setSelection(null)
    setSelectedIds([])
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
      setSelection(null)
      setSelectedIds([])
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

  function ensureWindowsVisible(windowIds: string[]) {
    const viewport = viewportEl?.getBoundingClientRect()
    if (!viewport) return
    const current = state()
    const bounds = current.windows
      .filter((window) => windowIds.includes(window.id))
      .map((window) => window.bounds)
    if (bounds.length === 0) return
    const padding = 24
    const visible = bounds.every((rect) => {
      const left = rect.x * current.camera.zoom + current.camera.x
      const top = rect.y * current.camera.zoom + current.camera.y
      const right = left + rect.width * current.camera.zoom
      const bottom = top + rect.height * current.camera.zoom
      return (
        left >= padding &&
        top >= padding &&
        right <= viewport.width - padding &&
        bottom <= viewport.height - padding
      )
    })
    if (!visible) fitBounds(unionRects(bounds), 1)
  }

  function clearSelection() {
    setMaximizedWindowId(null)
    setSelection(null)
    setSelectedIds([])
  }

  function selectWindow(windowId: string, additive = false) {
    if (maximizedWindowId() !== windowId) setMaximizedWindowId(null)
    setSelection({ kind: 'window', id: windowId })
    setSelectedIds((current) =>
      additive
        ? current.includes(windowId)
          ? current.filter((id) => id !== windowId)
          : [...current, windowId]
        : [windowId],
    )
  }

  function focusWindow(windowId: string) {
    const item = state().windows.find((candidate) => candidate.id === windowId)
    if (!item) return
    bringToFront(windowId)
    selectWindow(windowId)
    fitBounds(item.bounds, 1)
  }

  function maximizeWindow(windowId: string) {
    if (!state().windows.some((window) => window.id === windowId)) return
    bringToFront(windowId)
    selectWindow(windowId)
    setMaximizedWindowId(windowId)
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

  function placementObstacles(current: InfiniteCanvasState) {
    return [...current.windows.map((window) => window.bounds)]
  }

  function fileWindowPlacement(
    point: { x: number; y: number },
    current: InfiniteCanvasState,
    sizeKey: CanvasWindowSizeKey,
  ): FileDropPreview {
    const size =
      current.windowSizeByType[sizeKey] ??
      (sizeKey.startsWith('viewer-') ? current.windowSizeByType.viewer : undefined) ??
      DEFAULT_WINDOW_SIZE[sizeKey]
    const desired = {
      x: point.x - size.width / 2,
      y: point.y - size.height / 2,
      ...size,
    }
    return {
      bounds: findNearestFreeCanvasRect(desired, placementObstacles(current)),
    }
  }

  function makeDefinition(
    id: string,
    file?: FileItem,
    dir = '',
    readerKind?: 'pdf' | 'folder' | 'book',
  ): WindowDefinition {
    if (!file || (file.isDirectory && !readerKind)) {
      const path = file?.path ?? dir
      return {
        id,
        type: 'browser',
        title: directoryTitle(path),
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
      title: file.name || fileNameFromPath(file.path),
      iconPath: file.path,
      iconType: file.type,
      source: LOCAL_SOURCE,
      initialState: {
        viewing: file.path,
        dir: parentPath(file.path),
        readerKind: readerKind ?? null,
      },
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
    options: {
      duplicate?: boolean
      worldBounds?: CanvasRect
      readerKind?: 'pdf' | 'folder' | 'book'
    } = {},
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
      const definition = makeDefinition(id, file ?? undefined, '', options.readerKind)
      const sizeKey = windowSizeKey(definition)
      const worldBounds =
        options.worldBounds ??
        findNearestFreeCanvasRect(
          {
            ...point,
            ...(current.windowSizeByType[sizeKey] ??
              (sizeKey.startsWith('viewer-') ? current.windowSizeByType.viewer : undefined) ??
              DEFAULT_WINDOW_SIZE[sizeKey]),
          },
          placementObstacles(current),
        )
      const base: CanvasWindow = {
        id,
        definition,
        bounds: worldBounds,
        zIndex: current.nextZIndex,
      }
      return {
        ...current,
        windows: [...current.windows, base],
        nextItemId: current.nextItemId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
    })
    if (createdId) selectWindow(createdId)
    return createdId
  }

  async function addTextEditor(
    point = viewportCenterWorld(),
    content = '',
    requestedTitle = 'Canvas note',
    requestedDirectory = '',
  ) {
    const directory = requestedDirectory || writableDirectories()[0]
    if (!directory) {
      setDialog({
        kind: 'message',
        message: 'Configure an editable folder or knowledge base before creating text files.',
      })
      return false
    }
    const timestamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .replace(/\.\d{3}Z$/, '')
    const safeTitle = requestedTitle.replace(/[<>:"/\\|?*]/g, '-').trim() || 'Canvas note'
    const name = `${safeTitle} ${timestamp}.md`
    const path = `${directory}/${name}`
    try {
      await api('/api/files/create', {
        method: 'POST',
        body: JSON.stringify({ type: 'file', path, content }),
      })
      addFileWindow(
        {
          name,
          path,
          type: MediaType.TEXT,
          size: content.length,
          extension: 'md',
          isDirectory: false,
        },
        point,
      )
      return true
    } catch (error) {
      setDialog({
        kind: 'message',
        message: error instanceof Error ? error.message : 'Could not create text file.',
      })
      return false
    }
  }

  function openNoteComposer(
    point = viewportCenterWorld(),
    initialContent = '',
    requestedTitle = 'Canvas note',
  ) {
    if (!writableDirectories().length) {
      setDialog({
        kind: 'message',
        message: 'Configure an editable folder or knowledge base before creating text files.',
      })
      return
    }
    setDialogInput(requestedTitle)
    setNoteDirectory(writableDirectories()[0] ?? '')
    setDialog({ kind: 'new-note', point, initialContent })
  }

  async function createDocumentFromComposer(
    value: Extract<CanvasDialogState, { kind: 'new-note' }>,
  ) {
    setDialog(null)
    await addTextEditor(value.point, value.initialContent, dialogInput(), noteDirectory())
  }

  function readingPositionKey(windowId: string) {
    const item = state().windows.find((window) => window.id === windowId)
    const path = item?.definition.initialState.viewing
    return path ? `${CANVAS_READING_POSITION_PREFIX}:${collection().activeId}:${path}` : null
  }

  function bindReadingProgress(element: HTMLDivElement, windowId: string) {
    onCleanup(
      bindReadingProgressEvents({
        element,
        key: () => readingPositionKey(windowId),
      }),
    )
  }

  function deleteSelected() {
    const ids = new Set(selectedIds())
    if (!ids.size) return
    const targets = state().windows.filter((item) => ids.has(item.id))
    if (targets.some((item) => !canCloseHermesWindow(item.definition.hermes))) return
    commit((current) => {
      const removed = new Set(
        current.windows.filter((item) => ids.has(item.id)).map((item) => item.id),
      )
      const windows = current.windows.filter((item) => !removed.has(item.id))
      return { ...current, windows }
    })
    for (const target of targets) discardHermesDraft(target.definition.hermes)
    clearSelection()
  }

  function nudgeSelected(dx: number, dy: number, resize = false) {
    const ids = new Set(selectedIds())
    if (!ids.size) return
    commit((current) => {
      const windows = current.windows.map((item) => {
        if (!ids.has(item.id)) return item
        const bounds = item.bounds
        const next = snapCanvasRect({
          ...bounds,
          ...(resize
            ? { width: bounds.width + dx, height: bounds.height + dy }
            : { x: bounds.x + dx, y: bounds.y + dy }),
        })
        return { ...item, bounds: next }
      })
      return { ...current, windows }
    })
  }

  function exportCanvas() {
    const bundle = createCanvasExport(activeCanvas()?.name ?? 'Canvas', cloneState(state()))
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(activeCanvas()?.name ?? 'canvas').replace(/[^a-z0-9._-]+/gi, '-')}.canvas.json`
    link.click()
    URL.revokeObjectURL(url)
    setOverflowOpen(false)
  }

  async function importCanvasFile(file: File) {
    try {
      const bundle = parseCanvasExport(JSON.parse(await file.text()))
      if (!bundle) throw new Error('Unsupported canvas file')
      const current = persistActiveState()
      const record = createCanvasRecord(current, bundle.name, bundle.state)
      const next = {
        ...current,
        activeId: record.id,
        lastTimestamp: record.updatedAt,
        canvases: [...current.canvases, record],
      }
      setCollection(next)
      setState(cloneState(bundle.state))
      storeCollection(next)
      scheduleSync(50)
      setDialog(null)
    } catch (error) {
      setDialog({
        kind: 'message',
        message: error instanceof Error ? error.message : 'Import failed',
      })
    }
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
    const bounds = source.bounds
    const createdId = addFileWindow(
      file,
      { x: bounds.x + bounds.width + CANVAS_GRID_SIZE, y: bounds.y },
      { duplicate },
    )
    if (createdId)
      queueMicrotask(() => untrack(() => ensureWindowsVisible([sourceWindowId, createdId])))
  }

  function openReaderFromBrowser(sourceWindowId: string, file: FileItem) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source || !file.isDirectory) return
    const createdId = addFileWindow(
      file,
      { x: source.bounds.x + source.bounds.width + CANVAS_GRID_SIZE, y: source.bounds.y },
      { duplicate: true, readerKind: 'folder' },
    )
    if (createdId)
      queueMicrotask(() => untrack(() => ensureWindowsVisible([sourceWindowId, createdId])))
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
    const sourceBounds = source.bounds
    addHermesWindow(file, target, {
      x: sourceBounds.x + sourceBounds.width + CANVAS_GRID_SIZE,
      y: sourceBounds.y,
    })
  }

  function addHermesWindow(
    file: FileItem,
    target: VirtualOpenTarget,
    point: { x: number; y: number },
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
        return existing.id
      }
    }
    let createdId = ''
    commit((current) => {
      const id = `canvas-window-${current.nextItemId}`
      createdId = id
      const definition: WindowDefinition = {
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
        {
          ...point,
          ...(current.windowSizeByType.hermes ?? DEFAULT_WINDOW_SIZE.hermes),
        },
        placementObstacles(current),
      )
      const bounds = requestedBounds ?? worldBounds
      const base: CanvasWindow = {
        id,
        definition,
        bounds,
        zIndex: current.nextZIndex,
      }
      return {
        ...current,
        windows: [...current.windows, base],
        nextItemId: current.nextItemId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
    })
    if (createdId) selectWindow(createdId)
    return createdId
  }

  function addBlankHermesWindow(point = viewportCenterWorld()) {
    return addHermesWindow(
      {
        name: 'New AI chat',
        path: 'Hermes Sessions/draft',
        type: MediaType.OTHER,
        size: 0,
        extension: '',
        isDirectory: false,
        isVirtual: true,
      },
      { type: 'hermesDraft', readOnly: false },
      point,
    )
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
    update: (definition: WindowDefinition) => WindowDefinition,
  ) {
    setState((current) => {
      let changed = false
      const windows = current.windows.map((window) => {
        if (window.id !== windowId) return window
        changed = true
        return { ...window, definition: update(window.definition) }
      })
      return changed ? { ...current, windows } : current
    })
  }

  function navigateDir(windowId: string, dir: string) {
    updateDefinition(windowId, (definition) => ({
      ...definition,
      title: directoryTitle(dir),
      iconPath: dir,
      iconType: MediaType.FOLDER,
      initialState: { ...definition.initialState, dir },
    }))
  }

  function updateViewing(windowId: string, path: string) {
    updateDefinition(windowId, (definition) => ({
      ...definition,
      title: fileNameFromPath(path),
      iconPath: path,
      iconType: getMediaTypeFromPath(path),
      initialState: { ...definition.initialState, viewing: path, dir: parentPath(path) },
    }))
  }

  function sizeVideoWindow(windowId: string, videoWidth: number, videoHeight: number) {
    if (videoWidth <= 0 || videoHeight <= 0 || state().windowSizeByType['viewer-video']) return
    setState((current) => {
      const item = current.windows.find((window) => window.id === windowId)
      if (!item) return current
      const world = item.bounds
      const contentHeight = Math.max(320, Math.min(576, world.height - 32))
      const sized = snapCanvasRect({
        ...world,
        width: Math.min(1024, contentHeight * (videoWidth / videoHeight)),
        height: contentHeight + 32,
      })
      return {
        ...current,
        windows: current.windows.map((window) =>
          window.id === windowId ? { ...window, bounds: sized } : window,
        ),
      }
    })
    queueMicrotask(() => untrack(() => ensureWindowsVisible([windowId])))
  }

  function handleAudioActivate(windowId: string) {
    setLastAudioWindowId(windowId)
  }

  function closeWindow(windowId: string) {
    const target = state().windows.find((window) => window.id === windowId)
    if (!canCloseHermesWindow(target?.definition.hermes)) return
    const viewing = target?.definition.initialState.viewing
    if (viewing && playbackSession.getSnapshot().currentItem?.locator === viewing) {
      playbackSession.dispatch({ type: 'stop' })
    }
    if (lastAudioWindowId() === windowId) setLastAudioWindowId(null)
    if (maximizedWindowId() === windowId) setMaximizedWindowId(null)
    commit((current) => ({
      ...current,
      windows: current.windows.filter((window) => window.id !== windowId),
    }))
    discardHermesDraft(target?.definition.hermes)
    setSelectedIds((ids) => ids.filter((id) => id !== windowId))
    if (selection()?.id === windowId) setSelection(null)
  }

  function startWindowMove(windowId: string, event: PointerEvent) {
    if (readOnlyMode()) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    bringToFront(windowId)
    if (!selectedIds().includes(windowId)) selectWindow(windowId)
    const before = cloneState(state())
    const item = before.windows.find((window) => window.id === windowId)
    if (!item) return
    const ids = selectedIds().includes(windowId) ? selectedIds() : [windowId]
    const windowStarts = new Map(
      before.windows
        .filter((window) => ids.includes(window.id))
        .map((window) => [window.id, window.bounds]),
    )
    const startX = event.clientX
    const startY = event.clientY
    const startCamera = before.camera
    let latestX = startX
    let latestY = startY
    let frame: number | undefined
    let previousFrameTime: number | undefined
    setGeometryActive(true)
    const updateWindows = (camera: InfiniteCanvasState['camera']) => {
      const dx = (latestX - startX - (camera.x - startCamera.x)) / camera.zoom
      const dy = (latestY - startY - (camera.y - startCamera.y)) / camera.zoom
      setState((current) => ({
        ...current,
        camera,
        windows: current.windows.map((window) => {
          const start = windowStarts.get(window.id)
          return start
            ? {
                ...window,
                bounds: {
                  ...start,
                  x: snapCanvasValue(start.x + dx),
                  y: snapCanvasValue(start.y + dy),
                },
              }
            : window
        }),
      }))
    }
    const tick = (time: number) => {
      const elapsed = previousFrameTime === undefined ? 0 : Math.min(32, time - previousFrameTime)
      previousFrameTime = time
      const rect = viewportEl?.getBoundingClientRect()
      if (rect && elapsed > 0) {
        const velocity = canvasEdgeAutoPanVelocity(latestX, latestY, rect)
        if (velocity.x || velocity.y) {
          const camera = state().camera
          updateWindows({
            ...camera,
            x: camera.x + velocity.x * (elapsed / 1000),
            y: camera.y + velocity.y * (elapsed / 1000),
          })
        }
      }
      frame = window.requestAnimationFrame(tick)
    }
    const move = (next: PointerEvent) => {
      next.preventDefault()
      latestX = next.clientX
      latestY = next.clientY
      updateWindows(state().camera)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      setGeometryActive(false)
      pushGesture(before, state())
    }
    frame = window.requestAnimationFrame(tick)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
    window.addEventListener('pointercancel', end, { once: true })
    window.addEventListener('blur', end, { once: true })
  }

  function startWindowResize(windowId: string, direction: ResizeDirection, event: PointerEvent) {
    if (readOnlyMode()) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const before = cloneState(state())
    const item = before.windows.find((window) => window.id === windowId)
    if (!item) return
    const start = item.bounds
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
          window.id === windowId ? { ...window, bounds } : window,
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
      const bounds = resized.bounds
      const after = {
        ...current,
        windowSizeByType: {
          ...current.windowSizeByType,
          [windowSizeKey(resized.definition)]: { width: bounds.width, height: bounds.height },
        },
      }
      setState(after)
      pushGesture(before, after)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function beginPan(event: PointerEvent) {
    const allowPrimary = spaceHeld() || event.target === viewportEl
    if (event.button !== 1 && !(allowPrimary && event.button === 0)) return
    setMenu(null)
    panController.begin(event, allowPrimary)
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

  function setZoomFromControl(nextZoom: number) {
    const rect = viewportEl?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, nextZoom)
  }

  function onCanvasContextMenu(event: MouseEvent) {
    event.preventDefault()
    if (readOnlyMode()) return
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

  createEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        openSearch(null)
        return
      }
      if (editableTarget(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        setSpaceHeld(true)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setMaximizedWindowId(null)
        setSelectedIds(state().windows.map((item) => item.id))
      } else if (selectedIds().length && event.key.startsWith('Arrow')) {
        event.preventDefault()
        const distance = CANVAS_GRID_SIZE * (event.shiftKey ? 4 : 1)
        nudgeSelected(
          event.key === 'ArrowLeft' ? -distance : event.key === 'ArrowRight' ? distance : 0,
          event.key === 'ArrowUp' ? -distance : event.key === 'ArrowDown' ? distance : 0,
          event.ctrlKey || event.metaKey,
        )
      } else if (event.key === '?') {
        event.preventDefault()
        setDialog({ kind: 'shortcuts' })
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!readOnlyMode() && selectedIds().length) {
          event.preventDefault()
          deleteSelected()
        }
      } else if (event.key === 'Escape') {
        setMenu(null)
        clearSelection()
      }
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    onCleanup(() => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    })
  })

  const selectedWindow = createMemo(() => {
    const selected = selection()
    return selected?.kind === 'window'
      ? state().windows.find((window) => window.id === selected.id)
      : undefined
  })
  const lastAudioWindow = createMemo(() => {
    const stateWindows = state().windows
    const current = playback()
    const audioWindows = stateWindows.filter(
      (window) =>
        window.definition.type === 'viewer' &&
        getMediaTypeFromPath(window.definition.initialState.viewing ?? '') === MediaType.AUDIO,
    )
    const currentWindow =
      current.mode === 'audio' && current.currentItem
        ? stateWindows.find(
            (window) =>
              window.definition.type === 'viewer' &&
              window.definition.initialState.viewing === current.currentItem?.locator,
          )
        : undefined
    const id = lastAudioWindowId()
    return (
      currentWindow ??
      audioWindows.find((window) => window.id === id) ??
      audioWindows.reduce<CanvasWindow | undefined>(
        (latest, window) => (!latest || window.zIndex > latest.zIndex ? window : latest),
        undefined,
      )
    )
  })

  return (
    <div class='canvas-layout fixed inset-0 flex select-none flex-col overflow-hidden bg-background text-foreground'>
      <header class='relative z-[100000] flex h-12 shrink-0 items-center border-b border-border bg-card/95 px-2 shadow-sm backdrop-blur'>
        <div class='mr-2 flex h-8 shrink-0 items-center border-r border-border pr-2'>
          <button
            type='button'
            title='Canvas outline'
            aria-label='Canvas outline'
            class='inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
            onClick={() => setOutlineOpen((open) => !open)}
          >
            <PanelLeft class='size-4' />
          </button>
        </div>
        <div class='relative min-w-0' data-canvas-picker>
          <button
            type='button'
            data-testid='canvas-name-trigger'
            class='max-w-[32vw] truncate rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-muted sm:max-w-56'
            onClick={() => setCanvasMenuOpen((open) => !open)}
          >
            {activeCanvas()?.name ?? 'Canvas'}
          </button>
          <Show when={canvasMenuOpen()}>
            <div class='absolute top-10 left-0 w-80 rounded-lg border border-border bg-popover p-1 shadow-xl'>
              <div class='border-b border-border p-1.5'>
                <input
                  type='search'
                  aria-label='Search canvases'
                  placeholder='Search canvases…'
                  class='h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                  value={canvasQuery()}
                  onInput={(event) => setCanvasQuery(event.currentTarget.value)}
                />
              </div>
              <div class='max-h-72 overflow-auto py-1'>
                <For each={filteredCanvases()}>
                  {(canvas) => (
                    <div
                      data-testid='canvas-list-item'
                      class={`group flex min-h-11 w-full items-center rounded-md text-sm hover:bg-muted ${
                        canvas.id === collection().activeId ? 'bg-muted font-medium' : ''
                      }`}
                    >
                      <button
                        type='button'
                        aria-label={canvas.name}
                        class='min-w-0 flex-1 self-stretch px-2.5 text-left'
                        onClick={() => switchCanvas(canvas.id)}
                      >
                        <span class='block truncate'>{canvas.name}</span>
                      </button>
                      <div
                        data-canvas-row-actions
                        class='pointer-events-none flex shrink-0 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
                      >
                        <button
                          type='button'
                          aria-label={`Rename ${canvas.name}`}
                          title='Rename canvas'
                          class='inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground'
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
                          class='mr-0.5 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
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
        <Show when={selectedWindow()}>
          {(item) => (
            <>
              <ChevronRight class='hidden size-4 text-muted-foreground lg:block' />
              <button
                type='button'
                data-testid='canvas-window-breadcrumb'
                class='hidden max-w-48 truncate rounded px-2 py-1 text-sm hover:bg-muted lg:block'
                onClick={() => focusWindow(item().id)}
              >
                {item().definition.title}
              </button>
            </>
          )}
        </Show>
        <div class='ml-auto flex shrink-0 items-center gap-2'>
          <Show when={syncStatus() === 'error'}>
            <button
              type='button'
              data-testid='canvas-sync-error'
              class='inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-destructive hover:bg-destructive/10'
              title='Canvas is saved locally, but server sync failed'
              onClick={() => void syncCanvases()}
            >
              <CircleAlert class='size-4' />
              <span class='hidden sm:inline'>Sync failed</span>
              <span class='hidden font-medium md:inline'>Retry</span>
            </button>
          </Show>
          <div data-testid='canvas-create-tools' class='flex items-center gap-2'>
            <Show when={!readOnlyMode()}>
              <div class='relative' data-canvas-add>
                <button
                  type='button'
                  data-testid='canvas-add-trigger'
                  class='inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                  aria-label='Add to canvas'
                  title='Add to canvas'
                  aria-expanded={addMenuOpen()}
                  onClick={() => setAddMenuOpen((open) => !open)}
                >
                  <Plus class='size-4' />
                </button>
                <Show when={addMenuOpen()}>
                  <div class='absolute top-10 right-0 w-56 rounded-lg border border-border bg-popover p-1 shadow-xl'>
                    <MenuButton
                      onClick={() => {
                        openNoteComposer()
                        setAddMenuOpen(false)
                      }}
                    >
                      <FileText class='size-4' /> New document
                    </MenuButton>
                    <MenuButton
                      onClick={() => {
                        addFileWindow(null, viewportCenterWorld())
                        setAddMenuOpen(false)
                      }}
                    >
                      <FolderOpen class='size-4' /> File browser
                    </MenuButton>
                    <MenuButton
                      onClick={() => {
                        addBlankHermesWindow()
                        setAddMenuOpen(false)
                      }}
                    >
                      <MessageSquare class='size-4' /> AI chat
                    </MenuButton>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={lastAudioWindow()}>
              {(item) => (
                <button
                  type='button'
                  data-testid='canvas-playing-audio-focus'
                  aria-label={`Focus audio player: ${item().definition.title}`}
                  title={`Focus audio player: ${item().definition.title}`}
                  class='inline-flex size-9 items-center justify-center rounded-md text-primary hover:bg-primary/10'
                  onClick={() => focusWindow(item().id)}
                >
                  <Volume2 class='size-4' />
                </button>
              )}
            </Show>
            <button
              type='button'
              data-testid='canvas-search-trigger'
              aria-label='Search canvas'
              title='Search canvas'
              class='inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
              onClick={() => openSearch(null)}
            >
              <Search class='size-4' />
            </button>
          </div>
          <div
            data-testid='canvas-toolbar-divider'
            class='hidden h-6 w-px shrink-0 bg-border md:block'
          />
          <div data-testid='canvas-history-tools' class='hidden items-center gap-2 md:flex'>
            <button
              type='button'
              title='Undo'
              aria-label='Undo'
              disabled={!undoStack().length}
              class='inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35'
              onClick={undo}
            >
              <Undo2 class='size-4' />
            </button>
            <button
              type='button'
              title='Redo'
              aria-label='Redo'
              disabled={!redoStack().length}
              class='inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35'
              onClick={redo}
            >
              <Redo2 class='size-4' />
            </button>
          </div>
          <div data-testid='canvas-toolbar-divider' class='h-6 w-px shrink-0 bg-border' />
          <div
            data-testid='canvas-overflow-tools'
            data-canvas-overflow
            class='relative flex items-center'
          >
            <button
              type='button'
              title='More'
              aria-label='More canvas actions'
              class='inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
              onClick={() => setOverflowOpen((open) => !open)}
            >
              <MoreHorizontal class='size-4' />
            </button>
            <Show when={overflowOpen()}>
              <div class='absolute top-10 right-0 w-56 rounded-lg border border-border bg-popover p-1 shadow-xl'>
                <div class='md:hidden'>
                  <MenuButton
                    disabled={!undoStack().length}
                    onClick={() => {
                      undo()
                      setOverflowOpen(false)
                    }}
                  >
                    <Undo2 class='size-4' /> Undo
                  </MenuButton>
                  <MenuButton
                    disabled={!redoStack().length}
                    onClick={() => {
                      redo()
                      setOverflowOpen(false)
                    }}
                  >
                    <Redo2 class='size-4' /> Redo
                  </MenuButton>
                </div>
                <div class='my-1 border-t border-border md:hidden' />
                <MenuButton onClick={exportCanvas}>
                  <Download class='size-4' />
                  Export canvas
                </MenuButton>
                <MenuButton
                  onClick={() => {
                    importInputEl?.click()
                    setOverflowOpen(false)
                  }}
                >
                  <Upload class='size-4' />
                  Import canvas
                </MenuButton>
                <div class='my-1 border-t border-border' />
                <MenuButton
                  onClick={() => {
                    setDialog({ kind: 'shortcuts' })
                    setOverflowOpen(false)
                  }}
                >
                  <span class='inline-flex size-4 items-center justify-center font-semibold'>
                    ?
                  </span>
                  Shortcuts
                </MenuButton>
              </div>
            </Show>
          </div>
          <input
            ref={(element) => (importInputEl = element)}
            type='file'
            accept='.json,.canvas.json,application/json'
            class='hidden'
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              if (file) void importCanvasFile(file)
              event.currentTarget.value = ''
            }}
          />
        </div>
      </header>

      <Show when={!maximizedWindowId()}>
        <div
          data-testid='canvas-zoom-control'
          class='fixed right-3 bottom-3 z-[104000] flex h-11 items-center gap-2 rounded-lg border border-border bg-popover/95 px-2 shadow-xl backdrop-blur'
          onWheel={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const direction = Math.sign(event.deltaY || event.deltaX)
            if (direction !== 0) setZoomFromControl(state().camera.zoom - direction * 0.05)
          }}
        >
          <input
            type='range'
            title='Canvas zoom'
            aria-label='Canvas zoom'
            aria-valuetext={`${Math.round(state().camera.zoom * 100)} percent`}
            min={Math.round(CANVAS_MIN_ZOOM * 100)}
            max={Math.round(CANVAS_MAX_ZOOM * 100)}
            step='1'
            value={Math.round(state().camera.zoom * 100)}
            class='[&::-webkit-slider-thumb]:bg-primary h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
            onInput={(event) => setZoomFromControl(event.currentTarget.valueAsNumber / 100)}
          />
          <button
            type='button'
            title='Reset zoom'
            aria-label={`Reset canvas zoom, currently ${Math.round(state().camera.zoom * 100)} percent`}
            class='h-8 min-w-12 rounded-md px-1 text-xs tabular-nums hover:bg-muted'
            onClick={() => zoomBy(1 / state().camera.zoom)}
          >
            {Math.round(state().camera.zoom * 100)}%
          </button>
        </div>
      </Show>

      <Show when={outlineOpen()}>
        <aside class='fixed top-12 bottom-0 left-0 z-[110000] flex w-72 flex-col border-r border-border bg-card/95 shadow-xl backdrop-blur'>
          <div class='flex h-11 items-center justify-between border-b px-3'>
            <span class='text-sm font-semibold'>Canvas outline</span>
            <button
              type='button'
              aria-label='Close canvas outline'
              class='size-8 rounded hover:bg-muted'
              onClick={() => setOutlineOpen(false)}
            >
              <X class='mx-auto size-4' />
            </button>
          </div>
          <div class='min-h-0 flex-1 overflow-auto p-2'>
            <p class='px-2 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>
              Windows
            </p>
            <For each={state().windows}>
              {(item) => (
                <button
                  type='button'
                  class='flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-muted'
                  onClick={() => focusWindow(item.id)}
                >
                  <span class='shrink-0'>
                    {windowIcon(item.definition, fileIconContext(), 'sm')}
                  </span>
                  <span class='truncate'>{item.definition.title}</span>
                </button>
              )}
            </For>
          </div>
        </aside>
      </Show>

      <div
        ref={(element) => (viewportEl = element)}
        data-testid='infinite-canvas'
        class='relative min-h-0 flex-1 overflow-hidden bg-muted/20 outline-none'
        classList={{ 'cursor-grab': spaceHeld(), 'cursor-grabbing': geometryActive() }}
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
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            zoomAt(
              event.clientX,
              event.clientY,
              state().camera.zoom * Math.exp(-event.deltaY * 0.002),
            )
            return
          }
        }}
        onContextMenu={onCanvasContextMenu}
        onDragOver={(event) => {
          if (readOnlyMode()) return
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
          if (readOnlyMode()) return
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
              data.virtualOpenTarget
                ? 'hermes'
                : data.isDirectory
                  ? 'browser'
                  : mediaWindowSizeKey(getMediaTypeFromPath(data.path)),
            )
          setFileDropPreview(null)
          if (data.virtualOpenTarget) {
            addHermesWindow(
              fileItemFromDrag(data.path, false),
              data.virtualOpenTarget,
              point,
              placement.bounds,
            )
            return
          }
          addFileWindow(fileItemFromDrag(data.path, data.isDirectory), point, {
            duplicate: true,
            worldBounds: placement.bounds,
          })
        }}
      >
        <Show when={!readOnlyMode() && !state().windows.length}>
          <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8'>
            <div class='pointer-events-auto max-w-lg rounded-2xl border border-border bg-card/90 p-7 text-center shadow-xl backdrop-blur'>
              <h1 class='text-lg font-semibold'>Build your knowledge canvas</h1>
              <p class='mt-2 text-sm leading-6 text-muted-foreground'>
                Add documents, files, or AI chats.
              </p>
              <div class='mt-5 flex flex-wrap justify-center gap-2'>
                <button
                  type='button'
                  class='rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground'
                  onClick={() => openNoteComposer()}
                >
                  New document
                </button>
                <button
                  type='button'
                  class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
                  onClick={() => addFileWindow(null, viewportCenterWorld())}
                >
                  Browse files
                </button>
                <button
                  type='button'
                  class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
                  onClick={() => addBlankHermesWindow()}
                >
                  Ask AI
                </button>
              </div>
              <button
                type='button'
                class='mt-4 text-xs text-muted-foreground underline'
                onClick={() => setDialog({ kind: 'shortcuts' })}
              >
                View shortcuts
              </button>
            </div>
          </div>
        </Show>
        <div
          ref={(element) => (worldEl = element)}
          data-testid='canvas-world'
          class='absolute top-0 left-0 origin-top-left will-change-transform'
          classList={{ 'transition-transform duration-200 ease-out': cameraAnimating() }}
          style={{
            transform: `translate3d(${state().camera.x}px, ${state().camera.y}px, 0) scale(${state().camera.zoom})`,
          }}
        >
          <For each={state().windows.map((window) => window.id)}>
            {(windowId) => {
              const item = createMemo(() =>
                state().windows.find((window) => window.id === windowId),
              )
              const worldBounds = createMemo(() => item()!.bounds)
              const maximized = () => maximizedWindowId() === windowId
              const visualBounds = createMemo(() => {
                if (!maximized()) return canvasWindowVisualBounds(worldBounds())
                const zoom = state().camera.zoom
                return {
                  x: -state().camera.x / zoom,
                  y: -state().camera.y / zoom,
                  width: viewportSize().width,
                  height: viewportSize().height,
                }
              })
              const selected = () => selectedIds().includes(windowId)
              const details = createMemo(() => canvasWindowDetails(item()!.definition))
              const liveWindowChrome = () => state().camera.zoom >= LIVE_ZOOM || maximized()
              const titlebarHeight = createMemo(() =>
                liveWindowChrome() ? 32 : Math.min(72, Math.max(44, 32 / state().camera.zoom)),
              )
              const actionIconScale = createMemo(() =>
                liveWindowChrome() ? 1 : Math.min(1.6, Math.max(1, 14 / 20 / state().camera.zoom)),
              )
              const summaryMetrics = createMemo(() => {
                const zoom = state().camera.zoom
                const screenWidth = visualBounds().width * zoom
                const screenHeight = (visualBounds().height - titlebarHeight()) * zoom
                const icon = Math.min(28, Math.max(14, screenHeight * 0.22))
                const title = Math.min(20, Math.max(12, screenHeight * 0.17, screenWidth / 24))
                const kind = Math.min(14, Math.max(10, screenHeight * 0.12))
                const path = Math.min(12, Math.max(9, screenHeight * 0.1))
                const gap = Math.min(8, Math.max(3, screenHeight * 0.045))
                const padding = Math.min(
                  16,
                  Math.max(7, Math.min(screenWidth, screenHeight) * 0.07),
                )
                return {
                  iconScale: icon / 20 / zoom,
                  title: title / zoom,
                  kind: kind / zoom,
                  path: path / zoom,
                  gap: gap / zoom,
                  padding: padding / zoom,
                  screenWidth,
                  screenHeight,
                }
              })
              const showSummaryPath = createMemo(
                () =>
                  Boolean(details().path && details().path !== item()!.definition.title) &&
                  summaryMetrics().screenWidth >= 180 &&
                  summaryMetrics().screenHeight >= 145,
              )
              const windowShadow = createMemo(() => {
                const zoom = state().camera.zoom
                const lift = 4 / zoom
                const blur = 14 / zoom
                const focusGlow = selected() ? `, 0 0 ${6 / zoom}px rgba(59, 130, 246, 0.42)` : ''
                return `0 ${lift}px ${blur}px rgba(0, 0, 0, 0.55)${focusGlow}`
              })
              return (
                <div
                  data-testid='canvas-window'
                  data-window-id={windowId}
                  class='absolute overflow-visible bg-background'
                  classList={{
                    'rounded-lg': !maximized(),
                    'border border-border shadow-2xl outline outline-1 -outline-offset-1 outline-border':
                      liveWindowChrome(),
                    'border-border shadow-black/20': liveWindowChrome() && selected(),
                    'invisible pointer-events-none': state().camera.zoom < FAR_ZOOM && !maximized(),
                  }}
                  style={{
                    left: `${visualBounds().x}px`,
                    top: `${visualBounds().y}px`,
                    width: `${visualBounds().width}px`,
                    height: `${visualBounds().height}px`,
                    transform: maximized() ? `scale(${1 / state().camera.zoom})` : undefined,
                    'transform-origin': 'top left',
                    'box-shadow': liveWindowChrome() ? undefined : windowShadow(),
                    'z-index': maximized()
                      ? 2000000
                      : selected()
                        ? 1000000 + item()!.zIndex
                        : item()!.zIndex,
                  }}
                  onPointerDown={(event) => {
                    selectWindow(windowId, event.ctrlKey || event.metaKey || event.shiftKey)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <div
                    data-testid='canvas-window-titlebar'
                    class='flex cursor-grab items-center font-medium select-none active:cursor-grabbing'
                    classList={{
                      'rounded-t-lg': !maximized(),
                      'gap-2 px-2 text-xs': liveWindowChrome(),
                      'border-b border-border': liveWindowChrome(),
                      'bg-muted text-foreground': selected(),
                      'bg-muted/50 text-muted-foreground': liveWindowChrome() && !selected(),
                      'bg-card text-muted-foreground': !liveWindowChrome() && !selected(),
                    }}
                    style={{ height: `${titlebarHeight()}px` }}
                    onPointerDown={(event) => !maximized() && startWindowMove(windowId, event)}
                  >
                    <Show when={liveWindowChrome()} fallback={<span class='flex-1' />}>
                      <span class='shrink-0'>
                        {windowIcon(item()!.definition, fileIconContext(), 'sm')}
                      </span>
                      <span data-testid='canvas-window-title' class='min-w-0 flex-1 truncate'>
                        {item()!.definition.title}
                      </span>
                    </Show>
                    <div class='flex h-full shrink-0 items-center gap-0'>
                      <Show
                        when={maximized()}
                        fallback={
                          <button
                            type='button'
                            class='inline-flex h-full items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                            style={{ width: `${titlebarHeight()}px` }}
                            aria-label={`Maximize ${item()!.definition.title}`}
                            title='Maximize'
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => maximizeWindow(windowId)}
                          >
                            <Show
                              when={liveWindowChrome()}
                              fallback={
                                <span style={{ transform: `scale(${actionIconScale()})` }}>
                                  <Maximize2 class='size-5' stroke-width={2} />
                                </span>
                              }
                            >
                              <Maximize2 class='size-3.5' stroke-width={2} />
                            </Show>
                          </button>
                        }
                      >
                        <button
                          type='button'
                          class='inline-flex h-full items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                          style={{ width: `${titlebarHeight()}px` }}
                          aria-label={`Minimize ${item()!.definition.title}`}
                          title='Minimize'
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setMaximizedWindowId(null)}
                        >
                          <Show
                            when={liveWindowChrome()}
                            fallback={
                              <span style={{ transform: `scale(${actionIconScale()})` }}>
                                <Minimize2 class='size-5' stroke-width={2} />
                              </span>
                            }
                          >
                            <Minimize2 class='size-3.5' stroke-width={2} />
                          </Show>
                        </button>
                      </Show>
                      <Show when={!readOnlyMode()}>
                        <button
                          type='button'
                          class='inline-flex h-full items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                          style={{ width: `${titlebarHeight()}px` }}
                          aria-label={`Close ${item()!.definition.title}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => closeWindow(windowId)}
                        >
                          <Show
                            when={liveWindowChrome()}
                            fallback={
                              <span style={{ transform: `scale(${actionIconScale()})` }}>
                                <X class='size-5' stroke-width={2} />
                              </span>
                            }
                          >
                            <X class='size-3.5' stroke-width={2} />
                          </Show>
                        </button>
                      </Show>
                    </div>
                  </div>
                  <div
                    ref={(element) => bindReadingProgress(element, windowId)}
                    data-canvas-window-content
                    class='absolute right-0 bottom-0 left-0 overflow-hidden text-sm text-muted-foreground'
                    classList={{ 'rounded-b-lg': !maximized() }}
                    style={{ top: `${titlebarHeight()}px` }}
                    onContextMenu={(event) => event.stopPropagation()}
                  >
                    <div
                      class='h-full'
                      classList={{
                        'invisible pointer-events-none':
                          state().camera.zoom < LIVE_ZOOM && !maximized(),
                      }}
                    >
                      <ApplicationWindowContent
                        windowId={() => windowId}
                        definition={() => item()?.definition}
                        windowState={workspace}
                        visible={() => true}
                        active={() => selection()?.id === windowId}
                        editableFolders={() => (readOnlyMode() ? [] : editableFolders())}
                        knowledgeBases={knowledgeBases}
                        fileIconContext={fileIconContext}
                        onNavigateDir={navigateDir}
                        onOpenViewer={(id, file) => openFromBrowser(id, file)}
                        onOpenReader={openReaderFromBrowser}
                        onOpenVirtualTarget={openHermesFromBrowser}
                        onOpenInNewTab={(id, file) =>
                          openFromBrowser(id, fileItemFromDrag(file.path, file.isDirectory), true)
                        }
                        openInNewTabLabel='Open in new canvas window'
                        onRequestPlay={(_source, path) =>
                          openFromBrowser(windowId, fileItemFromDrag(path, false))
                        }
                        autoPlayVideo={false}
                        onOpenFileInNewFloatingWindow={(id, file) =>
                          openFromBrowser(id, file, true)
                        }
                        onUpdateViewing={updateViewing}
                        onVideoMetadataLoaded={(id, width, height) =>
                          sizeVideoWindow(id, width, height)
                        }
                        onAudioActivate={handleAudioActivate}
                        onHermesSessionCreated={bindHermesSession}
                        onHermesTitleChanged={(id, title) =>
                          updateDefinition(id, (definition) => ({ ...definition, title }))
                        }
                      />
                    </div>
                    <Show when={state().camera.zoom < LIVE_ZOOM}>
                      <div
                        class='absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-muted/40 text-center'
                        style={{
                          gap: `${summaryMetrics().gap}px`,
                          padding: `${summaryMetrics().padding}px`,
                        }}
                      >
                        <span
                          data-testid='canvas-window-zoom-icon'
                          class='inline-flex items-center justify-center'
                          style={{ transform: `scale(${summaryMetrics().iconScale})` }}
                        >
                          {windowIcon(item()!.definition, fileIconContext(), 'md')}
                        </span>
                        <p
                          data-testid='canvas-window-zoom-title'
                          class='max-w-full truncate font-semibold leading-[1.15]'
                          style={{ 'font-size': `${summaryMetrics().title}px` }}
                        >
                          {item()!.definition.title}
                        </p>
                        <p
                          data-testid='canvas-window-zoom-kind'
                          class='max-w-full truncate font-semibold leading-[1.15] text-foreground/80'
                          style={{ 'font-size': `${summaryMetrics().kind}px` }}
                        >
                          {details().kind}
                        </p>
                        <Show when={showSummaryPath()}>
                          <p
                            data-testid='canvas-window-zoom-path'
                            class='max-w-full truncate leading-[1.15] text-muted-foreground'
                            style={{ 'font-size': `${summaryMetrics().path}px` }}
                          >
                            {details().path}
                          </p>
                        </Show>
                      </div>
                    </Show>
                  </div>
                  <Show when={selected() && !readOnlyMode() && !maximized()}>
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
                const bounds = canvasWindowVisualBounds(item.bounds)
                const details = canvasWindowDetails(item.definition)
                const metrics = createMemo(() => {
                  const zoom = state().camera.zoom
                  const screenWidth = bounds.width * zoom
                  const screenHeight = bounds.height * zoom
                  const shortSide = Math.min(screenWidth, screenHeight)
                  return {
                    horizontal: screenWidth >= screenHeight * 1.25,
                    iconScale: Math.min(28, Math.max(12, shortSide * 0.2)) / 20 / zoom,
                    title: Math.min(18, Math.max(10, shortSide * 0.14)) / zoom,
                    kind: Math.min(13, Math.max(8, shortSide * 0.1)) / zoom,
                    path: Math.min(11, Math.max(7, shortSide * 0.085)) / zoom,
                    gap: Math.min(12, Math.max(5, shortSide * 0.08)) / zoom,
                    padding: Math.min(16, Math.max(6, shortSide * 0.08)) / zoom,
                    showPath: screenWidth >= 120 && screenHeight >= 70,
                  }
                })
                return (
                  <button
                    type='button'
                    data-testid='canvas-window-summary'
                    data-window-id={item.id}
                    class='absolute overflow-hidden rounded-lg bg-card p-0 text-left shadow-lg'
                    style={{
                      left: `${bounds.x}px`,
                      top: `${bounds.y}px`,
                      width: `${bounds.width}px`,
                      height: `${bounds.height}px`,
                      'z-index': item.zIndex,
                    }}
                    onClick={() => selectWindow(item.id)}
                  >
                    <span
                      data-testid='canvas-window-summary-content'
                      class='absolute inset-0 flex items-center justify-center overflow-hidden text-center'
                      classList={{ 'flex-col': !metrics().horizontal }}
                      style={{
                        width: `${bounds.width}px`,
                        height: `${bounds.height}px`,
                        'box-sizing': 'border-box',
                        gap: `${metrics().gap}px`,
                        padding: `${metrics().padding}px`,
                      }}
                    >
                      <span
                        class='inline-flex shrink-0 items-center justify-center'
                        style={{ transform: `scale(${metrics().iconScale})` }}
                      >
                        {windowIcon(item.definition, fileIconContext(), 'md')}
                      </span>
                      <span class='min-w-0 max-w-full overflow-hidden'>
                        <span
                          data-testid='canvas-window-summary-title'
                          class='block truncate font-semibold leading-[1.15]'
                          style={{ 'font-size': `${metrics().title}px` }}
                        >
                          {item.definition.title}
                        </span>
                        <span
                          class='mt-1 block truncate font-medium leading-[1.15] text-muted-foreground'
                          style={{ 'font-size': `${metrics().kind}px` }}
                        >
                          {details.kind}
                        </span>
                        <Show
                          when={
                            metrics().showPath &&
                            details.path &&
                            details.path !== item.definition.title
                          }
                        >
                          <span
                            class='mt-1 block truncate leading-[1.15] text-muted-foreground'
                            style={{ 'font-size': `${metrics().path}px` }}
                          >
                            {details.path}
                          </span>
                        </Show>
                      </span>
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
                  openNoteComposer({ x: value.worldX, y: value.worldY })
                  setMenu(null)
                }}
              >
                <FileText class='size-4' />
                New document
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
              <MenuButton
                onClick={() => {
                  const value = current() as Extract<ContextMenuState, { kind: 'canvas' }>
                  addBlankHermesWindow({ x: value.worldX, y: value.worldY })
                  setMenu(null)
                }}
              >
                <MessageSquare class='size-4' />
                New AI chat
              </MenuButton>
            </Show>
          </div>
        )}
      </Show>

      <Show when={searchOpen()}>
        <CanvasSearchPalette
          windows={state().windows}
          fileIconContext={fileIconContext()}
          onClose={() => setSearchOpen(false)}
          onWindow={focusWindow}
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
              ref={(element) => (dialogEl = element)}
              role='dialog'
              aria-modal='true'
              aria-labelledby='canvas-dialog-title'
              class='w-full rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl'
              classList={{
                'max-w-lg': current().kind === 'new-note' || current().kind === 'new-canvas',
                'max-w-sm': current().kind !== 'new-note' && current().kind !== 'new-canvas',
              }}
            >
              <span id='canvas-dialog-title' class='sr-only'>
                {canvasDialogLabel(current())}
              </span>
              <Show when={current().kind === 'new-canvas' || current().kind === 'rename-canvas'}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    const value = dialogInput().trim()
                    if (!value) return
                    const valueDialog = current()
                    if (valueDialog.kind === 'new-canvas') createNamedCanvas()
                    else if (valueDialog.kind === 'rename-canvas')
                      renameCanvas(valueDialog.canvasId)
                  }}
                >
                  <h2 class='text-base font-semibold'>
                    {current().kind === 'new-canvas' ? 'New canvas' : 'Rename canvas'}
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
              <Show
                when={
                  current().kind === 'new-note'
                    ? (current() as Extract<CanvasDialogState, { kind: 'new-note' }>)
                    : undefined
                }
              >
                {(value) => (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!dialogInput().trim() || !noteDirectory()) return
                      void createDocumentFromComposer(value())
                    }}
                  >
                    <h2 class='text-base font-semibold'>New document</h2>
                    <p class='mt-1 text-xs text-muted-foreground'>
                      Creates a Markdown file and opens it on this canvas.
                    </p>
                    <label class='mt-4 block text-sm text-muted-foreground'>Title</label>
                    <input
                      autofocus
                      aria-label='Document title'
                      maxlength={120}
                      class='mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                      value={dialogInput()}
                      onInput={(event) => setDialogInput(event.currentTarget.value)}
                    />
                    <label class='mt-4 block text-sm text-muted-foreground'>Location</label>
                    <select
                      aria-label='Document location'
                      class='mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                      value={noteDirectory()}
                      onChange={(event) => setNoteDirectory(event.currentTarget.value)}
                    >
                      <For each={writableDirectories()}>
                        {(directory) => <option value={directory}>{directory}</option>}
                      </For>
                    </select>
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
                        class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40'
                        disabled={!dialogInput().trim() || !noteDirectory()}
                      >
                        Create document
                      </button>
                    </div>
                  </form>
                )}
              </Show>
              <Show when={current().kind === 'shortcuts'}>
                <h2 class='text-base font-semibold'>Canvas shortcuts</h2>
                <dl class='mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm'>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Two-finger scroll</kbd>
                  </dt>
                  <dd>Pan canvas background</dd>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Space + drag</kbd>
                  </dt>
                  <dd>Pan canvas</dd>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Ctrl/⌘ + wheel</kbd>
                  </dt>
                  <dd>Zoom at pointer</dd>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Ctrl/⌘ + P</kbd>
                  </dt>
                  <dd>Search</dd>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Ctrl/⌘ + A</kbd>
                  </dt>
                  <dd>Select all</dd>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Arrow keys</kbd>
                  </dt>
                  <dd>Nudge selection; Shift moves faster</dd>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Ctrl/⌘ + arrows</kbd>
                  </dt>
                  <dd>Resize selection</dd>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Delete</kbd>
                  </dt>
                  <dd>Delete selection</dd>
                </dl>
                <div class='mt-5 flex justify-end'>
                  <button
                    type='button'
                    class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground'
                    onClick={() => setDialog(null)}
                  >
                    Done
                  </button>
                </div>
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
