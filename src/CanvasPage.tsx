import { getCanvasCollection, putCanvasCollection } from '@/lib/api-canvases'
import { isApiError } from '@/lib/api'
import { createCanvasExport, parseCanvasExport } from '@/lib/canvas-features'
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  clearCanvasCrashDraft,
  createCanvasRecord,
  createDefaultCanvasCollection,
  inspectCanvasCrashDraft,
  serializeCanvasCollection,
  writeCanvasCrashDraft,
  type CanvasCollection,
  type PersistedCanvas,
} from '@/lib/canvas-persistence'
import {
  getFileDragData,
  hasFileDragData,
  isDirectoryFileDragData,
  setFileDragData,
} from '@/lib/file-drag-data'
import {
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_WINDOW_HEIGHT,
  CANVAS_MIN_WINDOW_WIDTH,
  CANVAS_MIN_ZOOM,
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
} from '@/lib/infinite-canvas'
import { serverConfigQueryOptions, settingsQueryOptions } from '@/lib/query-options'
import { MediaType } from '@/lib/types'
import { contentWindowKind, type ContentWindowDefinition } from '@/lib/content-window'
import { applyCanvasPathMutation, type WorkspacePathMutation } from '@/lib/workspace-path-mutation'
import type { ContentInstance } from '@/lib/domain/content'
import {
  filesystemResourceAddress,
  filesystemResourceKey,
  type ResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { ExplorerView } from '@/src/features/explorer/ExplorerView'
import type { ExplorerHostAction } from '@/src/features/explorer/view-types'
import type { ApplicationExplorerPayload } from '@/src/integrations/explorer-adapter'
import { createApplicationExplorerDataSource } from '@/src/integrations/explorer-adapter'
import {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemPathForResourceKey,
  filesystemResourceIsDirectory,
  filesystemResourceMediaType,
} from '@/src/integrations/filesystem/resource'
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
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import Search from 'lucide-solid/icons/search'
import Trash2 from 'lucide-solid/icons/trash-2'
import Undo2 from 'lucide-solid/icons/undo-2'
import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { CanvasSearchPalette } from './canvas/CanvasSearchPalette'
import { canvasEdgeAutoPanVelocity } from './canvas/canvas-edge-auto-pan'
import { createCanvasPanController } from './canvas/create-canvas-pan-controller'
import {
  bindReadingProgress as bindReadingProgressEvents,
  canvasReadingProgressKey,
} from './canvas/reading-progress'
import { useApplicationEventsStream } from './lib/use-application-events-stream'
import {
  EMPTY_FILE_ICON_CONTEXT,
  gridResourceSummaryIcon,
  resourceSummaryIcon,
  workspaceTabIcon,
} from './lib/use-file-icon'
import { FilesystemResourceViewerContent } from './integrations/filesystem/FilesystemResourceViewerContent'
import { ContentRuntimeView } from './features/content/ContentRuntimeView'
import { ContentRecoveryView } from './features/content/ContentRecoveryView'
import { contentRuntimeIdentity } from './features/content/runtime'
import { confirmContentClose } from './features/content/confirm-content-close'
import type { HostOpenPlan } from './features/content/contracts'
import { createCanvasHost } from './features/content/hosts'
import {
  contentInstanceFromCurrentWindow,
  contentWindowFilesystemDirectory,
  contentWindowFilesystemPath,
  contentWindowWithInstance,
  contentWithInstanceId,
} from './integrations/current-window-content'
import { applicationContentRegistry, applicationContentRuntime } from './integrations/registry'
import { FILESYSTEM_RENDERER_ID } from './integrations/filesystem/renderers'
import { createFilesystemFile } from './integrations/filesystem/actions'
import { usePlaybackSession, usePlaybackSnapshot } from './features/playback/PlaybackProvider'
import { filesystemPlaybackItemPath } from './integrations/filesystem/playback'
import { openResource } from './integrations/open-resource'
import type { SearchHit } from './features/search/contracts'
import { executeSearchHit } from './features/search/executor'
import { applicationSearchCoordinator } from './integrations/search'

const DEFAULT_WINDOW_SIZE: Record<CanvasWindowSizeKey, CanvasWindowSize> = {
  browser: { width: 640, height: 480 },
  viewer: { width: 640, height: 480 },
  integration: { width: 640, height: 480 },
  'viewer-audio': { width: 576, height: 288 },
  'viewer-video': { width: 800, height: 480 },
  'viewer-image': { width: 640, height: 480 },
  'viewer-text': { width: 768, height: 544 },
  'viewer-pdf': { width: 768, height: 544 },
  'viewer-other': { width: 480, height: 320 },
}
const LIVE_ZOOM = 0.62
const FAR_ZOOM = 0.28

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
type FileDropPreview = { bounds: CanvasRect; sizeKey: CanvasWindowSizeKey }
type CanvasSyncStatus = 'saved' | 'saving' | 'error' | 'conflict'

type AddFileWindowOptions = Readonly<{
  duplicate?: boolean
  worldBounds?: CanvasRect
  readerKind?: 'pdf' | 'folder' | 'book'
}>

function cloneState(state: InfiniteCanvasState): InfiniteCanvasState {
  return cloneInfiniteCanvasState(state)
}

function sameState(a: InfiniteCanvasState, b: InfiniteCanvasState): boolean {
  return equalInfiniteCanvasState(a, b)
}

function parentPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

function fileName(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1) || path
}

function contentReaderKind(definition: ContentWindowDefinition): 'pdf' | 'folder' | 'book' | null {
  const instance = contentInstanceFromCurrentWindow(definition)
  if (instance?.type !== 'resource') return null
  if (instance.renderer === FILESYSTEM_RENDERER_ID.pdf) return 'pdf'
  if (instance.renderer === FILESYSTEM_RENDERER_ID.folderReader) return 'folder'
  if (instance.renderer === FILESYSTEM_RENDERER_ID.book) return 'book'
  return null
}

function contentMediaType(definition: ContentWindowDefinition): MediaType {
  const instance = contentInstanceFromCurrentWindow(definition)
  if (instance?.type === 'explorer') return MediaType.FOLDER
  if (instance?.type !== 'resource') return MediaType.OTHER
  if (instance.renderer === FILESYSTEM_RENDERER_ID.video) return MediaType.VIDEO
  if (instance.renderer === FILESYSTEM_RENDERER_ID.audio) return MediaType.AUDIO
  if (instance.renderer === FILESYSTEM_RENDERER_ID.image) return MediaType.IMAGE
  if (instance.renderer === FILESYSTEM_RENDERER_ID.text) return MediaType.TEXT
  if (instance.renderer === FILESYSTEM_RENDERER_ID.pdf) return MediaType.PDF
  if (instance.renderer === FILESYSTEM_RENDERER_ID.book) return MediaType.BOOK
  if (instance.renderer === FILESYSTEM_RENDERER_ID.folderReader) return MediaType.FOLDER
  return MediaType.OTHER
}

