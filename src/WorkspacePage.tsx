import { isVirtualFolderPath } from '@/lib/constants'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import {
  persistedResourceTarget,
  type PersistedResourceTarget,
  type ResourceSummary,
  type ViewerId,
} from '@/lib/resource'
import {
  inspectResourceTarget,
  reconcileResourceTargetPin,
  reconcileResourceTargetWindow,
  resourceTargetKey,
} from '@/lib/resource-target-resolution'
import { getMediaType } from '@/lib/media-utils'
import type { AssistGridSpan } from '@/lib/workspace-assist-grid'
import {
  createDefaultBounds,
  createWindowLayout,
  getPlaybackTitle,
  getPlayerBoundsForAspectRatio,
  insertWindowAtGroupIndex,
  isVideoPath,
  maxWorkspaceWindowZ,
  WORKSPACE_WINDOW_MIN_VISIBLE_PX,
} from '@/lib/workspace-geometry'
import type { FileDragData } from '@/lib/file-drag-data'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  resolveNewTabAnchorWindowId,
  serializeWorkspaceLayoutState,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import {
  rememberWorkspaceVideoIntrinsics,
  viewerBoundsForVideoOpen,
} from '@/lib/workspace-video-intrinsics-preload'
import {
  resolveWorkspaceDeferredPresetApply,
  resolveWorkspaceInitialHydration,
} from '@/lib/workspace-bootstrap'
import { useWorkspaceAudio } from '@/lib/workspace-audio-store'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import {
  getWorkspaceFileOpenTarget,
  useWorkspaceFileOpenTargetStore,
} from '@/lib/workspace-file-open-target'
import {
  layoutBoundsForWindowHighlight,
  pickWorkspaceWindowAtClientPoint,
} from '@/lib/workspace-file-open-target-picker'
import { workspaceBrowserDirTitle } from '@/lib/workspace-browser-dir-title'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { useThemeStore } from '@/lib/theme-store'
import { useStoreSync } from './lib/solid-store-sync'
import type { FileIconContext } from './lib/use-file-icon'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from './browser-history'
import { useAdminEventsStream } from './lib/use-admin-events-stream'
import { WorkspacePageCanvas } from './workspace/workspace-page/WorkspacePageCanvas'
import { WorkspacePageTaskbar } from './workspace/workspace-page/WorkspacePageTaskbar'
import type { WorkspacePageProps } from './workspace/workspace-page/workspace-page-types'
import { createWorkspaceSnapDragModel } from './workspace/workspace-page/create-workspace-snap-drag-model'
import { useWorkspacePageDocumentChrome } from './workspace/workspace-page/use-workspace-page-document-chrome'
import { useWorkspacePageLayoutBaseline } from './workspace/workspace-page/use-workspace-page-layout-baseline'
import { useWorkspacePageLocalPersistence } from './workspace/workspace-page/use-workspace-page-local-persistence'
import { useWorkspacePageServerData } from './workspace/workspace-page/use-workspace-page-server-data'

export type { WorkspacePageProps } from './workspace/workspace-page/workspace-page-types'
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
} from './workspace/tab-group-ops'
import { TaskbarGroupRow } from './workspace/WorkspaceTaskbarRows'
import type { WorkspaceVideoListenOnlyDetail } from './workspace/WorkspaceViewerPane'
import {
  DEFAULT_WORKSPACE_SOURCE,
  defaultInitialBrowserTitle,
  isWorkspaceRoute,
  loadPersisted,
} from './workspace/workspace-page-persistence'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/file-search'
import type { VirtualOpenTarget } from '@/lib/virtual-directory'
import { canCloseHermesWindow } from '@/lib/hermes-session-store'
import {
  OWNER_OPEN_SCOPE,
  grantOpenScope,
  resourceForFileItem,
} from './lib/legacy-resource-adapter'
import { openResource } from './lib/open-resource'
import { viewerMediaType } from './lib/viewer-registry'

