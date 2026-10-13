import { Effect, Schema } from 'effect'
import { modelOwner } from 'effectweb'
import { apiSchemaEffect, postEffect } from '@/lib/api/client'
import { virtualOpenTargetSchema } from '@/lib/files/file-schemas'
import { projectionSource } from 'effectweb/advanced'
import { randomId } from '@/lib/random-id'
import {
  getFileDragData,
  hasFileDragData,
  isDirectoryFileDragData,
} from '@/lib/files/file-drag-data'
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
import type { WindowSource, WindowDefinition } from '@/lib/models/window-model'
import { isHermesOpenTarget, type HermesOpenTarget } from '@/features/hermes/hermes-open-target'
import { HermesSessions } from '@/features/hermes/hermes-session-store'
import { canvasEdgeAutoPanVelocity } from './canvas-edge-auto-pan'
import { cameraForCanvasBounds } from './model/canvas-camera'
import { createCanvasPanController } from './create-canvas-pan-controller'
import { EMPTY_FILE_ICON_CONTEXT } from '@/features/explorer/file-icon'
import { getPlaybackSession, playbackSource } from '@/features/playback/PlaybackProvider'
import { browserHistory, navigateSearchParams } from '@/lib/browser/browser-history'
import type { WorkspaceSession } from '@/workspace/shared/WorkspaceSession'
import { DEFAULT_WORKSPACE_SOURCE, type PersistedWorkspaceState } from '@/workspace/model/workspace'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import { defaultPersistedState } from '@/workspace/shared/workspace-page-persistence'
import {
  applyCanvasGeometryToWorkspace,
  canvasViewFromWorkspace,
} from '@/workspace/canvas/model/canvas-projection'
import { createCanvasSelection } from '@/workspace/canvas/model/canvas-selection'
import {
  createCanvasOverlayState,
  type CanvasDialogState,
} from '@/workspace/canvas/model/canvas-overlay-state'
import { createWorkspaceLifecycleCommands } from '@/workspace/shared/workspace-lifecycle-commands'
import type { WorkspaceWindowActions } from '@/workspace/shared/workspace-window-actions'
import { rollbackWorkspaceTransferGeometry } from '@/workspace/model/workspace-transfer'
import { createCrossWorkspaceTransferController } from '@/workspace/shared/cross-workspace-transfer-controller'
import { confirmWorkspaceWindowsSequentially } from '@/workspace/model/workspace-close'
import { createWorkspacePageServerData } from '@/workspace/shared/workspace-page-server-data'
import { showAppAlertEffect } from '@/lib/ui/app-dialog'
import { startPointerGesture, type PointerGestureOptions } from '@/lib/ui/start-pointer-gesture'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import { planTaskbarPinAdd } from '@/workspace/model/workspace-taskbar-pin'
import {
  appendWorkspaceWindow,
  planWorkspaceWindowOpen,
  workspaceWindowId,
  type WorkspaceWindowOpenIntent,
} from '@/workspace/model/workspace-window-open'
const actionSlot = 'workspace-user-action'
const pinnedOpenSlot = 'workspace-pinned-open'
const createNoteSlot = 'canvas-create-note'
const pinnedTargetSchema = Schema.Struct({ openTarget: virtualOpenTargetSchema })
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
export const LIVE_ZOOM = 0.62
export const FAR_ZOOM = 0.28
export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type FileDropPreview = { bounds: CanvasRect }
type CanvasMergeTarget = { groupId: string; targetWindowId: string; insertIndex: number }
type CanvasMergeDragState = { sourceGroupId: string; target: CanvasMergeTarget | null }
function cloneState(state: InfiniteCanvasState): InfiniteCanvasState {
  return cloneInfiniteCanvasState(state)
}
export const EMPTY_CANVAS_BOUNDS: CanvasRect = {
  x: 0,
  y: 0,
  width: CANVAS_MIN_WINDOW_WIDTH,
  height: CANVAS_MIN_WINDOW_HEIGHT,
}
export function canvasWindowDetails(definition: WindowDefinition): {
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
export function fileItemFromDrag(path: string, isDirectory: boolean): FileItem {
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
export function mediaWindowSizeKey(mediaType: MediaType): CanvasWindowSizeKey {
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
export function createCanvasController(props: { session: WorkspaceSession }) {
  const initial = {
    geometryActive: false,
    searchOpen: false,
    outlineOpen: false,
    workspacePanelOpen: false,
    viewportSize: { width: 1, height: 1 },
    canvasMergeDrag: null as CanvasMergeDragState | null,
    cameraAnimating: false,
    fileDropPreview: null as FileDropPreview | null,
    lastAudioWindowId: null as string | null,
    spaceHeld: false,
  }
  const local = modelOwner(initial)
  const startups: (() => void | (() => void))[] = []
  const urlSearchParams = () => new URLSearchParams(browserHistory.model().search)
  const workspaceId = () => urlSearchParams().get('ws') ?? ''
  const playbackSession = getPlaybackSession()
  const playback = () => playbackSource.model()
  const geometryActive = (): boolean => local.read().geometryActive as boolean
  const setGeometryActive = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(geometryActive()) : value
    local.patch({ geometryActive: next })
    return next
  }
  let crossWorkspaceTransfer: ReturnType<typeof createCrossWorkspaceTransferController> | undefined
  let cancelCanvasPointerGesture: (() => void) | undefined
  const workspaceRegistry = props.session
  const unblock = workspaceRegistry.registerSavingBlocker(
    () => geometryActive() || (crossWorkspaceTransfer?.active() ?? false),
  )
  const workspaceSnapshot = workspaceRegistry.document.value
  const setWorkspaceSnapshot = workspaceRegistry.document.update
  const state = () => {
    const snapshot = workspaceSnapshot()
    return snapshot ? canvasViewFromWorkspace(snapshot) : createEmptyCanvasState()
  }
  const setState = (
    next: InfiniteCanvasState | ((current: InfiniteCanvasState) => InfiniteCanvasState),
  ) => {
    if (!workspaceRegistry.state.editable()) return
    setWorkspaceSnapshot((current) => {
      if (!current) return current
      const currentView = canvasViewFromWorkspace(current)
      const resolved = typeof next === 'function' ? next(currentView) : next
      return applyCanvasGeometryToWorkspace(resolved, current)
    })
  }
  const lifecycle = createWorkspaceLifecycleCommands({
    owner: local,
    session: workspaceRegistry,
    activeId: workspaceId,
    navigate: (id, mode) => navigateSearchParams({ ws: id }, mode),
  })
  const maximizedWindowId = () => state().maximizedWindowId
  const canvasSelection = createCanvasSelection({ workspace: workspaceSnapshot })
  const selectedIds = canvasSelection.selectedIds
  const overlays = createCanvasOverlayState()
  const searchOpen = (): boolean => local.read().searchOpen as boolean
  const setSearchOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(searchOpen()) : value
    local.patch({ searchOpen: next })
    return next
  }
  const outlineOpen = (): boolean => local.read().outlineOpen as boolean
  const setOutlineOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(outlineOpen()) : value
    local.patch({ outlineOpen: next })
    return next
  }
  const workspacePanelOpen = (): boolean => local.read().workspacePanelOpen as boolean
  const setWorkspacePanelOpen = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(workspacePanelOpen()) : value
    local.patch({ workspacePanelOpen: next })
    return next
  }
  const viewportSize = (): typeof initial.viewportSize =>
    local.read().viewportSize as typeof initial.viewportSize
  const setViewportSize = (
    value:
      | typeof initial.viewportSize
      | ((current: typeof initial.viewportSize) => typeof initial.viewportSize),
  ) => {
    const next = typeof value === 'function' ? value(viewportSize()) : value
    local.patch({ viewportSize: next })
    return next
  }
  const canvasMergeDrag = (): CanvasMergeDragState | null =>
    local.read().canvasMergeDrag as CanvasMergeDragState | null
  const setCanvasMergeDrag = (
    value:
      | CanvasMergeDragState
      | null
      | ((current: CanvasMergeDragState | null) => CanvasMergeDragState | null),
  ) => {
    const next = typeof value === 'function' ? value(canvasMergeDrag()) : value
    local.patch({ canvasMergeDrag: next })
    return next
  }
  const cameraAnimating = (): boolean => local.read().cameraAnimating as boolean
  const setCameraAnimating = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(cameraAnimating()) : value
    local.patch({ cameraAnimating: next })
    return next
  }
  const fileDropPreview = (): FileDropPreview | null =>
    local.read().fileDropPreview as FileDropPreview | null
  const setFileDropPreview = (
    value: FileDropPreview | null | ((current: FileDropPreview | null) => FileDropPreview | null),
  ) => {
    const next = typeof value === 'function' ? value(fileDropPreview()) : value
    local.patch({ fileDropPreview: next })
    return next
  }
  const lastAudioWindowId = (): string | null => local.read().lastAudioWindowId as string | null
  const setLastAudioWindowId = (
    value: string | null | ((current: string | null) => string | null),
  ) => {
    const next = typeof value === 'function' ? value(lastAudioWindowId()) : value
    local.patch({ lastAudioWindowId: next })
    return next
  }
  function openWorkspacePanel() {
    if (workspacePanelOpen()) return
    setWorkspacePanelOpen(true)
    void local.run(actionSlot, workspaceRegistry.catalog.refresh(), 'parallel')
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
    onError: (message) => local.run(actionSlot, showAppAlertEffect(message, 'Canvas'), 'parallel'),
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
  function settleCanvasGesturesBeforeNavigation() {
    return Effect.gen(function* () {
      cancelCanvasPointerGesture?.()
      yield* crossWorkspaceTransfer!.settleBeforeNavigation()
    })
  }
  const readOnlyMode = () =>
    !workspaceRegistry.state.editable() || crossWorkspaceTransfer!.committing()
  const spaceHeld = (): boolean => local.read().spaceHeld as boolean
  const setSpaceHeld = (value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === 'function' ? value(spaceHeld()) : value
    local.patch({ spaceHeld: next })
    return next
  }
  let viewportEl: HTMLDivElement | undefined
  let worldEl: HTMLDivElement | undefined
  const mountViewport = (element: HTMLDivElement | undefined) => {
    viewportEl = element
  }
  const mountWorld = (element: HTMLDivElement | undefined) => {
    worldEl = element
  }
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
  const server = createWorkspacePageServerData()
  const settingsQuery = server.settingsQuery
  const editableFolders = server.editableFolders
  const knowledgeBases = () => settingsQuery.data?.knowledgeBases ?? []
  const writableDirectories = () =>
    [...new Set([...knowledgeBases(), ...editableFolders()])].map((path) =>
      path.replace(/\\/g, '/').replace(/\/$/, ''),
    )
  const fileIconContext = () => ({
    ...EMPTY_FILE_ICON_CONTEXT,
    customIcons: settingsQuery.data?.customIcons ?? {},
    knowledgeBases: knowledgeBases(),
  })
  const fileDropVisualBounds = () => {
    const preview = fileDropPreview()
    return preview ? canvasWindowVisualBounds(preview.bounds) : null
  }
  const workspace = () => workspaceSnapshot() ?? defaultPersistedState(DEFAULT_WORKSPACE_SOURCE)
  const windowDefinitions = () =>
    new Map(workspace().windows.map((window) => [window.id, window] as const))
  const definitionFor = (window: CanvasWindow) => {
    const definition = windowDefinitions().get(window.id)
    if (!definition) throw new Error(`Missing workspace window ${window.id}`)
    return definition
  }
  const groupIdForCanvasWindow = (window: CanvasWindow) =>
    definitionFor(window).tabGroupId ?? window.id
  const groupWindows = (groupId: string) =>
    state().windows.filter((window) => groupIdForCanvasWindow(window) === groupId)
  const canvasGroupIds = () => {
    const seen = new Set<string>()
    const ids: string[] = []
    for (const window of state().windows) {
      const groupId = groupIdForCanvasWindow(window)
      if (seen.has(groupId)) continue
      seen.add(groupId)
      ids.push(groupId)
    }
    return ids
  }
  function clearCanvasCrossWorkspaceHover() {
    crossWorkspaceTransfer!.hover(null)
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
    canvasSelection.replace(activeId)
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
    canvasSelection.replace(sourceWindowId)
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
  startups.push(() => {
    const oldHtmlOverflow = document.documentElement.style.overflow
    const oldBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    const viewport = viewportEl
    const viewportObserver = new ResizeObserver(() => {
      setViewportSize({ width: viewport?.clientWidth ?? 1, height: viewport?.clientHeight ?? 1 })
    })
    if (viewport) viewportObserver.observe(viewport)
    viewport?.addEventListener('pointerdown', beginPan, true)
    const dismissContextMenu = (event: PointerEvent) => {
      if ((event.target as HTMLElement | null)?.closest('[data-canvas-context-menu]')) return
      overlays.canvasMenu.close()
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
  startups.push(() => () => {
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
    animateCamera(cameraForCanvasBounds({ bounds, viewport, padding: 72, maxZoom }))
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
  const visibilityFrames = new Set<number>()
  function scheduleEnsureWindowsVisible(windowIds: string[]) {
    const scheduledRevision = cameraInteractionRevision
    const frame = window.requestAnimationFrame(() => {
      visibilityFrames.delete(frame)
      if (cameraInteractionRevision !== scheduledRevision) return
      ensureWindowsVisible(windowIds)
    })
    visibilityFrames.add(frame)
  }
  function clearSelection() {
    setMaximizedWindowId(null)
    canvasSelection.clear()
    if (!readOnlyMode()) {
      setWorkspaceSnapshot((current) => (current ? { ...current, activeWindowId: null } : current))
    }
  }
  function selectWindow(windowId: string, additive = false) {
    if (maximizedWindowId() !== windowId) setMaximizedWindowId(null)
    if (additive) canvasSelection.toggle(windowId)
    else canvasSelection.replace(windowId)
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
    const desired = { x: point.x - size.width / 2, y: point.y - size.height / 2, ...size }
    return { bounds: findNearestFreeCanvasRect(desired, placementObstacles(current)) }
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
    const anchorId = canvasSelection.focusedId()
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
      const canvasWindow: CanvasWindow = { id, bounds: worldBounds, zIndex: current.nextZIndex }
      const nextView = {
        ...current,
        windows: [...current.windows, canvasWindow],
        maximizedWindowId: null,
        nextItemId: workspace.nextWindowId + 1,
        nextZIndex: current.nextZIndex + 1,
      }
      return applyCanvasGeometryToWorkspace(
        nextView,
        appendWorkspaceWindow(workspace, definition, {
          groupSourceWindowId: options.groupSourceWindowId,
        }),
      )
    })
    if (createdId) {
      canvasSelection.replace(createdId)
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
    if (plan.kind === 'add') server.addPin(plan.pin)
  }
  function removePinnedItem(pinId: string) {
    if (readOnlyMode()) return
    server.removePin(pinId)
  }
  const selectCanvasPinned = (pin: PinnedTaskbarItem) =>
    local.run(
      pinnedOpenSlot,
      Effect.gen(function* () {
        if (pin.isVirtual) {
          const { openTarget: target } = yield* apiSchemaEffect(
            pinnedTargetSchema,
            `/api/virtual-directory/open?path=${encodeURIComponent(pin.path)}`,
          )
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
      }),
      'replace',
    )
  function addTextEditor(
    point = viewportCenterWorld(),
    content = '',
    requestedTitle = 'Canvas note',
    requestedDirectory = '',
  ) {
    return Effect.gen(function* () {
      if (readOnlyMode()) return
      const directory = requestedDirectory || writableDirectories()[0]
      if (!directory) {
        yield* showAppAlertEffect(
          'Configure an editable folder or knowledge base before creating text files.',
          'Canvas',
        )
        return
      }
      const timestamp = new Date()
        .toISOString()
        .replace(/[:T]/g, '-')
        .replace(/\.\d{3}Z$/, '')
      const safeTitle = requestedTitle.replace(/[<>:"/\\|?*]/g, '-').trim() || 'Canvas note'
      const name = `${safeTitle} ${timestamp}.md`
      const path = `${directory}/${name}`
      yield* postEffect('/api/files/create', { type: 'file', path, content })
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
    }).pipe(
      Effect.catch((error) =>
        showAppAlertEffect(
          error instanceof Error ? error.message : 'Could not create text file.',
          'Canvas',
        ),
      ),
    )
  }
  function openNoteComposer(
    point = viewportCenterWorld(),
    initialContent = '',
    requestedTitle = 'Canvas note',
  ) {
    if (readOnlyMode()) return
    if (!writableDirectories().length) {
      void local.run(
        actionSlot,
        showAppAlertEffect(
          'Configure an editable folder or knowledge base before creating text files.',
          'Canvas',
        ),
        'parallel',
      )
      return
    }
    overlays.note.open({
      kind: 'new-note',
      point,
      initialContent,
      title: requestedTitle,
      directory: writableDirectories()[0] ?? '',
    })
  }
  function createDocumentFromComposer(value: Extract<CanvasDialogState, { kind: 'new-note' }>) {
    overlays.note.close()
    void local.run(
      createNoteSlot,
      addTextEditor(value.point, value.initialContent, value.title, value.directory),
      'drop',
    )
  }
  function deleteSelected() {
    const selectedGroups = new Set(
      state()
        .windows.filter((item) => selectedIds().includes(item.id))
        .map((item) => groupIdForCanvasWindow(item)),
    )
    if (!selectedGroups.size) return
    void local.run(actionSlot, closeWindowGroups(selectedGroups), 'parallel')
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
      { duplicate, source: definitionFor(source).source, openedFromWindowId: sourceWindowId },
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
      { x: sourceBounds.x + sourceBounds.width + CANVAS_GRID_SIZE, y: sourceBounds.y },
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
      draftId: target.type === 'hermesDraft' ? randomId() : undefined,
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
    const anchorId = canvasSelection.focusedId()
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
      const canvasWindow: CanvasWindow = { id, bounds, zIndex: current.nextZIndex }
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
      canvasSelection.replace(createdId)
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
  function updateViewing(windowId: string, path: string, imageSeed?: string | null) {
    updateCanvasWorkspace((current) =>
      WorkspaceDocumentCommands.updateViewing(current, windowId, path, imageSeed),
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
    queueMicrotask(() => (() => ensureWindowsVisible([windowId]))())
  }
  function handleAudioActivate(windowId: string) {
    setLastAudioWindowId(windowId)
  }
  function closeWindow(windowId: string) {
    return Effect.gen(function* () {
      if (readOnlyMode()) return
      const target = windowDefinitions().get(windowId)
      if (!target || !(yield* HermesSessions.canClose(target.hermes))) return
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
      HermesSessions.discardDraft(removed?.hermes)
      canvasSelection.remove(new Set([windowId]))
    })
  }
  function closeWindowGroups(groupIds: ReadonlySet<string>) {
    return Effect.gen(function* () {
      if (readOnlyMode()) return
      const targets = state()
        .windows.filter((window) => groupIds.has(groupIdForCanvasWindow(window)))
        .map(definitionFor)
      if (!targets.length) return
      if (!(yield* confirmWorkspaceWindowsSequentially(targets, HermesSessions.canClose))) return
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
      for (const target of result.removed) HermesSessions.discardDraft(target.hermes)
      const audioWindowId = lastAudioWindowId()
      if (audioWindowId && removedIds.has(audioWindowId)) setLastAudioWindowId(null)
      canvasSelection.remove(removedIds)
    })
  }
  function closeWindowGroup(groupId: string) {
    void local.run(actionSlot, closeWindowGroups(new Set([groupId])), 'parallel')
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
    setCanvasMergeDrag({ sourceGroupId: groupIdForCanvasWindow(item), target: null })
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
      setCanvasMergeDrag((state) =>
        state
          ? {
              ...state,
              target: canvasMergeTargetAt(next.clientX, next.clientY, groupIdForCanvasWindow(item)),
            }
          : state,
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
      const mergeTarget = canvasMergeDrag()?.target
      setCanvasMergeDrag(null)
      const dropTarget = !cancelled
        ? document.elementFromPoint(latestX, latestY)?.closest<HTMLElement>('[data-workspace-id]')
            ?.dataset.workspaceId
        : undefined
      if (cancelled) {
        crossWorkspaceTransfer!.cancel()
      } else if (dropTarget && dropTarget !== workspaceId()) {
        void local.run(actionSlot, crossWorkspaceTransfer!.drop(dropTarget), 'parallel')
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
          const detachedBounds = { ...target.bounds, x: point.x - 32, y: point.y - 16 }
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
                ? { ...window, layout: { ...window.layout, zIndex: view.nextZIndex } }
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
        setCanvasMergeDrag({ sourceGroupId: windowId, target: null })
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
      setCanvasMergeDrag((state) =>
        state
          ? { ...state, target: canvasMergeTargetAt(next.clientX, next.clientY, windowId) }
          : state,
      )
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
      const target = canvasMergeDrag()?.target
      setCanvasMergeDrag(null)
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
    overlays.canvasMenu.close()
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
    overlays.canvasMenu.open({
      kind: 'canvas',
      clientX: event.clientX,
      clientY: event.clientY,
      worldX: world.x,
      worldY: world.y,
    })
  }
  startups.push(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (overlays.note.value()) return
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
        canvasSelection.selectAll(state().windows.map((item) => item.id))
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
        overlays.canvasMenu.close()
        clearSelection()
      }
    }
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    }
  })
  const selectedWindow = () => {
    const focusedId = canvasSelection.focusedId()
    return focusedId ? state().windows.find((window) => window.id === focusedId) : undefined
  }
  const lastAudioWindow = () => {
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
  }
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
    viewer: { updateViewing, videoMetadata: sizeVideoWindow, audioActivate: handleAudioActivate },
    hermes: {
      sessionCreated: bindHermesSession,
      titleChanged: (windowId, title) =>
        updateCanvasWorkspace((current) =>
          WorkspaceDocumentCommands.renameWindow(current, windowId, title),
        ),
    },
  }
  const project = () => {
    const catalog = workspaceRegistry.catalog.value()
    const editable = workspaceRegistry.state.editable()
    const opened = workspaceRegistry.state.opened()
    const settings = settingsQuery.data
    const pins = server.serverPinsList()
    const folders = server.editableFolders()
    const pin = overlays.pinMenu.value()
    const menu = overlays.canvasMenu.value()
    const note = overlays.note.value()
    const transferActive = crossWorkspaceTransfer!.active()
    const transferReady = crossWorkspaceTransfer!.ready()
    const transferHover = crossWorkspaceTransfer!.hoverTarget()
    const focusedId = canvasSelection.focusedId()
    return {
      start,
      state: state(),
      fileIconContext: fileIconContext(),
      selectedWindow: selectedWindow(),
      maximizedWindowId: maximizedWindowId(),
      lastAudioWindow: lastAudioWindow(),
      searchOpen: searchOpen(),
      workspacePanelOpen: workspacePanelOpen(),
      workspaceId: workspaceId(),
      outlineOpen: outlineOpen(),
      spaceHeld: spaceHeld(),
      geometryActive: geometryActive(),
      fileDropPreview: fileDropPreview(),
      readOnlyMode: readOnlyMode(),
      cameraAnimating: cameraAnimating(),
      canvasGroupIds: canvasGroupIds(),
      workspaceSnapshot: workspaceSnapshot(),
      viewportSize: viewportSize(),
      selectedIds: selectedIds(),
      canvasMergeDrag: canvasMergeDrag(),
      workspace: workspace(),
      knowledgeBases: knowledgeBases(),
      fileDropVisualBounds: fileDropVisualBounds(),
      writableDirectories: writableDirectories(),
      setOutlineOpen,
      toggleWorkspacePanel,
      selectCanvasPinned,
      focusWindow,
      setZoomFromControl,
      zoomBy,
      fitAllWindows,
      setSearchOpen,
      addFileWindow,
      viewportCenterWorld,
      playbackSession,
      removePinnedItem,
      clearCanvasCrossWorkspaceHover,
      setWorkspacePanelOpen,
      settleCanvasGesturesBeforeNavigation,
      lifecycle,
      setFileDropPreview,
      clearSelection,
      zoomAt,
      onCanvasContextMenu,
      screenToWorld,
      fileWindowPlacement,
      addHermesWindow,
      openNoteComposer,
      addBlankHermesWindow,
      selectWindow,
      selectCanvasTab,
      activateWindow,
      closeWindow: (id: string) => local.run(actionSlot, closeWindow(id), 'parallel'),
      toggleCanvasTabPinned,
      startCanvasTabPull,
      updateCanvasWorkspace,
      startWindowMove,
      setMaximizedWindowId,
      maximizeWindow,
      closeWindowGroup,
      startCanvasSplitPaneDrag,
      windowActions,
      startWindowResize,
      createDocumentFromComposer,
      mountViewport,
      mountWorld,
      session: workspaceRegistry,
      registry: catalog,
      editable,
      opened,
      settings,
      serverPins: pins,
      editableFolders: folders,
      setWorkspaceTransition: server.setWorkspaceTransition,
      registryCommands: {
        transition: (action: () => void) =>
          local.run(
            actionSlot,
            settleCanvasGesturesBeforeNavigation().pipe(
              Effect.andThen(workspaceRegistry.lifecycle.transition(action)),
            ),
            'queue',
          ),
        takeControl: () =>
          local.run(actionSlot, workspaceRegistry.lifecycle.takeControl(), 'queue'),
        updateMetadata: (
          id: string,
          update: { name?: string; icon?: string; iconColor?: string },
        ) =>
          local.run(actionSlot, workspaceRegistry.catalog.updateMetadataFor(id, update), 'queue'),
        reorder: (order: string[]) =>
          local.run(actionSlot, workspaceRegistry.catalog.reorder(order), 'queue'),
      },
      pinMenu: pin,
      canvasMenu: menu,
      noteDialog: note,
      overlayCommands: {
        openPinMenu: overlays.pinMenu.open,
        closePinMenu: overlays.pinMenu.close,
        closeCanvasMenu: overlays.canvasMenu.close,
        closeNote: overlays.note.close,
        updateNoteTitle: overlays.note.updateTitle,
        updateNoteDirectory: overlays.note.updateDirectory,
      },
      transferActive,
      transferReady,
      transferHover,
      focusedId,
    }
  }
  const presentation = projectionSource({ project, refresh: workspaceRegistry.savingBlockChanged })
  const dependencies = [
    local.source,
    workspaceRegistry.source,
    server.source,
    canvasSelection.source,
    overlays.source,
    crossWorkspaceTransfer!.source,
    browserHistory,
    playbackSource,
  ]
  dependencies.forEach((source) => presentation.watch(source))
  presentation.start()
  let started = false
  const cleanup: (() => void)[] = []
  function start() {
    if (started) return
    started = true
    for (const startup of startups) {
      const dispose = startup()
      if (dispose) cleanup.push(dispose)
    }
  }
  return {
    source: presentation,
    start,
    lifetime: {
      close: () =>
        local
          .awaitIdle(actionSlot)
          .pipe(Effect.andThen(crossWorkspaceTransfer!.close()), Effect.andThen(local.close())),
      dispose() {
        presentation.dispose()
        for (const frame of visibilityFrames) window.cancelAnimationFrame(frame)
        visibilityFrames.clear()
        for (const dispose of cleanup) dispose()
        unblock()
        server.dispose()
        canvasSelection.dispose()
        overlays.dispose()
        local.dispose()
      },
    },
  }
}