function explorerLocation(definition: ContentWindowDefinition) {
  const instance = contentInstanceFromCurrentWindow(definition)
  if (instance?.type !== 'explorer')
    throw new Error('Canvas window does not contain Explorer content')
  return { key: instance.location }
}

function resourceContent(definition: ContentWindowDefinition) {
  const instance = contentInstanceFromCurrentWindow(definition)
  return instance?.type === 'resource' ? instance : null
}

function canvasWindowDetails(definition: ContentWindowDefinition): {
  kind: string
  path: string | null
} {
  const content = contentInstanceFromCurrentWindow(definition)
  if (content?.type === 'integration') {
    const presentation = applicationContentRegistry.presentation(content)
    return {
      kind: presentation?.status
        ? `${presentation.title} · ${presentation.status.label}`
        : (presentation?.title ?? 'Integration content'),
      path: presentation?.subtitle ?? null,
    }
  }

  const path = contentWindowFilesystemPath(definition)
  if (contentWindowKind(definition) === 'browser') {
    return {
      kind: path ? 'Folder' : 'Collection',
      path,
    }
  }
  const readerKind = contentReaderKind(definition)
  if (readerKind === 'folder') {
    return { kind: 'Image folder reader', path }
  }
  if (readerKind === 'pdf') {
    return { kind: 'PDF reader', path }
  }
  if (readerKind === 'book') {
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
    }[contentMediaType(definition)] ?? 'File'
  return { kind, path }
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
    default:
      return 'viewer-other'
  }
}

function windowSizeKey(definition: ContentWindowDefinition): CanvasWindowSizeKey {
  const kind = contentWindowKind(definition)
  if (kind !== 'viewer') return kind
  return mediaWindowSizeKey(contentMediaType(definition))
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
}

