import type { FileItem } from '@/lib/files/types'
import { MediaType } from '@/lib/files/types'
import { getMediaType } from '@/lib/media/media-utils'
import type { AssistGridSpan } from '@/workspace/model/workspace-assist-grid'
import {
  createDefaultBounds,
  createWindowLayout,
  getPlaybackTitle,
  getPlayerBoundsForAspectRatio,
  insertWindowAtGroupIndex,
  isVideoPath,
  maxWorkspaceWindowZ,
  WORKSPACE_WINDOW_MIN_VISIBLE_PX,
} from '@/workspace/model/workspace-geometry'
import type { FileDragData } from '@/lib/files/file-drag-data'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import type {
  WindowDefinition as WorkspaceWindowDefinition,
  WindowSource as WorkspaceSource,
} from '@/lib/models/window-model'
import {
  DEFAULT_WORKSPACE_SOURCE,
  resolveNewTabAnchorWindowId,
} from '@/workspace/model/use-workspace'
import { rememberVideoIntrinsics } from '@/lib/media/video-intrinsics'
import { viewerBoundsForVideoOpen } from '@/workspace/model/workspace-video-bounds'
import { useWorkspacePreferredSnapStore } from '@/workspace/model/workspace-preferred-snap-store'
import { getFileOpenTarget } from '@/features/explorer/file-open-target'
import {
  layoutBoundsForWindowHighlight,
  pickWorkspaceWindowAtClientPoint,
} from './workspace-file-open-target-picker'
import { For, Show, createEffect, createMemo, createSignal, onSettled, untrack } from 'solid-js'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from '@/lib/browser/browser-history'
import { DesktopWorkspaceCanvas } from './DesktopWorkspaceCanvas'
import { DesktopWorkspaceTaskbar } from './DesktopWorkspaceTaskbar'
import { createWorkspaceSnapDragModel } from './layout/create-workspace-snap-drag-model'
import { useWorkspacePageServerData } from '../shared/use-workspace-page-server-data'
import { useWorkspaceSession } from '../shared/WorkspaceSession'
import { WorkspaceSwitcher } from '../shared/WorkspaceSwitcher'

import {
  clampTabInsertIndex,
  groupIdForWindow,
  insertIndexAfterAllRightTabs,
  isSplitLeftTab,
  orderedAllGroupIds,
  tabsInGroup,
} from '../tabs/tab-group-ops'
import { TaskbarGroupRow } from './DesktopWorkspaceTaskbarRows'
import { defaultPersistedState } from '../shared/workspace-page-persistence'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/files/file-search'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import { canCloseHermesWindow, discardHermesDraft } from '@/features/hermes/hermes-session-store'
import { createFilesystemPlaybackItem, playbackPathMatches } from '@/features/playback/items'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import { rollbackWorkspaceTransferGeometry } from '@/workspace/model/workspace-transfer'
import { createCrossWorkspaceTransferController } from '@/workspace/shared/cross-workspace-transfer-controller'
import { confirmWorkspaceWindowsSequentially } from '@/workspace/model/workspace-close'
import { createWorkspaceLifecycleCommands } from '../shared/workspace-lifecycle-commands'
import { startPointerGesture } from '@/lib/ui/start-pointer-gesture'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import { planTaskbarPinAdd } from '@/workspace/model/workspace-taskbar-pin'
import {
  planWorkspaceWindowOpen,
  workspaceWindowId,
  type WorkspaceWindowOpenIntent,
} from '@/workspace/model/workspace-window-open'
import { showAppAlert } from '@/lib/ui/app-dialog'

function activateDesktopTabState(
  state: PersistedWorkspaceState,
  groupId: string,
  tabId: string,
): PersistedWorkspaceState {
  if (!tabsInGroup(state.windows, groupId).some((window) => window.id === tabId)) return state
  const activated = WorkspaceDocumentCommands.activateTab(state, groupId, tabId)
  const zIndex = maxWorkspaceWindowZ(activated.windows) + 1
  return {
    ...activated,
    windows: activated.windows.map((window) =>
      groupIdForWindow(window) === groupId
        ? { ...window, layout: { ...window.layout, zIndex, minimized: false } }
        : window,
    ),
  }
}

