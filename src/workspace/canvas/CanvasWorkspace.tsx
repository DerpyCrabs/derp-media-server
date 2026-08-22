import { api } from '@/lib/api/client'
import {
  getFileDragData,
  hasFileDragData,
  isDirectoryFileDragData,
} from '@/lib/files/file-drag-data'
import { fileSearchResultToFileItem } from '@/lib/files/file-search'
import {
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_WINDOW_HEIGHT,
  CANVAS_MIN_WINDOW_WIDTH,
  CANVAS_MIN_ZOOM,
  canvasWindowVisualBounds,
  cloneInfiniteCanvasState,
  createEmptyCanvasState,
  findNearestFreeCanvasRect,
  snapCanvasRect,
  snapCanvasValue,
  type CanvasRect,
  type CanvasWindow,
  type CanvasWindowSize,
  type CanvasWindowSizeKey,
  type InfiniteCanvasState,
} from '@/workspace/canvas/model/infinite-canvas'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { MediaType, type FileItem } from '@/lib/files/types'
import { fileNameFromPath } from '@/lib/files/path-utils'
import type {
  PersistedWindowState,
  WindowSource,
  WindowDefinition,
} from '@/lib/models/window-model'
import { isHermesOpenTarget, type HermesOpenTarget } from '@/features/hermes/hermes-open-target'
import { canCloseHermesWindow, discardHermesDraft } from '@/features/hermes/hermes-session-store'
import FileText from 'lucide-solid/icons/file-text'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import MessageSquare from 'lucide-solid/icons/message-square'
import PanelLeft from 'lucide-solid/icons/panel-left'
import PanelsTopLeft from 'lucide-solid/icons/panels-top-left'
import Volume2 from 'lucide-solid/icons/volume-2'
import X from 'lucide-solid/icons/x'
import { For, Show, createMemo, createSignal, onSettled, untrack } from 'solid-js'
import { canvasEdgeAutoPanVelocity } from './canvas-edge-auto-pan'
import { cameraForCanvasBounds } from './model/canvas-camera'
import { createCanvasPanController } from './create-canvas-pan-controller'
import { EMPTY_FILE_ICON_CONTEXT, windowIcon } from '@/features/explorer/use-file-icon'
import { ApplicationWindowContent } from '@/workspace/shared/ApplicationWindowContent'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from '@/lib/browser/browser-history'
import { useWorkspaceSession } from '@/workspace/shared/WorkspaceSession'
import {
  DEFAULT_WORKSPACE_SOURCE,
  type PersistedWorkspaceState,
} from '@/workspace/model/use-workspace'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import { defaultPersistedState } from '@/workspace/shared/workspace-page-persistence'
import {
  applyCanvasGeometryToWorkspace,
  canvasViewFromWorkspace,
} from '@/workspace/canvas/model/canvas-projection'
import { createWorkspaceLifecycleCommands } from '@/workspace/shared/workspace-lifecycle-commands'
import { WorkspaceSwitcher } from '@/workspace/shared/WorkspaceSwitcher'
import { WorkspaceTaskbarAudio } from '@/workspace/taskbar/WorkspaceTaskbarAudio'
import { WorkspaceTaskbarSettings } from '@/workspace/taskbar/WorkspaceTaskbarSettings'
import type { WorkspaceWindowActions } from '@/workspace/shared/workspace-window-actions'
import { WorkspaceSaveStatus } from '@/workspace/shared/WorkspaceSaveStatus'
import {
  WorkspaceTaskbar,
  WorkspaceTaskbarPins,
  WORKSPACE_TASKBAR_END_CLASS,
  WORKSPACE_TASKBAR_ICON_BUTTON_CLASS,
} from '@/workspace/shared/WorkspaceTaskbar'
import { rollbackWorkspaceTransferGeometry } from '@/workspace/model/workspace-transfer'
import { createCrossWorkspaceTransferController } from '@/workspace/shared/cross-workspace-transfer-controller'
import { confirmWorkspaceWindowsSequentially } from '@/workspace/model/workspace-close'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import { WorkspaceWindowTitlebar } from '@/workspace/shared/WorkspaceWindowTitlebar'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { FLOATING_Z_PIN_MENU } from '@/lib/ui/floating-z-index'
import { useWorkspacePageServerData } from '@/workspace/shared/use-workspace-page-server-data'
import { useModalFocus } from '@/lib/ui/modal-focus'
import { showAppAlert } from '@/lib/ui/app-dialog'
import { startPointerGesture, type PointerGestureOptions } from '@/lib/ui/start-pointer-gesture'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import { planTaskbarPinAdd } from '@/workspace/model/workspace-taskbar-pin'
import {
  planWorkspaceWindowOpen,
  workspaceWindowId,
  type WorkspaceWindowOpenIntent,
} from '@/workspace/model/workspace-window-open'

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

type ContextMenuState = {
  kind: 'canvas'
  clientX: number
  clientY: number
  worldX: number
  worldY: number
}

type Selection = { kind: 'window'; id: string } | null
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type CanvasDialogState = {
  kind: 'new-note'
  point: { x: number; y: number }
  initialContent: string
}
type FileDropPreview = { bounds: CanvasRect }
type CanvasMergeTarget = { groupId: string; targetWindowId: string; insertIndex: number }

function cloneState(state: InfiniteCanvasState): InfiniteCanvasState {
  return cloneInfiniteCanvasState(state)
}

const EMPTY_CANVAS_BOUNDS: CanvasRect = {
  x: 0,
  y: 0,
  width: CANVAS_MIN_WINDOW_WIDTH,
  height: CANVAS_MIN_WINDOW_HEIGHT,
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
    case 'new-note':
      return 'New document'
  }
  throw new Error('Unhandled canvas dialog')
}