export function CanvasPage() {
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const browserStorage =
    typeof localStorage === 'undefined'
      ? ({
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        } as Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>)
      : localStorage
  const startupCrashDraft = inspectCanvasCrashDraft(browserStorage)
  const localCandidate =
    startupCrashDraft.kind === 'valid'
      ? {
          schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
          revision: startupCrashDraft.value.baseRevision,
          activeId: startupCrashDraft.value.activeId,
          canvases: startupCrashDraft.value.canvases,
        }
      : createDefaultCanvasCollection()
  const initialCollection = localCandidate
  const initialCanvas = initialCollection.canvases.find(
    (item) => item.id === initialCollection.activeId,
  )!
  const [collection, setCollection] = createSignal<CanvasCollection>(initialCollection)
  const [state, setState] = createSignal<InfiniteCanvasState>(cloneState(initialCanvas.state!))
  useApplicationEventsStream(true, applyPathMutation)
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
  const [dialog, setDialog] = createSignal<CanvasDialogState | null>(null)
  const [dialogInput, setDialogInput] = createSignal('')
  const [noteDirectory, setNoteDirectory] = createSignal('')
  const [fileDropPreview, setFileDropPreview] = createSignal<FileDropPreview | null>(null)
  const [lastAudioWindowId, setLastAudioWindowId] = createSignal<string | null>(null)
  const [syncStatus, setSyncStatus] = createSignal<CanvasSyncStatus>('saved')
  const [corruptDraftRaw, setCorruptDraftRaw] = createSignal<string | null>(
    startupCrashDraft.kind === 'corrupt' ? startupCrashDraft.raw : null,
  )
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  let importInputEl: HTMLInputElement | undefined
  let dialogEl: HTMLDivElement | undefined
  let viewportEl: HTMLDivElement | undefined
  let worldEl: HTMLDivElement | undefined
  let persistenceTimer: number | undefined
  let syncTimer: number | undefined
  let syncRunning = false
  let initializationPromise: Promise<void> | undefined
  let saveAgain = false
  let persistenceReady = false
  let localGeneration = 0
  let acknowledgedGeneration = 0

  function canWriteCrashDraft(): boolean {
    return corruptDraftRaw() === null
  }

  function liveViewportElement() {
    if (viewportEl?.isConnected && viewportEl.clientWidth > 0 && viewportEl.clientHeight > 0) {
      return viewportEl
    }
    if (typeof document === 'undefined') return viewportEl
    const mounted = [
      ...document.querySelectorAll<HTMLDivElement>('[data-testid="infinite-canvas"]'),
    ].find((element) => element.clientWidth > 0 && element.clientHeight > 0)
    if (mounted) viewportEl = mounted
    return mounted ?? viewportEl
  }

  const panController = createCanvasPanController({
    camera: () => state().camera,
    viewport: liveViewportElement,
    world: () => worldEl,
    commit: (camera) => setState((current) => ({ ...current, camera })),
  })

  const settingsQuery = useQuery(settingsQueryOptions)
  const serverConfigQuery = useQuery(serverConfigQueryOptions)
  const editableFolders = createMemo(() => serverConfigQuery.data?.editableFolders ?? [])
  const explorerDataSource = createApplicationExplorerDataSource({ editableFolders })
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

  const activeCanvas = createMemo(() =>
    collection().canvases.find((item) => item.id === collection().activeId),
  )
  const availableCanvases = createMemo(() => collection().canvases)
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

  function persistActiveState(): CanvasCollection {
    const liveState = state()
    let result = collection()
    let changed = false
    setCollection((current) => {
      const active = current.canvases.find((item) => item.id === current.activeId)
      if (
        !active ||
        serializeInfiniteCanvasState(active.state) === serializeInfiniteCanvasState(liveState)
      ) {
        result = current
        return current
      }
      changed = true
      result = {
        ...current,
        canvases: current.canvases.map((item) =>
          item.id === current.activeId
            ? {
                ...item,
                state: cloneState(liveState),
                updatedAt: Date.now(),
              }
            : item,
        ),
      }
      localGeneration += 1
      return result
    })
    if (changed && canWriteCrashDraft()) {
      writeCanvasCrashDraft(browserStorage, result)
    }
    return result
  }

  function sameCanvasContent(left: PersistedCanvas, right: PersistedCanvas): boolean {
    return (
      left.name === right.name &&
      serializeInfiniteCanvasState(left.state) === serializeInfiniteCanvasState(right.state)
    )
  }

  function showCollection(next: CanvasCollection, preserveRuntime = true) {
    const previous = collection()
    const active = next.canvases.find((canvas) => canvas.id === next.activeId)
    if (!active) return
    setCollection(next)
    setState((current) =>
      preserveRuntime && previous.activeId === active.id
        ? reconcileInfiniteCanvasState(current, active.state)
        : cloneState(active.state),
    )
    setUndoStack([])
    setRedoStack([])
    setSelection(null)
    setSelectedIds([])
  }

  function saveCollection(next: CanvasCollection, delay = 50) {
    setCollection(next)
    localGeneration += 1
    if (canWriteCrashDraft()) writeCanvasCrashDraft(browserStorage, next)
    scheduleSync(delay)
  }

  function applyPathMutation(mutation: WorkspacePathMutation) {
    if (persistenceReady && localGeneration === acknowledgedGeneration) {
      void refreshCanvasAfterPathMutation()
      return
    }
    const current = collection()
    const currentState = state()
    const activeState = applyCanvasPathMutation(currentState, mutation)
    let changed = false
    const canvases = current.canvases.map((canvas) => {
      const source = canvas.id === current.activeId ? currentState : canvas.state
      const nextState =
        canvas.id === current.activeId ? activeState : applyCanvasPathMutation(source, mutation)
      if (nextState === source) return canvas
      changed = true
      return { ...canvas, state: nextState, updatedAt: Date.now() }
    })
    if (!changed) return
    const next = { ...current, canvases }
    setState(activeState)
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
    saveCollection(next)
  }

  async function refreshCanvasAfterPathMutation() {
    const generation = localGeneration
    try {
      const remote = await getCanvasCollection()
      if (localGeneration !== generation) return
      showCollection(
        remote.canvases.length > 0
          ? remote
          : { ...createDefaultCanvasCollection(), revision: remote.revision },
      )
      setSyncStatus('saved')
    } catch {
      setSyncStatus('error')
    }
  }

  function scheduleSync(delay = 700) {
    if (syncStatus() === 'conflict' || !canWriteCrashDraft()) return
    setSyncStatus('saving')
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => {
      syncTimer = undefined
      void saveCanvases()
    }, delay)
  }

  function cancelScheduledSync() {
    if (syncTimer === undefined) return
    window.clearTimeout(syncTimer)
    syncTimer = undefined
  }

  function acknowledgeSavedCollection(saved: CanvasCollection, sentGeneration: number) {
    const latest = persistActiveState()
    if (sentGeneration === localGeneration) {
      const runtimeById = new Map(latest.canvases.map((canvas) => [canvas.id, canvas.state]))
      const next = {
        ...saved,
        canvases: saved.canvases.map((canvas) => ({
          ...canvas,
          state: runtimeById.has(canvas.id)
            ? reconcileInfiniteCanvasState(runtimeById.get(canvas.id)!, canvas.state)
            : canvas.state,
        })),
      }
      setCollection(next)
      acknowledgedGeneration = sentGeneration
      clearCanvasCrashDraft(browserStorage)
      return
    }

    const savedById = new Map(saved.canvases.map((canvas) => [canvas.id, canvas]))
    const next: CanvasCollection = {
      ...latest,
      revision: saved.revision,
      canvases: latest.canvases.map((canvas) => {
        const acknowledged = savedById.get(canvas.id)
        return acknowledged && sameCanvasContent(canvas, acknowledged)
          ? { ...canvas, updatedAt: acknowledged.updatedAt }
          : canvas
      }),
    }
    setCollection(next)
    acknowledgedGeneration = sentGeneration
    writeCanvasCrashDraft(browserStorage, next)
    saveAgain = true
  }

  function markCanvasSaveFailure(error: unknown) {
    setSyncStatus(isApiError(error) && error.status === 409 ? 'conflict' : 'error')
  }

  async function saveCanvases() {
    if (!persistenceReady) {
      await initializeCanvasPersistence()
      return
    }
    if (!canWriteCrashDraft()) return
    if (syncStatus() === 'conflict') return
    if (syncRunning) {
      saveAgain = true
      return
    }
    syncRunning = true
    let savedSuccessfully = false
    setSyncStatus('saving')
    try {
      const current = persistActiveState()
      const sentGeneration = localGeneration
      writeCanvasCrashDraft(browserStorage, current)
      const saved = await putCanvasCollection(current)
      acknowledgeSavedCollection(saved, sentGeneration)
      savedSuccessfully = true
      setSyncStatus('saved')
    } catch (error) {
      markCanvasSaveFailure(error)
    } finally {
      syncRunning = false
      const retry = saveAgain && savedSuccessfully
      saveAgain = false
      if (retry) {
        scheduleSync(50)
      }
    }
  }

  async function loadServerAfterConflict() {
    if (syncRunning || !canWriteCrashDraft()) return
    syncRunning = true
    cancelScheduledSync()
    saveAgain = false
    const chosen = persistActiveState()
    const chosenSnapshot = serializeCanvasCollection(chosen)
    writeCanvasCrashDraft(browserStorage, chosen)
    setSyncStatus('saving')
    let saveDefault = false
    try {
      const remote = await getCanvasCollection()
      const latest = persistActiveState()
      if (serializeCanvasCollection(latest) !== chosenSnapshot) {
        cancelScheduledSync()
        setSyncStatus('conflict')
        return
      }
      const selected =
        remote.canvases.length > 0
          ? remote
          : { ...createDefaultCanvasCollection(), revision: remote.revision }
      showCollection(selected, false)
      localGeneration += 1
      acknowledgedGeneration = localGeneration
      clearCanvasCrashDraft(browserStorage)
      if (remote.canvases.length === 0) {
        localGeneration += 1
        writeCanvasCrashDraft(browserStorage, selected)
        saveDefault = true
      }
      setSyncStatus('saved')
    } catch {
      setSyncStatus('conflict')
    } finally {
      syncRunning = false
      saveAgain = false
      if (saveDefault) scheduleSync(0)
    }
  }

  async function keepLocalAfterConflict() {
    if (syncRunning || !canWriteCrashDraft()) return
    syncRunning = true
    cancelScheduledSync()
    saveAgain = false
    setSyncStatus('saving')
    try {
      writeCanvasCrashDraft(browserStorage, persistActiveState())
      const remote = await getCanvasCollection()
      const latest = persistActiveState()
      cancelScheduledSync()
      saveAgain = false
      const rebased = { ...latest, revision: remote.revision }
      setCollection(rebased)
      writeCanvasCrashDraft(browserStorage, rebased)
      const sentGeneration = localGeneration
      const saved = await putCanvasCollection(rebased)
      acknowledgeSavedCollection(saved, sentGeneration)
      setSyncStatus('saved')
    } catch (error) {
      markCanvasSaveFailure(error)
    } finally {
      syncRunning = false
      const retry = saveAgain && syncStatus() === 'saved'
      saveAgain = false
      if (retry) scheduleSync(50)
    }
  }

  function downloadCorruptCrashDraft() {
    const raw = corruptDraftRaw()
    if (raw === null) return
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'canvas-crash-draft.json'
    anchor.click()
    queueMicrotask(() => URL.revokeObjectURL(url))
  }

  function discardCorruptCrashDraft() {
    clearCanvasCrashDraft(browserStorage)
    setCorruptDraftRaw(null)
    if (!persistenceReady) {
      void initializeCanvasPersistence()
      return
    }
    if (syncStatus() === 'conflict') return
    if (localGeneration !== acknowledgedGeneration) scheduleSync(0)
    else setSyncStatus('saved')
  }

  function initializeCanvasPersistence(): Promise<void> {
    if (initializationPromise) return initializationPromise
    const task = (async () => {
      try {
        const remote = await getCanvasCollection()
        persistActiveState()
        const currentDraft = inspectCanvasCrashDraft(browserStorage)
        if (currentDraft.kind === 'corrupt') setCorruptDraftRaw(currentDraft.raw)

        let selected = remote
        let needsSave = false
        if (currentDraft.kind === 'valid') {
          selected = {
            schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
            revision: currentDraft.value.baseRevision,
            activeId: currentDraft.value.activeId,
            canvases: currentDraft.value.canvases,
          }
          needsSave = true
        } else if (remote.canvases.length === 0) {
          selected = { ...createDefaultCanvasCollection(), revision: remote.revision }
          needsSave = true
        }

        showCollection(selected)
        persistenceReady = true
        if (needsSave) {
          localGeneration += 1
          if (!canWriteCrashDraft()) {
            setSyncStatus('saved')
          } else {
            writeCanvasCrashDraft(browserStorage, selected)
            if (selected.revision === remote.revision) scheduleSync(0)
            else setSyncStatus('conflict')
          }
        } else {
          acknowledgedGeneration = localGeneration
          setSyncStatus('saved')
        }
      } catch {
        persistActiveState()
        persistenceReady = false
        setSyncStatus('error')
      }
    })()
    initializationPromise = task
    void task.finally(() => {
      if (initializationPromise === task) initializationPromise = undefined
    })
    return task
  }

  onMount(() => {
    const oldHtmlOverflow = document.documentElement.style.overflow
    const oldBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const viewport = liveViewportElement()
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
    let fileDropPreviewRequest = 0
    let fileDropInspection: { path: string; promise: Promise<ResourceSummary> } | undefined
    const clearFileDropPreview = () => {
      fileDropPreviewRequest += 1
      setFileDropPreview(null)
    }
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
      const point = screenToWorld(event.clientX, event.clientY)
      if (isDirectoryFileDragData(transfer)) {
        fileDropPreviewRequest += 1
        setFileDropPreview(fileWindowPlacement(point, state(), 'browser'))
        return
      }
      const data = getFileDragData(transfer)
      const request = ++fileDropPreviewRequest
      setFileDropPreview(fileWindowPlacement(point, state(), 'viewer'))
      if (!data) return
      const key = filesystemResourceKey(DEFAULT_FILESYSTEM_ROOT_ID, data.path)
      const inspector = applicationContentRegistry.inspect(key)
      if (!inspector) return
      if (!fileDropInspection || fileDropInspection.path !== data.path) {
        fileDropInspection = { path: data.path, promise: inspector.inspect(key) }
      }
      void fileDropInspection.promise
        .then((resource) => {
          if (request !== fileDropPreviewRequest) return
          setFileDropPreview(
            fileWindowPlacement(
              point,
              state(),
              mediaWindowSizeKey(filesystemResourceMediaType(resource)),
            ),
          )
        })
        .catch(() => {})
    }
    document.addEventListener('pointerdown', dismissContextMenu, true)
    document.addEventListener('dragover', updateFileDropPreview, true)
    document.addEventListener('dragend', clearFileDropPreview, true)
    document.addEventListener('drop', clearFileDropPreviewAfterDrop, true)
    window.addEventListener('blur', clearFileDropPreview)
    window.addEventListener('pagehide', persistBeforePageTeardown)
    void initializeCanvasPersistence()
    onCleanup(() => {
      viewport?.removeEventListener('pointerdown', beginPan, true)
      viewportObserver.disconnect()
      document.removeEventListener('pointerdown', dismissContextMenu, true)
      document.removeEventListener('dragover', updateFileDropPreview, true)
      document.removeEventListener('dragend', clearFileDropPreview, true)
      document.removeEventListener('drop', clearFileDropPreviewAfterDrop, true)
      window.removeEventListener('blur', clearFileDropPreview)
      window.removeEventListener('pagehide', persistBeforePageTeardown)
      document.documentElement.style.overflow = oldHtmlOverflow
      document.body.style.overflow = oldBodyOverflow
    })
  })

  createEffect(() => {
    serializeInfiniteCanvasState(state())
    if (persistenceTimer !== undefined) window.clearTimeout(persistenceTimer)
    persistenceTimer = window.setTimeout(() => {
      const before = localGeneration
      persistActiveState()
      persistenceTimer = undefined
      if (persistenceReady && localGeneration !== before) scheduleSync()
    }, 220)
  })

  onCleanup(() => {
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
    const target = collection().canvases.find((item) => item.id === id)
    if (!target) return
    const next = { ...collection(), activeId: id }
    setState(cloneState(target.state))
    setUndoStack([])
    setRedoStack([])
    setLastAudioWindowId(null)
    setSelection(null)
    setSelectedIds([])
    setCanvasMenuOpen(false)
    saveCollection(next)
  }

  function createNamedCanvas() {
    const current = persistActiveState()
    const record = createCanvasRecord(dialogInput())
    const next = {
      ...current,
      activeId: record.id,
      canvases: [...current.canvases, record],
    }
    setCollection(next)
    setState(cloneState(record.state!))
    setUndoStack([])
    setRedoStack([])
    setSelection(null)
    setSelectedIds([])
    saveCollection(next)
    setDialog(null)
  }

  function renameCanvas(canvasId: string) {
    const name = dialogInput().trim()
    if (!name) return
    const current = persistActiveState()
    saveCollection({
      ...current,
      canvases: current.canvases.map((item) =>
        item.id === canvasId ? { ...item, name, updatedAt: Date.now() } : item,
      ),
    })
    setDialog(null)
  }

  function deleteCanvas(canvasId: string) {
    const current = persistActiveState()
    let canvases = current.canvases.filter((item) => item.id !== canvasId)
    let fallback = canvases.find((item) => item.id === current.activeId)
    fallback ??= canvases[0]
    if (!fallback) {
      fallback = createCanvasRecord('Untitled canvas')
      canvases = [...canvases, fallback]
    }
    const next = {
      ...current,
      activeId: fallback.id,
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
    saveCollection(next)
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
    const rect = liveViewportElement()?.getBoundingClientRect()
    const camera = state().camera
    return {
      x: (clientX - (rect?.left ?? 0) - camera.x) / camera.zoom,
      y: (clientY - (rect?.top ?? 0) - camera.y) / camera.zoom,
    }
  }

  function viewportCenterWorld() {
    const rect = liveViewportElement()?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  function setCamera(camera: InfiniteCanvasState['camera']) {
    setState((current) => ({ ...current, camera }))
  }

  function fitBounds(bounds: CanvasRect, maxZoom = CANVAS_MAX_ZOOM) {
    const viewport = liveViewportElement()?.getBoundingClientRect()
    if (!viewport) return
    const padding = 72
    if (
      viewport.width <= padding * 2 ||
      viewport.height <= padding * 2 ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return
    }
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
    const camera = {
      zoom,
      x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    }
    setCamera(camera)
  }

  function ensureBoundsVisible(bounds: CanvasRect[]) {
    const viewport = liveViewportElement()?.getBoundingClientRect()
    if (!viewport) return
    const current = state()
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

  function ensureWindowsVisible(windowIds: string[]) {
    ensureBoundsVisible(
      state()
        .windows.filter((window) => windowIds.includes(window.id))
        .map((window) => window.bounds),
    )
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

  function clampWindowBoundsToViewport(
    bounds: CanvasRect,
    camera: InfiniteCanvasState['camera'],
  ): CanvasRect {
    const viewport = liveViewportElement()?.getBoundingClientRect()
    if (!viewport || camera.zoom <= 0) return bounds
    const margin = 24
    const minX = Math.ceil((margin - camera.x) / camera.zoom / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE
    const minY = Math.ceil((margin - camera.y) / camera.zoom / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE
    const maxX =
      Math.floor(
        ((viewport.width - margin - camera.x) / camera.zoom - bounds.width) / CANVAS_GRID_SIZE,
      ) * CANVAS_GRID_SIZE
    const maxY =
      Math.floor(
        ((viewport.height - margin - camera.y) / camera.zoom - bounds.height) / CANVAS_GRID_SIZE,
      ) * CANVAS_GRID_SIZE
    if (maxX < minX || maxY < minY) return bounds
    return {
      ...bounds,
      x: Math.min(maxX, Math.max(minX, bounds.x)),
      y: Math.min(maxY, Math.max(minY, bounds.y)),
    }
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
      sizeKey,
    }
  }

  function existingWindowForResource(resource: ResourceSummary) {
    return state().windows.find((window) => {
      const content = contentInstanceFromCurrentWindow(window.definition)
      const key =
        content?.type === 'explorer'
          ? content.location
          : content?.type === 'resource'
            ? content.resource
            : null
      return key?.provider === resource.key.provider && key.id === resource.key.id
    })
  }

  let pendingCanvasHostOpen:
    | {
        resource: ResourceSummary
        point: { x: number; y: number }
        options: AddFileWindowOptions
        created?: CanvasWindow
      }
    | undefined

  const canvasContentHost = createCanvasHost({
    window(plan) {
      const pending = pendingCanvasHostOpen
      if (!pending) return
      let created: CanvasWindow | undefined
      commit((current) => {
        const id = `canvas-window-${current.nextItemId}`
        const address = filesystemResourceAddress(plan.resource)
        const content: ContentInstance =
          plan.kind === 'browse'
            ? { id, type: 'explorer', location: plan.resource }
            : {
                id,
                type: 'resource',
                resource: plan.resource,
                renderer: plan.renderer,
                ...(address
                  ? { context: filesystemResourceKey(address.rootId, parentPath(address.path)) }
                  : {}),
              }
        const baseDefinition: ContentWindowDefinition = {
          id,
          title: pending.resource.name,
          contentInstance: content,
        }
        const definition = contentWindowWithInstance(baseDefinition, content) ?? baseDefinition
        const sizeKey = windowSizeKey(definition)
        const requestedBounds = findNearestFreeCanvasRect(
          {
            ...pending.point,
            ...(current.windowSizeByType[sizeKey] ??
              (sizeKey.startsWith('viewer-') ? current.windowSizeByType.viewer : undefined) ??
              DEFAULT_WINDOW_SIZE[sizeKey]),
          },
          placementObstacles(current),
        )
        const worldBounds =
          pending.options.worldBounds ??
          clampWindowBoundsToViewport(requestedBounds, current.camera)
        created = {
          id,
          definition,
          bounds: worldBounds,
          zIndex: current.nextZIndex,
        }
        return {
          ...current,
          windows: [...current.windows, created!],
          nextItemId: current.nextItemId + 1,
          nextZIndex: current.nextZIndex + 1,
        }
      })
      pending.created = created
      if (created) selectWindow(created.id)
    },
    close(instanceId) {
      void closeWindow(instanceId)
    },
    focus: focusWindow,
  })

  function addResourceWindow(
    resource: ResourceSummary,
    point: { x: number; y: number },
    options: AddFileWindowOptions = {},
  ) {
    if (!options.duplicate) {
      const existing = existingWindowForResource(resource)
      if (existing) {
        canvasContentHost.focus(existing.id)
        return existing
      }
    }
    const intent = options.readerKind
      ? 'read'
      : filesystemResourceIsDirectory(resource)
        ? 'browse'
        : 'default'
    const plan = openResource(resource, intent, { surface: 'canvas', disposition: 'window' })
    if (plan.status !== 'ready') {
      setDialog({ kind: 'message', message: `This resource cannot be opened (${plan.reason}).` })
      return undefined
    }
    const pending: NonNullable<typeof pendingCanvasHostOpen> = { resource, point, options }
    pendingCanvasHostOpen = pending
    try {
      canvasContentHost.open(plan as HostOpenPlan<'window'>)
      return pending.created
    } finally {
      pendingCanvasHostOpen = undefined
    }
  }

  function addBrowsableRootWindow(point: { x: number; y: number }) {
    const root = applicationContentRegistry
      .roots()
      .find((resource) => resource.capabilities.includes('browse'))
    return root ? addResourceWindow(root, point, { duplicate: true }) : undefined
  }

  function settleCanvasWindows(bounds: CanvasRect[]) {
    ensureBoundsVisible(bounds)
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
      await createFilesystemFile(path, { content })
      const key = filesystemResourceKey(DEFAULT_FILESYSTEM_ROOT_ID, path)
      const inspector = applicationContentRegistry.inspect(key)
      if (!inspector) throw new Error('Filesystem inspect capability is unavailable')
      addResourceWindow(await inspector.inspect(key), point)
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
    const path = item ? contentWindowFilesystemPath(item.definition) : null
    const canvasId = collection().activeId
    return path && canvasId ? canvasReadingProgressKey(canvasId, path) : null
  }

  function bindReadingProgress(element: HTMLDivElement, windowId: string) {
    onCleanup(
      bindReadingProgressEvents({
        element,
        key: () => readingPositionKey(windowId),
      }),
    )
  }

  async function deleteSelected() {
    const ids = new Set(selectedIds())
    if (!ids.size) return
    const targets = state().windows.filter((item) => ids.has(item.id))
    const content = targets
      .map((item) => contentInstanceFromCurrentWindow(item.definition))
      .filter((instance): instance is ContentInstance => instance !== null)
    const targetsAreCurrent = () =>
      targets.every(
        (target) => state().windows.find((window) => window.id === target.id) === target,
      )
    if (!(await confirmContentClose(applicationContentRuntime, content, targetsAreCurrent))) return
    if (!targetsAreCurrent()) return
    let removedAny = false
    commit((current) => {
      const removed = new Set(
        current.windows.filter((item) => ids.has(item.id)).map((item) => item.id),
      )
      removedAny = removed.size > 0
      const windows = current.windows.filter((item) => !removed.has(item.id))
      return { ...current, windows }
    })
    if (removedAny) {
      await Promise.all(content.map((instance) => applicationContentRuntime.release(instance)))
    }
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
      const record = createCanvasRecord(bundle.name, bundle.state)
      const next = {
        ...current,
        activeId: record.id,
        canvases: [...current.canvases, record],
      }
      setCollection(next)
      setState(cloneState(bundle.state))
      saveCollection(next)
      setDialog(null)
    } catch (error) {
      setDialog({
        kind: 'message',
        message: error instanceof Error ? error.message : 'Import failed',
      })
    }
  }

  function openFromBrowser(sourceWindowId: string, resource: ResourceSummary, duplicate = false) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source) return
    if (!duplicate) {
      const existing = existingWindowForResource(resource)
      if (existing) {
        focusWindow(existing.id)
        return
      }
    }
    const bounds = source.bounds
    const created = addResourceWindow(
      resource,
      { x: bounds.x + bounds.width + CANVAS_GRID_SIZE, y: bounds.y },
      { duplicate },
    )
    if (created) settleCanvasWindows([source.bounds, created.bounds])
  }

  function openResourceFromBrowser(sourceWindowId: string, resource: ResourceSummary) {
    openFromBrowser(sourceWindowId, resource)
  }

  function openReaderFromBrowser(sourceWindowId: string, resource: ResourceSummary) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source || !filesystemResourceIsDirectory(resource)) return
    const created = addResourceWindow(
      resource,
      { x: source.bounds.x + source.bounds.width + CANVAS_GRID_SIZE, y: source.bounds.y },
      { duplicate: true, readerKind: 'folder' },
    )
    if (created) settleCanvasWindows([source.bounds, created.bounds])
  }

  function canvasExplorerHostActions(
    sourceWindowId: string,
  ): readonly ExplorerHostAction<ApplicationExplorerPayload>[] {
    return [
      {
        descriptor: {
          id: 'host.openInNewWindow',
          operation: 'openInNewWindow',
          label: 'Open in new canvas window',
          capability: 'host.newWindow',
          scope: 'host',
          interaction: 'immediate',
        },
        run: (item) => openFromBrowser(sourceWindowId, item.resource, true),
      },
      {
        descriptor: {
          id: 'host.openWithReader',
          operation: 'openWithReader',
          label: 'Open with Reader',
          capability: 'host.reader',
          scope: 'host',
          interaction: 'immediate',
        },
        available: (item) => filesystemResourceIsDirectory(item.resource),
        run: (item) => openReaderFromBrowser(sourceWindowId, item.resource),
      },
    ]
  }

  function addContentWindowAtPoint(
    content: ContentInstance,
    point: { x: number; y: number },
    source?: ResourceSummary,
    requestedBounds?: CanvasRect,
  ) {
    const comparable = JSON.stringify({ ...content, id: '' })
    const existing = state().windows.find((window) => {
      const instance = contentInstanceFromCurrentWindow(window.definition)
      return instance && JSON.stringify({ ...instance, id: '' }) === comparable
    })
    if (existing) {
      focusWindow(existing.id)
      return existing
    }
    let created: CanvasWindow | undefined
    commit((current) => {
      const id = `canvas-window-${current.nextItemId}`
      const hosted = contentWithInstanceId(content, id)
      const presentation = applicationContentRegistry.presentation(hosted)
      const baseDefinition: ContentWindowDefinition = {
        id,
        title: source?.name ?? presentation?.title ?? 'Content',
        iconName: presentation?.icon ?? null,
        contentInstance: hosted,
      }
      const projected = contentWindowWithInstance(baseDefinition, hosted)
      if (!projected) return current
      const definition: ContentWindowDefinition = {
        ...projected,
        title: source?.name ?? projected.title,
      }
      const sizeKey = windowSizeKey(definition)
      const worldBounds = findNearestFreeCanvasRect(
        {
          ...point,
          ...(current.windowSizeByType[sizeKey] ??
            (sizeKey.startsWith('viewer-') ? current.windowSizeByType.viewer : undefined) ??
            DEFAULT_WINDOW_SIZE[sizeKey]),
        },
        placementObstacles(current),
      )
      const bounds = requestedBounds ?? worldBounds
      created = {
        id,
        definition,
        bounds,
        zIndex: current.nextZIndex,
      }
      return {
        ...current,
        windows: [...current.windows, created!],
        nextItemId: current.nextItemId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
    })
    if (created) selectWindow(created.id)
    return created
  }

  function addAssistantWindow(point = viewportCenterWorld()) {
    const pane = applicationContentRegistry.panes('assistant')[0]
    if (!pane) return
    const id = `assistant-draft-${crypto.randomUUID()}`
    return addContentWindowAtPoint(pane.create(id), point)
  }

  function openContentWindow(
    sourceWindowId: string,
    content: ContentInstance,
    source?: ResourceSummary,
  ) {
    const sourceWindow = state().windows.find((window) => window.id === sourceWindowId)
    if (!sourceWindow) return
    const created = addContentWindowAtPoint(
      content,
      {
        x: sourceWindow.bounds.x + sourceWindow.bounds.width + CANVAS_GRID_SIZE,
        y: sourceWindow.bounds.y,
      },
      source,
    )
    if (!created) return
    settleCanvasWindows([sourceWindow.bounds, created.bounds])
  }

  async function replaceWindowContent(windowId: string, content: ContentInstance) {
    const target = state().windows.find((window) => window.id === windowId)?.definition
    if (!target) return
    const previous = contentInstanceFromCurrentWindow(target)
    const hosted = contentWithInstanceId(content, windowId)
    const changesRuntimeOwner =
      previous !== null && contentRuntimeIdentity(previous) !== contentRuntimeIdentity(hosted)
    if (
      changesRuntimeOwner &&
      !(await confirmContentClose(applicationContentRuntime, [previous], () =>
        state().windows.some((window) => window.id === windowId && window.definition === target),
      ))
    ) {
      return
    }
    let replaced = false
    updateDefinition(windowId, (definition) => {
      if (definition !== target) return definition
      const projected = contentWindowWithInstance(definition, hosted)
      if (!projected) return definition
      replaced = true
      return projected
    })
    if (replaced && changesRuntimeOwner) await applicationContentRuntime.release(previous)
  }

  function updateDefinition(
    windowId: string,
    update: (definition: ContentWindowDefinition) => ContentWindowDefinition,
  ) {
    setState((current) => {
      let changed = false
      const windows = current.windows.map((window) => {
        if (window.id !== windowId) return window
        const definition = update(window.definition)
        if (definition === window.definition) return window
        changed = true
        return { ...window, definition }
      })
      return changed ? { ...current, windows } : current
    })
  }

  function navigateDir(windowId: string, location: ResourceKey) {
    replaceWindowContent(windowId, { id: windowId, type: 'explorer', location })
  }

  async function updateViewing(windowId: string, path: string) {
    const definition = state().windows.find((window) => window.id === windowId)?.definition
    const current = definition ? contentInstanceFromCurrentWindow(definition) : null
    const currentAddress =
      current?.type === 'resource' ? filesystemResourceAddress(current.resource) : null
    const key = filesystemResourceKey(currentAddress?.rootId ?? DEFAULT_FILESYSTEM_ROOT_ID, path)
    const inspector = applicationContentRegistry.inspect(key)
    if (!inspector) return
    const resource = await inspector.inspect(key)
    const plan = openResource(resource, 'default', {
      surface: 'canvas',
      disposition: 'window',
    })
    if (plan.status !== 'ready' || plan.kind !== 'render') return
    const planAddress = filesystemResourceAddress(plan.resource)
    const rootId = currentAddress?.rootId ?? planAddress?.rootId
    if (!rootId) return
    replaceWindowContent(windowId, {
      id: windowId,
      type: 'resource',
      resource: filesystemResourceKey(rootId, path),
      renderer: plan.renderer,
      context: filesystemResourceKey(rootId, parentPath(path)),
    })
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
    ensureWindowsVisible([windowId])
  }

  function handleAudioActivate(windowId: string) {
    setLastAudioWindowId(windowId)
  }

  async function closeWindow(windowId: string) {
    const target = state().windows.find((window) => window.id === windowId)
    if (!target) return
    const content = contentInstanceFromCurrentWindow(target.definition)
    const targetIsCurrent = () =>
      state().windows.find((window) => window.id === windowId) === target
    if (
      !(await confirmContentClose(
        applicationContentRuntime,
        content ? [content] : [],
        targetIsCurrent,
      ))
    ) {
      return
    }
    if (!targetIsCurrent()) return
    const viewing = contentWindowFilesystemPath(target.definition)
    const currentPlaybackItem = playbackSession.getSnapshot().currentItem
    if (
      viewing &&
      currentPlaybackItem &&
      filesystemPlaybackItemPath(currentPlaybackItem) === viewing
    ) {
      playbackSession.dispatch({ type: 'stop' })
    }
    if (lastAudioWindowId() === windowId) setLastAudioWindowId(null)
    if (maximizedWindowId() === windowId) setMaximizedWindowId(null)
    let removed = false
    commit((current) => {
      if (!current.windows.some((window) => window.id === windowId)) return current
      removed = true
      return {
        ...current,
        windows: current.windows.filter((window) => window.id !== windowId),
      }
    })
    if (removed && content) await applicationContentRuntime.release(content)
    setSelectedIds((ids) => ids.filter((id) => id !== windowId))
    if (selection()?.id === windowId) setSelection(null)
  }

  function startWindowMove(windowId: string, event: PointerEvent) {
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
      const rect = liveViewportElement()?.getBoundingClientRect()
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
    const allowPrimary = spaceHeld() || event.target === liveViewportElement()
    if (event.button !== 1 && !(allowPrimary && event.button === 0)) return
    setMenu(null)
    panController.begin(event, allowPrimary)
  }

  function zoomAt(clientX: number, clientY: number, nextZoom: number) {
    const rect = liveViewportElement()?.getBoundingClientRect()
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
    const rect = liveViewportElement()?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, state().camera.zoom * factor)
  }

  function setZoomFromControl(nextZoom: number) {
    const rect = liveViewportElement()?.getBoundingClientRect()
    if (!rect) return
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, nextZoom)
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

  function onLibrarySearchResult(hit: SearchHit) {
    void executeSearchHit(applicationSearchCoordinator, hit, {
      opener: openResource,
      context: { surface: 'canvas', disposition: 'window' },
      place(selected, plan) {
        if (!selected.resource || plan.status !== 'ready') return
        const pending: NonNullable<typeof pendingCanvasHostOpen> = {
          resource: selected.resource,
          point: searchPlacement(),
          options: {},
        }
        pendingCanvasHostOpen = pending
        try {
          canvasContentHost.open(plan as HostOpenPlan<'window'>)
        } finally {
          pendingCanvasHostOpen = undefined
        }
      },
    })
  }

  createEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (corruptDraftRaw() !== null) return
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
        if (selectedIds().length) {
          event.preventDefault()
          void deleteSelected()
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
        contentWindowKind(window.definition) === 'viewer' &&
        contentMediaType(window.definition) === MediaType.AUDIO,
    )
    const currentWindow =
      current.mode === 'audio' && current.currentItem
        ? stateWindows.find(
            (window) =>
              contentWindowKind(window.definition) === 'viewer' &&
              contentWindowFilesystemPath(window.definition) ===
                (current.currentItem ? filesystemPlaybackItemPath(current.currentItem) : null),
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
    <>
      <div
        class='canvas-layout fixed inset-0 flex select-none flex-col overflow-hidden bg-background text-foreground'
        inert={corruptDraftRaw() !== null}
      >
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
                title={
                  persistenceReady
                    ? 'Server sync failed; local Canvas state remains open'
                    : 'Canvas server state could not be loaded; no overwrite was attempted'
                }
                onClick={() => void saveCanvases()}
              >
                <CircleAlert class='size-4' />
                <span class='hidden sm:inline'>Sync failed</span>
                <span class='hidden font-medium md:inline'>Retry</span>
              </button>
            </Show>
            <Show when={syncStatus() === 'conflict'}>
              <div
                data-testid='canvas-sync-conflict'
                class='flex h-8 items-center gap-1 rounded-md bg-amber-500/10 px-1.5 text-xs text-amber-700 dark:text-amber-300'
              >
                <CircleAlert class='size-4' />
                <span class='hidden sm:inline'>Canvas changed on server</span>
                <button
                  type='button'
                  class='rounded px-1.5 py-1 font-medium hover:bg-amber-500/15'
                  onClick={() => void loadServerAfterConflict()}
                >
                  Load server
                </button>
                <button
                  type='button'
                  class='rounded px-1.5 py-1 font-medium hover:bg-amber-500/15'
                  onClick={() => void keepLocalAfterConflict()}
                >
                  Keep local
                </button>
              </div>
            </Show>
            <div data-testid='canvas-create-tools' class='flex items-center gap-2'>
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
                        addBrowsableRootWindow(viewportCenterWorld())
                        setAddMenuOpen(false)
                      }}
                    >
                      <FolderOpen class='size-4' /> File browser
                    </MenuButton>
                    <MenuButton
                      onClick={() => {
                        addAssistantWindow()
                        setAddMenuOpen(false)
                      }}
                    >
                      <MessageSquare class='size-4' /> AI chat
                    </MenuButton>
                  </div>
                </Show>
              </div>
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
                      {workspaceTabIcon(item.definition, fileIconContext(), 'sm')}
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
          class='relative min-h-0 flex-1 overflow-clip bg-muted/20 outline-none'
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
            const preview = fileDropPreview()
            setFileDropPreview(null)
            void (async () => {
              const key = filesystemResourceKey(DEFAULT_FILESYSTEM_ROOT_ID, data.path)
              const inspector = applicationContentRegistry.inspect(key)
              if (!inspector) return
              const resource = await inspector.inspect(key)
              const sizeKey = filesystemResourceIsDirectory(resource)
                ? 'browser'
                : mediaWindowSizeKey(filesystemResourceMediaType(resource))
              const placement =
                preview?.sizeKey === sizeKey
                  ? preview
                  : fileWindowPlacement(point, state(), sizeKey)
              addResourceWindow(resource, point, {
                duplicate: true,
                worldBounds: placement.bounds,
              })
            })()
          }}
        >
          <Show when={!state().windows.length}>
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
                    onClick={() => addBrowsableRootWindow(viewportCenterWorld())}
                  >
                    Browse files
                  </button>
                  <button
                    type='button'
                    class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
                    onClick={() => addAssistantWindow()}
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
            style={{
              transform: `translate3d(${state().camera.x}px, ${state().camera.y}px, 0) scale(${state().camera.zoom})`,
            }}
          >
            <For each={state().windows.map((window) => window.id)}>
              {(windowId) => {
                const item = createMemo(() =>
                  state().windows.find((window) => window.id === windowId),
                )
                const integrationContent = createMemo(() => {
                  const instance = contentInstanceFromCurrentWindow(item()!.definition)
                  return instance?.type === 'integration' ? instance : null
                })
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
                  liveWindowChrome()
                    ? 1
                    : Math.min(1.6, Math.max(1, 14 / 20 / state().camera.zoom)),
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
                      'invisible pointer-events-none':
                        state().camera.zoom < FAR_ZOOM && !maximized(),
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
                          {workspaceTabIcon(item()!.definition, fileIconContext(), 'sm')}
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
                        <button
                          type='button'
                          class='inline-flex h-full items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                          style={{ width: `${titlebarHeight()}px` }}
                          aria-label={`Close ${item()!.definition.title}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => void closeWindow(windowId)}
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
                        <Show when={item()!.definition.contentRecoveryReason} keyed>
                          {(reason) => <ContentRecoveryView reason={reason} />}
                        </Show>
                        <Show
                          when={
                            !item()!.definition.contentRecoveryReason &&
                            contentWindowKind(item()!.definition) === 'browser'
                          }
                        >
                          <ExplorerView<ApplicationExplorerPayload>
                            location={() => explorerLocation(item()!.definition)}
                            dataSource={explorerDataSource}
                            active={() =>
                              selection()?.kind === 'window' && selection()!.id === windowId
                            }
                            displayMode='Workspace'
                            hostActions={() => canvasExplorerHostActions(windowId)}
                            itemDomValue={(entry) =>
                              filesystemPathForResourceKey(entry.resource.key) ?? undefined
                            }
                            breadcrumbDomValue={(location) =>
                              filesystemPathForResourceKey(location.key) ?? undefined
                            }
                            renderItemIcon={(entry, size) => {
                              const current = fileIconContext()
                              return size === 'large'
                                ? gridResourceSummaryIcon(entry.resource, current)
                                : resourceSummaryIcon(entry.resource, current)
                            }}
                            destinationPicker={(_action, entry) => {
                              const path = filesystemPathForResourceKey(entry.resource.key)
                              return path === null
                                ? null
                                : { filePath: path, editableFolders: editableFolders() }
                            }}
                            onNavigate={(location) => navigateDir(windowId, location.key)}
                            onOpen={(entry) => openResourceFromBrowser(windowId, entry.resource)}
                            onOpenContent={(content, entry) =>
                              openContentWindow(windowId, content, entry.resource)
                            }
                            onDragStart={(entry, event) => {
                              const path = filesystemPathForResourceKey(entry.resource.key)
                              if (path === null || !event.dataTransfer) return
                              setFileDragData(event.dataTransfer, {
                                path,
                                isDirectory: filesystemResourceIsDirectory(entry.resource),
                                sourceKind: 'local',
                              })
                            }}
                          />
                        </Show>
                        <Show
                          when={
                            !item()!.definition.contentRecoveryReason &&
                            contentWindowKind(item()!.definition) === 'viewer'
                          }
                        >
                          <FilesystemResourceViewerContent
                            runtime={applicationContentRuntime}
                            contentInstance={() => resourceContent(item()!.definition)}
                            contentVisible={() => true}
                            viewingPath={() =>
                              contentWindowFilesystemPath(item()!.definition) ?? ''
                            }
                            readerKind={() => contentReaderKind(item()!.definition)}
                            directory={() =>
                              contentWindowFilesystemDirectory(item()!.definition) ?? ''
                            }
                            active={() =>
                              selection()?.kind === 'window' && selection()!.id === windowId
                            }
                            autoPlayVideo={false}
                            onNavigateViewing={(path) => updateViewing(windowId, path)}
                            onReplaceContent={(content) => {
                              replaceWindowContent(windowId, content)
                            }}
                            onVideoMetadataLoaded={(width, height) =>
                              sizeVideoWindow(windowId, width, height)
                            }
                            onAudioActivate={() => handleAudioActivate(windowId)}
                            showListenOnly={false}
                          />
                        </Show>
                        <Show when={integrationContent()}>
                          <ContentRuntimeView
                            runtime={applicationContentRuntime}
                            instance={integrationContent}
                            active={() => selection()?.id === windowId}
                            onReplace={(content) => replaceWindowContent(windowId, content)}
                            onOpen={(content) => openContentWindow(windowId, content)}
                            onClose={() => void closeWindow(windowId)}
                          />
                        </Show>
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
                            {workspaceTabIcon(item()!.definition, fileIconContext(), 'md')}
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
                    <Show when={selected() && !maximized()}>
                      <ResizeHandles
                        onStart={(direction, event) =>
                          startWindowResize(windowId, direction, event)
                        }
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
                          {workspaceTabIcon(item.definition, fileIconContext(), 'md')}
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
                    addBrowsableRootWindow({ x: value.worldX, y: value.worldY })
                    setMenu(null)
                  }}
                >
                  <FolderOpen class='size-4' />
                  Open file browser
                </MenuButton>
                <MenuButton
                  onClick={() => {
                    const value = current() as Extract<ContextMenuState, { kind: 'canvas' }>
                    addAssistantWindow({ x: value.worldX, y: value.worldY })
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
            onResult={onLibrarySearchResult}
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
                    “
                    {
                      (current() as Extract<CanvasDialogState, { kind: 'delete-canvas' }>)
                        .canvasName
                    }
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
      <Show when={corruptDraftRaw() !== null}>
        <div class='fixed inset-0 z-[200000] flex items-start justify-end bg-background/40 p-2 backdrop-blur-[1px]'>
          <div
            role='dialog'
            aria-modal='true'
            aria-label='Corrupt Canvas recovery draft'
            data-testid='canvas-corrupt-draft'
            class='flex min-h-10 items-center gap-1 rounded-md border border-destructive/30 bg-popover px-2 text-xs text-destructive shadow-xl'
          >
            <CircleAlert class='size-4' />
            <span class='hidden sm:inline'>Recovery draft is corrupt</span>
            <button
              type='button'
              class='rounded px-1.5 py-1 font-medium hover:bg-destructive/10'
              onClick={downloadCorruptCrashDraft}
            >
              Download draft
            </button>
            <Show when={!persistenceReady && syncStatus() === 'error'}>
              <button
                type='button'
                class='rounded px-1.5 py-1 font-medium hover:bg-destructive/10'
                onClick={() => void initializeCanvasPersistence()}
              >
                Retry server
              </button>
            </Show>
            <button
              type='button'
              class='rounded px-1.5 py-1 font-medium hover:bg-destructive/10'
              onClick={discardCorruptCrashDraft}
            >
              Discard draft
            </button>
          </div>
        </div>
      </Show>
    </>
  )
}
