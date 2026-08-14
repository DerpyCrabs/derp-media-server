import { contentWindowKind } from '@/lib/content-window'
import type { AssistGridSpan } from '@/lib/workspace-assist-grid'
import {
  createDefaultBounds,
  createWindowLayout,
  getPlayerBoundsForAspectRatio,
  insertWindowAtGroupIndex,
  maxWorkspaceWindowZ,
  WORKSPACE_WINDOW_MIN_VISIBLE_PX,
} from '@/lib/workspace-geometry'
import type { ResourceDragData } from '@/lib/resource-drag-data'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import { applyWorkspacePathMutation } from '@/lib/workspace-path-mutation'
import {
  workspaceTaskbarPinIdentity,
  workspaceTaskbarPinPath,
  workspaceTaskbarPinResource,
} from '@/lib/workspace-taskbar-pins'
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
import { useApplicationEventsStream } from './lib/use-application-events-stream'
import { WorkspacePageCanvas } from './workspace/workspace-page/WorkspacePageCanvas'
import { WorkspacePageTaskbar } from './workspace/workspace-page/WorkspacePageTaskbar'
import { createWorkspaceSnapDragModel } from './workspace/workspace-page/create-workspace-snap-drag-model'
import { useWorkspacePageDocumentChrome } from './workspace/workspace-page/use-workspace-page-document-chrome'
import { useWorkspacePageLayoutBaseline } from './workspace/workspace-page/use-workspace-page-layout-baseline'
import { useWorkspacePageLocalPersistence } from './workspace/workspace-page/use-workspace-page-local-persistence'
import { useWorkspacePageServerData } from './workspace/workspace-page/use-workspace-page-server-data'

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
import { isWorkspaceRoute, loadPersisted } from './workspace/workspace-page-persistence'
import type { ContentInstance } from '@/lib/domain/content'
import type { ExplorerLocation } from './features/explorer/types'
import {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemResourceAddress,
  filesystemResourceKey,
  resourceKey,
  resourceIsBrowsable,
  sameResourceKey,
  type ResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { usePlaybackSession, usePlaybackSnapshot } from './features/playback/PlaybackProvider'
import {
  contentForOpenPlan,
  type OpenIntent,
  type OpenReadyPlan,
} from './features/open/open-resource'
import { openResource } from './integrations/open-resource'
import {
  contentInstanceFromCurrentWindow,
  contentWindowFilesystemPath,
  contentWindowWithInstance,
  contentWithInstanceId,
  currentContentWindowPersistence,
} from './integrations/current-window-content'
import { contentRuntimeIdentity } from './features/content/runtime'
import { confirmContentClose } from './features/content/confirm-content-close'
import { applicationContentRegistry, applicationContentRuntime } from './integrations/registry'
import { openApplicationResource } from './integrations/explorer-adapter'
import { filesystemPathForResourceKey } from './integrations/filesystem/resource'
import type { SearchHit } from './features/search/contracts'
import { executeSearchHit } from './features/search/executor'
import { applicationSearchCoordinator } from './integrations/search'

export function WorkspacePage() {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()

  const server = useWorkspacePageServerData()

  const storageSessionKeyFull = createMemo(() => {
    const sid = urlSearchParams().get('ws') ?? ''
    const base = workspaceStorageBaseKey()
    return { sid, key: sid ? workspaceStorageSessionKey(base, sid) : '' }
  })

  const [workspace, setWorkspace] = createSignal<PersistedWorkspaceState | null>(null)
  useApplicationEventsStream(true, (mutation) => {
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
  const baseline = useWorkspacePageLayoutBaseline(workspace, setWorkspace)
  const snap = createWorkspaceSnapDragModel({
    workspace,
    setWorkspace,
    preferredSnapTick,
  })

  useWorkspacePageDocumentChrome(workspace, themeTick)

  useWorkspacePageLocalPersistence({
    storageSessionKeyFull,
    workspace,
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
    const base = workspaceStorageBaseKey()
    const key = workspaceStorageSessionKey(base, sid)
    const provider = sp.get('provider')
    const resourceId = sp.get('resource')
    let routeResource: ResourceKey | null = null
    if (provider && resourceId) {
      try {
        routeResource = resourceKey(provider, resourceId)
      } catch {}
    }
    const presetParam = sp.get('preset')
    void server.settingsQuery.isSuccess
    void server.serverLayoutPresets()
    const presetsReadyNow = server.settingsQuery.isSuccess
    // Always prefer session draft in localStorage over a named preset in the URL.
    const loaded = loadPersisted(key)
    const presetsList = server.serverLayoutPresets()

    if (lastHydratedStorageKey !== key) {
      lastHydratedStorageKey = key
      const initial = resolveWorkspaceInitialHydration(
        {
          resource: routeResource,
          presetParam,
          loaded,
          presetsReadyNow,
          presetsList,
        },
        currentContentWindowPersistence,
      )
      untrack(() => {
        if (initial.kind === 'defer-preset') {
          setPinsHydratedFor('')
          return
        }
        if (initial.baselineSnapshot && initial.baselinePresetId) {
          baseline.setLayoutBaselinePresetId(initial.baselinePresetId)
          baseline.setLayoutBaselineSerialized(
            serializeWorkspaceLayoutState(
              initial.baselineSnapshot,
              currentContentWindowPersistence,
            ),
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

    const deferred = resolveWorkspaceDeferredPresetApply(
      {
        presetParam,
        presetsReadyNow,
        hasPersistedDraft: !!loadPersisted(key),
        presetsList,
      },
      currentContentWindowPersistence,
    )
    if (!deferred) return
    untrack(() => {
      if (deferred.kind === 'apply') {
        baseline.setLayoutBaselinePresetId(deferred.baselinePresetId)
        baseline.setLayoutBaselineSerialized(
          serializeWorkspaceLayoutState(deferred.baselineSnapshot, currentContentWindowPersistence),
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
        void server.persistPinsMutation.mutateAsync({
          items: w.pinnedTaskbarItems ?? [],
        })
      }
    })
    setPinsHydratedFor(key)
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
          ? {
              ...win,
              layout: { ...win.layout, zIndex: newZ, minimized: false },
            }
          : win,
      ),
    })
  }

  function stopWorkspacePlaybackFromTaskbar() {
    playbackSession.dispatch({ type: 'stop' })
  }

  async function closeWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const t = w.windows.find((x) => x.id === windowId)
    const gid = t ? groupIdForWindow(t) : windowId
    const toRemove = new Set(w.windows.filter((x) => groupIdForWindow(x) === gid).map((x) => x.id))
    const removed = w.windows.filter((x) => toRemove.has(x.id))
    const content = removed
      .map((window) => contentInstanceFromCurrentWindow(window))
      .filter((instance): instance is ContentInstance => instance !== null)
    const groupIsCurrent = () => {
      const current = workspace()
      if (!current) return false
      const currentGroup = current.windows.filter((window) => groupIdForWindow(window) === gid)
      return (
        currentGroup.length === removed.length &&
        currentGroup.every((window, index) => window === removed[index])
      )
    }
    if (!(await confirmContentClose(applicationContentRuntime, content, groupIsCurrent))) return
    let closed = false
    setWorkspace((current) => {
      if (!current) return current
      const currentGroup = current.windows.filter((window) => groupIdForWindow(window) === gid)
      if (
        currentGroup.length !== removed.length ||
        !currentGroup.every((window, index) => window === removed[index])
      ) {
        return current
      }
      const next = current.windows.filter((window) => !toRemove.has(window.id))
      let active = current.activeWindowId
      if (active != null && toRemove.has(active)) active = next[next.length - 1]?.id ?? null
      const nextTabMap = { ...current.activeTabMap }
      delete nextTabMap[gid]
      closed = true
      return {
        ...current,
        windows: next,
        activeWindowId: active,
        activeTabMap: nextTabMap,
      }
    })
    if (closed) {
      await Promise.all(content.map((instance) => applicationContentRuntime.release(instance)))
    }
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
              ? {
                  ...win,
                  layout: { ...win.layout, zIndex: newZ, minimized: false },
                }
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

  async function closeTab(tabId: string, opts?: { ignoreTabPinForListenOnlyDismiss?: boolean }) {
    const current = workspace()
    const initial = current?.windows.find((window) => window.id === tabId)
    if (!initial || (initial.tabPinned && !opts?.ignoreTabPinForListenOnlyDismiss)) return
    const content = contentInstanceFromCurrentWindow(initial)
    if (
      !(await confirmContentClose(
        applicationContentRuntime,
        content ? [content] : [],
        () => workspace()?.windows.find((window) => window.id === tabId) === initial,
      ))
    ) {
      return
    }
    let removed = false
    setWorkspace((prev) => {
      if (!prev) return prev
      let work = prev
      const v0 = work.windows.find((w) => w.id === tabId)
      if (v0 !== initial) return prev
      if (v0.tabPinned && !opts?.ignoreTabPinForListenOnlyDismiss) return prev
      const g0 = groupIdForWindow(v0)
      if (work.tabGroupSplits?.[g0]?.leftTabId === tabId) {
        work = exitSplitViewState(work, g0)
      }
      const victim = work.windows.find((w) => w.id === tabId)
      if (!victim) return pruneTabGroupSplitsState(work)
      removed = true
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
    if (removed && content) await applicationContentRuntime.release(content)
  }

  function toggleTabPinned(tabId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const w = prev.windows.find((x) => x.id === tabId)
      const content = w ? contentInstanceFromCurrentWindow(w) : null
      if (
        !w ||
        (contentWindowKind(w) === 'viewer' &&
          content !== null &&
          applicationContentRegistry.presentation(content)?.category === 'video')
      ) {
        return prev
      }
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

        const next = splitWindowFromGroupState(prev, tabId, {
          x: newX,
          y: newY,
          width,
          height,
        })
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

  function requestPlay(resource: ResourceSummary, context?: ResourceKey) {
    const plan = openResource(resource, 'play', {
      surface: 'workspace',
      disposition: 'window',
    })
    if (plan.status !== 'ready' || plan.kind !== 'render') return
    const item = applicationContentRegistry.playbackItem(resource)
    if (!item) return
    const path = filesystemPathForResourceKey(item.resource)
    const isVideo = item.media === 'video'
    playbackSession.dispatch({
      type: 'load',
      item,
      queue: applicationContentRegistry.playbackQueue([resource], item),
      autoplay: true,
      mode: isVideo ? 'video' : 'audio',
    })
    if (!isVideo) {
      return
    }
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
            ? {
                ...win,
                layout: { ...win.layout, zIndex: maxZ, minimized: false },
              }
            : win,
        ),
      })
    }

    const existingViewer = work.windows.find((win) => {
      const content = contentInstanceFromCurrentWindow(win)
      return content?.type === 'resource' && sameResourceKey(content.resource, item.resource)
    })
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

    const resourceAddress = filesystemResourceAddress(plan.summary.key)
    const parentDir = path?.split(/[/\\]/).slice(0, -1).join('/')
    const initialContext =
      context ??
      (resourceAddress && parentDir !== undefined
        ? filesystemResourceKey(resourceAddress.rootId, parentDir)
        : undefined)

    const viewerId = `workspace-win-${work.nextWindowId}`
    const nextNextId = work.nextWindowId + 1
    const baseWindows = work.windows
    const zIndex = maxWorkspaceWindowZ(baseWindows) + 1
    const nextTabMap = { ...work.activeTabMap }
    const content = contentForOpenPlan(plan, viewerId, initialContext)

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
          title: resource.name,
          iconName: null,
          contentInstance: content,
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
      title: resource.name,
      iconName: null,
      contentInstance: content,
      tabGroupId: null,
      layout: createWindowLayout(
        undefined,
        path
          ? viewerBoundsForVideoOpen(path, baseWindows.length)
          : createDefaultBounds(baseWindows.length, 'viewer'),
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
      if (!viewer || contentWindowKind(viewer) !== 'viewer') return prev
      const currentBounds = viewer.layout?.bounds ?? null
      const newBounds = getPlayerBoundsForAspectRatio(aspect, currentBounds)
      const viewing = contentWindowFilesystemPath(viewer)
      if (viewing) {
        rememberWorkspaceVideoIntrinsics(viewing, videoWidth, videoHeight)
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

  async function updateWindowResource(windowId: string, resourceKey: ResourceKey) {
    const currentWindow = workspace()?.windows.find((window) => window.id === windowId)
    const current = currentWindow ? contentInstanceFromCurrentWindow(currentWindow) : null
    const inspector = applicationContentRegistry.inspect(resourceKey)
    if (!inspector) return
    const resource = await inspector.inspect(resourceKey)
    const plan = openResource(resource, 'default', {
      surface: 'workspace',
      disposition: 'pane',
    })
    if (plan.status !== 'ready' || plan.kind !== 'render') return
    const context =
      current?.type === 'resource' && current.resource.provider === resourceKey.provider
        ? current.context
        : undefined
    replaceWindowContent(windowId, contentForOpenPlan(plan, windowId, context))
  }

  function navigateDir(windowId: string, location: ExplorerLocation) {
    replaceWindowContent(windowId, {
      id: windowId,
      type: 'explorer',
      location: location.key,
    })
  }

  function openInNewTabInSameWindow(
    sourceWindowId: string,
    resource: ResourceSummary,
    insertIndex?: number,
  ) {
    const plan = openResource(resource, resourceIsBrowsable(resource) ? 'browse' : 'default', {
      surface: 'workspace',
      disposition: 'pane',
    })
    if (plan.status !== 'ready') return
    const content = contentForWorkspacePlan(plan, `planned-${crypto.randomUUID()}`)
    if (!content) return
    setWorkspace((prev) =>
      prev
        ? openInNewTabInGroupState(prev, sourceWindowId, content, resource.name, insertIndex)
        : prev,
    )
  }

  async function dropFileToTabBar(
    targetLeaderWindowId: string,
    data: ResourceDragData,
    insertIndex?: number,
  ) {
    const inspector = applicationContentRegistry.inspect(data.key)
    if (!inspector) return
    openInNewTabInSameWindow(targetLeaderWindowId, await inspector.inspect(data.key), insertIndex)
  }

  function openBrowser(options?: { path?: string; rootId?: string }) {
    const effectiveDir = options?.path ?? ''
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const browserTitle =
      effectiveDir !== '' ? workspaceBrowserDirTitle(effectiveDir) : workspaceBrowserDirTitle('')
    const newWin: WorkspaceWindowDefinition = {
      id,
      title: browserTitle,
      iconName: null,
      contentInstance: {
        id,
        type: 'explorer',
        location: filesystemResourceKey(
          options?.rootId ?? DEFAULT_FILESYSTEM_ROOT_ID,
          effectiveDir,
        ),
      },
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

  function openViewerFromBrowser(windowId: string, resource: ResourceSummary) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef) return
    const gid = groupIdForWindow(winDef)
    const splitBrowserLeft =
      !!w?.tabGroupSplits?.[gid]?.leftTabId &&
      w.tabGroupSplits[gid]!.leftTabId === windowId &&
      contentWindowKind(winDef) === 'browser'
    if (getWorkspaceFileOpenTarget() === 'new-tab') {
      const anchorId = w ? resolveNewTabAnchorWindowId(w, windowId) : windowId
      openInNewTabInSameWindow(anchorId, resource, undefined)
      return
    }
    if (splitBrowserLeft) {
      openInNewTabInSameWindow(windowId, resource, undefined)
      return
    }
    openViewer(windowId, resource)
  }

  function openContentWindow(
    windowId: string,
    content: ContentInstance,
    resource?: ResourceSummary,
    forceTab = false,
  ) {
    const w = workspace()
    if (!w) return
    const comparable = JSON.stringify({ ...content, id: '' })
    const existing = w.windows.find((window) => {
      const instance = contentInstanceFromCurrentWindow(window)
      return instance && JSON.stringify({ ...instance, id: '' }) === comparable
    })
    if (existing) {
      focusWindow(existing.id)
      return
    }
    const id = `workspace-window-${w.nextWindowId}`
    const sourceWindow = w.windows.find((win) => win.id === windowId)
    const attachToTab = (forceTab || getWorkspaceFileOpenTarget() === 'new-tab') && sourceWindow
    const gid = attachToTab ? groupIdForWindow(sourceWindow) : null
    const hosted = contentWithInstanceId(content, id)
    const presentation = applicationContentRegistry.presentation(hosted)
    const base: WorkspaceWindowDefinition = {
      id,
      title: resource?.name ?? presentation?.title ?? 'Content',
      iconName: presentation?.icon ?? null,
      contentInstance: hosted,
      tabGroupId: gid,
      layout:
        attachToTab && sourceWindow?.layout
          ? { ...sourceWindow.layout, minimized: false }
          : createWindowLayout(
              undefined,
              createDefaultBounds(w.windows.length, 'viewer'),
              maxWorkspaceWindowZ(w.windows) + 1,
            ),
    }
    const projected = contentWindowWithInstance(base, hosted)
    if (!projected) return
    const newWin: WorkspaceWindowDefinition = {
      ...projected,
      title: resource?.name ?? projected.title,
    }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: w.nextWindowId + 1,
      activeWindowId: id,
      activeTabMap: gid ? { ...w.activeTabMap, [gid]: id } : w.activeTabMap,
    })
  }

  async function replaceWindowContent(windowId: string, content: ContentInstance) {
    const target = workspace()?.windows.find((window) => window.id === windowId)
    if (!target) return
    const previous = contentInstanceFromCurrentWindow(target)
    const hosted = contentWithInstanceId(content, windowId)
    const changesRuntimeOwner =
      previous !== null && contentRuntimeIdentity(previous) !== contentRuntimeIdentity(hosted)
    if (
      changesRuntimeOwner &&
      !(await confirmContentClose(applicationContentRuntime, [previous], () =>
        Boolean(workspace()?.windows.some((window) => window.id === windowId && window === target)),
      ))
    ) {
      return
    }
    let replaced = false
    setWorkspace((current) => {
      if (!current) return current
      const currentTarget = current.windows.find((window) => window.id === windowId)
      if (currentTarget !== target) return current
      const projected = contentWindowWithInstance(currentTarget, hosted)
      if (!projected) return current
      replaced = true
      return {
        ...current,
        windows: current.windows.map((window) => (window === currentTarget ? projected : window)),
      }
    })
    if (replaced && changesRuntimeOwner) await applicationContentRuntime.release(previous)
  }

  function openInSplitViewFromBrowserPane(windowId: string, resource: ResourceSummary) {
    const plan = openResource(resource, resourceIsBrowsable(resource) ? 'browse' : 'default', {
      surface: 'workspace',
      disposition: 'pane',
    })
    if (plan.status !== 'ready') return
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || contentWindowKind(winDef) !== 'browser') return
    if (applicationContentRegistry.playbackItem(resource)?.media === 'audio') {
      const browser = contentInstanceFromCurrentWindow(winDef)
      requestPlay(resource, browser?.type === 'explorer' ? browser.location : undefined)
      return
    }
    const content = contentForWorkspacePlan(plan, `planned-${crypto.randomUUID()}`)
    if (!content) return
    setWorkspace((prev) =>
      prev ? openInSplitViewFromBrowserState(prev, windowId, content, resource.name) : prev,
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

  function openFileInNewFloatingWindow(windowId: string, resource: ResourceSummary) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || resourceIsBrowsable(resource)) return
    openViewer(windowId, resource)
  }

  function contentForWorkspacePlan(plan: OpenReadyPlan, id: string): ContentInstance {
    return contentForOpenPlan(plan, id)
  }

  function placeWorkspacePlan(fromWindowId: string, plan: OpenReadyPlan) {
    if (plan.disposition === 'replace') {
      replaceWindowContent(fromWindowId, contentForWorkspacePlan(plan, fromWindowId))
      return
    }
    if (plan.disposition === 'pane') {
      openContentWindow(
        fromWindowId,
        contentForWorkspacePlan(plan, `planned-${crypto.randomUUID()}`),
        undefined,
        true,
      )
      return
    }
    if (plan.disposition !== 'window') return
    const resource = plan.summary
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const content = contentForWorkspacePlan(plan, id)
    const path = filesystemPathForResourceKey(resource.key)
    const base: WorkspaceWindowDefinition = {
      id,
      title: resource.name,
      iconName: null,
      contentInstance: content,
      tabGroupId: null,
      layout: createWindowLayout(
        undefined,
        applicationContentRegistry.playbackItem(resource)?.media === 'video' && path !== null
          ? viewerBoundsForVideoOpen(path, w.windows.length)
          : createDefaultBounds(w.windows.length, 'viewer'),
        n,
      ),
    }
    const projected = contentWindowWithInstance(base, content)
    if (!projected) return
    const newWin: WorkspaceWindowDefinition = {
      ...projected,
      layout: {
        ...projected.layout,
        zIndex: maxWorkspaceWindowZ(w.windows) + 1,
      },
    }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  function openViewer(
    fromWindowId: string,
    resource: ResourceSummary,
    intent: OpenIntent = 'default',
  ) {
    const plan = openResource(resource, intent, {
      surface: 'workspace',
      disposition: 'window',
    })
    if (plan.status !== 'ready') return
    placeWorkspacePlan(fromWindowId, plan)
  }

  function openReaderFromBrowser(fromWindowId: string, resource: ResourceSummary) {
    openViewer(fromWindowId, resource, 'read')
  }

  function openGlobalSearchResult(hit: SearchHit) {
    void executeSearchHit(applicationSearchCoordinator, hit, {
      opener: openResource,
      context: { surface: 'workspace', disposition: 'window' },
      place(selected, plan) {
        if (!selected.resource || plan.status !== 'ready') return
        placeWorkspacePlan(workspace()?.activeWindowId ?? '', plan)
      },
    })
  }

  function addPinnedItem(resource: ResourceSummary) {
    const w = workspace()
    if (!w) return
    const filesystem = filesystemResourceAddress(resource.key)
    const path = filesystem?.path || null
    const customIcons = server.settingsQuery.data?.customIcons ?? {}
    const item: PinnedTaskbarItem = {
      id: crypto.randomUUID(),
      resource: resource.key,
      title: resource.name,
      customIconName:
        typeof resource.metadata?.customIcon === 'string'
          ? resource.metadata.customIcon
          : path
            ? (customIcons[path] ?? null)
            : null,
    }
    const newKey = workspaceTaskbarPinIdentity(item)
    if (
      (w.pinnedTaskbarItems ?? []).some(
        (candidate) => workspaceTaskbarPinIdentity(candidate) === newKey,
      )
    ) {
      return
    }
    const next = [...(w.pinnedTaskbarItems ?? []), item]
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void server.persistPinsMutation.mutateAsync({ items: next })
  }

  function removePinnedItem(id: string) {
    const w = workspace()
    if (!w) return
    const next = (w.pinnedTaskbarItems ?? []).filter((p) => p.id !== id)
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void server.persistPinsMutation.mutateAsync({ items: next })
  }

  async function selectPinned(pin: PinnedTaskbarItem) {
    const resource = workspaceTaskbarPinResource(pin)
    if (!resource) return
    const summary = await applicationContentRegistry.inspect(resource)?.inspect(resource)
    if (!summary) return
    const isDirectory = resourceIsBrowsable(summary)
    const path = workspaceTaskbarPinPath(pin)
    if (path === null) {
      const content = await openApplicationResource(resource, pin.title, {
        browse: isDirectory,
      })
      if (content) openContentWindow(workspace()?.activeWindowId ?? '', content)
      return
    }
    if (isDirectory) {
      openContentWindow(workspace()?.activeWindowId ?? '', {
        id: `pinned-${resource.provider}-explorer`,
        type: 'explorer',
        location: resource,
      })
      return
    }
    if (applicationContentRegistry.playbackItem(summary)) {
      requestPlay(summary)
      return
    }
    openViewer('', summary)
  }

  const [pinMenu, setPinMenu] = createSignal<{
    x: number
    y: number
    pinId: string
  } | null>(null)

  const playbackPlayingPath = createMemo(() => {
    const item = playback().currentItem
    return item ? filesystemPathForResourceKey(item.resource) : null
  })

  const suppressWorkspaceTaskbarAudioForVideoViewer = createMemo(() => {
    const w = workspace()
    const state = playback()
    const item = state.currentItem
    if (!item || item.media !== 'video' || state.mode !== 'video' || !w) return false
    return w.windows.some((win) => {
      if (contentWindowKind(win) !== 'viewer') return false
      const content = contentInstanceFromCurrentWindow(win)
      return (
        content?.type === 'resource' &&
        sameResourceKey(content.resource, item.resource) &&
        applicationContentRegistry.presentation(content)?.category === 'video'
      )
    })
  })

  const workspaceFileIconContext = (): FileIconContext => {
    const state = playback()
    const playing = state.currentItem
      ? filesystemPathForResourceKey(state.currentItem.resource)
      : null

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
          if (win.id !== browserId || contentWindowKind(win) !== 'browser') return win
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
          win.id === pick.sourceBrowserId && contentWindowKind(win) === 'browser'
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
          emptyState={{
            hasWindows: hasWorkspaceWindows,
            openBrowser,
          }}
          snapAssist={{
            bindPreview: snap.bindSnapPreview,
            areaNode: snap.workspaceAreaNode,
            getAreaElement: snap.getWorkspaceAreaElement,
            shown: snap.snapAssistShown,
            engageFromHandle: snap.engageSnapAssistFromHandle,
            disengageFromPanel: snap.disengageSnapAssistFromPanel,
            hoverPick: snap.assistHoverPick,
            bindRoot: snap.bindSnapAssistRoot,
            renderedGroupIds: orderedWindowGroupIds,
            mergeTargetPreview: snap.mergeTargetPreview,
            dragWindowId: snap.dragSnapWindowId,
          }}
          state={{ workspace, setWorkspace }}
          layoutPicker={{
            current: layoutPicker,
            close: () => setLayoutPicker(null),
            pick: handleWorkspaceTilingPick,
            setHoverPreview: snap.setTilingPickerHoverPreview,
            open: (windowId, anchor) => setLayoutPicker({ windowId, anchor }),
          }}
          resources={{
            editableFolders: server.editableFolders,
            knowledgeBases: () => server.settingsQuery.data?.knowledgeBases ?? [],
            fileIconContext: workspaceFileIconContext,
          }}
          windows={{
            focus: focusWindow,
            close: closeWindow,
            setMinimized: snap.setWindowMinimized,
            toggleFullscreen: snap.toggleFullscreenWindow,
            restoreDrag: snap.restoreDrag,
            moveDrag: snap.handleDragPointerMove,
            endDrag: snap.onDragPointerEnd,
            updateBounds: snap.updateWindowBounds,
            resizeSnapped: snap.resizeSnappedWindowBounds,
          }}
          tabs={{
            setActive: setActiveTab,
            close: closeTab,
            togglePinned: toggleTabPinned,
            startPull: handleTabPullStart,
            dropFile: dropFileToTabBar,
            startSplitDrag: startSplitPaneDrag,
          }}
          contentHost={{
            navigateExplorer: navigateDir,
            openViewer: openViewerFromBrowser,
            openReader: openReaderFromBrowser,
            open: openContentWindow,
            replace: replaceWindowContent,
            navigateResource: updateWindowResource,
          }}
          files={{
            addPinned: addPinnedItem,
            openInNewTab: openInNewTabInSameWindow,
            openInSplit: openInSplitViewFromBrowserPane,
            requestPlay,
            resizeViewerForVideo: resizeViewerWindowForVideoMetadata,
            beginOpenTargetPick: beginFileOpenTargetPick,
            openFloating: openFileInNewFloatingWindow,
          }}
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
        onOpenBrowser={() => openBrowser()}
        onOpenSearchResult={openGlobalSearchResult}
        hasAnyTaskbarItems={hasAnyTaskbarItems}
        pinnedItems={pinnedItems}
        taskbarGroupIds={orderedWindowGroupIds}
        taskbarWindowRows={taskbarWindowRows}
        storageSessionKey={() => storageSessionKeyFull().key}
        workspace={workspace}
        setWorkspace={setWorkspace}
        settingsData={() => server.settingsQuery.data}
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
