import { api } from '@/lib/api'
import {
  CANVAS_SNAPSHOTS_STORAGE_KEY,
  CANVAS_TEMPLATES,
  buildCanvasContext,
  createCanvasExport,
  createCanvasTemplateState,
  parseCanvasExport,
  parseCanvasSnapshots,
  type CanvasContextContent,
  type CanvasSnapshot,
  type CanvasTemplateKey,
} from '@/lib/canvas-features'
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
  createEmptyCanvasState,
  findNearestFreeCanvasRect,
  parseInfiniteCanvasState,
  reconcileInfiniteCanvasState,
  serializeInfiniteCanvasState,
  snapCanvasRect,
  snapCanvasValue,
  type CanvasCard,
  type CanvasRect,
  type CanvasWindow,
  type CanvasWindowSize,
  type CanvasWindowSizeKey,
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
import {
  canCloseHermesWindow,
  ensureHermesChat,
  hermesSessions,
  setHermesComposer,
} from '@/lib/hermes-session-store'
import { HermesChatPane } from '@/src/workspace/HermesChatPane'
import { useQuery } from '@tanstack/solid-query'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import CircleAlert from 'lucide-solid/icons/circle-alert'
import Copy from 'lucide-solid/icons/copy'
import Download from 'lucide-solid/icons/download'
import FileText from 'lucide-solid/icons/file-text'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Focus from 'lucide-solid/icons/focus'
import Maximize from 'lucide-solid/icons/maximize'
import MoreHorizontal from 'lucide-solid/icons/more-horizontal'
import Pencil from 'lucide-solid/icons/pencil'
import Plus from 'lucide-solid/icons/plus'
import Lock from 'lucide-solid/icons/lock'
import MessageSquare from 'lucide-solid/icons/message-square'
import PanelLeft from 'lucide-solid/icons/panel-left'
import Save from 'lucide-solid/icons/save'
import Upload from 'lucide-solid/icons/upload'
import Redo2 from 'lucide-solid/icons/redo-2'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Search from 'lucide-solid/icons/search'
import Trash2 from 'lucide-solid/icons/trash-2'
import Undo2 from 'lucide-solid/icons/undo-2'
import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { CanvasSearchPalette } from './canvas/CanvasSearchPalette'
import { CanvasCardsLayer } from './canvas/CanvasCardsLayer'
import { createCanvasPanController } from './canvas/create-canvas-pan-controller'
import { useAdminEventsStream } from './lib/use-admin-events-stream'
import { EMPTY_FILE_ICON_CONTEXT, workspaceTabIcon } from './lib/use-file-icon'
import { WorkspaceBrowserPane } from './workspace/WorkspaceBrowserPane'
import { WorkspaceViewerPane } from './workspace/WorkspaceViewerPane'

const LOCAL_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }
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
const AI_DOCUMENT_CHARACTER_LIMIT = 24_000
const AI_TOTAL_CHARACTER_LIMIT = 60_000

type NoteStarterKey = 'blank' | 'meeting' | 'decision' | 'reading' | 'hardware' | 'prompt'

const NOTE_STARTERS: Array<{
  key: NoteStarterKey
  label: string
  content: string
}> = [
  { key: 'blank', label: 'Blank', content: '' },
  {
    key: 'meeting',
    label: 'Meeting notes',
    content: '## Agenda\n\n## Notes\n\n## Actions\n\n- [ ] ',
  },
  { key: 'decision', label: 'Decision', content: '## Decision\n\n## Context\n\n## Consequences\n' },
  {
    key: 'reading',
    label: 'Reading notes',
    content: '## Questions\n\n## Claims\n\n## Evidence\n\n## Quotes\n',
  },
  {
    key: 'hardware',
    label: 'Hardware note',
    content: '## Requirements\n\n## Interfaces\n\n## Validation\n',
  },
  {
    key: 'prompt',
    label: 'Prompt brief',
    content: '## Role\n\n## Goal\n\n## Constraints\n\n## Output format\n\n## Evaluation criteria\n',
  },
]

type CanvasAiContextSource = {
  id: string
  title: string
  detail: string
  status: 'included' | 'reference' | 'failed'
  characters: number
}

type ContextMenuState =
  | { kind: 'canvas'; clientX: number; clientY: number; worldX: number; worldY: number }
  | { kind: 'window'; clientX: number; clientY: number; windowId: string }

type Selection = { kind: 'window'; id: string } | null
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type CanvasDialogState =
  | { kind: 'new-canvas' }
  | { kind: 'new-note'; point: { x: number; y: number }; initialContent: string }
  | {
      kind: 'ai-context'
      instruction: string
      context: string
      sources: CanvasAiContextSource[]
      loading: boolean
    }
  | { kind: 'rename-canvas'; canvasId: string }
  | { kind: 'delete-canvas'; canvasId: string; canvasName: string }
  | { kind: 'reset-canvas' }
  | { kind: 'snapshots' }
  | { kind: 'shortcuts' }
  | { kind: 'import-canvas' }
  | { kind: 'message'; message: string }
type FileDropPreview = { bounds: CanvasRect }

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
      return 'viewer-pdf'
    default:
      return 'viewer-other'
  }
}

