import { isVirtualFolderPath } from '@/lib/files/constants'
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
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/workspace/model/use-workspace'
import { applyWorkspacePathMutation } from '@/workspace/model/workspace-path-mutation'
import {
  resolveNewTabAnchorWindowId,
  sanitizePersistedWorkspaceState,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/workspace/model/use-workspace'
import { rememberVideoIntrinsics } from '@/lib/media/video-intrinsics'
import { viewerBoundsForVideoOpen } from '@/workspace/model/workspace-video-bounds'
import { buildWorkspaceFromDirParam } from './page/workspace-bootstrap'
import { useWorkspacePreferredSnapStore } from '@/workspace/model/workspace-preferred-snap-store'
import { fileOpenTargetStore, getFileOpenTarget } from '@/features/explorer/file-open-target'
import {
  layoutBoundsForWindowHighlight,
  pickWorkspaceWindowAtClientPoint,
} from './tabs/workspace-file-open-target-picker'
import { directoryTitle } from '@/lib/files/directory-title'
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import { useThemeStore } from '@/lib/state/theme-store'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from '@/lib/browser/browser-history'
import { useAdminEventsStream } from '@/lib/api/use-admin-events-stream'
import { WorkspacePageCanvas } from './page/WorkspacePageCanvas'
import { WorkspacePageTaskbar } from './page/WorkspacePageTaskbar'
import { createWorkspaceSnapDragModel } from './layout/create-workspace-snap-drag-model'
import { useWorkspacePageDocumentChrome } from './page/use-workspace-page-document-chrome'
import { useWorkspacePageLocalPersistence } from './page/use-workspace-page-local-persistence'
import { useWorkspacePageServerData } from './page/use-workspace-page-server-data'
import { useWorkspaceRegistry } from './page/use-workspace-registry'
import { WorkspaceSwitcher } from './page/WorkspaceSwitcher'

export type { WorkspacePageProps } from './page/workspace-page-types'
import {
  clampTabInsertIndex,
  ensureSplitActiveNotLeft,
  exitSplitViewState,
  groupIdForWindow,
  insertIndexAfterAllRightTabs,
  isSplitLeftTab,
  openInNewTabInGroupState,
  openInSplitViewFromBrowserState,
  orderedAllGroupIds,
  pruneTabGroupSplitsState,
  setSplitFractionState,
  setTabPinnedAndReorderState,
  splitWindowFromGroupState,
  tabsInGroup,
} from './tabs/tab-group-ops'
import { TaskbarGroupRow } from './taskbar/WorkspaceTaskbarRows'
import {
  DEFAULT_WORKSPACE_SOURCE,
  defaultPersistedState,
  isWorkspaceRoute,
  loadPersisted,
} from './page/workspace-page-persistence'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/files/file-search'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import { canCloseHermesWindow, discardHermesDraft } from '@/features/hermes/hermes-session-store'
import { createFilesystemPlaybackItem, playbackPathMatches } from '@/features/playback/items'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import { post } from '@/lib/api/client'

export function WorkspacePage() {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()

  const server = useWorkspacePageServerData()
  const browserSource = () => DEFAULT_WORKSPACE_SOURCE

  const storageSessionKeyFull = createMemo(() => {
    const sid = urlSearchParams().get('ws') ?? ''
    const base = workspaceStorageBaseKey()
    return { sid, key: sid ? workspaceStorageSessionKey(base, sid) : '' }
  })

  const [workspace, setWorkspace] = createSignal<PersistedWorkspaceState | null>(null)
  type CrossWorkspaceTransfer = {
    sourceId: string
    sourceState: PersistedWorkspaceState
    sourceNext: PersistedWorkspaceState
    sourceRevision: number
    destinationId: string
    destinationRevision: number
    destinationWasCreated: boolean
    draggedWindowId: string
  }
  let crossTransferStart: {
    target: string
    released: boolean
    promise: Promise<boolean>
  } | null = null
  const [crossDragCandidate, setCrossDragCandidate] = createSignal<{
    sourceId: string
    sourceState: PersistedWorkspaceState
    sourceRevision: number
    draggedWindowId: string
  } | null>(null)
  const [crossTransfer, setCrossTransfer] = createSignal<CrossWorkspaceTransfer | null>(null)
  const workspaceId = () => storageSessionKeyFull().sid
  const workspaceRegistry = useWorkspaceRegistry({
    workspaceId,
    workspace,
    setWorkspace,
    savingBlocked: () => crossDragCandidate() != null || crossTransfer() != null,
  })

  function ifEditable(action: () => void) {
    if (workspaceRegistry.editable()) action()
  }

  const setEditableWorkspace: typeof setWorkspace = (value) => {
    if (workspaceRegistry.editable()) setWorkspace(value)
  }
  useAdminEventsStream(true, (mutation) => {
    setWorkspace((current) => (current ? applyWorkspacePathMutation(current, mutation) : current))
  })

  const [layoutPicker, setLayoutPicker] = createSignal<{
    windowId: string
    anchor: DOMRect
  } | null>(null)

  const [fileOpenTargetPick, setFileOpenTargetPick] = createSignal<{
    sourceBrowserId: string
  } | null>(null)
  const [fileOpenPickHoverId, setFileOpenPickHoverId] = createSignal<string | null>(null)

  const preferredSnapTick = useStoreSync(useWorkspacePreferredSnapStore)
  const themeTick = useStoreSync(useThemeStore)
  const snap = createWorkspaceSnapDragModel({ workspace, setWorkspace, preferredSnapTick })

  const editableOpenBrowser = () => ifEditable(() => openBrowser())
  const editableFocusWindow = (id: string) => ifEditable(() => focusWindow(id))
  const editableSetWindowMinimized = (id: string, minimized: boolean) =>
    ifEditable(() => snap.setWindowMinimized(id, minimized))
  const editableCloseWindow = (id: string) => ifEditable(() => closeWindow(id))
  const editableAddPinnedItem = (file: FileItem) => ifEditable(() => addPinnedItem(file))
  const editableSelectPinned = (pin: PinnedTaskbarItem) => ifEditable(() => selectPinned(pin))
  const editableRemovePinnedItem = (id: string) => ifEditable(() => removePinnedItem(id))
  const editableOpenSearchResult = (result: FileSearchResult) =>
    ifEditable(() => openGlobalSearchResult(result))
  const editableToggleFullscreen = (id: string) => ifEditable(() => snap.toggleFullscreenWindow(id))
  const editableSetActiveTab = (groupId: string, tabId: string) =>
    ifEditable(() => setActiveTab(groupId, tabId))
  const editableCloseTab = (id: string, options?: { ignoreTabPinForListenOnlyDismiss?: boolean }) =>
    ifEditable(() => closeTab(id, options))
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
    ifEditable(() => setLayoutPicker({ windowId, anchor }))

  useWorkspacePageDocumentChrome(workspace, themeTick)

  useWorkspacePageLocalPersistence({
    storageSessionKeyFull,
    workspace,
    editable: workspaceRegistry.editable,
  })

  createEffect(
    () => workspace()?.fileOpenTarget,
    (target) => {
      if (target !== 'new-tab' && target !== 'new-window') return
      const current = fileOpenTargetStore.getState().target
      if (current !== target) {
        fileOpenTargetStore.getState().setTarget(target)
      }
    },
  )

  createEffect(
    () => !!fileOpenTargetPick(),
    (isOpen) => {
      if (!isOpen) return undefined
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setFileOpenTargetPick(null)
          setFileOpenPickHoverId(null)
        }
      }
      window.addEventListener('keydown', onKey)
      // eslint-disable-next-line solid/reactivity
      return () => window.removeEventListener('keydown', onKey)
    },
  )

  const [pinsHydratedFor, setPinsHydratedFor] = createSignal('')
  const [workspacePanelOpen, setWorkspacePanelOpen] = createSignal(false)
  const dismissWorkspacePanel = () => {
    setWorkspacePanelOpen(false)
  }
  const toggleWorkspacePanelFromTaskbar = () => {
    setWorkspacePanelOpen((open) => !open)
  }
  const [crossHoverTarget, setCrossHoverTarget] = createSignal('')
  let crossHoverTimer: ReturnType<typeof setTimeout> | undefined
  let crossTransferCommitting = false
  let crossDragReleaseListening = false
  let crossTransferStartGeneration = 0

  let lastHydratedStorageKey = ''

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

  createEffect(
    () => {
      const location = history()
      if (!isWorkspaceRoute(location.pathname)) return null
      const params = urlSearchParams()
      const sidParam = params.get('ws') ?? ''
      if (!sidParam) {
        if (!workspaceRegistry.ready()) return null
        const records = Object.values(workspaceRegistry.registry().records)
        const last = records.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0]
        return { kind: 'navigate' as const, sid: last?.id ?? crypto.randomUUID() }
      }
      const sid = sidParam
      const base = workspaceStorageBaseKey()
      const key = workspaceStorageSessionKey(base, sid)
      const loaded = loadPersisted(key)
      const remoteSnapshot = workspaceRegistry.registry().records[sid]?.snapshot
      const remote = remoteSnapshot ? sanitizePersistedWorkspaceState(remoteSnapshot) : null
      return {
        kind: 'hydrate' as const,
        sid,
        key,
        dirParam: params.get('dir'),
        loaded: remote ?? loaded,
      }
    },
    (hydration) => {
      if (!hydration) return
      if (hydration.kind === 'navigate') {
        navigateSearchParams({ ws: hydration.sid }, 'replace')
        return
      }
      if (crossTransfer()?.destinationId === hydration.sid) {
        lastHydratedStorageKey = hydration.key
        return
      }
      if (lastHydratedStorageKey === hydration.key) return
      lastHydratedStorageKey = hydration.key
      const initial = hydration.dirParam
        ? buildWorkspaceFromDirParam(hydration.dirParam, browserSource())
        : (hydration.loaded ?? defaultPersistedState(browserSource()))
      setWorkspace(initial)
      setPinsHydratedFor('')
    },
  )

  createEffect(
    () => workspaceRegistry.registry().records[workspaceId()],
    (record) => {
      if (!record) return
      setWorkspace((current) => {
        if (!current) return current
        const browserTabTitle = record.name || undefined
        const browserTabIcon = record.icon || undefined
        const browserTabIconColor = record.iconColor || undefined
        if (
          current.browserTabTitle === browserTabTitle &&
          current.browserTabIcon === browserTabIcon &&
          current.browserTabIconColor === browserTabIconColor
        )
          return current
        return { ...current, browserTabTitle, browserTabIcon, browserTabIconColor }
      })
    },
  )

  createEffect(
    () => {
      if (!server.serverPinsReady()) return null
      const { key } = storageSessionKeyFull()
      const state = workspace()
      if (!key || !state || pinsHydratedFor() === key) return null
      return { key, state, serverPins: server.serverPinsList() }
    },
    (pins) => {
      if (!pins) return
      if (pins.serverPins.length > 0) {
        setWorkspace((prev) => (prev ? { ...prev, pinnedTaskbarItems: pins.serverPins } : prev))
      } else if ((pins.state.pinnedTaskbarItems?.length ?? 0) > 0) {
        void server.persistPinsMutation.mutateAsync(pins.state.pinnedTaskbarItems ?? [])
      }
      setPinsHydratedFor(pins.key)
    },
  )

  function focusWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    let target = w.windows.find((x) => x.id === windowId)
    if (!target) return
    const gid = groupIdForWindow(target)
    let focusWindowId = windowId
    if (isSplitLeftTab(w, gid, windowId)) {
      const members = tabsInGroup(w.windows, gid)
      const splitId = w.tabGroupSplits?.[gid]?.leftTabId
      const firstRight = members.find((m) => m.id !== splitId)
      if (!firstRight) return
      const cur = w.activeTabMap[gid]
      focusWindowId =
        cur && cur !== splitId && members.some((m) => m.id === cur) ? cur : firstRight.id
      target = w.windows.find((x) => x.id === focusWindowId)
    }
    if (!target) return
    const leader = tabsInGroup(w.windows, gid)[0]
    const groupMinimized = leader?.layout?.minimized ?? false
    if (w.activeWindowId === focusWindowId && !groupMinimized) return
    const maxZ = maxWorkspaceWindowZ(w.windows)
    const newZ = maxZ + 1
    setWorkspace({
      ...w,
      activeWindowId: focusWindowId,
      activeTabMap: { ...w.activeTabMap, [gid]: focusWindowId },
      windows: w.windows.map((win) =>
        groupIdForWindow(win) === gid
          ? { ...win, layout: { ...win.layout, zIndex: newZ, minimized: false } }
          : win,
      ),
    })
  }

  function stopWorkspacePlaybackFromTaskbar() {
    playbackSession.dispatch({ type: 'stop' })
  }

  function closeWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const t = w.windows.find((x) => x.id === windowId)
    const gid = t ? groupIdForWindow(t) : windowId
    const toRemove = new Set(w.windows.filter((x) => groupIdForWindow(x) === gid).map((x) => x.id))
    const removed = w.windows.filter((x) => toRemove.has(x.id))
    if (removed.some((x) => !canCloseHermesWindow(x.hermes))) return
    const next = w.windows.filter((x) => !toRemove.has(x.id))
    let active = w.activeWindowId
    if (active != null && toRemove.has(active)) {
      active = next[next.length - 1]?.id ?? active
    }
    const nextTabMap = { ...w.activeTabMap }
    delete nextTabMap[gid]
    setWorkspace({ ...w, windows: next, activeWindowId: active, activeTabMap: nextTabMap })
    for (const window of removed) discardHermesDraft(window.hermes)
  }

  function setActiveTab(groupId: string, tabId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      if (isSplitLeftTab(prev, groupId, tabId)) {
        const split = prev.tabGroupSplits?.[groupId]
        if (!split) return prev
        const members = tabsInGroup(prev.windows, groupId)
        const firstRight = members.find((m) => m.id !== split.leftTabId)
        if (!firstRight) return prev
        const cur = prev.activeTabMap[groupId]
        const effectiveRight =
          cur && cur !== split.leftTabId && members.some((m) => m.id === cur) ? cur : firstRight.id
        const maxZ = maxWorkspaceWindowZ(prev.windows)
        const newZ = maxZ + 1
        return {
          ...prev,
          activeWindowId: effectiveRight,
          activeTabMap: { ...prev.activeTabMap, [groupId]: effectiveRight },
          windows: prev.windows.map((win) =>
            groupIdForWindow(win) === groupId
              ? { ...win, layout: { ...win.layout, zIndex: newZ, minimized: false } }
              : win,
          ),
        }
      }
      return {
        ...prev,
        activeTabMap: { ...prev.activeTabMap, [groupId]: tabId },
        activeWindowId: tabId,
      }
    })
  }

  function closeTab(tabId: string, opts?: { ignoreTabPinForListenOnlyDismiss?: boolean }) {
    setWorkspace((prev) => {
      if (!prev) return prev
      let work = prev
      const v0 = work.windows.find((w) => w.id === tabId)
      if (!v0) return prev
      if (v0.tabPinned && !opts?.ignoreTabPinForListenOnlyDismiss) return prev
      if (!canCloseHermesWindow(v0.hermes)) return prev
      const g0 = groupIdForWindow(v0)
      if (work.tabGroupSplits?.[g0]?.leftTabId === tabId) {
        work = exitSplitViewState(work, g0)
      }
      const victim = work.windows.find((w) => w.id === tabId)
      if (!victim) return pruneTabGroupSplitsState(work)
      discardHermesDraft(victim.hermes)
      const gid = groupIdForWindow(victim)
      const members = work.windows.filter((w) => groupIdForWindow(w) === gid)
      if (members.length <= 1) {
        const next = work.windows.filter((w) => w.id !== tabId)
        let active = work.activeWindowId
        if (active === tabId) active = next.length > 0 ? (next[next.length - 1]?.id ?? null) : null
        const nextMap = { ...work.activeTabMap }
        delete nextMap[gid]
        return pruneTabGroupSplitsState({
          ...work,
          windows: next,
          activeWindowId: active,
          activeTabMap: nextMap,
        })
      }
      let next = work.windows.filter((w) => w.id !== tabId)
      const still = next.filter((w) => groupIdForWindow(w) === gid)
      const nextMap = { ...work.activeTabMap }
      if (still.length === 1) {
        next = next.map((w) => (w.id === still[0].id ? { ...w, tabGroupId: null } : w))
        delete nextMap[gid]
      } else if (work.activeTabMap[gid] === tabId) {
        nextMap[gid] = still[0]?.id ?? work.activeTabMap[gid]
      }
      let active = work.activeWindowId
      if (active === tabId) {
        active = nextMap[gid] ?? still[0]?.id ?? next[next.length - 1]?.id ?? active
      }
      return pruneTabGroupSplitsState({
        ...work,
        windows: next,
        activeWindowId: active,
        activeTabMap: nextMap,
      })
    })
  }

  function toggleTabPinned(tabId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const w = prev.windows.find((x) => x.id === tabId)
      if (
        !w ||
        (w.type === 'viewer' && w.initialState?.viewing && isVideoPath(w.initialState.viewing))
      )
        return prev
      const gid = groupIdForWindow(w)
      if (isSplitLeftTab(prev, gid, tabId)) return prev
      return setTabPinnedAndReorderState(prev, tabId, !w.tabPinned)
    })
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

    const onMove = (ev: PointerEvent) => {
      if (!pulled) {
        const dy = ev.clientY - startY
        const dx = Math.abs(ev.clientX - startX)
        if (dy <= threshold && dx <= threshold) return
        pulled = true

        const win = prev.windows.find((x) => x.id === tabId)
        if (!win) {
          cleanup()
          return
        }
        const currentBounds = win.layout?.bounds
        const restoreBounds = win.layout?.restoreBounds
        const width = restoreBounds?.width ?? currentBounds?.width ?? 500
        const height = restoreBounds?.height ?? currentBounds?.height ?? 400
        const newX = ev.clientX - c.left - width / 2
        const newY = Math.max(0, ev.clientY - c.top - 16)

        const next = splitWindowFromGroupState(prev, tabId, { x: newX, y: newY, width, height })
        setWorkspace(next)
        focusWindow(tabId)

        const wb = next.windows.find((w) => w.id === tabId)?.layout?.bounds
        if (!wb) {
          cleanup()
          return
        }
        grabDx = ev.clientX - c.left - wb.x
        grabDy = ev.clientY - c.top - wb.y

        snap.handleDragPointerMove(tabId, ev.clientX, ev.clientY)
        const cur = next.windows.find((w) => w.id === tabId)?.layout?.bounds ?? wb
        let nx = clampPullDragX(ev.clientX - c.left - grabDx, cur.width)
        let ny = clampPullDragY(ev.clientY - c.top - grabDy, cur.height)
        snap.updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
        return
      }

      snap.handleDragPointerMove(tabId, ev.clientX, ev.clientY)
      const cur = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (!cur) return
      let nx = clampPullDragX(ev.clientX - c.left - grabDx, cur.width)
      let ny = clampPullDragY(ev.clientY - c.top - grabDy, cur.height)
      snap.updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
    }

    const onUp = (ev: PointerEvent) => {
      cleanup()
      if (!pulled) return
      const final = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (final) {
        snap.onDragPointerEnd(tabId, final, ev.clientX, ev.clientY)
      }
    }

    function cleanup() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
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

    let work: PersistedWorkspaceState = w

    const focusExistingMediaWindow = (target: WorkspaceWindowDefinition) => {
      const maxZ = maxWorkspaceWindowZ(work.windows) + 1
      const gid = groupIdForWindow(target)
      setWorkspace({
        ...work,
        activeWindowId: target.id,
        activeTabMap: { ...work.activeTabMap, [gid]: target.id },
        windows: work.windows.map((win) =>
          groupIdForWindow(win) === gid
            ? { ...win, layout: { ...win.layout, zIndex: maxZ, minimized: false } }
            : win,
        ),
      })
    }

    const existingViewer = work.windows.find(
      (win) => win.type === 'viewer' && win.initialState?.viewing === path,
    )
    if (existingViewer) {
      focusExistingMediaWindow(existingViewer)
      return
    }

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

    const viewerId = `workspace-win-${work.nextWindowId}`
    const nextNextId = work.nextWindowId + 1
    const baseWindows = work.windows
    const zIndex = maxWorkspaceWindowZ(baseWindows) + 1
    const nextTabMap = { ...work.activeTabMap }

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

        const newWin: WorkspaceWindowDefinition = {
          id: viewerId,
          type: 'viewer',
          title: getPlaybackTitle(path),
          iconName: null,
          iconPath: path,
          iconType: MediaType.VIDEO,
          iconIsVirtual: false,
          source,
          initialState: { viewing: path, dir: initialDir },
          tabGroupId: attachGroupId,
          layout: sharedLayout,
        }
        const nextWindows = insertWindowAtGroupIndex(baseWindows, newWin, attachGroupId, idx)
        let nextState: PersistedWorkspaceState = {
          ...work,
          windows: nextWindows,
          nextWindowId: nextNextId,
          activeWindowId: viewerId,
          activeTabMap: { ...nextTabMap, [attachGroupId]: viewerId },
        }
        nextState = ensureSplitActiveNotLeft(nextState)
        setWorkspace(nextState)
        return
      }
    }

    const newWin: WorkspaceWindowDefinition = {
      id: viewerId,
      type: 'viewer',
      title: getPlaybackTitle(path),
      iconName: null,
      iconPath: path,
      iconType: MediaType.VIDEO,
      iconIsVirtual: false,
      source,
      initialState: { viewing: path, dir: initialDir },
      tabGroupId: null,
      layout: createWindowLayout(
        undefined,
        viewerBoundsForVideoOpen(path, source, baseWindows.length),
        zIndex,
      ),
    }
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
    const w = workspace()
    if (!w) return
    const title = viewing.split(/[/\\]/).pop() ?? 'File'
    setWorkspace({
      ...w,
      windows: w.windows.map((win) =>
        win.id === windowId
          ? { ...win, title, initialState: { ...win.initialState, viewing } }
          : win,
      ),
    })
  }

  function navigateDir(windowId: string, dir: string) {
    const w = workspace()
    if (!w) return
    setWorkspace({
      ...w,
      windows: w.windows.map((win) => {
        if (win.id !== windowId) return win
        const next = { ...win, initialState: { ...win.initialState, dir } }
        if (win.type !== 'browser') return next
        const title = directoryTitle(dir)
        return {
          ...next,
          title,
          iconPath: dir,
          iconType: MediaType.FOLDER,
          iconIsVirtual: isVirtualFolderPath(dir),
        }
      }),
    })
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
        ? openInNewTabInGroupState(
            prev,
            sourceWindowId,
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
        ? openInNewTabInGroupState(
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

  function openBrowser(options?: { source?: WorkspaceSource; initialState?: { dir?: string } }) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const source = options?.source ?? browserSource()
    const dirOpt = options?.initialState?.dir
    const initialState = dirOpt != null ? { dir: dirOpt } : {}
    const effectiveDir = dirOpt ?? ''
    const browserTitle = effectiveDir !== '' ? directoryTitle(effectiveDir) : directoryTitle('')
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'browser',
      title: browserTitle,
      iconName: null,
      iconPath: effectiveDir,
      iconType: MediaType.FOLDER,
      iconIsVirtual: isVirtualFolderPath(effectiveDir),
      source,
      initialState,
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'browser'), n),
    }
    const maxZ = maxWorkspaceWindowZ(w.windows)
    newWin.layout = { ...newWin.layout, zIndex: maxZ + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
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
    if (getFileOpenTarget() === 'new-tab') {
      const anchorId = w ? resolveNewTabAnchorWindowId(w, windowId) : windowId
      openInNewTabInSameWindow(
        anchorId,
        { path: file.path, isDirectory: false },
        dir,
        undefined,
        winDef.source,
      )
      return
    }
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
    const w = workspace()
    if (!w) return
    if (target.sessionId) {
      const existing = w.windows.find(
        (win) => win.type === 'hermes' && win.hermes?.sessionId === target.sessionId,
      )
      if (existing) {
        focusWindow(existing.id)
        return
      }
    }
    const id = `workspace-window-${w.nextWindowId}`
    const sourceWindow = w.windows.find((win) => win.id === windowId)
    const attachToTab = (forceTab || getFileOpenTarget() === 'new-tab') && sourceWindow
    const gid = attachToTab ? groupIdForWindow(sourceWindow) : null
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'hermes',
      title: target.type === 'hermesDraft' ? 'New Hermes session' : file.name,
      iconName: null,
      iconPath: file.path,
      iconIsVirtual: true,
      source: { kind: 'local', rootPath: null },
      initialState: {},
      tabGroupId: gid,
      hermes: {
        sessionId: target.sessionId,
        draftId: target.type === 'hermesDraft' ? crypto.randomUUID() : undefined,
        cwd: target.projectPath,
        readOnly: target.readOnly,
      },
      layout:
        attachToTab && sourceWindow?.layout
          ? { ...sourceWindow.layout, minimized: false }
          : createWindowLayout(
              undefined,
              createDefaultBounds(w.windows.length, 'viewer'),
              maxWorkspaceWindowZ(w.windows) + 1,
            ),
    }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: w.nextWindowId + 1,
      activeWindowId: id,
      activeTabMap: gid ? { ...w.activeTabMap, [gid]: id } : w.activeTabMap,
    })
  }

  function bindHermesSession(windowId: string, sessionId: string) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            windows: prev.windows.map((win) =>
              win.id === windowId
                ? {
                    ...win,
                    title: win.title === 'New Hermes session' ? 'Hermes session' : win.title,
                    iconPath: `Hermes Sessions/session/${sessionId}`,
                    hermes: { ...win.hermes, sessionId, draftId: undefined },
                  }
                : win,
            ),
          }
        : prev,
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
      current
        ? {
            ...current,
            windows: current.windows.map((window) =>
              window.id === windowId ? { ...window, title } : window,
            ),
          }
        : current,
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
        ? openInSplitViewFromBrowserState(
            prev,
            windowId,
            { path: file.path, isDirectory: file.isDirectory, isVirtual: file.isVirtual },
            dir,
            winDef.source,
          )
        : prev,
    )
  }

  function setSplitPaneFraction(groupId: string, fraction: number) {
    if (!workspaceRegistry.editable()) return
    setWorkspace((prev) => (prev ? setSplitFractionState(prev, groupId, fraction) : prev))
  }

  function startSplitPaneDrag(groupId: string, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const row = (e.currentTarget as HTMLElement).parentElement
    if (!row) return
    const onMove = (ev: PointerEvent) => {
      const r = row.getBoundingClientRect()
      const wpx = Math.max(1, r.width)
      setSplitPaneFraction(groupId, (ev.clientX - r.left) / wpx)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  function openFileInNewFloatingWindow(windowId: string, file: FileItem) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || file.isDirectory) return
    openViewer(windowId, file, winDef.source)
  }

  function openViewer(_fromWindowId: string, file: FileItem, source: WorkspaceSource) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const parentDir = file.path.split(/[/\\]/).slice(0, -1).join('/') || ''
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'viewer',
      title: file.name,
      iconName: null,
      iconPath: file.path,
      iconType: file.type,
      iconIsVirtual: false,
      source,
      initialState: { dir: parentDir, viewing: file.path },
      tabGroupId: null,
      layout: createWindowLayout(
        undefined,
        file.type === MediaType.VIDEO
          ? viewerBoundsForVideoOpen(file.path, source, w.windows.length)
          : createDefaultBounds(w.windows.length, 'viewer'),
        n,
      ),
    }
    const maxZ = maxWorkspaceWindowZ(w.windows)
    newWin.layout = { ...newWin.layout, zIndex: maxZ + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  function openReaderFromBrowser(fromWindowId: string, file: FileItem) {
    const w = workspace()
    const sourceWindow = w?.windows.find((window) => window.id === fromWindowId)
    if (!w || !sourceWindow || !file.isDirectory) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const parentDir = file.path.split(/[/\\]/).slice(0, -1).join('/') || ''
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'viewer',
      title: file.name,
      iconName: null,
      iconPath: file.path,
      iconType: file.type,
      iconIsVirtual: false,
      source: sourceWindow.source,
      initialState: {
        dir: parentDir,
        viewing: file.path,
        readerKind: 'folder',
      },
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'viewer'), n),
    }
    newWin.layout = { ...newWin.layout, zIndex: maxWorkspaceWindowZ(w.windows) + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
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

  function addPinnedItem(file: FileItem) {
    const w = workspace()
    if (!w) return
    const source = browserSource()
    const pinKey = (p: PinnedTaskbarItem) => `${p.path}:${p.source.kind}`
    const newKey = `${file.path}:${source.kind}`
    if ((w.pinnedTaskbarItems ?? []).some((p) => pinKey(p) === newKey)) return
    const customIcons = server.settingsQuery.data?.customIcons ?? {}
    const item: PinnedTaskbarItem = {
      id: crypto.randomUUID(),
      path: file.path,
      isDirectory: file.isDirectory,
      title: file.name,
      customIconName: customIcons[file.path] ?? null,
      isVirtual: file.isVirtual,
      source,
    }
    const next = [...(w.pinnedTaskbarItems ?? []), item]
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void server.persistPinsMutation.mutateAsync(next)
  }

  function removePinnedItem(id: string) {
    const w = workspace()
    if (!w) return
    const next = (w.pinnedTaskbarItems ?? []).filter((p) => p.id !== id)
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void server.persistPinsMutation.mutateAsync(next)
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

  const pinnedItems = createMemo(() => workspace()?.pinnedTaskbarItems ?? [])
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
      document.addEventListener('pointermove', onMove, { capture: true })
      document.addEventListener('pointerup', onUp, { capture: true })
      // eslint-disable-next-line solid/reactivity
      return () => {
        document.body.style.cursor = previousCursor
        document.removeEventListener('pointermove', onMove, { capture: true })
        document.removeEventListener('pointerup', onUp, { capture: true })
      }
    },
  )

  function workspaceWithoutGroup(
    state: PersistedWorkspaceState,
    windowId: string,
  ): PersistedWorkspaceState {
    const window = state.windows.find((item) => item.id === windowId)
    if (!window) return state
    const groupId = groupIdForWindow(window)
    const removed = new Set(
      state.windows.filter((item) => groupIdForWindow(item) === groupId).map((item) => item.id),
    )
    const windows = state.windows.filter((item) => !removed.has(item.id))
    const activeTabMap = { ...state.activeTabMap }
    delete activeTabMap[groupId]
    const tabGroupSplits = { ...state.tabGroupSplits }
    delete tabGroupSplits[groupId]
    return {
      ...state,
      windows,
      activeWindowId: removed.has(state.activeWindowId ?? '')
        ? (windows.at(-1)?.id ?? null)
        : state.activeWindowId,
      activeTabMap,
      tabGroupSplits: Object.keys(tabGroupSplits).length ? tabGroupSplits : undefined,
    }
  }

  function destinationWithGroup(
    destination: PersistedWorkspaceState,
    source: PersistedWorkspaceState,
    windowId: string,
  ): PersistedWorkspaceState {
    const dragged = source.windows.find((item) => item.id === windowId)
    if (!dragged) return destination
    const groupId = groupIdForWindow(dragged)
    const payload = source.windows.filter((item) => groupIdForWindow(item) === groupId)
    const conflicts = new Set(payload.map((item) => item.id))
    const remap = new Map<string, string>()
    for (const item of destination.windows) {
      if (conflicts.has(item.id)) remap.set(item.id, `${item.id}-${crypto.randomUUID()}`)
    }
    const mappedGroup = (id: string) => remap.get(id) ?? id
    const windows = destination.windows.map((item) => ({
      ...item,
      id: mappedGroup(item.id),
      tabGroupId: item.tabGroupId ? mappedGroup(item.tabGroupId) : item.tabGroupId,
      fileOpenTargetWindowId: item.fileOpenTargetWindowId
        ? mappedGroup(item.fileOpenTargetWindowId)
        : item.fileOpenTargetWindowId,
    }))
    const activeTabMap = Object.fromEntries(
      Object.entries(destination.activeTabMap).map(([key, value]) => [
        mappedGroup(key),
        mappedGroup(value),
      ]),
    )
    const tabGroupSplits = Object.fromEntries(
      Object.entries(destination.tabGroupSplits ?? {}).map(([key, value]) => [
        mappedGroup(key),
        { ...value, leftTabId: mappedGroup(value.leftTabId) },
      ]),
    )
    const topZ = maxWorkspaceWindowZ(windows)
    const moved = payload.map((item, index) => ({
      ...structuredClone(item),
      layout: item.layout
        ? { ...item.layout, zIndex: topZ + index + 1, minimized: false }
        : item.layout,
    }))
    const sourceActive = source.activeTabMap[groupId]
    return {
      ...destination,
      windows: [...windows, ...moved],
      activeWindowId: windowId,
      activeTabMap: {
        ...activeTabMap,
        ...(sourceActive ? { [groupId]: sourceActive } : {}),
      },
      tabGroupSplits: {
        ...tabGroupSplits,
        ...(source.tabGroupSplits?.[groupId]
          ? { [groupId]: structuredClone(source.tabGroupSplits[groupId]) }
          : {}),
      },
      nextWindowId: Math.max(destination.nextWindowId, source.nextWindowId),
    }
  }

  function clearCrossWorkspaceHover() {
    if (crossHoverTimer) clearTimeout(crossHoverTimer)
    crossHoverTimer = undefined
    setCrossHoverTarget('')
  }

  function cancelCrossWorkspaceStart() {
    crossTransferStartGeneration += 1
    crossTransferStart = null
  }

  async function startCrossWorkspaceTransfer(destinationTarget: string, released = false) {
    const candidate = crossDragCandidate()
    if (!candidate || !destinationTarget || destinationTarget === workspaceId() || crossTransfer())
      return false
    if (crossTransferStart) {
      if (crossTransferStart.target !== destinationTarget) {
        cancelCrossWorkspaceStart()
      } else {
        crossTransferStart.released ||= released
        return crossTransferStart.promise
      }
    }
    const generation = ++crossTransferStartGeneration
    const destinationId = destinationTarget === '__new__' ? crypto.randomUUID() : destinationTarget
    const destination = workspaceRegistry.registry().records[destinationId]
    const emptyDestination: PersistedWorkspaceState = {
      ...defaultPersistedState(browserSource()),
      windows: [],
      activeWindowId: null,
      nextWindowId: 1,
    }
    const request = {
      target: destinationTarget,
      released,
      promise: Promise.resolve(false),
    }
    crossTransferStart = request
    const promise = (async () => {
      try {
        const opened = await workspaceRegistry.acquire(
          destinationId,
          destination?.snapshot ?? emptyDestination,
        )
        if (
          generation !== crossTransferStartGeneration ||
          !crossDragCandidate() ||
          crossDragCandidate()!.sourceId !== candidate.sourceId ||
          crossDragCandidate()!.draggedWindowId !== candidate.draggedWindowId
        )
          return false
        if (!opened?.editable) return false
        await workspaceRegistry.flush()
        if (
          generation !== crossTransferStartGeneration ||
          !crossDragCandidate() ||
          crossDragCandidate()!.sourceId !== candidate.sourceId ||
          crossDragCandidate()!.draggedWindowId !== candidate.draggedWindowId
        )
          return false
        const liveSourceState = workspace()
        const liveSourceRevision = workspaceRegistry.revision()
        if (!liveSourceState || workspaceId() !== candidate.sourceId) return false
        const sourceNext = workspaceWithoutGroup(liveSourceState, candidate.draggedWindowId)
        const destinationNext = destinationWithGroup(
          opened.record.snapshot,
          liveSourceState,
          candidate.draggedWindowId,
        )
        workspaceRegistry.adoptOpen(destinationId, opened)
        setCrossTransfer({
          ...candidate,
          sourceState: liveSourceState,
          sourceRevision: liveSourceRevision,
          sourceNext,
          destinationId,
          destinationRevision: opened.record.revision,
          destinationWasCreated: destinationTarget === '__new__',
        })
        setCrossHoverTarget(destinationTarget)
        setWorkspace(destinationNext)
        navigateSearchParams({ ws: destinationId, dir: null, preset: null }, 'replace')
        if (!request.released) {
          document.addEventListener('pointerup', () => void commitCrossWorkspaceTransfer(), {
            capture: true,
            once: true,
          })
        }
        return true
      } catch {
        return false
      }
    })()
    request.promise = promise
    try {
      return await promise
    } finally {
      if (crossTransferStart === request) {
        crossTransferStart = null
      }
    }
  }

  function beginCrossWorkspaceHover(destinationId: string) {
    if (crossTransfer()) return
    if (!destinationId || destinationId === workspaceId()) {
      cancelCrossWorkspaceStart()
      clearCrossWorkspaceHover()
      return
    }
    if (!crossDragCandidate()) return
    if (crossHoverTarget() === destinationId && crossHoverTimer) return
    clearCrossWorkspaceHover()
    setCrossHoverTarget(destinationId)
    crossHoverTimer = setTimeout(() => {
      crossHoverTimer = undefined
      void startCrossWorkspaceTransfer(destinationId)
    }, 1_000)
  }

  async function commitCrossWorkspaceTransfer() {
    if (crossTransferCommitting) return false
    const transfer = crossTransfer()
    const destinationState = workspace()
    if (!transfer || !destinationState) return false
    crossTransferCommitting = true
    try {
      await workspaceRegistry.flushMetadata()
      const sourceRecord = workspaceRegistry.registry().records[transfer.sourceId]
      const deleteSource = !sourceRecord?.name && transfer.sourceNext.windows.length === 0
      const result = await post<{ destinationRevision: number }>('/api/workspaces/move', {
        sourceId: transfer.sourceId,
        destinationId: transfer.destinationId,
        clientId: workspaceRegistry.clientId,
        sourceRevision: transfer.sourceRevision,
        destinationRevision: transfer.destinationRevision,
        sourceSnapshot: sanitizePersistedWorkspaceState(transfer.sourceNext),
        destinationSnapshot: sanitizePersistedWorkspaceState(destinationState),
        deleteSource,
      })
      workspaceRegistry.setRevision(result.destinationRevision)
      setCrossTransfer(null)
      setCrossDragCandidate(null)
      clearCrossWorkspaceHover()
      setWorkspacePanelOpen(false)
      await workspaceRegistry.refresh()
      return true
    } catch {
      if (transfer.destinationWasCreated) {
        try {
          await workspaceRegistry.deleteWorkspace(transfer.destinationId)
        } catch {}
      }
      setWorkspace(transfer.sourceState)
      navigateSearchParams({ ws: transfer.sourceId, dir: null, preset: null }, 'replace')
      setCrossTransfer(null)
      setCrossDragCandidate(null)
      clearCrossWorkspaceHover()
      return false
    } finally {
      crossTransferCommitting = false
    }
  }

  async function leaveForWorkspace(id: string, mode: 'push' | 'replace' = 'push') {
    const currentId = workspaceId()
    const currentRecord = workspaceRegistry.registry().records[currentId]
    if (!currentRecord?.name && (workspace()?.windows.length ?? 0) === 0) {
      try {
        await workspaceRegistry.deleteWorkspace(currentId)
      } catch {
        // Leaving remains available offline; empty draft stays recoverable.
      }
    }
    setWorkspacePanelOpen(false)
    navigateSearchParams({ ws: id, dir: null, preset: null }, mode)
  }

  createEffect(
    () => ({ transfer: crossTransfer(), candidate: crossDragCandidate() }),
    ({ transfer, candidate }) => {
      if (!transfer && !candidate) return undefined
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        if (crossTransferCommitting) return
        const activeTransfer = crossTransfer()
        if (!activeTransfer) {
          cancelCrossWorkspaceStart()
          setCrossDragCandidate(null)
          clearCrossWorkspaceHover()
          setWorkspacePanelOpen(false)
          return
        }
        if (activeTransfer.destinationWasCreated) {
          void workspaceRegistry.deleteWorkspace(activeTransfer.destinationId)
        }
        setWorkspace(activeTransfer.sourceState)
        navigateSearchParams({ ws: activeTransfer.sourceId, dir: null, preset: null }, 'replace')
        setCrossTransfer(null)
        setCrossDragCandidate(null)
        clearCrossWorkspaceHover()
        setWorkspacePanelOpen(false)
      }
      window.addEventListener('keydown', onKey)
      // eslint-disable-next-line solid/reactivity
      return () => window.removeEventListener('keydown', onKey)
    },
  )

  return (
    <div
      data-workspace-opened={workspaceRegistry.opened() ? '' : undefined}
      class={`workspace-layout fixed inset-0 flex flex-col overflow-hidden bg-background select-none ${
        workspaceRegistry.opened() || workspaceRegistry.offline()
          ? 'pointer-events-auto'
          : 'pointer-events-none'
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
        <Show when={!workspaceRegistry.editable() && !workspaceRegistry.offline()}>
          <div class='absolute left-1/2 top-2 z-[100002] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-lg'>
            Read only — workspace is open elsewhere
          </div>
        </Show>
        <WorkspacePageCanvas
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
            setCrossDragCandidate(
              (current) =>
                current ??
                (workspace()
                  ? {
                      sourceId: workspaceId(),
                      sourceState: structuredClone(workspace()!),
                      sourceRevision: workspaceRegistry.revision(),
                      draggedWindowId: windowId,
                    }
                  : null),
            )
            if (workspacePanelOpen() && clientX > 300) {
              cancelCrossWorkspaceStart()
              clearCrossWorkspaceHover()
              setWorkspacePanelOpen(false)
              if (!crossTransfer()) setCrossDragCandidate(null)
              return
            }
            const railTarget = document
              .elementFromPoint(clientX, clientY)
              ?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId
            if (crossDragCandidate()) beginCrossWorkspaceHover(railTarget ?? '')
            if (clientX <= 12 && !crossTransfer()) {
              setWorkspacePanelOpen(true)
              if (!crossDragReleaseListening) {
                crossDragReleaseListening = true
                document.addEventListener(
                  'pointerdown',
                  () => {
                    if (crossTransfer()) return
                    crossDragReleaseListening = false
                    cancelCrossWorkspaceStart()
                    setCrossDragCandidate(null)
                    setWorkspacePanelOpen(false)
                  },
                  { capture: true, once: true },
                )
                document.addEventListener(
                  'pointerup',
                  () => {
                    crossDragReleaseListening = false
                    setTimeout(() => {
                      if (crossTransfer() || crossTransferStart) return
                      cancelCrossWorkspaceStart()
                      setCrossDragCandidate(null)
                      setWorkspacePanelOpen(false)
                    }, 100)
                  },
                  { capture: true, once: true },
                )
              }
            }
          }}
          onDragPointerEnd={(windowId, bounds, clientX, clientY) => {
            if (!workspaceRegistry.editable()) return
            const dropTarget = document
              .elementFromPoint(clientX, clientY)
              ?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId
            snap.onDragPointerEnd(windowId, bounds, clientX, clientY)
            if (crossTransfer()) void commitCrossWorkspaceTransfer()
            else if (dropTarget && dropTarget !== workspaceId()) {
              if (crossTransferStart && crossTransferStart.target !== dropTarget)
                cancelCrossWorkspaceStart()
              // eslint-disable-next-line solid/reactivity
              void startCrossWorkspaceTransfer(dropTarget, true).then((started) => {
                if (crossDragCandidate()?.draggedWindowId !== windowId) return
                if (started) void commitCrossWorkspaceTransfer()
                else {
                  cancelCrossWorkspaceStart()
                  setCrossDragCandidate(null)
                  clearCrossWorkspaceHover()
                  setWorkspacePanelOpen(false)
                }
              })
            } else {
              cancelCrossWorkspaceStart()
              setCrossDragCandidate(null)
              clearCrossWorkspaceHover()
              setTimeout(() => setWorkspacePanelOpen(false), 100)
            }
          }}
          updateWindowBounds={(id, bounds) =>
            workspaceRegistry.editable() && snap.updateWindowBounds(id, bounds)
          }
          resizeSnappedWindowBounds={(id, bounds, edges) =>
            workspaceRegistry.editable() && snap.resizeSnappedWindowBounds(id, bounds, edges)
          }
          setActiveTab={editableSetActiveTab}
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
      <WorkspacePageTaskbar
        onOpenBrowser={editableOpenBrowser}
        onOpenWorkspaces={toggleWorkspacePanelFromTaskbar}
        onWorkspaceTransitionChange={(value) => {
          void post('/api/settings/workspaceTransition', { value }).then(() =>
            server.settingsQuery.refetch(),
          )
        }}
        onOpenSearchResult={editableOpenSearchResult}
        hasAnyTaskbarItems={hasAnyTaskbarItems}
        pinnedItems={pinnedItems}
        taskbarGroupIds={orderedWindowGroupIds}
        taskbarWindowRows={taskbarWindowRows}
        storageSessionKey={() => storageSessionKeyFull().key}
        browserSource={browserSource}
        workspace={workspace}
        setWorkspace={setEditableWorkspace}
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
        offline={workspaceRegistry.offline()}
        onToggle={() => setWorkspacePanelOpen((open) => !open)}
        onReveal={() => setWorkspacePanelOpen(true)}
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
          setWorkspacePanelOpen(false)
          setWorkspace(defaultPersistedState(browserSource()))
          navigateSearchParams({ ws: id, dir: null, preset: null }, 'push')
        }}
        onTakeControl={workspaceRegistry.takeControl}
        onRename={(id, name) => workspaceRegistry.updateMetadataFor(id, { name })}
        onIcon={(id, icon, iconColor) =>
          workspaceRegistry.updateMetadataFor(id, { icon, iconColor })
        }
        onDelete={(id) => {
          const record = workspaceRegistry.registry().records[id]
          if (!record) return Promise.resolve()
          if (
            !window.confirm(
              `Delete “${record.name || 'Unnamed workspace'}” and close ${record.snapshot.windows.length} windows?`,
            )
          )
            return Promise.resolve()
          const order = workspaceRegistry.registry().order
          const index = order.indexOf(id)
          const deletingActive = id === workspaceId()
          return workspaceRegistry.deleteWorkspace(id).then(() => {
            if (deletingActive) {
              const next = order[index + 1] ?? order[index - 1] ?? crypto.randomUUID()
              navigateSearchParams({ ws: next, dir: null, preset: null }, 'replace')
            }
          })
        }}
        onReorder={(order) =>
          workspaceRegistry.editable() ? workspaceRegistry.reorder(order) : Promise.resolve()
        }
        draggingWindow={crossDragCandidate() != null || crossTransfer() != null}
        onDragHover={beginCrossWorkspaceHover}
        hoverTarget={crossHoverTarget()}
        transferReady={crossTransfer() != null}
      />
    </div>
  )
}