export function CanvasWorkspace() {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const workspaceId = () => urlSearchParams().get('ws') ?? ''
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const [geometryActive, setGeometryActive] = createSignal(false)
  let crossWorkspaceTransfer: ReturnType<typeof createCrossWorkspaceTransferController> | undefined
  let cancelCanvasPointerGesture: (() => void) | undefined
  const workspaceRegistry = useWorkspaceSession({
    savingBlocked: () => geometryActive() || (crossWorkspaceTransfer?.active() ?? false),
  })
  const workspaceSnapshot = workspaceRegistry.document
  const setWorkspaceSnapshot = workspaceRegistry.update
  const initialWorkspace = workspaceSnapshot()
  const state = createMemo(() => {
    const snapshot = workspaceSnapshot()
    return snapshot ? canvasViewFromWorkspace(snapshot) : createEmptyCanvasState()
  })
  const setState = (
    next: InfiniteCanvasState | ((current: InfiniteCanvasState) => InfiniteCanvasState),
  ) => {
    if (!untrack(workspaceRegistry.editable)) return
    setWorkspaceSnapshot((current) => {
      if (!current) return current
      const currentView = canvasViewFromWorkspace(current)
      const resolved = typeof next === 'function' ? next(currentView) : next
      return applyCanvasGeometryToWorkspace(resolved, current)
    })
  }
  const lifecycle = createWorkspaceLifecycleCommands({
    session: workspaceRegistry,
    activeId: workspaceId,
    navigate: (id, mode) => navigateSearchParams({ ws: id }, mode),
  })
  const maximizedWindowId = () => state().maximizedWindowId
  const initialActiveWindowId =
    initialWorkspace?.activeWindowId &&
    initialWorkspace.windows.some((window) => window.id === initialWorkspace.activeWindowId)
      ? initialWorkspace.activeWindowId
      : null
  type CanvasSelectionState = {
    activeWindowId: string | null
    selection: Selection
    selectedIds: string[]
  }
  const [localSelection, setLocalSelection] = createSignal<CanvasSelectionState>({
    activeWindowId: initialActiveWindowId,
    selection: initialActiveWindowId ? { kind: 'window', id: initialActiveWindowId } : null,
    selectedIds: initialActiveWindowId ? [initialActiveWindowId] : [],
  })
  const selectionProjection = createMemo(() => {
    const snapshot = workspaceSnapshot()
    const ids = new Set(snapshot?.windows.map((window) => window.id) ?? [])
    const activeWindowId =
      snapshot?.activeWindowId && ids.has(snapshot.activeWindowId) ? snapshot.activeWindowId : null
    return { ids, activeWindowId }
  })
  const resolvedSelection = createMemo((): CanvasSelectionState => {
    const local = localSelection()
    const projection = selectionProjection()
    if (local.activeWindowId !== projection.activeWindowId) {
      return {
        activeWindowId: projection.activeWindowId,
        selection: projection.activeWindowId
          ? { kind: 'window', id: projection.activeWindowId }
          : null,
        selectedIds: projection.activeWindowId ? [projection.activeWindowId] : [],
      }
    }
    return {
      activeWindowId: projection.activeWindowId,
      selection:
        local.selection?.kind === 'window' && !projection.ids.has(local.selection.id)
          ? null
          : local.selection,
      selectedIds: local.selectedIds.filter((id) => projection.ids.has(id)),
    }
  })
  const selection = () => resolvedSelection().selection
  const selectedIds = () => resolvedSelection().selectedIds
  const setSelection = (next: Selection | ((current: Selection) => Selection)) => {
    const current = resolvedSelection()
    setLocalSelection({
      ...current,
      selection: typeof next === 'function' ? next(current.selection) : next,
    })
  }
  const setSelectedIds = (next: string[] | ((current: string[]) => string[])) => {
    const current = resolvedSelection()
    setLocalSelection({
      ...current,
      selectedIds: typeof next === 'function' ? next(current.selectedIds) : next,
    })
  }
  const [menu, setMenu] = createSignal<ContextMenuState | null>(null)
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [pinMenu, setPinMenu] = createSignal<{ x: number; y: number; pinId: string } | null>(null)
  const [outlineOpen, setOutlineOpen] = createSignal(false)
  const [viewportSize, setViewportSize] = createSignal({ width: 1, height: 1 })
  const [workspacePanelOpen, setWorkspacePanelOpen] = createSignal(false)
  const [canvasMergeTarget, setCanvasMergeTarget] = createSignal<CanvasMergeTarget | null>(null)
  const [draggedCanvasGroupId, setDraggedCanvasGroupId] = createSignal('')
  const [cameraAnimating, setCameraAnimating] = createSignal(false)
  const [dialog, setDialog] = createSignal<CanvasDialogState | null>(null)
  const [dialogInput, setDialogInput] = createSignal('')
  const [noteDirectory, setNoteDirectory] = createSignal('')
  const [fileDropPreview, setFileDropPreview] = createSignal<FileDropPreview | null>(null)
  const [lastAudioWindowId, setLastAudioWindowId] = createSignal<string | null>(null)

  function openWorkspacePanel() {
    if (workspacePanelOpen()) return
    setWorkspacePanelOpen(true)
    void workspaceRegistry.refresh()
  }

  function toggleWorkspacePanel() {
    if (workspacePanelOpen()) setWorkspacePanelOpen(false)
    else openWorkspacePanel()
  }

  crossWorkspaceTransfer = createCrossWorkspaceTransferController({
    session: workspaceRegistry,
    sourceId: workspaceId,
    emptyDestination: () => ({
      ...defaultPersistedState(DEFAULT_WORKSPACE_SOURCE),
      windows: [],
      activeWindowId: null,
      nextWindowId: 1,
    }),
    navigate: (id) => navigateSearchParams({ ws: id }, 'replace'),
    viewport: viewportSize,
    rollbackGesture: rollbackWorkspaceTransferGeometry,
    onError: (message) => void showAppAlert(message, 'Canvas'),
    onSettled: () => setWorkspacePanelOpen(false),
  })

  function startCanvasPointerGesture(options: PointerGestureOptions) {
    cancelCanvasPointerGesture?.()
    let dispose = () => {}
    const settled = (callback: () => void) => {
      if (cancelCanvasPointerGesture === dispose) cancelCanvasPointerGesture = undefined
      callback()
    }
    dispose = startPointerGesture({
      ...options,
      commit: (event) => settled(() => options.commit(event)),
      cancel: () => settled(options.cancel),
    })
    cancelCanvasPointerGesture = dispose
  }

  async function settleCanvasGesturesBeforeNavigation() {
    cancelCanvasPointerGesture?.()
    await crossWorkspaceTransfer!.settleBeforeNavigation()
  }
  const readOnlyMode = () => !workspaceRegistry.editable() || crossWorkspaceTransfer!.committing()
  const [spaceHeld, setSpaceHeld] = createSignal(false)
  let dialogEl: HTMLDivElement | undefined
  const onDialogKeyDown = useModalFocus({
    active: () => dialog() != null,
    element: () => dialogEl,
    onEscape: () => setDialog(null),
    fallbackFocus: () =>
      document.querySelector<HTMLElement>('[data-testid="workspace-taskbar-workspaces"]'),
  })
  let viewportEl: HTMLDivElement | undefined
  let worldEl: HTMLDivElement | undefined
  let animationTimer: number | undefined
  let cameraInteractionRevision = 0
  const panController = createCanvasPanController({
    camera: () => state().camera,
    viewport: () => viewportEl,
    world: () => worldEl,
    commit: (camera) => {
      cameraInteractionRevision += 1
      setState((current) => ({ ...current, camera }))
    },
  })

  const server = useWorkspacePageServerData()
  const settingsQuery = server.settingsQuery
  const editableFolders = server.editableFolders
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

  const workspace = createMemo<PersistedWindowState>(
    () => workspaceSnapshot() ?? defaultPersistedState(DEFAULT_WORKSPACE_SOURCE),
  )

  const windowDefinitions = createMemo(
    () => new Map(workspace().windows.map((window) => [window.id, window] as const)),
  )
  const definitionFor = (window: CanvasWindow) => {
    const definition = windowDefinitions().get(window.id)
    if (!definition) throw new Error(`Missing workspace window ${window.id}`)
    return definition
  }

  const groupIdForCanvasWindow = (window: CanvasWindow) =>
    definitionFor(window).tabGroupId ?? window.id
  const groupWindows = (groupId: string) =>
    state().windows.filter((window) => groupIdForCanvasWindow(window) === groupId)
  const canvasGroupIds = createMemo(() => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const window of state().windows) {
      const groupId = groupIdForCanvasWindow(window)
      if (seen.has(groupId)) continue
      seen.add(groupId)
      ids.push(groupId)
    }
    return ids
  })

  function clearCanvasCrossWorkspaceHover() {
    crossWorkspaceTransfer!.hover(null)
  }

  const activeWindowForGroup = (groupId: string) => {
    const members = groupWindows(groupId)
    const activeId = workspaceSnapshot()?.activeTabMap[groupId]
    return members.find((member) => member.id === activeId) ?? members[0]
  }

  function selectCanvasTab(groupId: string, tabId: string) {
    if (readOnlyMode()) return
    let activeId: string | null = null
    setWorkspaceSnapshot((current) => {
      if (!current) return current
      const members = current.windows.filter(
        (window) => (window.tabGroupId ?? window.id) === groupId,
      )
      if (!members.some((member) => member.id === tabId)) return current
      const groupWasMaximized = members.some(
        (member) => member.id === current.canvas?.maximizedWindowId,
      )
      const activated = WorkspaceDocumentCommands.activateTab(current, groupId, tabId)
      activeId = activated.activeTabMap[groupId] ?? activated.activeWindowId
      if (!activeId) return current
      const zIndex = activated.canvas?.nextZIndex ?? 1
      return {
        ...activated,
        windows: activated.windows.map((window) =>
          (window.tabGroupId ?? window.id) === groupId
            ? { ...window, layout: { ...window.layout, zIndex } }
            : window,
        ),
        canvas: activated.canvas
          ? {
              ...activated.canvas,
              maximizedWindowId: groupWasMaximized ? activeId : activated.canvas.maximizedWindowId,
              nextZIndex: zIndex + 1,
            }
          : activated.canvas,
      }
    })
    if (!activeId) return
    setSelection({ kind: 'window', id: activeId })
    setSelectedIds([activeId])
  }

  function updateCanvasWorkspace(
    operation: (current: PersistedWorkspaceState) => PersistedWorkspaceState,
  ) {
    if (readOnlyMode()) return
    setWorkspaceSnapshot((current) => (current ? operation(current) : current))
  }

  function toggleCanvasTabPinned(tabId: string) {
    updateCanvasWorkspace((current) => WorkspaceDocumentCommands.toggleTabPin(current, tabId))
  }

  function mergeCanvasGroup(sourceWindowId: string, target: CanvasMergeTarget) {
    if (readOnlyMode()) return
    let merged = false
    setWorkspaceSnapshot((current) => {
      if (!current) return current
      const next = WorkspaceDocumentCommands.mergeGroups(
        current,
        sourceWindowId,
        target.targetWindowId,
        target.insertIndex,
      )
      if (next === current) return current
      merged = true
      const activated = WorkspaceDocumentCommands.activateTab(next, target.groupId, sourceWindowId)
      const zIndex = activated.canvas?.nextZIndex ?? 1
      return {
        ...activated,
        windows: activated.windows.map((window) =>
          (window.tabGroupId ?? window.id) === target.groupId
            ? { ...window, layout: { ...window.layout, zIndex } }
            : window,
        ),
        canvas: activated.canvas
          ? { ...activated.canvas, nextZIndex: zIndex + 1 }
          : activated.canvas,
      }
    })
    if (!merged) return
    setSelection({ kind: 'window', id: sourceWindowId })
    setSelectedIds([sourceWindowId])
  }

  function canvasMergeTargetAt(
    clientX: number,
    clientY: number,
    sourceGroupId: string,
  ): CanvasMergeTarget | null {
    const card = document
      .elementsFromPoint(clientX, clientY)
      .map((element) =>
        element.closest<HTMLElement>('[data-testid="canvas-window"][data-canvas-group-id]'),
      )
      .find((candidate) => candidate?.dataset.canvasGroupId !== sourceGroupId)
    const groupId = card?.dataset.canvasGroupId
    if (!card || !groupId || groupId === sourceGroupId) return null
    const members = groupWindows(groupId)
    const tab = document
      .elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>('[data-workspace-tab-id]'))
      .find((candidate) => candidate?.closest('[data-canvas-group-id]') === card)
    let insertIndex = members.length
    if (tab) {
      const tabId = tab.dataset.workspaceTabId
      const index = members.findIndex((member) => member.id === tabId)
      const rect = tab.getBoundingClientRect()
      if (index >= 0) insertIndex = index + (clientX >= rect.left + rect.width / 2 ? 1 : 0)
    }
    return { groupId, targetWindowId: members[0]!.id, insertIndex }
  }

  onSettled(() => {
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
    }
    const clearFileDropPreview = () => setFileDropPreview(null)
    const clearFileDropPreviewAfterDrop = () => queueMicrotask(clearFileDropPreview)
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
    // eslint-disable-next-line solid/reactivity
    return () => {
      viewport?.removeEventListener('pointerdown', beginPan, true)
      viewportObserver.disconnect()
      document.removeEventListener('pointerdown', dismissContextMenu, true)
      document.removeEventListener('dragover', updateFileDropPreview, true)
      document.removeEventListener('dragend', clearFileDropPreview, true)
      document.removeEventListener('drop', clearFileDropPreviewAfterDrop, true)
      window.removeEventListener('blur', clearFileDropPreview)
      document.documentElement.style.overflow = oldHtmlOverflow
      document.body.style.overflow = oldBodyOverflow
    }
  })

  // eslint-disable-next-line solid/reactivity
  onSettled(() => () => {
    if (animationTimer !== undefined) window.clearTimeout(animationTimer)
    cancelCanvasPointerGesture?.()
    crossWorkspaceTransfer!.dispose()
    panController.dispose()
  })

  function commit(mutator: (current: InfiniteCanvasState) => InfiniteCanvasState) {
    if (readOnlyMode()) return
    setState((current) => mutator(cloneState(current)))
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
    animateCamera(
      cameraForCanvasBounds({
        bounds,
        viewport,
        padding: 72,
        maxZoom,
      }),
    )
  }

  function fitAllWindows() {
    const bounds = canvasGroupIds().flatMap((groupId) => {
      const window = groupWindows(groupId)[0]
      return window ? [window.bounds] : []
    })
    if (bounds.length) fitBounds(unionRects(bounds))
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
    if (!visible) fitBounds(unionRects(bounds), current.camera.zoom)
  }

  function scheduleEnsureWindowsVisible(windowIds: string[]) {
    const scheduledRevision = cameraInteractionRevision
    window.requestAnimationFrame(() => {
      if (cameraInteractionRevision !== scheduledRevision) return
      untrack(() => ensureWindowsVisible(windowIds))
    })
  }

  function clearSelection() {
    setMaximizedWindowId(null)
    setSelection(null)
    setSelectedIds([])
    if (!readOnlyMode()) {
      setWorkspaceSnapshot((current) => (current ? { ...current, activeWindowId: null } : current))
    }
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
    if (!readOnlyMode()) {
      setWorkspaceSnapshot((current) =>
        current ? { ...current, activeWindowId: windowId } : current,
      )
    }
  }

  function focusWindow(windowId: string) {
    const item = state().windows.find((candidate) => candidate.id === windowId)
    if (!item) return
    selectCanvasTab(groupIdForCanvasWindow(item), windowId)
    fitBounds(item.bounds, 1)
  }

  function activateWindow(windowId: string) {
    const target = state().windows.find((candidate) => candidate.id === windowId)
    if (!target) return
    selectCanvasTab(groupIdForCanvasWindow(target), windowId)
  }

  function maximizeWindow(windowId: string) {
    if (!state().windows.some((window) => window.id === windowId)) return
    bringToFront(windowId)
    selectWindow(windowId)
    setMaximizedWindowId(windowId)
  }

  function bringToFront(windowId: string) {
    const target = state().windows.find((window) => window.id === windowId)
    const groupId = target ? groupIdForCanvasWindow(target) : windowId
    const definitions = windowDefinitions()
    setState((current) => ({
      ...current,
      windows: current.windows.map((window) =>
        (definitions.get(window.id)?.tabGroupId ?? window.id) === groupId
          ? { ...window, zIndex: current.nextZIndex }
          : window,
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

  function canvasFileOpenIntent(
    file: FileItem | null,
    options: {
      source?: WindowSource
      openedFromWindowId?: string | null
      tabGroupId?: string | null
      readerKind?: 'pdf' | 'folder' | 'book'
    },
  ): WorkspaceWindowOpenIntent {
    const identity = {
      source: options.source ?? DEFAULT_WORKSPACE_SOURCE,
      openedFromWindowId: options.openedFromWindowId,
      tabGroupId: options.tabGroupId,
    }
    if (!file || (file.isDirectory && !options.readerKind)) {
      return { ...identity, kind: 'browser', dir: file?.path ?? '' }
    }
    return options.readerKind
      ? { ...identity, kind: 'reader', file, readerKind: options.readerKind }
      : { ...identity, kind: 'viewer', file }
  }

  function addFileWindow(
    file: FileItem | null,
    point: { x: number; y: number },
    options: {
      duplicate?: boolean
      worldBounds?: CanvasRect
      readerKind?: 'pdf' | 'folder' | 'book'
      source?: WindowSource
      openedFromWindowId?: string | null
      tabGroupId?: string | null
      groupSourceWindowId?: string
    } = {},
  ) {
    const initial = workspaceSnapshot()
    if (!initial) return ''
    const intent = canvasFileOpenIntent(file, options)
    const initialPlan = planWorkspaceWindowOpen({
      windows: initial.windows,
      id: workspaceWindowId(initial.nextWindowId),
      reuseExisting: !!file && !options.duplicate,
      intent,
    })
    if (initialPlan.kind === 'existing') {
      focusWindow(initialPlan.windowId)
      return initialPlan.windowId
    }
    let createdId = ''
    const anchorId = selection()?.kind === 'window' ? selection()!.id : null
    setWorkspaceSnapshot((workspace) => {
      if (!workspace) return workspace
      const current = canvasViewFromWorkspace(workspace)
      const id = workspaceWindowId(workspace.nextWindowId)
      createdId = id
      const basePlan = planWorkspaceWindowOpen({
        windows: workspace.windows,
        id,
        reuseExisting: false,
        intent,
      })
      if (basePlan.kind !== 'create') return workspace
      const sizeKey = windowSizeKey(basePlan.definition)
      const worldBounds = options.worldBounds ?? fileWindowPlacement(point, current, sizeKey).bounds
      const plan = planWorkspaceWindowOpen({
        windows: workspace.windows,
        id,
        reuseExisting: false,
        intent,
        layout: { bounds: worldBounds, zIndex: current.nextZIndex },
      })
      if (plan.kind !== 'create') return workspace
      const definition = plan.definition
      const canvasWindow: CanvasWindow = {
        id,
        bounds: worldBounds,
        zIndex: current.nextZIndex,
      }
      const nextView = {
        ...current,
        windows: [...current.windows, canvasWindow],
        maximizedWindowId: null,
        nextItemId: workspace.nextWindowId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
      const groupedWindows = workspace.windows.map((window) =>
        options.groupSourceWindowId === window.id && !window.tabGroupId
          ? { ...window, tabGroupId: options.tabGroupId ?? window.id }
          : window,
      )
      return applyCanvasGeometryToWorkspace(nextView, {
        ...workspace,
        workspaceType: 'canvas',
        windows: [...groupedWindows, definition],
        activeWindowId: id,
        activeTabMap: options.tabGroupId
          ? { ...workspace.activeTabMap, [options.tabGroupId]: id }
          : workspace.activeTabMap,
        nextWindowId: nextView.nextItemId,
      })
    })
    if (createdId) {
      setSelection({ kind: 'window', id: createdId })
      setSelectedIds([createdId])
      scheduleEnsureWindowsVisible(anchorId ? [anchorId, createdId] : [createdId])
    }
    return createdId
  }

  function addFileTab(sourceWindowId: string, file: FileItem) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source) return ''
    const groupId = groupIdForCanvasWindow(source)
    const id = addFileWindow(
      file,
      { x: source.bounds.x, y: source.bounds.y },
      {
        duplicate: true,
        worldBounds: { ...source.bounds },
        source: definitionFor(source).source,
        openedFromWindowId: sourceWindowId,
        tabGroupId: groupId,
        groupSourceWindowId: sourceWindowId,
      },
    )
    if (!id) return ''
    return id
  }

  function openInCanvasSplit(sourceWindowId: string, file: FileItem) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source) return
    const id = addFileTab(sourceWindowId, file)
    if (!id) return
    setWorkspaceSnapshot((current) =>
      current ? WorkspaceDocumentCommands.setSplitLeft(current, sourceWindowId) : current,
    )
  }

  function addPinnedItem(file: FileItem, source: WindowSource) {
    if (readOnlyMode()) return
    const plan = planTaskbarPinAdd({
      pins: server.serverPinsList(),
      file,
      source,
      customIcons: settingsQuery.data?.customIcons ?? {},
    })
    if (plan.kind === 'add') void server.addPin(plan.pin).catch(() => undefined)
  }

  function removePinnedItem(pinId: string) {
    if (readOnlyMode()) return
    void server.removePin(pinId).catch(() => undefined)
  }

  async function selectCanvasPinned(pin: PinnedTaskbarItem) {
    if (pin.isVirtual) {
      const response = await fetch(
        `/api/virtual-directory/open?path=${encodeURIComponent(pin.path)}`,
      )
      if (!response.ok) return
      const target = (await response.json()).openTarget
      if (!isHermesOpenTarget(target)) return
      if (!target) return
      addHermesWindow(
        {
          name: pin.title,
          path: pin.path,
          isDirectory: false,
          isVirtual: true,
          size: 0,
          type: MediaType.OTHER,
          extension: '',
        },
        target,
        viewportCenterWorld(),
        undefined,
        pin.source,
      )
      return
    }
    const type = pin.isDirectory ? MediaType.FOLDER : getMediaTypeFromPath(pin.path)
    if (type === MediaType.VIDEO || type === MediaType.AUDIO) return
    addFileWindow(
      {
        name: pin.title,
        path: pin.path,
        type,
        size: 0,
        extension: pin.path.split('.').at(-1) ?? '',
        isDirectory: pin.isDirectory,
        isVirtual: false,
      },
      viewportCenterWorld(),
      { source: pin.source },
    )
  }

  async function addTextEditor(
    point = viewportCenterWorld(),
    content = '',
    requestedTitle = 'Canvas note',
    requestedDirectory = '',
  ) {
    if (readOnlyMode()) return false
    const directory = requestedDirectory || writableDirectories()[0]
    if (!directory) {
      void showAppAlert(
        'Configure an editable folder or knowledge base before creating text files.',
        'Canvas',
      )
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
      void showAppAlert(
        error instanceof Error ? error.message : 'Could not create text file.',
        'Canvas',
      )
      return false
    }
  }

  function openNoteComposer(
    point = viewportCenterWorld(),
    initialContent = '',
    requestedTitle = 'Canvas note',
  ) {
    if (readOnlyMode()) return
    if (!writableDirectories().length) {
      void showAppAlert(
        'Configure an editable folder or knowledge base before creating text files.',
        'Canvas',
      )
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

  function deleteSelected() {
    const selectedGroups = new Set(
      state()
        .windows.filter((item) => selectedIds().includes(item.id))
        .map((item) => groupIdForCanvasWindow(item)),
    )
    if (!selectedGroups.size) return
    void closeWindowGroups(selectedGroups)
  }

  function nudgeSelected(dx: number, dy: number, resize = false) {
    if (readOnlyMode()) return
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

  function openFromBrowser(sourceWindowId: string, file: FileItem, duplicate = false) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source) return
    const bounds = source.bounds
    const createdId = addFileWindow(
      file,
      { x: bounds.x + bounds.width + CANVAS_GRID_SIZE, y: bounds.y },
      {
        duplicate,
        source: definitionFor(source).source,
        openedFromWindowId: sourceWindowId,
      },
    )
    if (createdId) scheduleEnsureWindowsVisible([sourceWindowId, createdId])
  }

  function openReaderFromBrowser(sourceWindowId: string, file: FileItem) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source || !file.isDirectory) return
    const createdId = addFileWindow(
      file,
      { x: source.bounds.x + source.bounds.width + CANVAS_GRID_SIZE, y: source.bounds.y },
      {
        duplicate: true,
        readerKind: 'folder',
        source: definitionFor(source).source,
        openedFromWindowId: sourceWindowId,
      },
    )
    if (createdId) scheduleEnsureWindowsVisible([sourceWindowId, createdId])
  }

  function openHermesFromBrowser(sourceWindowId: string, file: FileItem, target: HermesOpenTarget) {
    const source = state().windows.find((window) => window.id === sourceWindowId)
    if (!source) return
    const sourceBounds = source.bounds
    addHermesWindow(
      file,
      target,
      {
        x: sourceBounds.x + sourceBounds.width + CANVAS_GRID_SIZE,
        y: sourceBounds.y,
      },
      undefined,
      definitionFor(source).source,
      sourceWindowId,
    )
  }

  function addHermesWindow(
    file: FileItem,
    target: HermesOpenTarget,
    point: { x: number; y: number },
    requestedBounds?: CanvasRect,
    source: WindowSource = DEFAULT_WORKSPACE_SOURCE,
    openedFromWindowId?: string,
  ) {
    const initial = workspaceSnapshot()
    if (!initial) return ''
    const intent: WorkspaceWindowOpenIntent = {
      kind: 'hermes',
      file,
      target,
      draftId: target.type === 'hermesDraft' ? crypto.randomUUID() : undefined,
      source,
      openedFromWindowId,
    }
    const initialPlan = planWorkspaceWindowOpen({
      windows: initial.windows,
      id: workspaceWindowId(initial.nextWindowId),
      reuseExisting: true,
      intent,
    })
    if (initialPlan.kind === 'existing') {
      focusWindow(initialPlan.windowId)
      return initialPlan.windowId
    }
    let createdId = ''
    const anchorId = selection()?.kind === 'window' ? selection()!.id : null
    setWorkspaceSnapshot((workspace) => {
      if (!workspace) return workspace
      const current = canvasViewFromWorkspace(workspace)
      const id = workspaceWindowId(workspace.nextWindowId)
      createdId = id
      const worldBounds = fileWindowPlacement(point, current, 'hermes').bounds
      const bounds = requestedBounds ?? worldBounds
      const plan = planWorkspaceWindowOpen({
        windows: workspace.windows,
        id,
        reuseExisting: false,
        intent,
        layout: { bounds, zIndex: current.nextZIndex },
      })
      if (plan.kind !== 'create') return workspace
      const definition = plan.definition
      const canvasWindow: CanvasWindow = {
        id,
        bounds,
        zIndex: current.nextZIndex,
      }
      const nextView = {
        ...current,
        windows: [...current.windows, canvasWindow],
        maximizedWindowId: null,
        nextItemId: workspace.nextWindowId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
      return applyCanvasGeometryToWorkspace(nextView, {
        ...workspace,
        workspaceType: 'canvas',
        windows: [...workspace.windows, definition],
        activeWindowId: id,
        nextWindowId: nextView.nextItemId,
      })
    })
    if (createdId) {
      setSelection({ kind: 'window', id: createdId })
      setSelectedIds([createdId])
      scheduleEnsureWindowsVisible(anchorId ? [anchorId, createdId] : [createdId])
    }
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
      { provider: 'hermes', type: 'hermesDraft', readOnly: false },
      point,
    )
  }

  function bindHermesSession(windowId: string, sessionId: string) {
    if (readOnlyMode()) return
    updateCanvasWorkspace((current) =>
      WorkspaceDocumentCommands.bindHermesSession(current, windowId, sessionId),
    )
  }

  function navigateDir(windowId: string, dir: string) {
    updateCanvasWorkspace((current) =>
      WorkspaceDocumentCommands.navigateDir(current, windowId, dir),
    )
  }

  function updateViewing(windowId: string, path: string) {
    updateCanvasWorkspace((current) =>
      WorkspaceDocumentCommands.updateViewing(current, windowId, path),
    )
  }

  function sizeVideoWindow(windowId: string, videoWidth: number, videoHeight: number) {
    if (readOnlyMode()) return
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

  async function closeWindow(windowId: string) {
    if (readOnlyMode()) return
    const target = windowDefinitions().get(windowId)
    if (!target || !(await canCloseHermesWindow(target.hermes))) return
    const base = workspaceSnapshot()
    if (!base) return
    const result = WorkspaceDocumentCommands.closeTab(base, windowId)
    setWorkspaceSnapshot(result.state)
    const removed = result.removed[0]
    const viewing = removed?.initialState.viewing
    if (viewing && playbackSession.getSnapshot().currentItem?.locator === viewing) {
      playbackSession.dispatch({ type: 'stop' })
    }
    if (lastAudioWindowId() === windowId) setLastAudioWindowId(null)
    discardHermesDraft(removed?.hermes)
    setSelectedIds((ids) => ids.filter((id) => id !== windowId))
    if (selection()?.id === windowId) setSelection(null)
  }

  async function closeWindowGroups(groupIds: ReadonlySet<string>) {
    if (readOnlyMode()) return
    const targets = state()
      .windows.filter((window) => groupIds.has(groupIdForCanvasWindow(window)))
      .map(definitionFor)
    if (!targets.length) return
    if (!(await confirmWorkspaceWindowsSequentially(targets, canCloseHermesWindow))) return
    const base = workspaceSnapshot()
    if (!base) return
    const result = WorkspaceDocumentCommands.closeGroups(base, groupIds)
    const removedIds = new Set(result.removed.map((target) => target.id))
    const currentItem = playbackSession.getSnapshot().currentItem
    if (
      currentItem &&
      result.removed.some((target) => target.initialState.viewing === currentItem.locator)
    ) {
      playbackSession.dispatch({ type: 'stop' })
    }
    setWorkspaceSnapshot(result.state)
    for (const target of result.removed) discardHermesDraft(target.hermes)
    const audioWindowId = lastAudioWindowId()
    if (audioWindowId && removedIds.has(audioWindowId)) setLastAudioWindowId(null)
    setSelectedIds((ids) => ids.filter((id) => !removedIds.has(id)))
    const selected = selection()
    if (selected && removedIds.has(selected.id)) setSelection(null)
  }

  function closeWindowGroup(groupId: string) {
    void closeWindowGroups(new Set([groupId]))
  }

  function startWindowMove(windowId: string, event: PointerEvent) {
    if (readOnlyMode()) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const before = cloneState(state())
    const item = before.windows.find((window) => window.id === windowId)
    if (!item) return
    const selected = selectedIds().includes(windowId) ? selectedIds() : [windowId]
    const selectedGroups = new Set(
      before.windows
        .filter((window) => selected.includes(window.id))
        .map((window) => groupIdForCanvasWindow(window)),
    )
    const ids = before.windows
      .filter((window) => selectedGroups.has(groupIdForCanvasWindow(window)))
      .map((window) => window.id)
    const windowStarts = new Map(
      before.windows
        .filter((window) => ids.includes(window.id))
        .map((window) => [window.id, window.bounds]),
    )
    const groupStarts = new Map(
      before.windows
        .filter((window) => selectedGroups.has(groupIdForCanvasWindow(window)))
        .map((window) => [groupIdForCanvasWindow(window), window.bounds]),
    )
    if (!crossWorkspaceTransfer!.begin(ids)) return
    bringToFront(windowId)
    if (!selectedIds().includes(windowId)) selectWindow(windowId)
    const startX = event.clientX
    const startY = event.clientY
    const startCamera = before.camera
    let latestX = startX
    let latestY = startY
    let frame: number | undefined
    let previousFrameTime: number | undefined
    clearCanvasCrossWorkspaceHover()
    setGeometryActive(true)
    setDraggedCanvasGroupId(groupIdForCanvasWindow(item))
    const dragDelta = (camera: InfiniteCanvasState['camera']) => {
      const dx = (latestX - startX - (camera.x - startCamera.x)) / camera.zoom
      const dy = (latestY - startY - (camera.y - startCamera.y)) / camera.zoom
      return { dx: snapCanvasValue(dx), dy: snapCanvasValue(dy) }
    }
    const updateDragPreview = (camera: InfiniteCanvasState['camera']) => {
      const delta = dragDelta(camera)
      for (const card of worldEl?.querySelectorAll<HTMLElement>('[data-canvas-group-id]') ?? []) {
        if (groupStarts.has(card.dataset.canvasGroupId ?? '')) {
          card.style.translate = `${delta.dx}px ${delta.dy}px`
        }
      }
      return delta
    }
    const tick = (time: number) => {
      const elapsed = previousFrameTime === undefined ? 0 : Math.min(32, time - previousFrameTime)
      previousFrameTime = time
      const rect = viewportEl?.getBoundingClientRect()
      if (rect && elapsed > 0) {
        const velocity = canvasEdgeAutoPanVelocity(latestX, latestY, rect)
        if (velocity.x || velocity.y) {
          const camera = state().camera
          const nextCamera = {
            ...camera,
            x: camera.x + velocity.x * (elapsed / 1000),
            y: camera.y + velocity.y * (elapsed / 1000),
          }
          cameraInteractionRevision += 1
          setState((current) => ({ ...current, camera: nextCamera }))
          updateDragPreview(nextCamera)
        }
      }
      frame = window.requestAnimationFrame(tick)
    }
    const move = (next: PointerEvent) => {
      next.preventDefault()
      latestX = next.clientX
      latestY = next.clientY
      if (next.clientX <= 20) openWorkspacePanel()
      const pointerElement = document.elementFromPoint(next.clientX, next.clientY)
      const destinationId =
        pointerElement?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId
      if (destinationId && destinationId !== workspaceId()) {
        crossWorkspaceTransfer!.hover(destinationId)
      } else if (!pointerElement?.closest('[data-testid="workspace-switcher"]')) {
        clearCanvasCrossWorkspaceHover()
      }
      updateDragPreview(state().camera)
      setCanvasMergeTarget(
        canvasMergeTargetAt(next.clientX, next.clientY, groupIdForCanvasWindow(item)),
      )
    }
    const finish = (cancelled: boolean) => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      for (const card of worldEl?.querySelectorAll<HTMLElement>('[data-canvas-group-id]') ?? []) {
        if (groupStarts.has(card.dataset.canvasGroupId ?? '')) card.style.translate = ''
      }
      if (!cancelled) {
        const delta = dragDelta(state().camera)
        setState((current) => ({
          ...current,
          windows: current.windows.map((window) => {
            const start = windowStarts.get(window.id)
            return start
              ? {
                  ...window,
                  bounds: {
                    ...start,
                    x: snapCanvasValue(start.x + delta.dx),
                    y: snapCanvasValue(start.y + delta.dy),
                  },
                }
              : window
          }),
        }))
      }
      setGeometryActive(false)
      const mergeTarget = canvasMergeTarget()
      setCanvasMergeTarget(null)
      setDraggedCanvasGroupId('')
      const dropTarget = !cancelled
        ? document.elementFromPoint(latestX, latestY)?.closest<HTMLElement>('[data-workspace-id]')
            ?.dataset.workspaceId
        : undefined
      if (cancelled) {
        crossWorkspaceTransfer!.cancel()
      } else if (dropTarget && dropTarget !== workspaceId()) {
        void crossWorkspaceTransfer!.drop(dropTarget)
      } else if (!cancelled && mergeTarget) {
        crossWorkspaceTransfer!.finishLocal()
        mergeCanvasGroup(windowId, mergeTarget)
      } else {
        crossWorkspaceTransfer!.finishLocal()
        setWorkspacePanelOpen(false)
      }
    }
    frame = window.requestAnimationFrame(tick)
    startCanvasPointerGesture({
      pointerId: event.pointerId,
      captureTarget: event.currentTarget as HTMLElement,
      move,
      commit: (endEvent) => {
        latestX = endEvent.clientX
        latestY = endEvent.clientY
        finish(false)
      },
      cancel: () => finish(true),
    })
  }

  function startCanvasTabPull(groupId: string, windowId: string, event: PointerEvent) {
    if (readOnlyMode() || event.button !== 0) return
    if (windowDefinitions().get(windowId)?.tabPinned) return
    event.preventDefault()
    event.stopPropagation()
    clearCanvasCrossWorkspaceHover()
    const startX = event.clientX
    const startY = event.clientY
    const beforeWorkspace = workspaceSnapshot() ? structuredClone(workspaceSnapshot()!) : null
    let detachedProjection = beforeWorkspace
    let pulled = false
    let detachedCard: HTMLElement | null = null
    let latestBounds: CanvasRect | null = null
    const move = (next: PointerEvent) => {
      if (!pulled && Math.hypot(next.clientX - startX, next.clientY - startY) < 40) return
      if (!pulled) {
        const point = screenToWorld(next.clientX, next.clientY)
        setWorkspaceSnapshot((current) => {
          if (!current) return current
          const view = canvasViewFromWorkspace(current)
          const target = view.windows.find((window) => window.id === windowId)
          if (!target) return current
          const detachedBounds = {
            ...target.bounds,
            x: point.x - 32,
            y: point.y - 16,
          }
          const detached = WorkspaceDocumentCommands.splitWindowFromGroup(
            current,
            windowId,
            detachedBounds,
          )
          if (detached === current) return current
          detachedProjection = {
            ...detached,
            windows: detached.windows.map((window) =>
              window.id === windowId
                ? {
                    ...window,
                    layout: { ...window.layout, zIndex: view.nextZIndex },
                  }
                : window,
            ),
            canvas: detached.canvas
              ? { ...detached.canvas, nextZIndex: view.nextZIndex + 1 }
              : detached.canvas,
          }
          return detachedProjection
        })
        if (detachedProjection === beforeWorkspace) return
        pulled = true
        selectWindow(windowId)
        setGeometryActive(true)
        setDraggedCanvasGroupId(windowId)
        detachedCard =
          worldEl?.querySelector<HTMLElement>(`[data-canvas-group-id="${CSS.escape(windowId)}"]`) ??
          null
      }
      const point = screenToWorld(next.clientX, next.clientY)
      const current = state().windows.find((window) => window.id === windowId)
      if (current) {
        latestBounds = { ...current.bounds, x: point.x - 32, y: point.y - 16 }
        if (detachedCard) {
          const visual = canvasWindowVisualBounds(latestBounds)
          detachedCard.style.left = `${visual.x}px`
          detachedCard.style.top = `${visual.y}px`
        }
      }
      setCanvasMergeTarget(canvasMergeTargetAt(next.clientX, next.clientY, windowId))
    }
    const finish = (cancelled: boolean) => {
      if (detachedCard) {
        detachedCard.style.left = ''
        detachedCard.style.top = ''
      }
      if (cancelled && pulled && beforeWorkspace && detachedProjection) {
        setWorkspaceSnapshot((current) =>
          current
            ? WorkspaceDocumentCommands.rollbackTabPull(
                current,
                beforeWorkspace,
                detachedProjection!,
                groupId,
              )
            : current,
        )
      } else if (pulled && latestBounds) {
        setState((current) => ({
          ...current,
          windows: current.windows.map((window) =>
            window.id === windowId ? { ...window, bounds: latestBounds! } : window,
          ),
        }))
      }
      if (pulled) {
        setGeometryActive(false)
      }
      const target = canvasMergeTarget()
      setCanvasMergeTarget(null)
      setDraggedCanvasGroupId('')
      if (!cancelled && pulled && target) mergeCanvasGroup(windowId, target)
    }
    startCanvasPointerGesture({
      pointerId: event.pointerId,
      move,
      commit: () => finish(false),
      cancel: () => finish(true),
    })
  }

  function startWindowResize(windowId: string, direction: ResizeDirection, event: PointerEvent) {
    if (readOnlyMode()) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const item = state().windows.find((window) => window.id === windowId)
    if (!item) return
    const groupId = groupIdForCanvasWindow(item)
    const start = item.bounds
    const startX = event.clientX
    const startY = event.clientY
    const card = worldEl?.querySelector<HTMLElement>(
      `[data-canvas-group-id="${CSS.escape(groupId)}"]`,
    )
    let latestBounds = start
    setGeometryActive(true)
    const move = (next: PointerEvent) => {
      latestBounds = resizeRect(
        start,
        (next.clientX - startX) / state().camera.zoom,
        (next.clientY - startY) / state().camera.zoom,
        direction,
      )
      const visual = canvasWindowVisualBounds(latestBounds)
      if (card) {
        card.style.left = `${visual.x}px`
        card.style.top = `${visual.y}px`
        card.style.width = `${visual.width}px`
        card.style.height = `${visual.height}px`
      }
    }
    const finish = (shouldCommit: boolean) => {
      setGeometryActive(false)
      const current = state()
      if (card) {
        card.style.left = ''
        card.style.top = ''
        card.style.width = ''
        card.style.height = ''
      }
      if (!shouldCommit) return
      const after: InfiniteCanvasState = {
        ...current,
        windows: current.windows.map((window) =>
          groupIdForCanvasWindow(window) === groupId ? { ...window, bounds: latestBounds } : window,
        ),
        windowSizeByType: {
          ...current.windowSizeByType,
          [windowSizeKey(definitionFor(item))]: {
            width: latestBounds.width,
            height: latestBounds.height,
          },
        },
      }
      setState(after)
    }
    startCanvasPointerGesture({
      pointerId: event.pointerId,
      captureTarget: event.currentTarget as HTMLElement,
      move,
      commit: () => finish(true),
      cancel: () => finish(false),
    })
  }

  function startCanvasSplitPaneDrag(groupId: string, event: PointerEvent) {
    if (readOnlyMode() || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const card = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-canvas-group-id]')
    if (!card) return
    const before = workspaceSnapshot()
    if (!before) return
    let splitProjection = before
    const move = (next: PointerEvent) => {
      const rect = card.getBoundingClientRect()
      const fraction = (next.clientX - rect.left) / rect.width
      setWorkspaceSnapshot((current) => {
        if (!current) return current
        splitProjection = WorkspaceDocumentCommands.setSplitFraction(current, groupId, fraction)
        return splitProjection
      })
    }
    startCanvasPointerGesture({
      pointerId: event.pointerId,
      captureTarget: event.currentTarget as HTMLElement,
      move,
      commit: () => {},
      cancel: () =>
        setWorkspaceSnapshot((current) =>
          current
            ? WorkspaceDocumentCommands.rollbackSplitFraction(
                current,
                before,
                splitProjection,
                groupId,
              )
            : current,
        ),
    })
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
    cameraInteractionRevision += 1
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

  onSettled(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (dialog()) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (editableTarget(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        setSpaceHeld(true)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
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
    // eslint-disable-next-line solid/reactivity
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    }
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
        definitionFor(window).type === 'viewer' &&
        getMediaTypeFromPath(definitionFor(window).initialState.viewing ?? '') === MediaType.AUDIO,
    )
    const currentWindow =
      current.mode === 'audio' && current.currentItem
        ? stateWindows.find(
            (window) =>
              definitionFor(window).type === 'viewer' &&
              definitionFor(window).initialState.viewing === current.currentItem?.locator,
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
  const windowActions: WorkspaceWindowActions = {
    browser: {
      navigate: navigateDir,
      openViewer: openFromBrowser,
      openReader: openReaderFromBrowser,
      openVirtual: (windowId, file, target) => {
        if (isHermesOpenTarget(target)) openHermesFromBrowser(windowId, file, target)
      },
      addToTaskbar: (windowId, file) => {
        const current = state().windows.find((item) => item.id === windowId)
        if (current) addPinnedItem(file, definitionFor(current).source)
      },
      openInNewTab: (windowId, file) =>
        addFileTab(windowId, fileItemFromDrag(file.path, file.isDirectory)),
      openInSplitView: openInCanvasSplit,
      play: (windowId, path) => openFromBrowser(windowId, fileItemFromDrag(path, false)),
      openInNewWindow: (windowId, file) => openFromBrowser(windowId, file, true),
      newTabLabel: 'Open in new canvas tab',
    },
    viewer: {
      updateViewing,
      videoMetadata: sizeVideoWindow,
      audioActivate: handleAudioActivate,
    },
    hermes: {
      sessionCreated: bindHermesSession,
      titleChanged: (windowId, title) =>
        updateCanvasWorkspace((current) =>
          WorkspaceDocumentCommands.renameWindow(current, windowId, title),
        ),
    },
  }

  return (
    <div
      data-workspace-opened={workspaceRegistry.opened() ? '' : undefined}
      class={`canvas-layout fixed inset-0 flex select-none flex-col overflow-hidden bg-background text-foreground ${
        workspaceRegistry.opened() ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
    >
      <Show when={!workspaceRegistry.editable()}>
        <div class='fixed left-1/2 top-2 z-[100002] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-lg'>
          Read only — workspace is open elsewhere
        </div>
      </Show>
      <WorkspaceTaskbar fixed scrollable class='canvas-taskbar'>
        <button
          type='button'
          title='Canvas outline'
          aria-label='Canvas outline'
          class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
          onClick={() => setOutlineOpen((open) => !open)}
        >
          <PanelLeft class='h-5 w-5' stroke-width={1.75} />
        </button>
        <button
          type='button'
          title='Workspaces'
          aria-label='Open workspaces'
          data-testid='workspace-taskbar-workspaces'
          data-workspace-toggle
          class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
          onClick={toggleWorkspacePanel}
        >
          <PanelsTopLeft class='h-5 w-5' stroke-width={1.75} />
        </button>
        <div class='flex min-w-0 flex-1 items-center'>
          <Show when={server.serverPinsList().length > 0}>
            <WorkspaceTaskbarPins
              items={server.serverPinsList()}
              customIcons={settingsQuery.data?.customIcons ?? {}}
              fileIconContext={fileIconContext()}
              onSelect={(pin) => void selectCanvasPinned(pin)}
              onContextMenu={(pin, event) => {
                event.preventDefault()
                setPinMenu({ x: event.clientX, y: event.clientY, pinId: pin.id })
              }}
            />
          </Show>
          <Show when={server.serverPinsList().length > 0 && selectedWindow()}>
            <div class='w-2 shrink-0' aria-hidden='true' />
          </Show>
          <div class='flex min-w-0 flex-1 items-center' data-testid='canvas-navigation'>
            <Show when={selectedWindow()}>
              {(item) => (
                <button
                  type='button'
                  data-testid='canvas-window-breadcrumb'
                  class='min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-muted'
                  onClick={() => focusWindow(item().id)}
                >
                  {definitionFor(item()).title}
                </button>
              )}
            </Show>
          </div>
        </div>
        <div class={WORKSPACE_TASKBAR_END_CLASS}>
          <WorkspaceSaveStatus />
          <div data-testid='canvas-create-tools' class='flex items-center gap-1'>
            <Show when={!maximizedWindowId()}>
              <div
                data-testid='canvas-zoom-control'
                class='flex h-7 shrink-0 items-center gap-1 border-r border-border pr-1'
                onWheel={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  const direction = Math.sign(event.deltaY || event.deltaX)
                  if (direction !== 0) {
                    setZoomFromControl(state().camera.zoom - direction * 0.05)
                  }
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
                  class='[&::-webkit-slider-thumb]:bg-primary h-1 w-16 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                  onInput={(event) => setZoomFromControl(event.currentTarget.valueAsNumber / 100)}
                />
                <button
                  type='button'
                  title='Reset zoom'
                  aria-label={`Reset canvas zoom, currently ${Math.round(state().camera.zoom * 100)} percent`}
                  class='h-7 min-w-9 px-1 text-[11px] tabular-nums hover:bg-muted'
                  onClick={() => zoomBy(1 / state().camera.zoom)}
                >
                  {Math.round(state().camera.zoom * 100)}%
                </button>
              </div>
            </Show>
            <button
              type='button'
              class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
              title='Fit all canvas cards'
              aria-label='Fit all canvas cards'
              onClick={fitAllWindows}
            >
              <Maximize2 class='size-3.5' />
            </button>
            <Show when={lastAudioWindow()}>
              {(item) => (
                <button
                  type='button'
                  data-testid='canvas-playing-audio-focus'
                  aria-label={`Focus audio player: ${definitionFor(item()).title}`}
                  title={`Focus audio player: ${definitionFor(item()).title}`}
                  class='inline-flex size-7 items-center justify-center text-primary hover:bg-primary/10'
                  onClick={() => focusWindow(item().id)}
                >
                  <Volume2 class='size-4' />
                </button>
              )}
            </Show>
            <FileSearchButton
              title='Search library and open a new canvas window'
              testId='canvas-search-trigger'
              class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
              open={searchOpen}
              onOpenChange={setSearchOpen}
              onSelect={(result) =>
                addFileWindow(fileSearchResultToFileItem(result), viewportCenterWorld())
              }
            />
          </div>
          <WorkspaceTaskbarAudio
            onShowVideo={(path) => {
              const item = state().windows.find(
                (window) => definitionFor(window).initialState.viewing === path,
              )
              if (item) focusWindow(item.id)
            }}
            onStopPlayback={() => playbackSession.dispatch({ type: 'stop' })}
          />
          <WorkspaceTaskbarSettings
            workspaceTransition={() => settingsQuery.data?.workspaceTransition ?? 'fade'}
            onWorkspaceTransitionChange={(value) => void server.setWorkspaceTransition(value)}
          />
        </div>
      </WorkspaceTaskbar>

      <FloatingContextMenu
        state={pinMenu}
        anchor={(current) => ({ x: current.x, y: current.y })}
        onDismiss={() => setPinMenu(null)}
        zIndex={FLOATING_Z_PIN_MENU}
        data-slot='pin-context-menu'
        pinContextMenuRoot
      >
        {(current) => (
          <button
            type='button'
            data-slot='context-menu-item'
            class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
            role='menuitem'
            onClick={() => {
              removePinnedItem(current.pinId)
              setPinMenu(null)
            }}
          >
            Unpin
          </button>
        )}
      </FloatingContextMenu>

      <WorkspaceSwitcher
        open={workspacePanelOpen()}
        activeId={workspaceId()}
        registry={workspaceRegistry.registry()}
        editable={workspaceRegistry.editable()}
        onToggle={() => {
          clearCanvasCrossWorkspaceHover()
          toggleWorkspacePanel()
        }}
        onDismiss={() => {
          clearCanvasCrossWorkspaceHover()
          setWorkspacePanelOpen(false)
        }}
        onSelect={(id) =>
          void settleCanvasGesturesBeforeNavigation().then(() =>
            workspaceRegistry.transition(() => navigateSearchParams({ ws: id }, 'push')),
          )
        }
        onOpenNewTab={(id) =>
          window.open(`/workspace?ws=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer')
        }
        onCreate={() =>
          void settleCanvasGesturesBeforeNavigation().then(() =>
            workspaceRegistry.transition(() =>
              navigateSearchParams({ ws: crypto.randomUUID() }, 'push'),
            ),
          )
        }
        onTakeControl={() => void workspaceRegistry.takeControl()}
        onRename={(id, name) => workspaceRegistry.updateMetadataFor(id, { name })}
        onIcon={(id, icon, iconColor) =>
          workspaceRegistry.updateMetadataFor(id, { icon, iconColor })
        }
        onDelete={lifecycle.deleteWorkspace}
        onConvert={lifecycle.convertWorkspace}
        onReorder={workspaceRegistry.reorder}
        draggingWindow={crossWorkspaceTransfer!.active()}
        hoverTarget={crossWorkspaceTransfer!.hoverTarget()}
        transferReady={crossWorkspaceTransfer!.ready()}
      />

      <Show when={outlineOpen()}>
        <aside class='fixed top-0 bottom-8 left-0 z-[110000] flex w-72 flex-col border-r border-border bg-card/95 shadow-xl backdrop-blur'>
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
                    {windowIcon(definitionFor(item), fileIconContext(), 'sm')}
                  </span>
                  <span class='truncate'>{definitionFor(item).title}</span>
                </button>
              )}
            </For>
          </div>
        </aside>
      </Show>

      <div
        ref={(element) => (viewportEl = element)}
        data-testid='infinite-canvas'
        class={[
          'relative min-h-0 flex-1 overflow-hidden bg-muted/20 outline-none',
          { 'cursor-grab': spaceHeld(), 'cursor-grabbing': geometryActive() },
        ]}
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
          if (data.virtualOpenTarget && isHermesOpenTarget(data.virtualOpenTarget)) {
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
            </div>
          </div>
        </Show>
        <div
          ref={(element) => (worldEl = element)}
          data-testid='canvas-world'
          class={[
            'absolute top-0 left-0 origin-top-left will-change-transform',
            { 'transition-transform duration-200 ease-out': cameraAnimating() },
          ]}
          style={{
            transform: `translate3d(${state().camera.x}px, ${state().camera.y}px, 0) scale(${state().camera.zoom})`,
          }}
        >
          <For each={canvasGroupIds()}>
            {(groupId) => {
              const members = createMemo(() => groupWindows(groupId))
              const item = createMemo(() => activeWindowForGroup(groupId))
              const split = createMemo(() => workspaceSnapshot()?.tabGroupSplits?.[groupId])
              const memberIds = createMemo(() => members().map((member) => member.id))
              const worldBounds = createMemo(
                () => members()[0]?.bounds ?? item()?.bounds ?? EMPTY_CANVAS_BOUNDS,
              )
              const maximized = () => {
                const active = item()
                return active ? maximizedWindowId() === active.id : false
              }
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
              const selected = () => members().some((member) => selectedIds().includes(member.id))
              const details = createMemo(() => {
                const active = item()
                return active
                  ? canvasWindowDetails(definitionFor(active))
                  : { kind: '', path: null }
              })
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
              const showSummaryPath = createMemo(() => {
                const active = item()
                return (
                  Boolean(
                    active && details().path && details().path !== definitionFor(active).title,
                  ) &&
                  summaryMetrics().screenWidth >= 180 &&
                  summaryMetrics().screenHeight >= 145
                )
              })
              const windowShadow = createMemo(() => {
                const zoom = state().camera.zoom
                const lift = 4 / zoom
                const blur = 14 / zoom
                const focusGlow = selected() ? `, 0 0 ${6 / zoom}px rgba(59, 130, 246, 0.42)` : ''
                return `0 ${lift}px ${blur}px rgba(0, 0, 0, 0.55)${focusGlow}`
              })
              return (
                <Show when={item()}>
                  <div
                    data-testid='canvas-window'
                    data-window-id={item()!.id}
                    data-canvas-group-id={groupId}
                    class={[
                      'absolute overflow-visible bg-background',
                      {
                        'rounded-lg': !maximized(),
                        'border border-border shadow-2xl outline outline-1 -outline-offset-1 outline-border':
                          liveWindowChrome(),
                        'border-border shadow-black/20': liveWindowChrome() && selected(),
                        'invisible pointer-events-none':
                          state().camera.zoom < FAR_ZOOM && !maximized(),
                      },
                    ]}
                    style={{
                      left: `${visualBounds().x}px`,
                      top: `${visualBounds().y}px`,
                      width: `${visualBounds().width}px`,
                      height: `${visualBounds().height}px`,
                      transform: maximized() ? `scale(${1 / state().camera.zoom})` : undefined,
                      'transform-origin': 'top left',
                      'box-shadow': liveWindowChrome() ? undefined : windowShadow(),
                      opacity:
                        canvasMergeTarget() && draggedCanvasGroupId() === groupId
                          ? 0.55
                          : undefined,
                      'z-index': maximized()
                        ? 2000000
                        : selected()
                          ? 1000000 + item()!.zIndex
                          : item()!.zIndex,
                    }}
                    onPointerDown={(event) => {
                      selectWindow(item()!.id, event.ctrlKey || event.metaKey || event.shiftKey)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                  >
                    <WorkspaceWindowTitlebar
                      groupId={groupId}
                      tabs={() => members().map(definitionFor)}
                      visibleTabId={() => item()!.id}
                      active={selected()}
                      fileIconContext={fileIconContext}
                      maximized={maximized}
                      rootTestId='canvas-window-titlebar'
                      height={titlebarHeight}
                      actionSize={titlebarHeight}
                      actionIconScale={actionIconScale}
                      rounded={() => !maximized()}
                      showTabs={liveWindowChrome}
                      mergeHighlightInsertIndex={() =>
                        canvasMergeTarget()?.groupId === groupId
                          ? canvasMergeTarget()!.insertIndex
                          : null
                      }
                      splitLeftTabId={() => split()?.leftTabId}
                      onActivateTab={selectCanvasTab}
                      onFocusWindow={activateWindow}
                      onCloseTab={(windowId) => void closeWindow(windowId)}
                      onToggleTabPinned={toggleCanvasTabPinned}
                      onTabPullStart={startCanvasTabPull}
                      onExitSplitView={() =>
                        updateCanvasWorkspace((current) =>
                          WorkspaceDocumentCommands.exitSplit(current, groupId),
                        )
                      }
                      onUseAsSplitLeftTab={(tabId) =>
                        updateCanvasWorkspace((current) =>
                          WorkspaceDocumentCommands.setSplitLeft(current, tabId),
                        )
                      }
                      onPointerDown={(event) => {
                        if (maximized()) return
                        const target = event.target as HTMLElement
                        const tab = target.closest('[data-workspace-tab-id]')
                        if (!tab || members().length === 1) startWindowMove(item()!.id, event)
                      }}
                      onToggleMaximize={() =>
                        maximized() ? setMaximizedWindowId(null) : maximizeWindow(item()!.id)
                      }
                      onClose={readOnlyMode() ? undefined : () => closeWindowGroup(groupId)}
                    />
                    <div
                      data-canvas-window-content
                      class={[
                        'absolute right-0 bottom-0 left-0 overflow-hidden text-sm text-muted-foreground',
                        { 'rounded-b-lg': !maximized() },
                      ]}
                      style={{ top: `${titlebarHeight()}px` }}
                      onContextMenu={(event) => event.stopPropagation()}
                    >
                      <div
                        class={[
                          'flex h-full',
                          {
                            'invisible pointer-events-none':
                              state().camera.zoom < LIVE_ZOOM && !maximized(),
                          },
                        ]}
                      >
                        <For each={memberIds()}>
                          {(paneId, index) => {
                            const pane = createMemo(() =>
                              state().windows.find((window) => window.id === paneId),
                            )
                            const paneVisible = () =>
                              paneId === item()!.id || paneId === split()?.leftTabId
                            return (
                              <>
                                <Show
                                  when={
                                    split() &&
                                    paneId === item()!.id &&
                                    paneId !== split()?.leftTabId
                                  }
                                >
                                  <div
                                    data-testid='workspace-split-divider'
                                    data-no-window-drag
                                    class='w-1.5 shrink-0 cursor-col-resize border-border bg-muted/40 hover:bg-primary/25'
                                    style={{
                                      'border-left-width': '1px',
                                      'border-right-width': '1px',
                                      order: 1,
                                    }}
                                    onPointerDown={(event) =>
                                      startCanvasSplitPaneDrag(groupId, event)
                                    }
                                  />
                                </Show>
                                <div
                                  data-canvas-pane-id={paneId}
                                  class={`h-full min-w-0 border-r border-border last:border-r-0 ${
                                    paneVisible() ? '' : 'hidden'
                                  }`}
                                  aria-hidden={paneVisible() ? 'false' : 'true'}
                                  style={{
                                    width: !split()
                                      ? '100%'
                                      : paneId === split()?.leftTabId
                                        ? `${(split()?.leftPaneFraction ?? 0.5) * 100}%`
                                        : `${(1 - (split()?.leftPaneFraction ?? 0.5)) * 100}%`,
                                    order: split()
                                      ? paneId === split()?.leftTabId
                                        ? 0
                                        : 2
                                      : index(),
                                  }}
                                >
                                  <ApplicationWindowContent
                                    windowId={() => paneId}
                                    definition={() => {
                                      const current = pane()
                                      return current ? definitionFor(current) : undefined
                                    }}
                                    windowState={workspace}
                                    visible={paneVisible}
                                    active={() => selection()?.id === paneId}
                                    editableFolders={() =>
                                      readOnlyMode() ? [] : editableFolders()
                                    }
                                    knowledgeBases={knowledgeBases}
                                    fileIconContext={fileIconContext}
                                    actions={windowActions}
                                    autoPlayVideo={false}
                                  />
                                </div>
                              </>
                            )
                          }}
                        </For>
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
                            {windowIcon(definitionFor(item()!), fileIconContext(), 'md')}
                          </span>
                          <p
                            data-testid='canvas-window-zoom-title'
                            class='max-w-full truncate font-semibold leading-[1.15]'
                            style={{ 'font-size': `${summaryMetrics().title}px` }}
                          >
                            {definitionFor(item()!).title}
                            <Show when={members().length > 1}> · {members().length} tabs</Show>
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
                        onStart={(direction, event) =>
                          startWindowResize(item()!.id, direction, event)
                        }
                      />
                    </Show>
                  </div>
                </Show>
              )
            }}
          </For>
          <Show when={state().camera.zoom < FAR_ZOOM}>
            <For each={canvasGroupIds()}>
              {(groupId) => {
                const item = createMemo(() => activeWindowForGroup(groupId))
                const memberCount = () => groupWindows(groupId).length
                const bounds = createMemo(() =>
                  canvasWindowVisualBounds(item()?.bounds ?? EMPTY_CANVAS_BOUNDS),
                )
                const details = createMemo(() => {
                  const active = item()
                  return active
                    ? canvasWindowDetails(definitionFor(active))
                    : { kind: '', path: null }
                })
                const metrics = createMemo(() => {
                  const zoom = state().camera.zoom
                  const screenWidth = bounds().width * zoom
                  const screenHeight = bounds().height * zoom
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
                  <Show when={item()}>
                    <button
                      type='button'
                      data-testid='canvas-window-summary'
                      data-window-id={item().id}
                      class='absolute overflow-hidden rounded-lg bg-card p-0 text-left shadow-lg'
                      style={{
                        left: `${bounds().x}px`,
                        top: `${bounds().y}px`,
                        width: `${bounds().width}px`,
                        height: `${bounds().height}px`,
                        'z-index': item()!.zIndex,
                      }}
                      onClick={() => focusWindow(item()!.id)}
                    >
                      <span
                        data-testid='canvas-window-summary-content'
                        class={[
                          'absolute inset-0 flex items-center justify-center overflow-hidden text-center',
                          { 'flex-col': !metrics().horizontal },
                        ]}
                        style={{
                          width: `${bounds().width}px`,
                          height: `${bounds().height}px`,
                          'box-sizing': 'border-box',
                          gap: `${metrics().gap}px`,
                          padding: `${metrics().padding}px`,
                        }}
                      >
                        <span
                          class='inline-flex shrink-0 items-center justify-center'
                          style={{ transform: `scale(${metrics().iconScale})` }}
                        >
                          {windowIcon(definitionFor(item()!), fileIconContext(), 'md')}
                        </span>
                        <span class='min-w-0 max-w-full overflow-hidden'>
                          <span
                            data-testid='canvas-window-summary-title'
                            class='block truncate font-semibold leading-[1.15]'
                            style={{ 'font-size': `${metrics().title}px` }}
                          >
                            {definitionFor(item()!).title}
                            <Show when={memberCount() > 1}> · {memberCount()} tabs</Show>
                          </span>
                          <span
                            class='mt-1 block truncate font-medium leading-[1.15] text-muted-foreground'
                            style={{ 'font-size': `${metrics().kind}px` }}
                          >
                            {details().kind}
                          </span>
                          <Show
                            when={
                              metrics().showPath &&
                              details().path &&
                              details().path !== definitionFor(item()!).title
                            }
                          >
                            <span
                              class='mt-1 block truncate leading-[1.15] text-muted-foreground'
                              style={{ 'font-size': `${metrics().path}px` }}
                            >
                              {details().path}
                            </span>
                          </Show>
                        </span>
                      </span>
                    </button>
                  </Show>
                )
              }}
            </For>
          </Show>
          <div
            data-testid='canvas-drop-preview'
            class={[
              'pointer-events-none absolute overflow-hidden rounded-lg border-2 border-dashed border-primary bg-primary/10 shadow-xl',
              { invisible: !fileDropVisualBounds() },
            ]}
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

      <Show when={dialog()}>
        {(current) => (
          <div
            class='fixed inset-0 z-[1300000] flex items-center justify-center bg-black/55 p-4'
            onKeyDown={onDialogKeyDown}
            onPointerDown={(event) => event.target === event.currentTarget && setDialog(null)}
          >
            <div
              ref={(element) => (dialogEl = element)}
              role='dialog'
              aria-modal='true'
              aria-labelledby='canvas-dialog-title'
              class={[
                'w-full rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl',
                {
                  'max-w-lg': current().kind === 'new-note',
                  'max-w-sm': current().kind !== 'new-note',
                },
              ]}
            >
              <span id='canvas-dialog-title' class='sr-only'>
                {canvasDialogLabel(current())}
              </span>
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
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