export function DesktopWorkspace() {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()

  const server = useWorkspacePageServerData()
  const browserSource = () => DEFAULT_WORKSPACE_SOURCE
  const workspaceId = () => urlSearchParams().get('ws') ?? ''
  const [workspacePanelOpen, setWorkspacePanelOpen] = createSignal(false)
  const [activePointerGestures, setActivePointerGestures] = createSignal(0)
  const pointerGestureCancels = new Set<() => void>()
  let crossWorkspaceTransfer: ReturnType<typeof createCrossWorkspaceTransferController> | undefined
  const workspaceRegistry = useWorkspaceSession({
    savingBlocked: () => activePointerGestures() > 0 || (crossWorkspaceTransfer?.active() ?? false),
  })
  const workspace = workspaceRegistry.document
  const setWorkspace = workspaceRegistry.update
  const lifecycle = createWorkspaceLifecycleCommands({
    session: workspaceRegistry,
    activeId: workspaceId,
    navigate: (id, mode) => navigateSearchParams({ ws: id, dir: null, preset: null }, mode),
  })

  function ifEditable(action: () => void) {
    if (workspaceRegistry.editable()) action()
  }

  const setEditableWorkspace: typeof setWorkspace = (value) => {
    if (workspaceRegistry.editable()) setWorkspace(value)
  }
  const [layoutPicker, setLayoutPicker] = createSignal<{
    windowId: string
    anchor: DOMRect
  } | null>(null)

  const [fileOpenTargetPick, setFileOpenTargetPick] = createSignal<{
    sourceBrowserId: string
  } | null>(null)
  const [fileOpenPickHoverId, setFileOpenPickHoverId] = createSignal<string | null>(null)

  const preferredSnapTick = useStoreSync(useWorkspacePreferredSnapStore)
  const snap = createWorkspaceSnapDragModel({ workspace, setWorkspace, preferredSnapTick })

  crossWorkspaceTransfer = createCrossWorkspaceTransferController({
    session: workspaceRegistry,
    sourceId: workspaceId,
    emptyDestination: () => ({
      ...defaultPersistedState(browserSource()),
      windows: [],
      activeWindowId: null,
      nextWindowId: 1,
    }),
    navigate: (id) => navigateSearchParams({ ws: id, dir: null, preset: null }, 'replace'),
    viewport: () => ({ width: globalThis.innerWidth, height: globalThis.innerHeight - 32 }),
    rollbackGesture: rollbackWorkspaceTransferGeometry,
    onError: (message) => void showAppAlert(message, 'Workspace'),
    onSettled: () => setWorkspacePanelOpen(false),
  })
  onSettled(() => () => {
    for (const cancel of [...pointerGestureCancels]) cancel()
    crossWorkspaceTransfer!.dispose()
  })

  type PointerGestureRollback = (
    latest: PersistedWorkspaceState,
    beforeGesture: PersistedWorkspaceState,
  ) => PersistedWorkspaceState

  function beginPointerGesture(
    rollback: PointerGestureRollback = (latest, beforeGesture) =>
      rollbackWorkspaceTransferGeometry(
        latest,
        beforeGesture,
        beforeGesture.windows.map((window) => window.id),
      ),
  ) {
    const current = workspace()
    if (!current) return { commit: () => {}, cancel: () => {} }
    const beforeGesture = structuredClone(current)
    let active = true
    setActivePointerGestures((count) => count + 1)
    const finish = () => {
      if (!active) return
      active = false
      pointerGestureCancels.delete(cancel)
      setActivePointerGestures((count) => Math.max(0, count - 1))
    }
    const cancel = () => {
      if (!active) return
      snap.cancelDrag()
      crossWorkspaceTransfer!.cancel()
      setWorkspacePanelOpen(false)
      setWorkspace((latest) => (latest ? rollback(latest, beforeGesture) : latest))
      finish()
    }
    pointerGestureCancels.add(cancel)
    return { commit: finish, cancel }
  }

  const editableOpenBrowser = () => ifEditable(() => openBrowser())
  const editableFocusWindow = (id: string) => ifEditable(() => focusWindow(id))
  const editableSetWindowMinimized = (id: string, minimized: boolean) =>
    ifEditable(() => snap.setWindowMinimized(id, minimized))
  const editableCloseWindow = (id: string) => ifEditable(() => void closeWindow(id))
  const editableAddPinnedItem = (file: FileItem, source: WorkspaceSource) =>
    ifEditable(() => addPinnedItem(file, source))
  const editableSelectPinned = (pin: PinnedTaskbarItem) => ifEditable(() => selectPinned(pin))
  const editableRemovePinnedItem = (id: string) => ifEditable(() => removePinnedItem(id))
  const editableOpenSearchResult = (result: FileSearchResult) =>
    ifEditable(() => openGlobalSearchResult(result))
  const editableToggleFullscreen = (id: string) => ifEditable(() => snap.toggleFullscreenWindow(id))
  const editableActivateTab = (groupId: string, tabId: string) =>
    ifEditable(() => activateTab(groupId, tabId))
  const editableCloseTab = (id: string, options?: { ignoreTabPinForListenOnlyDismiss?: boolean }) =>
    ifEditable(() => void closeTab(id, options))
  const editableToggleTabPinned = (id: string) => ifEditable(() => toggleTabPinned(id))
  const editableHandleTabPullStart = (groupId: string, tabId: string, event: PointerEvent) =>
    ifEditable(() => handleTabPullStart(groupId, tabId, event))
  const editableDropFileToTabBar = (leaderId: string, data: FileDragData) =>
    ifEditable(() => dropFileToTabBar(leaderId, data))
  const editableStartSplitPaneDrag = (groupId: string, event: PointerEvent) =>
    ifEditable(() => startSplitPaneDrag(groupId, event))
  const editableNavigateDir = (windowId: string, dir: string) =>
    ifEditable(() => navigateDir(windowId, dir))
  const editableOpenViewerFromBrowser = (windowId: string, file: FileItem) =>
    ifEditable(() => openViewerFromBrowser(windowId, file))
  const editableOpenReaderFromBrowser = (windowId: string, file: FileItem) =>
    ifEditable(() => openReaderFromBrowser(windowId, file))
  const editableOpenHermesFromBrowser = (
    windowId: string,
    file: FileItem,
    target: VirtualOpenTarget,
  ) => ifEditable(() => openHermesFromBrowser(windowId, file, target))
  const editableBindHermesSession = (windowId: string, sessionId: string) =>
    ifEditable(() => bindHermesSession(windowId, sessionId))
  const editableOpenHermesBranch = (windowId: string, sessionId: string, title: string) =>
    ifEditable(() => openHermesBranch(windowId, sessionId, title))
  const editableRenameHermesWindow = (windowId: string, title: string) =>
    ifEditable(() => renameHermesWindow(windowId, title))
  const editableOpenInNewTabInSameWindow = (
    windowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
    insertIndex?: number,
    sourceOverride?: WorkspaceSource,
  ) =>
    ifEditable(() =>
      openInNewTabInSameWindow(windowId, file, currentPath, insertIndex, sourceOverride),
    )
  const editableOpenInSplitViewFromBrowserPane = (windowId: string, file: FileItem) =>
    ifEditable(() => openInSplitViewFromBrowserPane(windowId, file))
  const editableRequestPlay = (source: WorkspaceSource, path: string, dir?: string) =>
    ifEditable(() => requestPlay(source, path, dir))
  const editableUpdateWindowViewing = (windowId: string, viewing: string) =>
    ifEditable(() => updateWindowViewing(windowId, viewing))
  const editableResizeViewerWindowForVideoMetadata = (
    windowId: string,
    width: number,
    height: number,
  ) => ifEditable(() => resizeViewerWindowForVideoMetadata(windowId, width, height))
  const editableBeginFileOpenTargetPick = (windowId: string) =>
    ifEditable(() => beginFileOpenTargetPick(windowId))
  const editableOpenFileInNewFloatingWindow = (windowId: string, file: FileItem) =>
    ifEditable(() => openFileInNewFloatingWindow(windowId, file))
  const editableHandleWorkspaceTilingPick = (windowId: string, span: AssistGridSpan) =>
    ifEditable(() => handleWorkspaceTilingPick(windowId, span))
  const editableOpenLayoutPicker = (windowId: string, anchor: DOMRect) =>
    ifEditable(() =>
      setLayoutPicker((current) => (current?.windowId === windowId ? null : { windowId, anchor })),
    )

  const dismissWorkspacePanel = () => {
    crossWorkspaceTransfer!.hover(null)
    setWorkspacePanelOpen(false)
  }
  const settleGesturesBeforeNavigation = async () => {
    for (const cancel of [...pointerGestureCancels]) cancel()
    await crossWorkspaceTransfer!.settleBeforeNavigation()
  }
  const toggleWorkspacePanelFromTaskbar = async () => {
    await settleGesturesBeforeNavigation()
    const opening = !workspacePanelOpen()
    setWorkspacePanelOpen(opening)
    if (opening) await workspaceRegistry.refresh()
  }

  createEffect(
    () => workspacePanelOpen(),
    (open) => {
      if (!open) return undefined
      const closeOutside = (event: PointerEvent) => {
        const insideWorkspaceUi = event
          .composedPath()
          .some(
            (node) =>
              node instanceof Element &&
              node.matches(
                '[data-testid="workspace-switcher"], [data-testid="workspace-context-menu"], [data-workspace-toggle]',
              ),
          )
        if (insideWorkspaceUi) return
        setWorkspacePanelOpen(false)
      }
      document.addEventListener('pointerdown', closeOutside)
      // eslint-disable-next-line solid/reactivity
      return () => document.removeEventListener('pointerdown', closeOutside)
    },
  )

  function focusWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const target = w.windows.find((x) => x.id === windowId)
    if (!target) return
    activateTab(groupIdForWindow(target), windowId)
  }

  function stopWorkspacePlaybackFromTaskbar() {
    playbackSession.dispatch({ type: 'stop' })
  }

  async function closeWindow(windowId: string) {
    const initial = workspace()
    if (!initial) return
    const target = initial.windows.find((window) => window.id === windowId)
    const groupId = target ? groupIdForWindow(target) : windowId
    const candidates = initial.windows.filter((window) => groupIdForWindow(window) === groupId)
    if (!(await confirmWorkspaceWindowsSequentially(candidates, canCloseHermesWindow))) return
    const removed: typeof candidates = []
    setWorkspace((current) => {
      if (!current) return current
      const result = WorkspaceDocumentCommands.closeGroups(current, new Set([groupId]))
      removed.push(...result.removed)
      return result.state
    })
    for (const window of removed) discardHermesDraft(window.hermes)
  }

  function activateTab(groupId: string, tabId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      return activateDesktopTabState(prev, groupId, tabId)
    })
  }

  async function closeTab(tabId: string, opts?: { ignoreTabPinForListenOnlyDismiss?: boolean }) {
    const current = workspace()
    const currentTab = current?.windows.find((window) => window.id === tabId)
    if (!currentTab || !(await canCloseHermesWindow(currentTab.hermes))) return
    const removed: WorkspaceWindowDefinition[] = []
    setWorkspace((prev) => {
      if (!prev) return prev
      const result = WorkspaceDocumentCommands.closeTab(prev, tabId, {
        ignorePin: opts?.ignoreTabPinForListenOnlyDismiss,
      })
      removed.push(...result.removed)
      return result.state
    })
    for (const window of removed) discardHermesDraft(window.hermes)
  }

  function toggleTabPinned(tabId: string) {
    setWorkspace((prev) => (prev ? WorkspaceDocumentCommands.toggleTabPin(prev, tabId) : prev))
  }

  function handleTabPullStart(groupId: string, tabId: string, e: PointerEvent) {
    const c = snap.getWorkspaceAreaElement()?.getBoundingClientRect()
    if (!c) return

    const prev = workspace()
    if (!prev) return
    if (isSplitLeftTab(prev, groupId, tabId)) return
    const pulledWin = prev.windows.find((x) => x.id === tabId)
    if (pulledWin?.tabPinned) return
    const members = prev.windows.filter((w) => groupIdForWindow(w) === groupId)
    if (members.length <= 1) return
    let detachedProjection = prev
    const pointerGesture = beginPointerGesture((latest, beforeGesture) =>
      WorkspaceDocumentCommands.rollbackTabPull(latest, beforeGesture, detachedProjection, groupId),
    )

    const startX = e.clientX
    const startY = e.clientY
    const threshold = 40
    let pulled = false
    let grabDx = 0
    let grabDy = 0
    const clampPullDragX = (nx: number, curWidth: number) => {
      const vis = WORKSPACE_WINDOW_MIN_VISIBLE_PX
      return Math.max(vis - curWidth, Math.min(nx, c.width - vis))
    }
    const clampPullDragY = (ny: number, curHeight: number) => {
      const vis = WORKSPACE_WINDOW_MIN_VISIBLE_PX
      return Math.max(vis - curHeight, Math.min(ny, c.height - vis))
    }

    let cancelGesture = () => {}
    const onMove = (ev: PointerEvent) => {
      if (!pulled) {
        const dy = ev.clientY - startY
        const dx = Math.abs(ev.clientX - startX)
        if (dy <= threshold && dx <= threshold) return
        pulled = true

        const win = prev.windows.find((x) => x.id === tabId)
        if (!win) {
          cancelGesture()
          return
        }
        const currentBounds = win.layout?.bounds
        const restoreBounds = win.layout?.restoreBounds
        const width = restoreBounds?.width ?? currentBounds?.width ?? 500
        const height = restoreBounds?.height ?? currentBounds?.height ?? 400
        const newX = ev.clientX - c.left - width / 2
        const newY = Math.max(0, ev.clientY - c.top - 16)

        const next = WorkspaceDocumentCommands.splitWindowFromGroup(prev, tabId, {
          x: newX,
          y: newY,
          width,
          height,
        })
        detachedProjection = next
        setWorkspace(next)
        focusWindow(tabId)

        const wb = next.windows.find((w) => w.id === tabId)?.layout?.bounds
        if (!wb) {
          cancelGesture()
          return
        }
        grabDx = ev.clientX - c.left - wb.x
        grabDy = ev.clientY - c.top - wb.y

        snap.handleDragPointerMove(tabId, ev.clientX, ev.clientY)
        const cur = next.windows.find((w) => w.id === tabId)?.layout?.bounds ?? wb
        let nx = clampPullDragX(ev.clientX - c.left - grabDx, cur.width)
        let ny = clampPullDragY(ev.clientY - c.top - grabDy, cur.height)
        snap.updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
        detachedProjection = workspace() ?? detachedProjection
        return
      }

      snap.handleDragPointerMove(tabId, ev.clientX, ev.clientY)
      const cur = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (!cur) return
      let nx = clampPullDragX(ev.clientX - c.left - grabDx, cur.width)
      let ny = clampPullDragY(ev.clientY - c.top - grabDy, cur.height)
      snap.updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
      detachedProjection = workspace() ?? detachedProjection
    }

    cancelGesture = startPointerGesture({
      pointerId: e.pointerId,
      move: onMove,
      commit: (ev) => {
        if (pulled) {
          const final = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
          if (final) snap.onDragPointerEnd(tabId, final, ev.clientX, ev.clientY)
        }
        pointerGesture.commit()
      },
      cancel: pointerGesture.cancel,
    })
  }

  function requestPlay(source: WorkspaceSource, path: string, dir?: string) {
    const isVideo = isVideoPath(path)
    const current = playbackSession.getSnapshot()
    if (!isVideo && current.mode === 'audio' && playbackPathMatches(current.currentItem, path)) {
      playbackSession.dispatch({ type: 'toggle' })
      return
    }
    const item = createFilesystemPlaybackItem({
      locator: path,
      name: path.split(/[/\\]/).at(-1) || path,
      media: isVideo ? 'video' : 'audio',
    })
    playbackSession.dispatch({
      type: 'load',
      item,
      queue: [item],
      autoplay: true,
      mode: isVideo ? 'video' : 'audio',
    })
    if (!isVideo) return
    const w = workspace()
    if (!w) return

    const work: PersistedWorkspaceState = w
    const activeWin = work.windows.find((x) => x.id === work.activeWindowId)
    let attachGroupId: string | null = null
    if (activeWin) {
      const gid = groupIdForWindow(activeWin)
      const members = tabsInGroup(work.windows, gid)
      const hasSplit = !!work.tabGroupSplits?.[gid]
      if (hasSplit || members.length > 1) {
        attachGroupId = gid
      }
    }

    const parentDir = path.split(/[/\\]/).slice(0, -1).join('/') || ''
    const initialDir = dir && dir.length > 0 ? dir : parentDir || null

    const viewerId = workspaceWindowId(work.nextWindowId)
    const nextNextId = work.nextWindowId + 1
    const baseWindows = work.windows
    const zIndex = maxWorkspaceWindowZ(baseWindows) + 1
    const nextTabMap = { ...work.activeTabMap }
    const file: FileItem = {
      name: getPlaybackTitle(path),
      path,
      type: MediaType.VIDEO,
      size: 0,
      extension: path.split('.').at(-1) ?? '',
      isDirectory: false,
    }

    const existingPlan = planWorkspaceWindowOpen({
      windows: work.windows,
      id: viewerId,
      reuseExisting: true,
      intent: { kind: 'viewer', file, source, dir: initialDir },
    })
    if (existingPlan.kind === 'existing') {
      const existing = work.windows.find((window) => window.id === existingPlan.windowId)
      if (existing) {
        setWorkspace(activateDesktopTabState(work, groupIdForWindow(existing), existing.id))
      }
      return
    }

    if (attachGroupId) {
      const anchor =
        baseWindows.find((x) => x.id === activeWin!.id) ??
        tabsInGroup(baseWindows, attachGroupId)[0]
      if (anchor) {
        const lb = anchor.layout
        const sharedLayout = lb
          ? {
              bounds: lb.bounds,
              fullscreen: lb.fullscreen,
              snapZone: lb.snapZone,
              tiling: lb.tiling,
              minimized: false,
              zIndex: lb.zIndex ?? zIndex,
              restoreBounds: lb.restoreBounds,
            }
          : createWindowLayout(undefined, createDefaultBounds(baseWindows.length, 'viewer'), zIndex)

        const groupMembers = tabsInGroup(baseWindows, attachGroupId)
        const split = work.tabGroupSplits?.[attachGroupId]
        let idx =
          split && split.leftTabId
            ? insertIndexAfterAllRightTabs(groupMembers, split.leftTabId)
            : groupMembers.length
        idx = clampTabInsertIndex(baseWindows, attachGroupId, idx)

        const plan = planWorkspaceWindowOpen({
          windows: baseWindows,
          id: viewerId,
          reuseExisting: false,
          intent: {
            kind: 'viewer',
            file,
            source,
            dir: initialDir,
            tabGroupId: attachGroupId,
            openedFromWindowId: activeWin?.id,
          },
          layout: sharedLayout,
        })
        if (plan.kind !== 'create') return
        const newWin = plan.definition
        const nextWindows = insertWindowAtGroupIndex(baseWindows, newWin, attachGroupId, idx)
        let nextState: PersistedWorkspaceState = {
          ...work,
          windows: nextWindows,
          nextWindowId: nextNextId,
          activeWindowId: viewerId,
          activeTabMap: { ...nextTabMap, [attachGroupId]: viewerId },
        }
        nextState = WorkspaceDocumentCommands.repairSplitFocus(nextState)
        setWorkspace(nextState)
        return
      }
    }

    const plan = planWorkspaceWindowOpen({
      windows: baseWindows,
      id: viewerId,
      reuseExisting: false,
      intent: { kind: 'viewer', file, source, dir: initialDir },
      layout: createWindowLayout(
        undefined,
        viewerBoundsForVideoOpen(path, source, baseWindows.length),
        zIndex,
      ),
    })
    if (plan.kind !== 'create') return
    const newWin = plan.definition
    setWorkspace({
      ...work,
      windows: [...baseWindows, newWin],
      nextWindowId: nextNextId,
      activeWindowId: viewerId,
      activeTabMap: nextTabMap,
    })
  }

  function resizeViewerWindowForVideoMetadata(
    windowId: string,
    videoWidth: number,
    videoHeight: number,
  ) {
    if (videoWidth <= 0 || videoHeight <= 0) return
    const aspect = videoWidth / videoHeight
    setWorkspace((prev) => {
      if (!prev) return prev
      const viewer = prev.windows.find((x) => x.id === windowId)
      if (!viewer || viewer.type !== 'viewer') return prev
      const currentBounds = viewer.layout?.bounds ?? null
      const newBounds = getPlayerBoundsForAspectRatio(aspect, currentBounds)
      const viewing = viewer.initialState?.viewing
      if (viewing) {
        rememberVideoIntrinsics(viewer.source, viewing, videoWidth, videoHeight)
      }
      const pb = viewer.layout?.bounds
      if (
        pb &&
        pb.x === newBounds.x &&
        pb.y === newBounds.y &&
        pb.width === newBounds.width &&
        pb.height === newBounds.height
      ) {
        return prev
      }
      return {
        ...prev,
        windows: prev.windows.map((win) =>
          win.id === windowId
            ? {
                ...win,
                layout: {
                  ...win.layout,
                  bounds: newBounds,
                },
              }
            : win,
        ),
      }
    })
  }

  function updateWindowViewing(windowId: string, viewing: string) {
    setWorkspace((current) =>
      current ? WorkspaceDocumentCommands.updateViewing(current, windowId, viewing) : current,
    )
  }

  function navigateDir(windowId: string, dir: string) {
    setWorkspace((current) =>
      current ? WorkspaceDocumentCommands.navigateDir(current, windowId, dir) : current,
    )
  }

  function openInNewTabInSameWindow(
    sourceWindowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
    insertIndex?: number,
    sourceOverride?: WorkspaceSource,
  ) {
    setWorkspace((prev) =>
      prev
        ? WorkspaceDocumentCommands.openTabInGroup(
            prev,
            resolveNewTabAnchorWindowId(prev, sourceWindowId),
            file,
            currentPath,
            insertIndex,
            sourceOverride,
          )
        : prev,
    )
  }

  function dropFileToTabBar(
    targetLeaderWindowId: string,
    data: FileDragData,
    insertIndex?: number,
  ) {
    if (data.virtualOpenTarget) {
      openHermesFromBrowser(
        targetLeaderWindowId,
        {
          path: data.path,
          name: data.path.split('/').at(-1) ?? 'Hermes session',
          isDirectory: false,
          isVirtual: true,
          size: 0,
          type: MediaType.OTHER,
          extension: '',
        },
        data.virtualOpenTarget,
        true,
      )
      return
    }
    const source: WorkspaceSource = DEFAULT_WORKSPACE_SOURCE
    const dir = data.isDirectory ? '' : data.path.split(/[/\\]/).slice(0, -1).join('/')
    setWorkspace((prev) =>
      prev
        ? WorkspaceDocumentCommands.openTabInGroup(
            prev,
            targetLeaderWindowId,
            { path: data.path, isDirectory: data.isDirectory },
            dir,
            insertIndex,
            source,
          )
        : prev,
    )
  }

  function openDesktopWindow(options: {
    reuseExisting: boolean
    intent: (current: PersistedWorkspaceState) => WorkspaceWindowOpenIntent | null
    placement: (
      current: PersistedWorkspaceState,
      intent: WorkspaceWindowOpenIntent,
    ) => WorkspaceWindowDefinition['layout']
  }): string | null {
    let openedWindowId: string | null = null
    setWorkspace((current) => {
      if (!current) return current
      const intent = options.intent(current)
      if (!intent) return current
      const plan = planWorkspaceWindowOpen({
        windows: current.windows,
        id: workspaceWindowId(current.nextWindowId),
        reuseExisting: options.reuseExisting,
        intent,
        layout: options.placement(current, intent),
      })
      openedWindowId = plan.kind === 'existing' ? plan.windowId : plan.definition.id
      if (plan.kind === 'existing') {
        const existing = current.windows.find((window) => window.id === plan.windowId)
        return existing
          ? activateDesktopTabState(current, groupIdForWindow(existing), existing.id)
          : current
      }
      const definition = plan.definition
      const added = {
        ...current,
        windows: [...current.windows, definition],
        nextWindowId: current.nextWindowId + 1,
        activeWindowId: definition.id,
        activeTabMap: definition.tabGroupId
          ? { ...current.activeTabMap, [definition.tabGroupId]: definition.id }
          : current.activeTabMap,
      }
      return definition.tabGroupId
        ? activateDesktopTabState(added, definition.tabGroupId, definition.id)
        : added
    })
    return openedWindowId
  }

  function openBrowser(options?: { source?: WorkspaceSource; initialState?: { dir?: string } }) {
    const source = options?.source ?? browserSource()
    const dir = options?.initialState?.dir ?? ''
    openDesktopWindow({
      reuseExisting: false,
      intent: () => ({ kind: 'browser', dir, source }),
      placement: (current) =>
        createWindowLayout(
          undefined,
          createDefaultBounds(current.windows.length, 'browser'),
          maxWorkspaceWindowZ(current.windows) + 1,
        ),
    })
  }

  function openViewerFromBrowser(windowId: string, file: FileItem) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef) return
    const dir = winDef.initialState?.dir ?? ''
    const gid = groupIdForWindow(winDef)
    const splitBrowserLeft =
      !!w?.tabGroupSplits?.[gid]?.leftTabId &&
      w.tabGroupSplits[gid]!.leftTabId === windowId &&
      winDef.type === 'browser'
    if (splitBrowserLeft) {
      openInNewTabInSameWindow(
        windowId,
        { path: file.path, isDirectory: false },
        dir,
        undefined,
        winDef.source,
      )
      return
    }
    openViewer(windowId, file, winDef.source)
  }

  function openHermesFromBrowser(
    windowId: string,
    file: FileItem,
    target: VirtualOpenTarget,
    forceTab = false,
  ) {
    openDesktopWindow({
      reuseExisting: true,
      intent: (current) => {
        const sourceWindow = current.windows.find((window) => window.id === windowId)
        const attachToTab = !!sourceWindow && (forceTab || getFileOpenTarget() === 'new-tab')
        return {
          kind: 'hermes',
          file,
          target,
          draftId: target.type === 'hermesDraft' ? crypto.randomUUID() : undefined,
          source: sourceWindow?.source ?? browserSource(),
          openedFromWindowId: sourceWindow?.id,
          tabGroupId: attachToTab ? groupIdForWindow(sourceWindow) : null,
        }
      },
      placement: (current, intent) => {
        const sourceWindow = intent.openedFromWindowId
          ? current.windows.find((window) => window.id === intent.openedFromWindowId)
          : undefined
        return intent.tabGroupId && sourceWindow?.layout
          ? { ...sourceWindow.layout, minimized: false }
          : createWindowLayout(
              undefined,
              createDefaultBounds(current.windows.length, 'viewer'),
              maxWorkspaceWindowZ(current.windows) + 1,
            )
      },
    })
  }

  function bindHermesSession(windowId: string, sessionId: string) {
    setWorkspace((prev) =>
      prev ? WorkspaceDocumentCommands.bindHermesSession(prev, windowId, sessionId) : prev,
    )
  }

  function openHermesBranch(windowId: string, sessionId: string, title: string) {
    openHermesFromBrowser(
      windowId,
      {
        name: title,
        path: `Hermes Sessions/session/${sessionId}`,
        type: MediaType.OTHER,
        size: 0,
        extension: '',
        isDirectory: false,
        isVirtual: true,
      },
      { type: 'hermesSession', sessionId, readOnly: false },
      true,
    )
  }

  function renameHermesWindow(windowId: string, title: string) {
    setWorkspace((current) =>
      current ? WorkspaceDocumentCommands.renameWindow(current, windowId, title) : current,
    )
  }

  function openInSplitViewFromBrowserPane(windowId: string, file: FileItem) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || winDef.type !== 'browser') return
    const dir = winDef.initialState?.dir ?? ''
    if (file.type === MediaType.AUDIO) {
      requestPlay(winDef.source, file.path, dir || undefined)
      return
    }
    setWorkspace((prev) =>
      prev
        ? WorkspaceDocumentCommands.openInSplit(
            prev,
            windowId,
            { path: file.path, isDirectory: file.isDirectory, isVirtual: file.isVirtual },
            dir,
            winDef.source,
          )
        : prev,
    )
  }

  function startSplitPaneDrag(groupId: string, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const row = (e.currentTarget as HTMLElement).parentElement
    if (!row) return
    const current = workspace()
    if (!current) return
    let splitProjection = current
    const pointerGesture = beginPointerGesture((latest, beforeGesture) =>
      WorkspaceDocumentCommands.rollbackSplitFraction(
        latest,
        beforeGesture,
        splitProjection,
        groupId,
      ),
    )
    const onMove = (ev: PointerEvent) => {
      if (!workspaceRegistry.editable()) return
      const r = row.getBoundingClientRect()
      const wpx = Math.max(1, r.width)
      const fraction = (ev.clientX - r.left) / wpx
      setWorkspace((latest) => {
        if (!latest) return latest
        const next = WorkspaceDocumentCommands.setSplitFraction(latest, groupId, fraction)
        splitProjection = next
        return next
      })
    }
    startPointerGesture({
      pointerId: e.pointerId,
      captureTarget: e.currentTarget as HTMLElement,
      move: onMove,
      commit: pointerGesture.commit,
      cancel: pointerGesture.cancel,
    })
  }

  function openFileInNewFloatingWindow(windowId: string, file: FileItem) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || file.isDirectory) return
    openViewer(windowId, file, winDef.source)
  }

  function openViewer(fromWindowId: string, file: FileItem, source: WorkspaceSource) {
    openDesktopWindow({
      reuseExisting: false,
      intent: () => ({
        kind: 'viewer',
        file,
        source,
        openedFromWindowId: fromWindowId || null,
      }),
      placement: (current) =>
        createWindowLayout(
          undefined,
          file.type === MediaType.VIDEO
            ? viewerBoundsForVideoOpen(file.path, source, current.windows.length)
            : createDefaultBounds(current.windows.length, 'viewer'),
          maxWorkspaceWindowZ(current.windows) + 1,
        ),
    })
  }

  function openReaderFromBrowser(fromWindowId: string, file: FileItem) {
    if (!file.isDirectory) return
    openDesktopWindow({
      reuseExisting: false,
      intent: (current) => {
        const sourceWindow = current.windows.find((window) => window.id === fromWindowId)
        return sourceWindow
          ? {
              kind: 'reader',
              file,
              readerKind: 'folder',
              source: sourceWindow.source,
              openedFromWindowId: sourceWindow.id,
            }
          : null
      },
      placement: (current) =>
        createWindowLayout(
          undefined,
          createDefaultBounds(current.windows.length, 'viewer'),
          maxWorkspaceWindowZ(current.windows) + 1,
        ),
    })
  }

  function openGlobalSearchResult(result: FileSearchResult) {
    const file = fileSearchResultToFileItem(result)
    const source = browserSource()
    if (file.isDirectory) {
      openBrowser({ source, initialState: { dir: file.path } })
      return
    }
    if (file.type === MediaType.AUDIO || file.type === MediaType.VIDEO) {
      requestPlay(source, file.path, result.parentPath || undefined)
      return
    }
    openViewer(workspace()?.activeWindowId ?? '', file, source)
  }

  function addPinnedItem(file: FileItem, source: WorkspaceSource) {
    const plan = planTaskbarPinAdd({
      pins: server.serverPinsList(),
      file,
      source,
      customIcons: server.settingsQuery.data?.customIcons ?? {},
    })
    if (plan.kind === 'add') void server.addPin(plan.pin).catch(() => undefined)
  }

  function removePinnedItem(id: string) {
    void server.removePin(id).catch(() => undefined)
  }

  function selectPinned(pin: PinnedTaskbarItem): void {
    void selectPinnedAsync(pin)
  }

  async function selectPinnedAsync(pin: PinnedTaskbarItem) {
    if (pin.isVirtual) {
      const response = await fetch(
        `/api/virtual-directory/open?path=${encodeURIComponent(pin.path)}`,
      )
      if (!response.ok) return
      const payload = await response.json()
      const target = payload.openTarget as VirtualOpenTarget | undefined
      if (target) {
        const synthetic: FileItem = {
          path: pin.path,
          name: pin.title,
          isDirectory: false,
          isVirtual: true,
          size: 0,
          type: MediaType.OTHER,
          extension: '',
        }
        openHermesFromBrowser(workspace()?.activeWindowId ?? '', synthetic, target)
      }
      return
    }
    if (pin.isDirectory) {
      openBrowser({ source: pin.source, initialState: { dir: pin.path } })
      return
    }
    const ext = pin.path.split('.').pop()?.toLowerCase() ?? ''
    const type = getMediaType(ext)
    if (type === MediaType.VIDEO || type === MediaType.AUDIO) {
      return
    }
    const synthetic: FileItem = {
      path: pin.path,
      name: pin.title,
      isDirectory: false,
      isVirtual: false,
      size: 0,
      type,
      extension: ext,
    }
    openViewer('', synthetic, pin.source)
  }

  const [pinMenu, setPinMenu] = createSignal<{
    x: number
    y: number
    pinId: string
  } | null>(null)

  const playbackPlayingPath = createMemo(() => playback().currentItem?.locator ?? null)

  const suppressWorkspaceTaskbarAudioForVideoViewer = createMemo(() => {
    const w = workspace()
    const state = playback()
    const path = state.currentItem?.locator
    if (!path || state.currentItem?.media !== 'video' || state.mode !== 'video' || !w) return false
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const n = norm(path)
    return w.windows.some((win) => {
      if (win.type !== 'viewer') return false
      const v = win.initialState?.viewing
      if (!v || norm(v) !== n) return false
      return isVideoPath(v)
    })
  })

  const workspaceFileIconContext = (): FileIconContext => {
    const state = playback()
    const playing = state.currentItem?.locator ?? null

    return {
      customIcons: server.settingsQuery.data?.customIcons ?? {},
      knowledgeBases: server.settingsQuery.data?.knowledgeBases ?? [],
      playingPath: playing,
      currentFile: playing,
      mediaPlayerIsPlaying: state.phase === 'playing',
      mediaType: state.currentItem ? state.mode : null,
    }
  }

  const taskbarMouseHandled = { current: false }
  const orderedWindowGroupIds = createMemo(() => orderedAllGroupIds(workspace()?.windows ?? []))
  const taskbarActiveWindowId = createMemo(() => workspace()?.activeWindowId ?? null)

  const pinnedItems = server.serverPinsList
  const hasWorkspaceWindows = createMemo(() => (workspace()?.windows.length ?? 0) > 0)
  const hasAnyTaskbarItems = createMemo(
    () => pinnedItems().length > 0 || orderedWindowGroupIds().length > 0,
  )

  /** Solid <For> passes props.each to mapArray as the list; it must be an array, not a memo fn. */
  const taskbarWindowRows = createMemo(() => (
    <For each={orderedWindowGroupIds()}>
      {(groupId) => (
        <TaskbarGroupRow
          groupId={groupId}
          workspace={workspace}
          activeWindowId={taskbarActiveWindowId}
          playingPath={playbackPlayingPath}
          fileIconContext={workspaceFileIconContext}
          taskbarMouseHandled={taskbarMouseHandled}
          focusWindow={editableFocusWindow}
          setWindowMinimized={editableSetWindowMinimized}
          closeWindow={editableCloseWindow}
        />
      )}
    </For>
  ))

  function handleWorkspaceTilingPick(windowId: string, span: AssistGridSpan) {
    snap.applyTilingPickerPick(windowId, span)
    setLayoutPicker(null)
  }

  function beginFileOpenTargetPick(sourceBrowserId: string) {
    setFileOpenTargetPick({ sourceBrowserId })
    setFileOpenPickHoverId(null)
  }

  function cancelFileOpenTargetPick() {
    setFileOpenTargetPick(null)
    setFileOpenPickHoverId(null)
  }

  function updateFileOpenPickHover(clientX: number, clientY: number) {
    const w = workspace()
    const area = snap.getWorkspaceAreaElement()
    if (!w || !area) {
      setFileOpenPickHoverId(null)
      return
    }
    const rect = area.getBoundingClientRect()
    setFileOpenPickHoverId(pickWorkspaceWindowAtClientPoint(w.windows, rect, clientX, clientY))
  }

  function clearBrowserFileOpenTarget(browserId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        windows: prev.windows.map((win) => {
          if (win.id !== browserId || win.type !== 'browser') return win
          if (win.fileOpenTargetWindowId == null) return win
          const { fileOpenTargetWindowId: _omit, ...rest } = win
          return rest as WorkspaceWindowDefinition
        }),
      }
    })
  }

  function commitFileOpenTargetPick(targetWindowId: string) {
    const pick = fileOpenTargetPick()
    if (!pick) return
    if (!workspaceRegistry.editable()) {
      cancelFileOpenTargetPick()
      return
    }
    if (targetWindowId === pick.sourceBrowserId) {
      clearBrowserFileOpenTarget(pick.sourceBrowserId)
      cancelFileOpenTargetPick()
      return
    }
    setWorkspace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        windows: prev.windows.map((win) =>
          win.id === pick.sourceBrowserId && win.type === 'browser'
            ? { ...win, fileOpenTargetWindowId: targetWindowId }
            : win,
        ),
      }
    })
    cancelFileOpenTargetPick()
  }

  createEffect(
    () => !!fileOpenTargetPick(),
    (isOpen) => {
      if (!isOpen) return undefined
      const previousCursor = document.body.style.cursor
      document.body.style.cursor = 'crosshair'
      const onMove = (e: PointerEvent) => {
        updateFileOpenPickHover(e.clientX, e.clientY)
      }
      const onUp = (e: PointerEvent) => {
        const state = workspace()
        const area = snap.getWorkspaceAreaElement()
        if (!state || !area) {
          cancelFileOpenTargetPick()
          return
        }
        const rect = area.getBoundingClientRect()
        const id = pickWorkspaceWindowAtClientPoint(state.windows, rect, e.clientX, e.clientY)
        if (id) commitFileOpenTargetPick(id)
        else cancelFileOpenTargetPick()
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') cancelFileOpenTargetPick()
      }
      document.addEventListener('pointermove', onMove, { capture: true })
      document.addEventListener('pointerup', onUp, { capture: true })
      document.addEventListener('pointercancel', cancelFileOpenTargetPick, { capture: true })
      window.addEventListener('blur', cancelFileOpenTargetPick)
      window.addEventListener('keydown', onKey)
      // eslint-disable-next-line solid/reactivity
      return () => {
        document.body.style.cursor = previousCursor
        document.removeEventListener('pointermove', onMove, { capture: true })
        document.removeEventListener('pointerup', onUp, { capture: true })
        document.removeEventListener('pointercancel', cancelFileOpenTargetPick, { capture: true })
        window.removeEventListener('blur', cancelFileOpenTargetPick)
        window.removeEventListener('keydown', onKey)
      }
    },
  )

  function clearCrossWorkspaceHover() {
    crossWorkspaceTransfer!.hover(null)
  }

  function beginCrossWorkspaceHover(destinationId: string) {
    if (!destinationId || destinationId === workspaceId()) {
      clearCrossWorkspaceHover()
      return
    }
    if (crossWorkspaceTransfer!.active()) crossWorkspaceTransfer!.hover(destinationId)
  }

  async function leaveForWorkspace(id: string, mode: 'push' | 'replace' = 'push') {
    await settleGesturesBeforeNavigation()
    setWorkspacePanelOpen(false)
    await workspaceRegistry.transition(
      () => navigateSearchParams({ ws: id, dir: null, preset: null }, mode),
      async () => {
        const { currentId, currentRecord, empty } = untrack(() => {
          const currentId = workspaceId()
          return {
            currentId,
            currentRecord: workspaceRegistry.registry().records[currentId],
            empty: (workspace()?.windows.length ?? 0) === 0,
          }
        })
        if (!currentRecord?.name && empty) {
          try {
            await workspaceRegistry.deleteWorkspace(currentId)
          } catch {
            // Leaving remains available after a failed delete request.
          }
        }
      },
    )
  }

  return (
    <div
      data-workspace-opened={workspaceRegistry.opened() ? '' : undefined}
      class={`workspace-layout fixed inset-0 flex flex-col overflow-hidden bg-background select-none ${
        workspaceRegistry.opened() ? 'pointer-events-auto' : 'pointer-events-none'
      } ${
        server.settingsQuery.data?.workspaceTransition !== 'instant'
          ? 'transition-opacity duration-150'
          : ''
      }`}
    >
      <div
        class='relative min-h-0 flex-1 overflow-hidden'
        ref={(el) => snap.bindWorkspaceAreaRoot(el)}
      >
        <Show when={!workspaceRegistry.editable()}>
          <div class='absolute left-1/2 top-2 z-[100002] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-lg'>
            Read only — workspace is open elsewhere
          </div>
        </Show>
        <DesktopWorkspaceCanvas
          hasWorkspaceWindows={hasWorkspaceWindows}
          onOpenBrowser={editableOpenBrowser}
          bindSnapPreview={(el) => snap.bindSnapPreview(el)}
          workspaceAreaNode={snap.workspaceAreaNode}
          getWorkspaceAreaElement={snap.getWorkspaceAreaElement}
          snapAssistShown={snap.snapAssistShown}
          engageSnapAssistFromHandle={snap.engageSnapAssistFromHandle}
          disengageSnapAssistFromPanel={snap.disengageSnapAssistFromPanel}
          assistHoverPick={snap.assistHoverPick}
          bindSnapAssistRoot={(el) => snap.bindSnapAssistRoot(el)}
          renderedGroupIds={orderedWindowGroupIds}
          workspace={workspace}
          setWorkspace={setEditableWorkspace}
          mergeTargetPreview={snap.mergeTargetPreview}
          dragSnapWindowId={snap.dragSnapWindowId}
          layoutPicker={layoutPicker}
          closeLayoutPicker={() => setLayoutPicker(null)}
          onTilingPick={editableHandleWorkspaceTilingPick}
          setTilingPickerHoverPreview={snap.setTilingPickerHoverPreview}
          openLayoutPicker={editableOpenLayoutPicker}
          editableFolders={server.editableFolders}
          knowledgeBases={() => server.settingsQuery.data?.knowledgeBases ?? []}
          workspaceFileIconContext={workspaceFileIconContext}
          focusWindow={editableFocusWindow}
          closeWindow={editableCloseWindow}
          setWindowMinimized={editableSetWindowMinimized}
          toggleFullscreenWindow={editableToggleFullscreen}
          restoreDrag={(id, x, y) =>
            workspaceRegistry.editable() ? snap.restoreDrag(id, x, y) : undefined
          }
          handleDragPointerMove={(windowId, clientX, clientY) => {
            if (!workspaceRegistry.editable()) return
            snap.handleDragPointerMove(windowId, clientX, clientY)
            if (!crossWorkspaceTransfer!.active()) crossWorkspaceTransfer!.begin([windowId])
            if (workspacePanelOpen() && clientX > 300) {
              clearCrossWorkspaceHover()
              setWorkspacePanelOpen(false)
              crossWorkspaceTransfer!.finishLocal()
              return
            }
            const pointerElement = document.elementFromPoint(clientX, clientY)
            const railTarget =
              pointerElement?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId
            if (crossWorkspaceTransfer!.active()) {
              if (railTarget) beginCrossWorkspaceHover(railTarget)
              else if (!pointerElement?.closest('[data-testid="workspace-switcher"]'))
                beginCrossWorkspaceHover('')
            }
            if (clientX <= 12 && !workspacePanelOpen()) {
              setWorkspacePanelOpen(true)
              void workspaceRegistry.refresh()
            }
          }}
          onDragPointerEnd={(windowId, bounds, clientX, clientY) => {
            if (!workspaceRegistry.editable()) return
            const dropTarget = document
              .elementFromPoint(clientX, clientY)
              ?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId
            snap.onDragPointerEnd(windowId, bounds, clientX, clientY)
            if (dropTarget && dropTarget !== workspaceId()) {
              void crossWorkspaceTransfer!.drop(dropTarget)
            } else {
              crossWorkspaceTransfer!.finishLocal()
              setTimeout(() => setWorkspacePanelOpen(false), 100)
            }
          }}
          updateWindowBounds={(id, bounds) =>
            workspaceRegistry.editable() && snap.updateWindowBounds(id, bounds)
          }
          resizeSnappedWindowBounds={(id, bounds, edges) =>
            workspaceRegistry.editable() && snap.resizeSnappedWindowBounds(id, bounds, edges)
          }
          beginPointerGesture={beginPointerGesture}
          activateTab={editableActivateTab}
          closeTab={editableCloseTab}
          toggleTabPinned={editableToggleTabPinned}
          handleTabPullStart={editableHandleTabPullStart}
          dropFileToTabBar={editableDropFileToTabBar}
          startSplitPaneDrag={editableStartSplitPaneDrag}
          navigateDir={editableNavigateDir}
          openViewerFromBrowser={editableOpenViewerFromBrowser}
          openReaderFromBrowser={editableOpenReaderFromBrowser}
          openHermesFromBrowser={editableOpenHermesFromBrowser}
          bindHermesSession={editableBindHermesSession}
          openHermesBranch={editableOpenHermesBranch}
          renameHermesWindow={editableRenameHermesWindow}
          addPinnedItem={editableAddPinnedItem}
          openInNewTabInSameWindow={editableOpenInNewTabInSameWindow}
          openInSplitViewFromBrowserPane={editableOpenInSplitViewFromBrowserPane}
          requestPlay={editableRequestPlay}
          updateWindowViewing={editableUpdateWindowViewing}
          resizeViewerWindowForVideoMetadata={editableResizeViewerWindowForVideoMetadata}
          onBeginFileOpenTargetPick={editableBeginFileOpenTargetPick}
          openFileInNewFloatingWindow={editableOpenFileInNewFloatingWindow}
        />
        <Show when={fileOpenTargetPick()}>
          <Show when={fileOpenPickHoverId()} keyed fallback={null}>
            {(hid) => {
              const b = layoutBoundsForWindowHighlight(workspace()?.windows ?? [], hid)
              if (!b) return null
              return (
                <div
                  class='pointer-events-none absolute z-[100001] rounded-sm border-2 border-primary bg-primary/15'
                  style={{
                    left: `${b.x}px`,
                    top: `${b.y}px`,
                    width: `${b.width}px`,
                    height: `${b.height}px`,
                  }}
                />
              )
            }}
          </Show>
        </Show>
      </div>
      <DesktopWorkspaceTaskbar
        onOpenBrowser={editableOpenBrowser}
        onOpenWorkspaces={() => void toggleWorkspacePanelFromTaskbar()}
        onWorkspaceTransitionChange={(value) => void server.setWorkspaceTransition(value)}
        onOpenSearchResult={editableOpenSearchResult}
        hasAnyTaskbarItems={hasAnyTaskbarItems}
        pinnedItems={pinnedItems}
        taskbarGroupIds={orderedWindowGroupIds}
        taskbarWindowRows={taskbarWindowRows}
        browserSource={browserSource}
        workspace={workspace}
        settingsData={() => server.settingsQuery.data}
        workspaceFileIconContext={workspaceFileIconContext}
        selectPinned={editableSelectPinned}
        removePinnedItem={editableRemovePinnedItem}
        pinMenu={pinMenu}
        setPinMenu={setPinMenu}
        focusWindow={editableFocusWindow}
        stopWorkspacePlaybackFromTaskbar={stopWorkspacePlaybackFromTaskbar}
        requestPlay={editableRequestPlay}
        suppressTaskbarAudioChrome={suppressWorkspaceTaskbarAudioForVideoViewer}
      />
      <WorkspaceSwitcher
        open={workspacePanelOpen()}
        activeId={workspaceId()}
        registry={workspaceRegistry.registry()}
        editable={workspaceRegistry.editable()}
        onToggle={() => setWorkspacePanelOpen((open) => !open)}
        onDismiss={dismissWorkspacePanel}
        onSelect={(id) => {
          void leaveForWorkspace(id)
        }}
        onOpenNewTab={(id) => {
          if (id === workspaceId()) return
          window.open(`/workspace?ws=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer')
        }}
        onCreate={() => {
          const id = crypto.randomUUID()
          void workspaceRegistry.transition(() => {
            setWorkspacePanelOpen(false)
            navigateSearchParams({ ws: id, dir: null, preset: null }, 'push')
          })
        }}
        onTakeControl={() => void workspaceRegistry.takeControl()}
        onRename={(id, name) => workspaceRegistry.updateMetadataFor(id, { name })}
        onIcon={(id, icon, iconColor) =>
          workspaceRegistry.updateMetadataFor(id, { icon, iconColor })
        }
        onDelete={lifecycle.deleteWorkspace}
        onConvert={lifecycle.convertWorkspace}
        onReorder={(order) => workspaceRegistry.reorder(order)}
        draggingWindow={crossWorkspaceTransfer!.active()}
        onDragHover={beginCrossWorkspaceHover}
        hoverTarget={crossWorkspaceTransfer!.hoverTarget()}
        transferReady={crossWorkspaceTransfer!.ready()}
      />
    </div>
  )
}