export function WorkspacePage(props: WorkspacePageProps = {}) {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const shareConfig = () => props.shareConfig ?? null
  const server = useWorkspacePageServerData(props, shareConfig)
  useAdminEventsStream(!props.shareConfig)

  const browserSource = createMemo(
    (): WorkspaceSource =>
      shareConfig()
        ? {
            kind: 'share',
            token: shareConfig()!.token,
            sharePath: shareConfig()!.sharePath,
          }
        : DEFAULT_WORKSPACE_SOURCE,
  )

  const storageSessionKeyFull = createMemo(() => {
    const sid = urlSearchParams().get('ws') ?? ''
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    return { sid, key: sid ? workspaceStorageSessionKey(base, sid) : '' }
  })

  const [workspace, setWorkspace] = createSignal<PersistedWorkspaceState | null>(null)
  let resolvedResourceSummaries = new Map<string, ResourceSummary>()

  function openScopeForSource(source: WorkspaceSource) {
    return source.kind === 'share'
      ? grantOpenScope(source.token ?? shareConfig()?.token ?? '')
      : OWNER_OPEN_SCOPE
  }

  function resourceForWorkspaceTarget(
    file: FileItem,
    resourceTarget?: PersistedResourceTarget,
  ): ResourceSummary {
    if (resourceTarget) {
      const resolved = resolvedResourceSummaries.get(resourceTargetKey(resourceTarget))
      if (resolved) return resolved
    }
    const resource = resourceForFileItem(file)
    if (file.resource || !resourceTarget) return resource
    return {
      ...resource,
      ref: { ...resourceTarget.ref },
      locator: { ...resource.locator, providerLocator: resourceTarget.legacyLocator },
      legacyLocator: resourceTarget.legacyLocator,
    }
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
  const themeTick = useStoreSync(useThemeStore)
  const baseline = useWorkspacePageLayoutBaseline(workspace, setWorkspace)
  const snap = createWorkspaceSnapDragModel({ workspace, setWorkspace, preferredSnapTick })

  useWorkspacePageDocumentChrome(workspace, themeTick)

  useWorkspacePageLocalPersistence({
    storageSessionKeyFull,
    workspace,
    isShareSession: () => !!shareConfig(),
  })

  createEffect(() => {
    const w = workspace()
    const t = w?.fileOpenTarget
    if (t !== 'new-tab' && t !== 'new-window') return
    const cur = useWorkspaceFileOpenTargetStore.getState().target
    if (cur !== t) {
      useWorkspaceFileOpenTargetStore.getState().setTarget(t)
    }
  })

  createEffect(() => {
    if (!fileOpenTargetPick()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFileOpenTargetPick(null)
        setFileOpenPickHoverId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const [pinsHydratedFor, setPinsHydratedFor] = createSignal('')

  let lastHydratedStorageKey = ''

  createEffect(() => {
    const loc = history()
    if (!isWorkspaceRoute(loc.pathname)) return
    const sp = urlSearchParams()
    let sid = sp.get('ws') ?? ''
    if (!sid) {
      sid = crypto.randomUUID()
      navigateSearchParams({ ws: sid }, 'replace')
    }
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    const key = workspaceStorageSessionKey(base, sid)
    const dirParam = sp.get('dir')
    const presetParam = sp.get('preset')
    void server.settingsQuery.isSuccess
    void server.serverLayoutPresets()
    const presetsReadyNow = shareConfig() ? true : server.settingsQuery.isSuccess
    // Always prefer session draft in localStorage over a named preset in the URL.
    const loaded = loadPersisted(key)
    const src = browserSource()
    const scope = server.layoutScope()
    const presetsList = server.serverLayoutPresets()

    if (lastHydratedStorageKey !== key) {
      lastHydratedStorageKey = key
      const initial = resolveWorkspaceInitialHydration({
        dirParam,
        presetParam,
        loaded,
        presetsReadyNow,
        presetsList,
        layoutScope: scope,
        source: src,
      })
      untrack(() => {
        if (initial.kind === 'defer-preset') {
          setPinsHydratedFor('')
          return
        }
        if (initial.baselineSnapshot && initial.baselinePresetId) {
          baseline.setLayoutBaselinePresetId(initial.baselinePresetId)
          baseline.setLayoutBaselineSerialized(
            serializeWorkspaceLayoutState(initial.baselineSnapshot),
          )
          baseline.setLayoutBaselineSnapshot(initial.baselineSnapshot)
        } else {
          baseline.resetLayoutBaseline()
        }
        setWorkspace(initial.workspace)
        if (initial.stripPresetFromUrl) {
          navigateSearchParams({ preset: null }, 'replace')
        }
        setPinsHydratedFor('')
      })
      return
    }

    const deferred = resolveWorkspaceDeferredPresetApply({
      presetParam,
      presetsReadyNow,
      hasPersistedDraft: !!loadPersisted(key),
      presetsList,
      layoutScope: scope,
    })
    if (!deferred) return
    untrack(() => {
      if (deferred.kind === 'apply') {
        baseline.setLayoutBaselinePresetId(deferred.baselinePresetId)
        baseline.setLayoutBaselineSerialized(
          serializeWorkspaceLayoutState(deferred.baselineSnapshot),
        )
        baseline.setLayoutBaselineSnapshot(deferred.baselineSnapshot)
        setWorkspace(deferred.workspace)
      }
      if (deferred.stripPresetFromUrl) {
        navigateSearchParams({ preset: null }, 'replace')
      }
      setPinsHydratedFor('')
    })
  })

  createEffect(() => {
    if (!server.serverPinsReady()) return
    const { key } = storageSessionKeyFull()
    const w = workspace()
    if (!key || !w) return
    if (pinsHydratedFor() === key) return

    const serverPins = server.serverPinsList()
    untrack(() => {
      if (serverPins.length > 0) {
        setWorkspace((prev) => (prev ? { ...prev, pinnedTaskbarItems: serverPins } : prev))
      } else if ((w.pinnedTaskbarItems?.length ?? 0) > 0) {
        void server.persistPinsMutation.mutateAsync(w.pinnedTaskbarItems ?? [])
      }
    })
    setPinsHydratedFor(key)
  })

  let resourceResolutionSnapshot = ''
  let resourceResolutionController: AbortController | null = null
  onCleanup(() => resourceResolutionController?.abort())

  createEffect(() => {
    const { key } = storageSessionKeyFull()
    const current = workspace()
    if (!key || !current || !server.serverPinsReady() || pinsHydratedFor() !== key) return

    const targets = new Map<string, PersistedResourceTarget>()
    for (const window of current.windows) {
      if (window.resourceTarget) {
        targets.set(resourceTargetKey(window.resourceTarget), window.resourceTarget)
      }
    }
    for (const pin of current.pinnedTaskbarItems ?? []) {
      if (pin.resourceTarget) targets.set(resourceTargetKey(pin.resourceTarget), pin.resourceTarget)
    }

    const share = shareConfig()
    const access = share
      ? ({ kind: 'grant', token: share.token } as const)
      : ({ kind: 'owner', surface: 'workspace' } as const)
    const snapshot = `${key}\u0000${access.kind === 'grant' ? access.token : 'owner'}\u0000${[
      ...targets.keys(),
    ]
      .sort()
      .join('\u0001')}`
    if (snapshot === resourceResolutionSnapshot) return
    resourceResolutionSnapshot = snapshot
    resolvedResourceSummaries = new Map()
    resourceResolutionController?.abort()
    const controller = new AbortController()
    resourceResolutionController = controller

    void Promise.all(
      [...targets].map(async ([targetKey, target]) => {
        try {
          return [
            targetKey,
            await inspectResourceTarget(target, access, controller.signal),
          ] as const
        } catch {
          return [targetKey, null] as const
        }
      }),
    ).then((resolved) => {
      if (controller.signal.aborted || resourceResolutionSnapshot !== snapshot) return
      const summaries = new Map(resolved)
      resolvedResourceSummaries = new Map(
        resolved.flatMap(([targetKey, summary]) => (summary ? [[targetKey, summary]] : [])),
      )
      const latest = workspace()
      if (!latest || storageSessionKeyFull().key !== key) return

      const windows = latest.windows.map((window) => {
        const target = window.resourceTarget
        const summary = target ? summaries.get(resourceTargetKey(target)) : null
        return summary ? reconcileResourceTargetWindow(window, summary) : window
      })
      const currentPins = latest.pinnedTaskbarItems ?? []
      const pins = currentPins.map((pin) => {
        const target = pin.resourceTarget
        const summary = target ? summaries.get(resourceTargetKey(target)) : null
        return summary ? reconcileResourceTargetPin(pin, summary) : pin
      })
      const pinsChanged = pins.some((pin, index) => {
        const before = currentPins[index]
        return (
          !!before &&
          (pin.path !== before.path ||
            pin.title !== before.title ||
            pin.isDirectory !== before.isDirectory ||
            pin.resourceTarget?.legacyLocator !== before.resourceTarget?.legacyLocator)
        )
      })
      setWorkspace({ ...latest, windows, pinnedTaskbarItems: pins })
      if (pinsChanged) void server.persistPinsMutation.mutateAsync(pins)
    })
  })

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
    const key = storageSessionKeyFull().key
    if (!key) return
    useWorkspaceAudio.getState().closePlayer(key)
  }

  function closeWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const t = w.windows.find((x) => x.id === windowId)
    const gid = t ? groupIdForWindow(t) : windowId
    const toRemove = new Set(w.windows.filter((x) => groupIdForWindow(x) === gid).map((x) => x.id))
    if (w.windows.some((x) => toRemove.has(x.id) && !canCloseHermesWindow(x.hermes))) return
    const next = w.windows.filter((x) => !toRemove.has(x.id))
    let active = w.activeWindowId
    if (active != null && toRemove.has(active)) {
      active = next[next.length - 1]?.id ?? active
    }
    const nextTabMap = { ...w.activeTabMap }
    delete nextTabMap[gid]
    setWorkspace({ ...w, windows: next, activeWindowId: active, activeTabMap: nextTabMap })
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
      const g0 = groupIdForWindow(v0)
      if (work.tabGroupSplits?.[g0]?.leftTabId === tabId) {
        work = exitSplitViewState(work, g0)
      }
      const victim = work.windows.find((w) => w.id === tabId)
      if (!victim) return pruneTabGroupSplitsState(work)
      if (!canCloseHermesWindow(victim.hermes)) return work
      if (victim.tabPinned && !opts?.ignoreTabPinForListenOnlyDismiss) return work
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

  function listenOnlyHandoffFromWorkspaceViewer(
    tabId: string,
    detail: WorkspaceVideoListenOnlyDetail,
  ) {
    if (!storageSessionKeyFull().key) return
    useWorkspaceAudio.getState().setCurrentTime(detail.videoCurrentTime)
    useWorkspaceAudio.getState().armUserGestureTransport(detail.path)
    useWorkspaceAudio.getState().playAudio(detail.path, detail.dir)
    useWorkspaceAudio.getState().setAudioOnly(undefined, true)
    closeTab(tabId, { ignoreTabPinForListenOnlyDismiss: true })
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

  function requestPlay(
    source: WorkspaceSource,
    path: string,
    dir?: string,
    resourceTarget?: PersistedResourceTarget,
    plannedMedia?: 'audio' | 'video',
    plannedViewerId?: ViewerId,
  ) {
    const key = storageSessionKeyFull().key
    if (!key) return
    const video = plannedMedia ? plannedMedia === 'video' : isVideoPath(path)
    if (!video) {
      useWorkspaceAudio.getState().armUserGestureTransport(path)
      useWorkspaceAudio.getState().playAudio(path, dir)
      return
    }
    const w = workspace()
    if (!w) return

    useWorkspaceAudio.getState().setAudioOnly(undefined, false)

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
          resourceTarget,
          viewerId: plannedViewerId ?? 'video-player',
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
      resourceTarget,
      viewerId: plannedViewerId ?? 'video-player',
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
        rememberWorkspaceVideoIntrinsics(viewer.source, viewing, videoWidth, videoHeight)
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

  function updateWindowViewing(
    windowId: string,
    viewing: string,
    resource?: ResourceSummary,
    viewerId?: ViewerId,
  ) {
    const w = workspace()
    if (!w) return
    const title = viewing.split(/[/\\]/).pop() ?? 'File'
    setWorkspace({
      ...w,
      windows: w.windows.map((win) =>
        win.id === windowId
          ? {
              ...win,
              title,
              iconPath: viewing,
              iconType:
                (viewerId ? viewerMediaType(viewerId) : null) ?? win.iconType ?? MediaType.OTHER,
              initialState: { ...win.initialState, viewing },
              resourceTarget: persistedResourceTarget(resource),
              viewerId: viewerId ?? win.viewerId,
            }
          : win,
      ),
    })
  }

  function navigateDir(windowId: string, dir: string, resource?: ResourceSummary) {
    const w = workspace()
    if (!w) return
    setWorkspace({
      ...w,
      windows: w.windows.map((win) => {
        if (win.id !== windowId) return win
        const next = {
          ...win,
          initialState: { ...win.initialState, dir },
          resourceTarget: persistedResourceTarget(resource),
        }
        if (win.type !== 'browser') return next
        const title = workspaceBrowserDirTitle(dir)
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
    file: {
      path: string
      isDirectory: boolean
      isVirtual?: boolean
      resource?: ResourceSummary
      resourceTarget?: PersistedResourceTarget
      viewerId?: ViewerId
    },
    currentPath: string,
    insertIndex?: number,
    sourceOverride?: WorkspaceSource,
    viewerId?: ViewerId,
  ) {
    setWorkspace((prev) =>
      prev
        ? openInNewTabInGroupState(
            prev,
            sourceWindowId,
            { ...file, viewerId: viewerId ?? file.viewerId },
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
    const sc = shareConfig()
    const source: WorkspaceSource =
      data.sourceKind === 'share'
        ? {
            kind: 'share',
            token: data.sourceToken ?? '',
            sharePath: sc?.sharePath ?? '',
          }
        : { kind: 'local', rootPath: null }
    const extension = data.path.split('.').pop()?.toLowerCase() ?? ''
    const file: FileItem = {
      path: data.path,
      name: data.path.split(/[/\\]/).filter(Boolean).at(-1) ?? 'File',
      isDirectory: data.isDirectory,
      isVirtual: !!data.virtualOpenTarget,
      size: data.resource?.size ?? 0,
      type: data.isDirectory ? MediaType.FOLDER : getMediaType(extension),
      extension,
      resource: data.resource,
    }
    if (data.virtualOpenTarget) {
      const target = data.virtualOpenTarget
      const openTarget =
        target.type === 'hermesSession' && target.sessionId
          ? {
              type: 'hermesSession' as const,
              sessionId: target.sessionId,
              readOnly: target.readOnly,
            }
          : target.type === 'hermesDraft'
            ? {
                type: 'hermesDraft' as const,
                ...(target.projectPath ? { projectPath: target.projectPath } : {}),
                readOnly: target.readOnly,
              }
            : undefined
      if (!openTarget) return
      const resource = data.resource
        ? data.resource.openTarget
          ? data.resource
          : { ...data.resource, openTarget }
        : resourceForFileItem(file, {
            kind: openTarget.type === 'hermesSession' ? 'conversation' : 'draft',
            presentation: 'conversation',
            providerOperations: ['read'],
            openTarget,
          })
      const plan = openResource(resource, 'default', {
        surface: 'workspace',
        scope: openScopeForSource(source),
      })
      if (plan.kind === 'conversation') {
        openHermesFromBrowser(targetLeaderWindowId, file, plan.target, true)
      }
      return
    }
    const plan = openResource(resourceForWorkspaceTarget(file, data.resourceTarget), 'default', {
      surface: 'workspace',
      scope: openScopeForSource(source),
    })
    if (plan.kind === 'blocked' || plan.kind === 'conversation') return
    const viewerId = plan.kind === 'viewer' || plan.kind === 'playback' ? plan.viewer.id : undefined
    const dir = data.isDirectory ? '' : data.path.split(/[/\\]/).slice(0, -1).join('/')
    setWorkspace((prev) =>
      prev
        ? openInNewTabInGroupState(
            prev,
            targetLeaderWindowId,
            {
              ...file,
              resourceTarget: data.resourceTarget,
              viewerId,
            },
            dir,
            insertIndex,
            source,
          )
        : prev,
    )
  }

  function openBrowser(options?: {
    source?: WorkspaceSource
    initialState?: { dir?: string }
    resourceTarget?: PersistedResourceTarget
  }) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const source = options?.source ?? browserSource()
    const dirOpt = options?.initialState?.dir
    const initialState = dirOpt != null ? { dir: dirOpt } : {}
    const effectiveDir = dirOpt ?? ''
    const browserTitle =
      effectiveDir !== ''
        ? workspaceBrowserDirTitle(effectiveDir)
        : source.kind === 'share'
          ? defaultInitialBrowserTitle(source)
          : workspaceBrowserDirTitle('')
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
      resourceTarget: options?.resourceTarget,
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

  function openViewerFromBrowser(windowId: string, file: FileItem, viewerId?: ViewerId) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef) return
    const dir = winDef.initialState?.dir ?? ''
    const gid = groupIdForWindow(winDef)
    const splitBrowserLeft =
      !!w?.tabGroupSplits?.[gid]?.leftTabId &&
      w.tabGroupSplits[gid]!.leftTabId === windowId &&
      winDef.type === 'browser'
    if (getWorkspaceFileOpenTarget() === 'new-tab') {
      const anchorId = w ? resolveNewTabAnchorWindowId(w, windowId) : windowId
      openInNewTabInSameWindow(anchorId, file, dir, undefined, winDef.source, viewerId)
      return
    }
    if (splitBrowserLeft) {
      openInNewTabInSameWindow(windowId, file, dir, undefined, winDef.source, viewerId)
      return
    }
    openViewer(windowId, file, winDef.source, undefined, viewerId)
  }

  function openHermesFromBrowser(
    windowId: string,
    file: FileItem,
    target: VirtualOpenTarget,
    forceTab = false,
  ) {
    if (props.shareConfig) return
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
    const attachToTab = (forceTab || getWorkspaceFileOpenTarget() === 'new-tab') && sourceWindow
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
      resourceTarget: persistedResourceTarget(file.resource),
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

  function openInSplitViewFromBrowserPane(
    windowId: string,
    file: FileItem,
    plannedMedia?: 'audio' | 'video',
    viewerId?: ViewerId,
  ) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || winDef.type !== 'browser') return
    const dir = winDef.initialState?.dir ?? ''
    if ((plannedMedia ?? (file.type === MediaType.AUDIO ? 'audio' : undefined)) === 'audio') {
      requestPlay(
        winDef.source,
        file.path,
        dir || undefined,
        persistedResourceTarget(file.resource),
        'audio',
        viewerId,
      )
      return
    }
    setWorkspace((prev) =>
      prev
        ? openInSplitViewFromBrowserState(prev, windowId, { ...file, viewerId }, dir, winDef.source)
        : prev,
    )
  }

  function setSplitPaneFraction(groupId: string, fraction: number) {
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

  function openFileInNewFloatingWindow(windowId: string, file: FileItem, viewerId?: ViewerId) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || file.isDirectory) return
    openViewer(windowId, file, winDef.source, undefined, viewerId)
  }

  function openViewer(
    _fromWindowId: string,
    file: FileItem,
    source: WorkspaceSource,
    resourceTargetOverride?: PersistedResourceTarget,
    viewerId?: ViewerId,
  ) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const parentDir = file.path.split(/[/\\]/).slice(0, -1).join('/') || ''
    const plannedType = (viewerId ? viewerMediaType(viewerId) : null) ?? file.type
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'viewer',
      title: file.name,
      iconName: null,
      iconPath: file.path,
      iconType: plannedType,
      iconIsVirtual: false,
      source,
      initialState: { dir: parentDir, viewing: file.path },
      resourceTarget: persistedResourceTarget(file.resource) ?? resourceTargetOverride,
      viewerId,
      tabGroupId: null,
      layout: createWindowLayout(
        undefined,
        plannedType === MediaType.VIDEO
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

  function openReaderFromBrowser(fromWindowId: string, file: FileItem, viewerId?: ViewerId) {
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
      resourceTarget: persistedResourceTarget(file.resource),
      viewerId,
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
    const plan = openResource(resourceForFileItem(file), 'default', {
      surface: 'workspace',
      scope: openScopeForSource(source),
    })
    if (plan.kind === 'browse') {
      openBrowser({
        source,
        initialState: { dir: file.path },
        resourceTarget: persistedResourceTarget(file.resource),
      })
      return
    }
    if (plan.kind === 'playback') {
      requestPlay(
        source,
        file.path,
        result.parentPath || undefined,
        persistedResourceTarget(file.resource),
        plan.media,
        plan.viewer.id,
      )
      return
    }
    if (plan.kind === 'viewer') {
      openViewer(workspace()?.activeWindowId ?? '', file, source, undefined, plan.viewer.id)
    }
  }

  function addPinnedItem(file: FileItem) {
    const w = workspace()
    if (!w) return
    const source = browserSource()
    const pinKey = (p: PinnedTaskbarItem) => `${p.path}:${p.source.kind}:${p.source.token ?? ''}`
    const newKey = `${file.path}:${source.kind}:${source.token ?? ''}`
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
      resourceTarget: persistedResourceTarget(file.resource),
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

  async function selectPinned(pin: PinnedTaskbarItem) {
    if (pin.isVirtual) {
      if (props.shareConfig) return
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
        const openTarget =
          target.type === 'hermesSession' && target.sessionId
            ? {
                type: 'hermesSession' as const,
                sessionId: target.sessionId,
                readOnly: target.readOnly,
              }
            : target.type === 'hermesDraft'
              ? {
                  type: 'hermesDraft' as const,
                  ...(target.projectPath ? { projectPath: target.projectPath } : {}),
                  readOnly: target.readOnly,
                }
              : undefined
        if (!openTarget) return
        const plan = openResource(
          resourceForFileItem(synthetic, {
            kind: openTarget.type === 'hermesSession' ? 'conversation' : 'draft',
            presentation: 'conversation',
            providerOperations: ['read'],
            openTarget,
          }),
          'default',
          { surface: 'workspace', scope: openScopeForSource(pin.source) },
        )
        if (plan.kind === 'conversation') {
          openHermesFromBrowser(workspace()?.activeWindowId ?? '', synthetic, plan.target)
        }
      }
      return
    }
    const ext = pin.path.split('.').pop()?.toLowerCase() ?? ''
    const synthetic: FileItem = {
      path: pin.path,
      name: pin.title,
      isDirectory: pin.isDirectory,
      isVirtual: false,
      size: 0,
      type: pin.isDirectory ? MediaType.FOLDER : getMediaType(ext),
      extension: ext,
    }
    const plan = openResource(
      resourceForWorkspaceTarget(synthetic, pin.resourceTarget),
      'default',
      {
        surface: 'workspace',
        scope: openScopeForSource(pin.source),
      },
    )
    if (plan.kind === 'browse') {
      openBrowser({
        source: pin.source,
        initialState: { dir: pin.path },
        resourceTarget: pin.resourceTarget,
      })
      return
    }
    if (plan.kind === 'playback') {
      requestPlay(
        pin.source,
        pin.path,
        pin.path.split(/[/\\]/).slice(0, -1).join('/') || undefined,
        pin.resourceTarget,
        plan.media,
        plan.viewer.id,
      )
      return
    }
    if (plan.kind === 'viewer') {
      openViewer('', synthetic, pin.source, pin.resourceTarget, plan.viewer.id)
    }
  }

  const [pinMenu, setPinMenu] = createSignal<{
    x: number
    y: number
    pinId: string
  } | null>(null)

  const wxAudioTick = useStoreSync(useWorkspaceAudio)

  const playbackPlayingPath = createMemo(() => {
    void wxAudioTick()
    return useWorkspaceAudio.getState().playing ?? null
  })

  const suppressWorkspaceTaskbarAudioForVideoViewer = createMemo(() => {
    void wxAudioTick()
    const w = workspace()
    const st = useWorkspaceAudio.getState()
    const path = st.playing
    if (!path || !isVideoPath(path) || st.audioOnly || !w) return false
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
    void wxAudioTick()
    const key = storageSessionKeyFull().key
    const slice = key ? useWorkspaceAudio.getState().byKey[key] : undefined
    const tm = useWorkspaceAudio.getState()
    const sp = server.sharePanel()
    const playing = slice?.playing ?? null
    const audioOnly = slice?.audioOnly ?? false
    const audioMode = !!(playing && (!isVideoPath(playing) || audioOnly))
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const transportAudioForRow = !!playing && !!tm.playing && norm(playing) === norm(tm.playing)
    const taskbarDrivesIcon = audioMode && transportAudioForRow

    return {
      customIcons: server.settingsQuery.data?.customIcons ?? {},
      knowledgeBases: server.settingsQuery.data?.knowledgeBases ?? [],
      playingPath: playing,
      currentFile: audioMode ? playing : null,
      mediaPlayerIsPlaying: taskbarDrivesIcon ? tm.isPlaying : false,
      mediaType: audioMode ? 'audio' : null,
      mediaShare: sp ? { token: sp.token, sharePath: sp.sharePath } : undefined,
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
          focusWindow={focusWindow}
          setWindowMinimized={snap.setWindowMinimized}
          closeWindow={closeWindow}
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

  createEffect(() => {
    if (!fileOpenTargetPick()) return
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
    const onMove = (e: PointerEvent) => {
      updateFileOpenPickHover(e.clientX, e.clientY)
    }
    const onUp = (e: PointerEvent) => {
      const w = workspace()
      const area = snap.getWorkspaceAreaElement()
      if (!w || !area) {
        cancelFileOpenTargetPick()
        return
      }
      const rect = area.getBoundingClientRect()
      const id = pickWorkspaceWindowAtClientPoint(w.windows, rect, e.clientX, e.clientY)
      if (id) commitFileOpenTargetPick(id)
      else cancelFileOpenTargetPick()
    }
    document.addEventListener('pointermove', onMove, { capture: true })
    document.addEventListener('pointerup', onUp, { capture: true })
    onCleanup(() => {
      document.body.style.cursor = prevCursor
      document.removeEventListener('pointermove', onMove, { capture: true })
      document.removeEventListener('pointerup', onUp, { capture: true })
    })
  })

  return (
    <div class='workspace-layout pointer-events-auto fixed inset-0 flex flex-col overflow-hidden bg-background select-none'>
      <div
        class='relative min-h-0 flex-1 overflow-hidden'
        ref={(el) => snap.bindWorkspaceAreaRoot(el)}
      >
        <WorkspacePageCanvas
          hasWorkspaceWindows={hasWorkspaceWindows}
          onOpenBrowser={() => openBrowser()}
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
          setWorkspace={setWorkspace}
          mergeTargetPreview={snap.mergeTargetPreview}
          dragSnapWindowId={snap.dragSnapWindowId}
          layoutPicker={layoutPicker}
          closeLayoutPicker={() => setLayoutPicker(null)}
          onTilingPick={handleWorkspaceTilingPick}
          setTilingPickerHoverPreview={snap.setTilingPickerHoverPreview}
          openLayoutPicker={(windowId, anchor) => setLayoutPicker({ windowId, anchor })}
          pageProps={props}
          sharePanel={server.sharePanel}
          editableFolders={server.editableFolders}
          knowledgeBases={() => server.settingsQuery.data?.knowledgeBases ?? []}
          storageKey={() => storageSessionKeyFull().key}
          workspaceFileIconContext={workspaceFileIconContext}
          focusWindow={focusWindow}
          closeWindow={closeWindow}
          setWindowMinimized={snap.setWindowMinimized}
          toggleFullscreenWindow={snap.toggleFullscreenWindow}
          restoreDrag={snap.restoreDrag}
          handleDragPointerMove={snap.handleDragPointerMove}
          onDragPointerEnd={snap.onDragPointerEnd}
          updateWindowBounds={snap.updateWindowBounds}
          resizeSnappedWindowBounds={snap.resizeSnappedWindowBounds}
          setActiveTab={setActiveTab}
          closeTab={closeTab}
          toggleTabPinned={toggleTabPinned}
          handleTabPullStart={handleTabPullStart}
          dropFileToTabBar={dropFileToTabBar}
          startSplitPaneDrag={startSplitPaneDrag}
          navigateDir={navigateDir}
          openViewerFromBrowser={openViewerFromBrowser}
          openReaderFromBrowser={openReaderFromBrowser}
          openHermesFromBrowser={openHermesFromBrowser}
          bindHermesSession={bindHermesSession}
          openHermesBranch={openHermesBranch}
          renameHermesWindow={renameHermesWindow}
          addPinnedItem={addPinnedItem}
          openInNewTabInSameWindow={openInNewTabInSameWindow}
          openInSplitViewFromBrowserPane={openInSplitViewFromBrowserPane}
          requestPlay={(source, file, dir, plannedMedia, viewerId) =>
            requestPlay(
              source,
              file.path,
              dir,
              persistedResourceTarget(file.resource),
              plannedMedia,
              viewerId,
            )
          }
          updateWindowViewing={updateWindowViewing}
          resizeViewerWindowForVideoMetadata={resizeViewerWindowForVideoMetadata}
          listenOnlyHandoff={listenOnlyHandoffFromWorkspaceViewer}
          onBeginFileOpenTargetPick={beginFileOpenTargetPick}
          openFileInNewFloatingWindow={openFileInNewFloatingWindow}
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
        pageProps={props}
        onOpenBrowser={() => openBrowser()}
        onOpenSearchResult={openGlobalSearchResult}
        hasAnyTaskbarItems={hasAnyTaskbarItems}
        pinnedItems={pinnedItems}
        taskbarGroupIds={orderedWindowGroupIds}
        taskbarWindowRows={taskbarWindowRows}
        storageSessionKey={() => storageSessionKeyFull().key}
        browserSource={browserSource}
        workspace={workspace}
        setWorkspace={setWorkspace}
        settingsData={() => server.settingsQuery.data}
        layoutScope={server.layoutScope}
        serverLayoutPresets={server.serverLayoutPresets}
        presetsReady={server.presetsReady}
        collectLayoutSnapshot={baseline.collectLayoutSnapshot}
        applyLayoutSnapshot={baseline.applyLayoutSnapshot}
        syncLayoutBaselineToCurrent={baseline.syncLayoutBaselineToCurrent}
        revertLayoutToBaseline={baseline.revertLayoutToBaseline}
        declareBaselinePresetId={baseline.declareBaselinePresetId}
        isLayoutDirty={baseline.isLayoutDirty}
        layoutBaselinePresetId={baseline.layoutBaselinePresetId}
        workspaceFileIconContext={workspaceFileIconContext}
        selectPinned={selectPinned}
        removePinnedItem={removePinnedItem}
        pinMenu={pinMenu}
        setPinMenu={setPinMenu}
        focusWindow={focusWindow}
        stopWorkspacePlaybackFromTaskbar={stopWorkspacePlaybackFromTaskbar}
        requestPlay={requestPlay}
        suppressTaskbarAudioChrome={suppressWorkspaceTaskbarAudioForVideoViewer}
      />
    </div>
  )
}
