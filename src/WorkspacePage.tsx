import { isVirtualFolderPath } from '@/lib/constants'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import type { AssistGridSpan } from '@/lib/workspace-assist-grid'
import {
  createDefaultBounds,
  createWindowLayout,
  getPlaybackTitle,
  getPlayerBoundsForAspectRatio,
  insertWindowAtGroupIndex,
  isVideoPath,
  WORKSPACE_TITLE_BAR_PX,
} from '@/lib/workspace-geometry'
import type { FileDragData } from '@/lib/file-drag-data'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  serializeWorkspaceLayoutState,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import {
  resolveWorkspaceDeferredPresetApply,
  resolveWorkspaceInitialHydration,
} from '@/lib/workspace-bootstrap'
import { useWorkspaceAudio } from '@/lib/workspace-audio-store'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import { getWorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'
import { For, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js'
import { workspaceTabIconColorKeyToHex } from '@/lib/workspace-tab-icon-colors'
import { useThemeStore } from '@/lib/theme-store'
import {
  DEFAULT_FAVICON_DATA_URL,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/dynamic-favicon-core'
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
import { useWorkspacePageLayoutBaseline } from './workspace/workspace-page/use-workspace-page-layout-baseline'
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
  isWorkspaceRoute,
  loadPersisted,
  persistWorkspaceState,
} from './workspace/workspace-page-persistence'

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

  const [layoutPicker, setLayoutPicker] = createSignal<{
    windowId: string
    anchor: DOMRect
  } | null>(null)

  const preferredSnapTick = useStoreSync(useWorkspacePreferredSnapStore)
  const themeTick = useStoreSync(useThemeStore)
  const baseline = useWorkspacePageLayoutBaseline(workspace, setWorkspace)
  const snap = createWorkspaceSnapDragModel({ workspace, setWorkspace, preferredSnapTick })

  const tabChromeRestore = { title: 'Media Server', href: DEFAULT_FAVICON_DATA_URL }
  let tabFaviconGen = 0

  onMount(() => {
    tabChromeRestore.title = document.title
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null
    if (link?.href) tabChromeRestore.href = link.href
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

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    const { key } = storageSessionKeyFull()
    const w = workspace()
    if (!key || !w) return
    if (shareConfig()) {
      persistWorkspaceState(key, w)
      return
    }
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistWorkspaceState(key, w)
    }, 300)
    onCleanup(() => {
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
    })
  })

  createEffect(() => {
    void themeTick()
    const w = workspace()
    if (typeof document === 'undefined') return
    if (!w) return
    const title = (w.browserTabTitle ?? '').trim()
    document.title = title ? `${title} · Media Server` : 'Workspace · Media Server'
    const iconName = (w.browserTabIcon ?? '').trim()
    const gen = ++tabFaviconGen
    if (!iconName) {
      setFaviconHref(tabChromeRestore.href)
      return
    }
    const svg = getLucideIconSvg(iconName)
    if (!svg) {
      setFaviconHref(tabChromeRestore.href)
      return
    }
    const isDark = document.documentElement.getAttribute('data-theme')?.endsWith('-dark')
    const colorKey = (w.browserTabIconColor ?? '').trim()
    const color = workspaceTabIconColorKeyToHex(colorKey) ?? (isDark ? '#ffffff' : '#000000')
    void generateFaviconFromSvg(svg, color).then((data) => {
      if (gen !== tabFaviconGen) return
      if (data) setFaviconHref(data)
    })
  })

  onCleanup(() => {
    if (typeof document === 'undefined') return
    document.title = tabChromeRestore.title
    setFaviconHref(tabChromeRestore.href)
  })

  onMount(() => {
    const flushPersist = () => {
      const k = storageSessionKeyFull().key
      const w = workspace()
      if (k && w) persistWorkspaceState(k, w)
    }
    window.addEventListener('beforeunload', flushPersist)
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushPersist()
    }
    document.addEventListener('visibilitychange', onVis)
    onCleanup(() => {
      window.removeEventListener('beforeunload', flushPersist)
      document.removeEventListener('visibilitychange', onVis)
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
    const maxZ = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1)
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
        const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
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
        let nx = ev.clientX - c.left - grabDx
        let ny = ev.clientY - c.top - grabDy
        nx = Math.max(0, Math.min(nx, c.width - cur.width))
        const maxY = Math.max(0, c.height - WORKSPACE_TITLE_BAR_PX)
        ny = Math.max(0, Math.min(ny, maxY))
        snap.updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
        return
      }

      snap.handleDragPointerMove(tabId, ev.clientX, ev.clientY)
      const cur = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (!cur) return
      let nx = ev.clientX - c.left - grabDx
      let ny = ev.clientY - c.top - grabDy
      nx = Math.max(0, Math.min(nx, c.width - cur.width))
      const maxY = Math.max(0, c.height - WORKSPACE_TITLE_BAR_PX)
      ny = Math.max(0, Math.min(ny, maxY))
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
    const key = storageSessionKeyFull().key
    if (!key) return
    if (!isVideoPath(path)) {
      useWorkspaceAudio.getState().armUserGestureTransport(path)
      useWorkspaceAudio.getState().playAudio(path, dir)
      return
    }
    const w = workspace()
    if (!w) return

    useWorkspaceAudio.getState().setAudioOnly(undefined, false)

    let work: PersistedWorkspaceState = w

    const focusExistingMediaWindow = (target: WorkspaceWindowDefinition) => {
      const maxZ = Math.max(...work.windows.map((x) => x.layout?.zIndex ?? 1), 1) + 1
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
    const zIndex = Math.max(...baseWindows.map((x) => x.layout?.zIndex ?? 1), 1) + 1
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
        createDefaultBounds(baseWindows.length, 'viewer'),
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
        const title = dir.split(/[/\\]/).filter(Boolean).pop() ?? 'Folder'
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
    const sc = shareConfig()
    const source: WorkspaceSource =
      data.sourceKind === 'share'
        ? {
            kind: 'share',
            token: data.sourceToken ?? '',
            sharePath: sc?.sharePath ?? '',
          }
        : { kind: 'local', rootPath: null }
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
    const usePathChrome = typeof dirOpt === 'string' && dirOpt.length > 0
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'browser',
      title: usePathChrome
        ? (dirOpt.split(/[/\\]/).filter(Boolean).pop() ?? 'Folder')
        : `Browser ${n}`,
      iconName: null,
      iconPath: usePathChrome ? dirOpt : '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: usePathChrome ? isVirtualFolderPath(dirOpt) : false,
      source,
      initialState,
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'browser'), n),
    }
    const maxZ = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1)
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
    if (splitBrowserLeft || getWorkspaceFileOpenTarget() === 'new-tab') {
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
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'viewer'), n),
    }
    const maxZ = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1)
    newWin.layout = { ...newWin.layout, zIndex: maxZ + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
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

  function selectPinned(pin: PinnedTaskbarItem) {
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

  const wxAudioTick = useStoreSync(useWorkspaceAudio)

  const playbackPlayingPath = createMemo(() => {
    void wxAudioTick()
    return useWorkspaceAudio.getState().playing ?? null
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
          addPinnedItem={addPinnedItem}
          openInNewTabInSameWindow={openInNewTabInSameWindow}
          openInSplitViewFromBrowserPane={openInSplitViewFromBrowserPane}
          requestPlay={requestPlay}
          updateWindowViewing={updateWindowViewing}
          resizeViewerWindowForVideoMetadata={resizeViewerWindowForVideoMetadata}
          listenOnlyHandoff={listenOnlyHandoffFromWorkspaceViewer}
        />
      </div>
      <WorkspacePageTaskbar
        pageProps={props}
        onOpenBrowser={() => openBrowser()}
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
      />
    </div>
  )
}