function windowSizeKey(definition: WorkspaceWindowDefinition): CanvasWindowSizeKey {
  if (definition.type !== 'viewer') return definition.type
  const path = definition.initialState.viewing ?? ''
  return mediaWindowSizeKey(getMediaType(path.split('.').at(-1) ?? ''))
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
  const loadedCollection = loadCanvasCollection(browserStorage)
  const initialCollection = loadedCollection
  const initialCanvas = initialCollection.canvases.find(
    (item) => item.id === initialCollection.activeId && !item.deleted,
  )!
  const [collection, setCollection] = createSignal<CanvasCollection>(initialCollection)
  const [state, setState] = createSignal<InfiniteCanvasState>(initialCanvas.state!)
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
  const [canvasMenuOpen, setCanvasMenuOpen] = createSignal(false)
  const [geometryActive, setGeometryActive] = createSignal(false)
  const [cameraAnimating, setCameraAnimating] = createSignal(false)
  const [dialog, setDialog] = createSignal<CanvasDialogState | null>(null)
  const [dialogInput, setDialogInput] = createSignal('')
  const [canvasTemplate, setCanvasTemplate] = createSignal<CanvasTemplateKey>('blank')
  const [noteDirectory, setNoteDirectory] = createSignal('')
  const [noteStarter, setNoteStarter] = createSignal<NoteStarterKey>('blank')
  const [fileDropPreview, setFileDropPreview] = createSignal<FileDropPreview | null>(null)
  const [lastAudioWindowId, setLastAudioWindowId] = createSignal<string | null>(null)
  const [syncStatus, setSyncStatus] = createSignal<'saved' | 'saving' | 'offline' | 'error'>(
    'saved',
  )
  const readOnlyMode = () => false
  const [snapshots, setSnapshots] = createSignal<CanvasSnapshot[]>(
    parseCanvasSnapshots(browserStorage.getItem(CANVAS_SNAPSHOTS_STORAGE_KEY)),
  )
  const [connectingFrom, setConnectingFrom] = createSignal<string | null>(null)
  const [viewHistory, setViewHistory] = createSignal<InfiniteCanvasState['camera'][]>([])
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  let importInputEl: HTMLInputElement | undefined
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

  const workspace = createMemo<PersistedWorkspaceState>(() => ({
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

  function storeCollection(next: CanvasCollection) {
    localStorage.setItem(CANVAS_COLLECTION_STORAGE_KEY, serializeCanvasCollection(next))
    localStorage.setItem(CANVAS_STORAGE_KEY, serializeInfiniteCanvasState(state()))
  }

  function persistActiveState(): CanvasCollection {
    if (readOnlyMode()) return collection()
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
    if (readOnlyMode()) return
    setSyncStatus(navigator.onLine === false ? 'offline' : 'saving')
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = undefined
      void syncCanvases()
    }, delay)
  }

  async function syncCanvases(pullFirst = false) {
    if (navigator.onLine === false) {
      setSyncStatus('offline')
      return
    }
    if (syncRunning) {
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
          current = {
            ...current,
            activeId: remoteActive.id,
            lastTimestamp: Math.max(current.lastTimestamp, remoteActive.updatedAt),
            canvases: remote,
          }
          setCollection(current)
          setState((activeState) => reconcileInfiniteCanvasState(activeState, remoteActive.state!))
          setUndoStack([])
          setRedoStack([])
        } else {
          current = { ...current, canvases: mergeCanvasRecords(current.canvases, remote) }
          setCollection(current)
        }
      }
      if (readOnlyMode()) {
        setSyncStatus('saved')
        return
      }
      const response = await api<{ canvases: unknown[] }>('/api/canvases/sync', {
        method: 'POST',
        body: JSON.stringify({ canvases: current.canvases }),
      })
      const latest = collection()
      const canvases = mergeCanvasRecords(latest.canvases, parseCanvasRecords(response.canvases))
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
          serializeInfiniteCanvasState(fallback.state!) !== serializeInfiniteCanvasState(state())
        ) {
          setState((activeState) => reconcileInfiniteCanvasState(activeState, fallback.state!))
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
      if (!(event.target as HTMLElement | null)?.closest('[data-canvas-add]')) setAddMenuOpen(false)
    }
    const clearFileDropPreview = () => setFileDropPreview(null)
    const clearFileDropPreviewAfterDrop = () => queueMicrotask(clearFileDropPreview)
    const persistBeforePageTeardown = () => persistActiveState()
    const syncWhenOnline = () => void syncCanvases()
    const markOffline = () => setSyncStatus('offline')
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
            ? mediaWindowSizeKey(getMediaType(data.path.split('.').at(-1) ?? ''))
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
    window.addEventListener('online', syncWhenOnline)
    window.addEventListener('offline', markOffline)
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
      window.removeEventListener('offline', markOffline)
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
    setLastAudioWindowId(null)
    clearSelection()
    setCanvasMenuOpen(false)
    storeCollection(next)
  }

  function createNamedCanvas() {
    const current = persistActiveState()
    const record = createCanvasRecord(
      current,
      dialogInput(),
      createCanvasTemplateState(canvasTemplate()),
    )
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
    const current = state().camera
    if (current.x !== camera.x || current.y !== camera.y || current.zoom !== camera.zoom) {
      setViewHistory((items) => [...items.slice(-29), current])
    }
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
    setSelection(null)
    setSelectedIds([])
    setConnectingFrom(null)
  }

  function selectWindow(windowId: string, additive = false) {
    setSelection({ kind: 'window', id: windowId })
    setSelectedIds((current) =>
      additive
        ? current.includes(windowId)
          ? current.filter((id) => id !== windowId)
          : [...current, windowId]
        : [windowId],
    )
  }

  function selectCard(cardId: string, additive = false) {
    setSelection(null)
    setSelectedIds((current) =>
      additive
        ? current.includes(cardId)
          ? current.filter((id) => id !== cardId)
          : [...current, cardId]
        : [cardId],
    )
    if (connectingFrom() && connectingFrom() !== cardId) finishConnector(cardId)
  }

  function focusWindow(windowId: string) {
    const item = state().windows.find((candidate) => candidate.id === windowId)
    if (!item) return
    bringToFront(windowId)
    selectWindow(windowId)
    fitBounds(item.bounds, 1)
  }

  function focusCard(cardId: string) {
    const card = state().cards.find((candidate) => candidate.id === cardId)
    if (!card) return
    selectCard(cardId)
    fitBounds(card.bounds, 1.4)
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
    return [
      ...current.windows.map((window) => window.bounds),
      ...current.cards.map((card) => card.bounds),
    ]
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
    options: { duplicate?: boolean; worldBounds?: CanvasRect } = {},
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
      return
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
    } catch (error) {
      setDialog({
        kind: 'message',
        message: error instanceof Error ? error.message : 'Could not create text file.',
      })
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
    setNoteStarter('blank')
    setDialog({ kind: 'new-note', point, initialContent })
  }

  function createDocumentFromComposer(value: Extract<CanvasDialogState, { kind: 'new-note' }>) {
    const starter = NOTE_STARTERS.find((item) => item.key === noteStarter())?.content ?? ''
    const content = value.initialContent || starter
    setDialog(null)
    void addTextEditor(value.point, content, dialogInput(), noteDirectory())
  }

  function addQuickNote(point = viewportCenterWorld(), body = '', title = 'Untitled note') {
    let createdId = ''
    commit((current) => {
      const id = `canvas-card-${current.nextItemId}`
      createdId = id
      const bounds = findNearestFreeCanvasRect(
        { x: point.x - 176, y: point.y - 112, width: 352, height: 224 },
        placementObstacles(current),
      )
      return {
        ...current,
        cards: [
          ...current.cards,
          {
            id,
            kind: 'note',
            title,
            body,
            url: null,
            color: '#6366f1',
            bounds,
            zIndex: current.nextZIndex,
            locked: false,
            tags: [],
          },
        ],
        nextItemId: current.nextItemId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
    })
    if (!createdId) return
    selectCard(createdId)
    queueMicrotask(() => {
      document.querySelector<HTMLTextAreaElement>(`[data-card-id="${createdId}"] textarea`)?.focus()
    })
  }

  function updateCard(
    cardId: string,
    patch: Partial<Pick<CanvasCard, 'title' | 'body' | 'url' | 'tags'>>,
  ) {
    if (readOnlyMode()) return
    setState((current) => {
      const card = current.cards.find((item) => item.id === cardId)
      if (!card) return current
      Object.assign(card, patch)
      return { ...current, cards: [...current.cards] }
    })
  }

  function toggleCardLock(cardId: string) {
    commit((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        card.id === cardId ? { ...card, locked: !card.locked } : card,
      ),
    }))
  }

  function deleteCard(cardId: string) {
    commit((current) => ({
      ...current,
      cards: current.cards.filter((card) => card.id !== cardId),
      connectors: current.connectors.filter(
        (connector) => connector.fromId !== cardId && connector.toId !== cardId,
      ),
    }))
    setSelectedIds((ids) => ids.filter((id) => id !== cardId))
  }

  function toggleConnectorEndpoint(itemId: string) {
    const fromId = connectingFrom()
    if (!fromId) {
      setConnectingFrom(itemId)
      if (!selectedIds().includes(itemId)) setSelectedIds([itemId])
      return
    }
    if (fromId === itemId) {
      setConnectingFrom(null)
      return
    }
    finishConnector(itemId)
  }

  function finishConnector(toId: string) {
    const fromId = connectingFrom()
    if (!fromId || fromId === toId) return
    commit((current) => {
      if (current.connectors.some((item) => item.fromId === fromId && item.toId === toId))
        return current
      return {
        ...current,
        connectors: [
          ...current.connectors,
          {
            id: `canvas-connector-${current.nextItemId}`,
            fromId,
            toId,
            label: '',
            color: '#64748b',
          },
        ],
        nextItemId: current.nextItemId + 1,
      }
    })
    setConnectingFrom(null)
    setSelectedIds([fromId, toId])
  }

  function deleteConnector(connectorId: string) {
    commit((current) => ({
      ...current,
      connectors: current.connectors.filter((connector) => connector.id !== connectorId),
    }))
  }

  function startCardMove(cardId: string, event: PointerEvent) {
    if (readOnlyMode()) return
    if (event.button !== 0) return
    const before = cloneState(state())
    const source = before.cards.find((card) => card.id === cardId)
    if (!source || source.locked) return
    event.preventDefault()
    event.stopPropagation()
    selectCard(cardId, event.ctrlKey || event.metaKey || event.shiftKey)
    const ids = selectedIds().includes(cardId) ? selectedIds() : [cardId]
    const starts = new Map(
      before.cards
        .filter((card) => ids.includes(card.id) && !card.locked)
        .map((card) => [card.id, card.bounds]),
    )
    const startX = event.clientX
    const startY = event.clientY
    const move = (next: PointerEvent) => {
      const dx = snapCanvasValue((next.clientX - startX) / state().camera.zoom)
      const dy = snapCanvasValue((next.clientY - startY) / state().camera.zoom)
      setState((current) => ({
        ...current,
        cards: current.cards.map((card) => {
          const start = starts.get(card.id)
          if (!start) return card
          return { ...card, bounds: { ...start, x: start.x + dx, y: start.y + dy } }
        }),
      }))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      pushGesture(before, state())
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function startCardResize(cardId: string, direction: ResizeDirection, event: PointerEvent) {
    if (readOnlyMode()) return
    if (event.button !== 0) return
    const before = cloneState(state())
    const card = before.cards.find((item) => item.id === cardId)
    if (!card || card.locked) return
    event.preventDefault()
    event.stopPropagation()
    const start = card.bounds
    const startX = event.clientX
    const startY = event.clientY
    const move = (next: PointerEvent) => {
      const bounds = resizeRect(
        start,
        (next.clientX - startX) / state().camera.zoom,
        (next.clientY - startY) / state().camera.zoom,
        direction,
      )
      setState((current) => ({
        ...current,
        cards: current.cards.map((item) => (item.id === cardId ? { ...item, bounds } : item)),
      }))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      pushGesture(before, state())
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function alignSelected(axis: 'left' | 'top') {
    const ids = selectedIds()
    if (ids.length < 2) return
    commit((current) => {
      const rects = [
        ...current.windows
          .filter((item) => ids.includes(item.id))
          .map((item) => [item.id, item.bounds] as const),
        ...current.cards
          .filter((item) => ids.includes(item.id) && !item.locked)
          .map((item) => [item.id, item.bounds] as const),
      ]
      if (rects.length < 2) return current
      const target = Math.min(...rects.map(([, bounds]) => (axis === 'left' ? bounds.x : bounds.y)))
      const byId = new Map(rects)
      return {
        ...current,
        windows: current.windows.map((item) => {
          const bounds = byId.get(item.id)
          if (!bounds) return item
          return { ...item, bounds: { ...bounds, [axis === 'left' ? 'x' : 'y']: target } }
        }),
        cards: current.cards.map((item) => {
          const bounds = byId.get(item.id)
          if (!bounds || item.locked) return item
          return { ...item, bounds: { ...bounds, [axis === 'left' ? 'x' : 'y']: target } }
        }),
      }
    })
  }

  function distributeSelected() {
    const ids = selectedIds()
    if (ids.length < 3) return
    commit((current) => {
      const rects = [
        ...current.windows
          .filter((item) => ids.includes(item.id))
          .map((item) => [item.id, item.bounds] as const),
        ...current.cards
          .filter((item) => ids.includes(item.id) && !item.locked)
          .map((item) => [item.id, item.bounds] as const),
      ].sort((a, b) => a[1].x - b[1].x)
      if (rects.length < 3) return current
      const left = rects[0]![1].x
      const right = rects.at(-1)![1].x
      const step = (right - left) / (rects.length - 1)
      const positions = new Map(
        rects.map(([id], index) => [id, snapCanvasValue(left + index * step)]),
      )
      return {
        ...current,
        windows: current.windows.map((item) => {
          const x = positions.get(item.id)
          if (x === undefined) return item
          return { ...item, bounds: { ...item.bounds, x } }
        }),
        cards: current.cards.map((item) => {
          const x = positions.get(item.id)
          if (x === undefined || item.locked) return item
          return { ...item, bounds: { ...item.bounds, x } }
        }),
      }
    })
  }

  function deleteSelected() {
    const ids = new Set(selectedIds())
    if (!ids.size) return
    commit((current) => {
      const removed = new Set([
        ...current.windows
          .filter((item) => ids.has(item.id) && !item.locked)
          .map((item) => item.id),
        ...current.cards.filter((item) => ids.has(item.id) && !item.locked).map((item) => item.id),
      ])
      const windows = current.windows.filter((item) => !removed.has(item.id))
      const cards = current.cards.filter((item) => !removed.has(item.id))
      return {
        ...current,
        windows,
        cards,
        connectors: current.connectors.filter(
          (item) => !removed.has(item.fromId) && !removed.has(item.toId),
        ),
      }
    })
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
      const cards = current.cards.map((item) => {
        if (!ids.has(item.id) || item.locked) return item
        const bounds = item.bounds
        const next = snapCanvasRect({
          ...bounds,
          ...(resize
            ? { width: bounds.width + dx, height: bounds.height + dy }
            : { x: bounds.x + dx, y: bounds.y + dy }),
        })
        return { ...item, bounds: next }
      })
      return { ...current, windows, cards }
    })
  }

  function toggleSelectedLock() {
    const ids = new Set(selectedIds())
    if (!ids.size) return
    const allLocked = [
      ...state().windows.filter((item) => ids.has(item.id)),
      ...state().cards.filter((item) => ids.has(item.id)),
    ].every((item) => !!item.locked)
    commit((current) => ({
      ...current,
      windows: current.windows.map((item) =>
        ids.has(item.id) ? { ...item, locked: !allLocked } : item,
      ),
      cards: current.cards.map((item) =>
        ids.has(item.id) ? { ...item, locked: !allLocked } : item,
      ),
    }))
  }

  function connectSelected() {
    const ids = selectedIds()
    if (ids.length !== 2) return
    setConnectingFrom(ids[0]!)
    finishConnector(ids[1]!)
  }

  function saveSnapshot(name = `Snapshot ${new Date().toLocaleString()}`) {
    const snapshot: CanvasSnapshot = {
      id: crypto.randomUUID(),
      canvasId: collection().activeId,
      name,
      createdAt: Date.now(),
      state: cloneState(state()),
    }
    const next = [snapshot, ...snapshots()].slice(0, 30)
    setSnapshots(next)
    localStorage.setItem(CANVAS_SNAPSHOTS_STORAGE_KEY, JSON.stringify(next))
  }

  function restoreSnapshot(snapshot: CanvasSnapshot) {
    commit(() => cloneState(snapshot.state))
    setDialog(null)
    clearSelection()
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

  async function prepareAiContext(
    instruction = 'Help me analyze, improve, or continue this work.',
  ) {
    const ids = selectedIds().length
      ? selectedIds()
      : [...state().windows.map((item) => item.id), ...state().cards.map((item) => item.id)]
    setDialog({ kind: 'ai-context', instruction, context: '', sources: [], loading: true })
    const selected = new Set(ids)
    const contents: Record<string, CanvasContextContent> = {}
    const sources: CanvasAiContextSource[] = []
    let remaining = AI_TOTAL_CHARACTER_LIMIT

    for (const card of state().cards.filter((item) => selected.has(item.id))) {
      const allowed = Math.max(0, Math.min(AI_DOCUMENT_CHARACTER_LIMIT, remaining))
      const content = card.body.slice(0, allowed)
      contents[card.id] = { content, truncated: content.length < card.body.length }
      remaining -= content.length
      sources.push({
        id: card.id,
        title: card.title || 'Untitled note',
        detail: contents[card.id]!.truncated ? 'Note content truncated' : 'Note content included',
        status: 'included',
        characters: content.length,
      })
    }

    for (const item of state().windows.filter((window) => selected.has(window.id))) {
      const path = item.definition.initialState.viewing ?? item.definition.initialState.dir ?? ''
      if (item.definition.type === 'hermes' && item.definition.hermes) {
        const key = ensureHermesChat(item.definition.hermes)
        const transcript = (hermesSessions[key]?.messages ?? [])
          .filter((message) => message.text.trim())
          .map(
            (message) => `${message.role === 'assistant' ? 'AI' : 'You'}: ${message.text.trim()}`,
          )
          .join('\n\n')
        const allowed = Math.max(0, Math.min(AI_DOCUMENT_CHARACTER_LIMIT, remaining))
        const content = transcript.slice(0, allowed)
        if (content) {
          contents[item.id] = { content, truncated: content.length < transcript.length }
          remaining -= content.length
        }
        sources.push({
          id: item.id,
          title: item.definition.title,
          detail: content ? 'Chat transcript included' : 'Chat title included',
          status: content ? 'included' : 'reference',
          characters: content.length,
        })
        continue
      }
      if (
        item.definition.type !== 'viewer' ||
        !path ||
        getMediaType(path.split('.').at(-1) ?? '') !== MediaType.TEXT
      ) {
        sources.push({
          id: item.id,
          title: item.definition.title,
          detail: path ? `Reference only: ${path}` : 'Reference only',
          status: 'reference',
          characters: 0,
        })
        continue
      }
      try {
        const response = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`)
        if (!response.ok) throw new Error('Failed to load document')
        const fullContent = await response.text()
        const allowed = Math.max(0, Math.min(AI_DOCUMENT_CHARACTER_LIMIT, remaining))
        const content = fullContent.slice(0, allowed)
        contents[item.id] = { content, truncated: content.length < fullContent.length }
        remaining -= content.length
        sources.push({
          id: item.id,
          title: item.definition.title,
          detail: contents[item.id]!.truncated
            ? `Document truncated: ${path}`
            : `Document included: ${path}`,
          status: 'included',
          characters: content.length,
        })
      } catch {
        sources.push({
          id: item.id,
          title: item.definition.title,
          detail: `Could not load: ${path}`,
          status: 'failed',
          characters: 0,
        })
      }
    }

    setDialog({
      kind: 'ai-context',
      instruction,
      context: buildCanvasContext(state(), ids, contents),
      sources,
      loading: false,
    })
  }

  function sendAiContext(value: Extract<CanvasDialogState, { kind: 'ai-context' }>) {
    const id = addBlankHermesWindow()
    const definition = state().windows.find((item) => item.id === id)?.definition
    if (!definition?.hermes) return
    const key = ensureHermesChat(definition.hermes)
    setHermesComposer(
      key,
      `${value.instruction}\n\nUse following canvas context:\n\n${value.context}`,
    )
    setDialog(null)
    focusWindow(id)
  }

  function captureHermesAsNote(windowId: string) {
    const item = state().windows.find((window) => window.id === windowId)
    if (item?.definition.type !== 'hermes' || !item.definition.hermes) return
    const key = ensureHermesChat(item.definition.hermes)
    const messages = hermesSessions[key]?.messages ?? []
    const transcript = messages
      .filter((message) => message.text.trim())
      .map(
        (message) => `## ${message.role === 'assistant' ? 'AI' : 'You'}\n\n${message.text.trim()}`,
      )
      .join('\n\n---\n\n')
    if (!transcript) {
      setDialog({ kind: 'message', message: 'Chat has no messages to capture yet.' })
      return
    }
    const bounds = item.bounds
    openNoteComposer(
      { x: bounds.x + bounds.width + 208, y: bounds.y + 112 },
      transcript,
      `${item.definition.title} transcript`,
    )
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
    if (createdId) queueMicrotask(() => ensureWindowsVisible([sourceWindowId, createdId]))
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
    queueMicrotask(() => ensureWindowsVisible([windowId]))
  }

  function handleAudioPlay(windowId: string, element: HTMLAudioElement) {
    document.querySelectorAll<HTMLAudioElement>('[data-canvas-audio-player]').forEach((audio) => {
      if (audio !== element && !audio.paused) audio.pause()
    })
    setLastAudioWindowId(windowId)
  }

  function closeWindow(windowId: string) {
    const target = state().windows.find((window) => window.id === windowId)
    if (!canCloseHermesWindow(target?.definition.hermes)) return
    if (lastAudioWindowId() === windowId) setLastAudioWindowId(null)
    commit((current) => ({
      ...current,
      windows: current.windows.filter((window) => window.id !== windowId),
      connectors: current.connectors.filter(
        (connector) => connector.fromId !== windowId && connector.toId !== windowId,
      ),
    }))
    setSelectedIds((ids) => ids.filter((id) => id !== windowId))
    if (selection()?.id === windowId) setSelection(null)
  }

  function duplicateWindow(windowId: string) {
    const source = state().windows.find((window) => window.id === windowId)
    if (!source) return
    if (source.definition.type === 'hermes') {
      focusWindow(windowId)
      return
    }
    const world = source.bounds
    const file =
      source.definition.type === 'browser'
        ? fileItemFromDrag(source.definition.initialState.dir ?? '', true)
        : fileItemFromDrag(source.definition.initialState.viewing ?? '', false)
    addFileWindow(
      file,
      { x: world.x + CANVAS_GRID_SIZE * 2, y: world.y + CANVAS_GRID_SIZE * 2 },
      { duplicate: true },
    )
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
    if (!item || item.locked) return
    const ids = selectedIds().includes(windowId) ? selectedIds() : [windowId]
    const windowStarts = new Map(
      before.windows
        .filter((window) => ids.includes(window.id))
        .map((window) => [window.id, window.bounds]),
    )
    const cardStarts = new Map(
      before.cards
        .filter((card) => ids.includes(card.id) && !card.locked)
        .map((card) => [card.id, card.bounds]),
    )
    const startX = event.clientX
    const startY = event.clientY
    setGeometryActive(true)
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / state().camera.zoom
      const dy = (next.clientY - startY) / state().camera.zoom
      setState((current) => ({
        ...current,
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
        cards: current.cards.map((card) => {
          const start = cardStarts.get(card.id)
          return start
            ? {
                ...card,
                bounds: {
                  ...start,
                  x: snapCanvasValue(start.x + dx),
                  y: snapCanvasValue(start.y + dy),
                },
              }
            : card
        }),
      }))
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      setGeometryActive(false)
      pushGesture(before, state())
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  function startWindowResize(windowId: string, direction: ResizeDirection, event: PointerEvent) {
    if (readOnlyMode()) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const before = cloneState(state())
    const item = before.windows.find((window) => window.id === windowId)
    if (!item || item.locked) return
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
    setViewHistory((items) => [...items.slice(-29), state().camera])
    panController.begin(event, allowPrimary)
  }

  function previousView() {
    const history = viewHistory()
    const camera = history.at(-1)
    if (!camera) return
    setViewHistory(history.slice(0, -1))
    setState((current) => ({ ...current, camera }))
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

  function resetCanvas() {
    setDialog({ kind: 'reset-canvas' })
  }

  function resetCanvasNow() {
    commit(() => createEmptyCanvasState())
    setLastAudioWindowId(null)
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
        setSelectedIds([
          ...state().windows.map((item) => item.id),
          ...state().cards.map((item) => item.id),
        ])
      } else if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault()
        previousView()
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
    const audioWindows = state().windows.filter(
      (window) =>
        window.definition.type === 'viewer' &&
        getMediaType(window.definition.initialState.viewing?.split('.').at(-1) ?? '') ===
          MediaType.AUDIO,
    )
    const id = lastAudioWindowId()
    return (
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
            class='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
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
            <div class='absolute top-10 left-0 w-72 rounded-lg border border-border bg-popover p-1 shadow-xl'>
              <div class='max-h-64 overflow-auto'>
                <For each={availableCanvases()}>
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
                        <span class='block text-[10px] font-normal text-muted-foreground'>
                          {new Date(canvas.updatedAt).toLocaleString()}
                        </span>
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
                  setCanvasTemplate('blank')
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
          <div
            data-testid='canvas-create-tools'
            class='flex items-center rounded-lg border border-border/70 bg-background/50 p-0.5 shadow-sm'
          >
            <Show when={!readOnlyMode()}>
              <div class='relative' data-canvas-add>
                <button
                  type='button'
                  data-testid='canvas-add-trigger'
                  class='inline-flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90'
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
                        addQuickNote()
                        setAddMenuOpen(false)
                      }}
                    >
                      <FileText class='size-4' /> Quick note
                    </MenuButton>
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
                  class='inline-flex size-8 items-center justify-center rounded-md text-primary hover:bg-primary/10'
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
              class='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
              onClick={() => openSearch(null)}
            >
              <Search class='size-4' />
            </button>
          </div>
          <div
            data-testid='canvas-history-tools'
            class='hidden items-center rounded-lg border border-border/70 bg-background/50 p-0.5 shadow-sm md:flex'
          >
            <button
              type='button'
              title='Undo'
              aria-label='Undo'
              disabled={!undoStack().length}
              class='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35'
              onClick={undo}
            >
              <Undo2 class='size-4' />
            </button>
            <button
              type='button'
              title='Redo'
              aria-label='Redo'
              disabled={!redoStack().length}
              class='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35'
              onClick={redo}
            >
              <Redo2 class='size-4' />
            </button>
          </div>
          <div
            data-testid='canvas-overflow-tools'
            class='relative flex items-center rounded-lg border border-border/70 bg-background/50 p-0.5 shadow-sm'
          >
            <button
              type='button'
              title='More'
              aria-label='More canvas actions'
              class='inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
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
                <MenuButton
                  disabled={!viewHistory().length}
                  onClick={() => {
                    previousView()
                    setOverflowOpen(false)
                  }}
                >
                  <ChevronRight class='size-4 rotate-180' /> Previous view
                </MenuButton>
                <div class='my-1 border-t border-border' />
                <MenuButton
                  onClick={() => {
                    saveSnapshot()
                    setOverflowOpen(false)
                  }}
                >
                  <Save class='size-4' />
                  Save snapshot
                </MenuButton>
                <MenuButton
                  onClick={() => {
                    setDialog({ kind: 'snapshots' })
                    setOverflowOpen(false)
                  }}
                >
                  <RotateCcw class='size-4' />
                  Snapshot history
                </MenuButton>
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

      <div class='fixed right-3 bottom-3 z-[104000] flex items-center gap-0.5 rounded-lg border border-border bg-popover/95 p-1 shadow-xl backdrop-blur'>
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
          class='h-8 min-w-12 rounded-md px-1.5 text-xs tabular-nums hover:bg-muted'
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
      </div>

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
              Notes
            </p>
            <For each={state().cards}>
              {(card) => (
                <button
                  type='button'
                  class='flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-muted'
                  onClick={() => focusCard(card.id)}
                >
                  <FileText class='size-4 shrink-0' />
                  <span class='truncate'>{card.title || 'Untitled note'}</span>
                </button>
              )}
            </For>
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
                    {workspaceTabIcon(item.definition, fileIconContext(), 'sm')}
                  </span>
                  <span class='truncate'>{item.definition.title}</span>
                </button>
              )}
            </For>
          </div>
        </aside>
      </Show>

      <Show when={selectedIds().length > 0}>
        <div class='fixed top-14 left-1/2 z-[105000] flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border border-border bg-popover p-1 shadow-xl'>
          <span class='px-2 text-xs text-muted-foreground'>{selectedIds().length} selected</span>
          <Show when={selectedIds().length > 1}>
            <button
              type='button'
              class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted'
              onClick={() => alignSelected('left')}
            >
              Align left
            </button>
            <button
              type='button'
              class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted'
              onClick={() => alignSelected('top')}
            >
              Align top
            </button>
            <button
              type='button'
              class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted disabled:opacity-40'
              disabled={selectedIds().length < 3}
              onClick={distributeSelected}
            >
              Distribute
            </button>
            <button
              type='button'
              class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted disabled:opacity-40'
              disabled={selectedIds().length !== 2}
              onClick={connectSelected}
            >
              Connect
            </button>
          </Show>
          <Show when={selectedIds().length === 1}>
            <button
              type='button'
              class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted'
              onClick={() => toggleConnectorEndpoint(selectedIds()[0]!)}
            >
              {connectingFrom() ? 'Cancel connect' : 'Connect'}
            </button>
          </Show>
          <button
            type='button'
            class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted'
            onClick={toggleSelectedLock}
          >
            Lock/unlock
          </button>
          <button
            type='button'
            class='h-8 shrink-0 rounded bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90'
            onClick={() =>
              void prepareAiContext(
                'Summarize this material. Preserve key decisions, facts, and open questions.',
              )
            }
          >
            Summarize
          </button>
          <button
            type='button'
            class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted'
            onClick={() =>
              void prepareAiContext(
                'Extract concrete tasks. Return a prioritized checklist with owners or dependencies when stated.',
              )
            }
          >
            Tasks
          </button>
          <Show when={selectedIds().length > 1}>
            <button
              type='button'
              class='h-8 shrink-0 rounded px-2 text-xs hover:bg-muted'
              onClick={() =>
                void prepareAiContext(
                  'Compare selected material. Identify agreements, conflicts, gaps, and a recommended synthesis.',
                )
              }
            >
              Compare
            </button>
          </Show>
          <button
            type='button'
            class='h-8 shrink-0 rounded px-2 text-xs text-destructive hover:bg-destructive/10'
            onClick={deleteSelected}
          >
            Delete
          </button>
        </div>
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
        onDblClick={(event) => {
          if (readOnlyMode() || event.target !== event.currentTarget) return
          openNoteComposer(screenToWorld(event.clientX, event.clientY))
        }}
        onPaste={(event) => {
          if (readOnlyMode() || editableTarget(event.target)) return
          const text = event.clipboardData?.getData('text/plain').trim()
          if (!text) return
          event.preventDefault()
          openNoteComposer(viewportCenterWorld(), text, text.split(/\r?\n/, 1)[0]?.slice(0, 40))
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
                  : mediaWindowSizeKey(getMediaType(data.path.split('.').at(-1) ?? '')),
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
        <Show when={!readOnlyMode() && !state().windows.length && !state().cards.length}>
          <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8'>
            <div class='pointer-events-auto max-w-lg rounded-2xl border border-border bg-card/90 p-7 text-center shadow-xl backdrop-blur'>
              <h1 class='text-lg font-semibold'>Build your knowledge canvas</h1>
              <p class='mt-2 text-sm leading-6 text-muted-foreground'>
                Double-click anywhere for a document. Add quick notes, drop files, or ask AI.
              </p>
              <div class='mt-5 flex flex-wrap justify-center gap-2'>
                <button
                  type='button'
                  class='rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground'
                  onClick={() => addQuickNote()}
                >
                  Quick note
                </button>
                <button
                  type='button'
                  class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
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
          <CanvasCardsLayer
            cards={state().cards}
            connectors={state().connectors}
            windows={state().windows}
            selectedIds={selectedIds()}
            connectingFrom={connectingFrom()}
            readOnly={readOnlyMode()}
            onSelect={selectCard}
            onMoveStart={startCardMove}
            onResizeStart={startCardResize}
            onChange={updateCard}
            onToggleLock={toggleCardLock}
            onDelete={deleteCard}
            onConnect={toggleConnectorEndpoint}
            onDeleteConnector={deleteConnector}
          />

          <For each={state().windows.map((window) => window.id)}>
            {(windowId) => {
              const item = createMemo(() =>
                state().windows.find((window) => window.id === windowId),
              )
              const worldBounds = createMemo(() => item()!.bounds)
              const visualBounds = createMemo(() => canvasWindowVisualBounds(worldBounds()))
              const selected = () => selectedIds().includes(windowId)
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
                  onPointerDown={(event) => {
                    selectWindow(windowId, event.ctrlKey || event.metaKey || event.shiftKey)
                    if (connectingFrom() && connectingFrom() !== windowId) finishConnector(windowId)
                  }}
                  onDblClick={() => state().camera.zoom < LIVE_ZOOM && focusWindow(windowId)}
                  onContextMenu={(event) => {
                    if ((event.target as HTMLElement).closest('[data-canvas-window-content]'))
                      return
                    event.preventDefault()
                    event.stopPropagation()
                    if (readOnlyMode()) return
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
                    <Show when={item()!.locked}>
                      <Lock class='size-3.5 text-muted-foreground' />
                    </Show>
                    <Show when={!readOnlyMode()}>
                      <button
                        type='button'
                        class='inline-flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                        aria-label={`Close ${item()!.definition.title}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => closeWindow(windowId)}
                      >
                        <X class='size-3.5' stroke-width={2} />
                      </button>
                    </Show>
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
                          editableFolders={readOnlyMode() ? [] : editableFolders()}
                          onNavigateDir={navigateDir}
                          onOpenViewer={(windowId, file) => openFromBrowser(windowId, file)}
                          onOpenVirtualTarget={openHermesFromBrowser}
                          onOpenInNewTab={(windowId, file) =>
                            openFromBrowser(
                              windowId,
                              fileItemFromDrag(file.path, file.isDirectory),
                              true,
                            )
                          }
                          openInNewTabLabel='Open in new canvas window'
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
                          editableFolders={readOnlyMode() ? [] : editableFolders()}
                          knowledgeBases={knowledgeBases()}
                          shareCanEdit={false}
                          shareCanUpload={false}
                          onUpdateViewing={updateViewing}
                          onVideoMetadataLoaded={(width, height) =>
                            sizeVideoWindow(windowId, width, height)
                          }
                          onAudioPlay={(element) => handleAudioPlay(windowId, element)}
                          showListenOnly={false}
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
                  <Show when={selected() && !readOnlyMode()}>
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
                  addQuickNote({ x: value.worldX, y: value.worldY })
                  setMenu(null)
                }}
              >
                <FileText class='size-4' />
                Quick note
              </MenuButton>
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
                    <Show
                      when={
                        state().windows.find((window) => window.id === windowId)?.definition
                          .type === 'hermes'
                      }
                    >
                      <MenuButton
                        onClick={() => {
                          captureHermesAsNote(windowId)
                          setMenu(null)
                        }}
                      >
                        <FileText class='size-4' />
                        Capture chat as note
                      </MenuButton>
                    </Show>
                    <MenuButton
                      onClick={() => {
                        duplicateWindow(windowId)
                        setMenu(null)
                      }}
                    >
                      <Copy class='size-4' />
                      Open another copy
                    </MenuButton>
                    <MenuButton
                      onClick={() => {
                        setSelectedIds([windowId])
                        toggleSelectedLock()
                        setMenu(null)
                      }}
                    >
                      <Lock class='size-4' />
                      Lock / unlock
                    </MenuButton>
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
          windows={state().windows}
          cards={state().cards}
          fileIconContext={fileIconContext()}
          onClose={() => setSearchOpen(false)}
          onWindow={focusWindow}
          onCard={focusCard}
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
              class='w-full rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl'
              classList={{
                'max-w-2xl': current().kind === 'ai-context',
                'max-w-lg': current().kind === 'new-note' || current().kind === 'new-canvas',
                'max-w-sm':
                  current().kind !== 'ai-context' &&
                  current().kind !== 'new-note' &&
                  current().kind !== 'new-canvas',
              }}
            >
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
                  <Show when={current().kind === 'new-canvas'}>
                    <fieldset class='mt-4'>
                      <legend class='text-sm text-muted-foreground'>Template</legend>
                      <div class='mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3'>
                        <For each={CANVAS_TEMPLATES}>
                          {(template) => (
                            <button
                              type='button'
                              class='rounded-lg border p-2.5 text-left hover:bg-muted'
                              classList={{
                                'border-primary bg-primary/10': canvasTemplate() === template.key,
                              }}
                              onClick={() => setCanvasTemplate(template.key)}
                            >
                              <span class='block text-sm font-medium'>{template.label}</span>
                              <span class='mt-0.5 block text-[11px] leading-4 text-muted-foreground'>
                                {template.description}
                              </span>
                            </button>
                          )}
                        </For>
                      </div>
                    </fieldset>
                  </Show>
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
                      createDocumentFromComposer(value())
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
                    <Show when={!value().initialContent}>
                      <label class='mt-4 block text-sm text-muted-foreground'>Starter</label>
                      <select
                        aria-label='Document starter'
                        class='mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                        value={noteStarter()}
                        onChange={(event) =>
                          setNoteStarter(event.currentTarget.value as NoteStarterKey)
                        }
                      >
                        <For each={NOTE_STARTERS}>
                          {(starter) => <option value={starter.key}>{starter.label}</option>}
                        </For>
                      </select>
                    </Show>
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
              <Show
                when={
                  current().kind === 'ai-context'
                    ? (current() as Extract<CanvasDialogState, { kind: 'ai-context' }>)
                    : undefined
                }
              >
                {(value) => {
                  const context = value
                  return (
                    <>
                      <h2 class='text-base font-semibold'>Review AI context</h2>
                      <p class='mt-1 text-xs text-muted-foreground'>
                        Confirm what AI receives. Text documents and chat transcripts include
                        content; other media remain references.
                      </p>
                      <Show
                        when={!context().loading}
                        fallback={
                          <p class='flex min-h-44 items-center justify-center text-sm text-muted-foreground'>
                            Loading selected materialâ€¦
                          </p>
                        }
                      >
                        <div class='mt-4 max-h-48 space-y-1 overflow-auto rounded-lg border border-border p-2'>
                          <For each={context().sources}>
                            {(source) => (
                              <div class='flex items-start gap-3 rounded-md px-2 py-2 text-sm'>
                                <span
                                  class='mt-1 size-2 shrink-0 rounded-full'
                                  classList={{
                                    'bg-emerald-500': source.status === 'included',
                                    'bg-amber-500': source.status === 'reference',
                                    'bg-destructive': source.status === 'failed',
                                  }}
                                />
                                <span class='min-w-0 flex-1'>
                                  <span class='block truncate font-medium'>{source.title}</span>
                                  <span class='block truncate text-xs text-muted-foreground'>
                                    {source.detail}
                                  </span>
                                </span>
                                <Show when={source.characters > 0}>
                                  <span class='shrink-0 text-[11px] tabular-nums text-muted-foreground'>
                                    {source.characters.toLocaleString()} chars
                                  </span>
                                </Show>
                              </div>
                            )}
                          </For>
                        </div>
                        <div class='mt-3 flex items-center justify-between text-xs text-muted-foreground'>
                          <span>{context().sources.length} sources</span>
                          <span>
                            ~{Math.ceil(context().context.length / 4).toLocaleString()} tokens
                          </span>
                        </div>
                        <details class='mt-3 rounded-lg border border-border'>
                          <summary class='cursor-pointer px-3 py-2 text-sm'>
                            Preview assembled context
                          </summary>
                          <pre class='max-h-48 overflow-auto whitespace-pre-wrap border-t border-border p-3 text-xs select-text'>
                            {context().context}
                          </pre>
                        </details>
                      </Show>
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
                          class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40'
                          disabled={context().loading || !context().context}
                          onClick={() => sendAiContext(context())}
                        >
                          Open in AI chat
                        </button>
                      </div>
                    </>
                  )
                }}
              </Show>
              <Show when={current().kind === 'snapshots'}>
                <h2 class='text-base font-semibold'>Snapshot history</h2>
                <p class='mt-1 text-xs text-muted-foreground'>
                  Local snapshots for current canvas.
                </p>
                <div class='mt-4 max-h-80 space-y-1 overflow-auto'>
                  <Show
                    when={
                      snapshots().filter((item) => item.canvasId === collection().activeId).length
                    }
                    fallback={
                      <p class='py-8 text-center text-sm text-muted-foreground'>
                        No snapshots yet.
                      </p>
                    }
                  >
                    <For
                      each={snapshots().filter((item) => item.canvasId === collection().activeId)}
                    >
                      {(snapshot) => (
                        <button
                          type='button'
                          class='flex w-full items-center rounded-md px-3 py-2 text-left hover:bg-muted'
                          onClick={() => restoreSnapshot(snapshot)}
                        >
                          <span class='min-w-0 flex-1'>
                            <span class='block truncate text-sm font-medium'>{snapshot.name}</span>
                            <span class='block text-xs text-muted-foreground'>
                              {new Date(snapshot.createdAt).toLocaleString()}
                            </span>
                          </span>
                          <RotateCcw class='size-4' />
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
                <div class='mt-5 flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                    onClick={() => setDialog(null)}
                  >
                    Close
                  </button>
                  <button
                    type='button'
                    class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground'
                    onClick={() => saveSnapshot()}
                  >
                    Save snapshot
                  </button>
                </div>
              </Show>
              <Show when={current().kind === 'shortcuts'}>
                <h2 class='text-base font-semibold'>Canvas shortcuts</h2>
                <dl class='mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm'>
                  <dt>
                    <kbd class='rounded border px-1.5 py-0.5'>Double-click</kbd>
                  </dt>
                  <dd>New document at pointer</dd>
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
                    <kbd class='rounded border px-1.5 py-0.5'>Alt + Left</kbd>
                  </dt>
                  <dd>Previous view</dd>
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
              <Show when={current().kind === 'reset-canvas'}>
                <h2 class='text-base font-semibold'>Reset local canvas?</h2>
                <p class='mt-2 text-sm text-muted-foreground'>
                  Notes, relationships, and canvas windows will be removed. Underlying files remain
                  untouched.
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
