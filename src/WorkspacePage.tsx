import type { GlobalSettings } from '@/lib/use-settings'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import {
  assistGridSpanToBounds,
  assistShapeMatchingSpan,
  detectEdgeAssistGridSpan,
  type AssistGridSpan,
} from '@/lib/workspace-assist-grid'
import { pickAssistSlotFromPoint, type AssistSlotPick } from '@/lib/workspace-snap-pick'
import { snapZonePreviewBoundsForDrag } from '@/lib/workspace-snap-live'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import {
  createDefaultBounds,
  createFullscreenBounds,
  createWindowLayout,
  getPlaybackTitle,
  getPlayerBoundsForAspectRatio,
  getViewportSize,
  isVideoPath,
  PLAYER_WINDOW_ID,
  scaleSnappedWindowsBoundsForCanvasResize,
  snapZoneToBoundsWithOccupied,
  type WorkspaceCanvasSize,
} from '@/lib/workspace-geometry'
import { setFileDragData, type FileDragData } from '@/lib/file-drag-data'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  SnapZone,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
  workspaceSourceToMediaContext,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import {
  workspaceLayoutScopeFromShareToken,
  type WorkspaceLayoutPreset,
} from '@/lib/workspace-layout-presets'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import {
  SNAP_EDGE_THRESHOLD_PX,
  TOP_SNAP_ASSIST_CENTER_HALF_WIDTH_PX,
  TOP_SNAP_ASSIST_KEEPALIVE_PX,
  type SnapDetectResult,
} from '@/lib/use-snap-zones'
import { WORKSPACE_TITLE_BAR_PX } from '@/lib/workspace-snap-live'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { getWorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'
import FolderOpen from 'lucide-solid/icons/folder-open'
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
import { useStoreSync } from './lib/solid-store-sync'
import type { FileIconContext } from './lib/use-file-icon'
import { pinnedShellIcon } from './lib/use-file-icon'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from './browser-history'
import { useAdminEventsStream } from './lib/use-admin-events-stream'
import { applySnapPreviewLayout } from './workspace/snap-preview'
import { WorkspaceSnapAssistBar } from './workspace/WorkspaceSnapAssistBar'
import { WorkspaceTilingPicker } from './workspace/WorkspaceTilingPicker'
import { findMergeTarget, type MergeTarget } from './workspace/merge-target'
import {
  groupIdForWindow,
  mergeWindowIntoGroupState,
  openInNewTabInGroupState,
  orderedAllGroupIds,
  splitWindowFromGroupState,
  tabsInGroup,
} from './workspace/tab-group-ops'
import { TaskbarGroupRow } from './workspace/WorkspaceTaskbarRows'
import { WorkspaceBrowserPane, type WorkspaceShareConfig } from './workspace/WorkspaceBrowserPane'
import { WorkspacePlayerPane } from './workspace/WorkspacePlayerPane'
import { WorkspaceViewerPane } from './workspace/WorkspaceViewerPane'
import { WorkspaceWindowChrome, type WorkspaceBounds } from './workspace/WorkspaceWindowChrome'
import { WorkspaceNamedLayoutMenu } from './workspace/WorkspaceNamedLayoutMenu'
import { WorkspaceTaskbarAudio } from './workspace/WorkspaceTaskbarAudio'
import { WorkspaceTaskbarSettings } from './workspace/WorkspaceTaskbarSettings'
import {
  DEFAULT_WORKSPACE_SOURCE,
  defaultPersistedState,
  isWorkspaceRoute,
  loadPersisted,
  persistWorkspaceState,
} from './workspace/workspace-page-persistence'

type AuthConfig = { enabled: boolean; editableFolders: string[] }

export type WorkspacePageProps = {
  shareConfig?: { token: string; sharePath: string } | null
  shareWorkspaceTaskbarPins?: PinnedTaskbarItem[]
  shareWorkspaceLayoutPresets?: WorkspaceLayoutPreset[]
  shareAllowUpload?: boolean
  shareCanEdit?: boolean
  shareCanDelete?: boolean
  shareIsKnowledgeBase?: boolean
}

export function WorkspacePage(props: WorkspacePageProps = {}) {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const queryClient = useQueryClient()

  const shareConfig = () => props.shareConfig ?? null
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

  let workspaceAreaEl: HTMLDivElement | undefined
  let snapPreviewEl: HTMLDivElement | undefined
  let snapAssistRootEl: HTMLDivElement | undefined
  const [workspaceAreaNode, setWorkspaceAreaNode] = createSignal<HTMLDivElement | null>(null)
  const [workspaceCanvasSize, setWorkspaceCanvasSize] = createSignal<WorkspaceCanvasSize | null>(
    null,
  )
  const [layoutPicker, setLayoutPicker] = createSignal<{
    windowId: string
    anchor: DOMRect
  } | null>(null)
  const [_dragSnapZone, setDragSnapZone] = createSignal<SnapDetectResult | null>(null)
  const [dragSnapWindowId, setDragSnapWindowId] = createSignal<string | null>(null)
  const [snapAssistShown, setSnapAssistShown] = createSignal(false)
  const [snapAssistEngaged, setSnapAssistEngaged] = createSignal(false)
  const [assistHoverPick, setAssistHoverPick] = createSignal<AssistSlotPick | null>(null)
  const [dragEdgeGridSpan, setDragEdgeGridSpan] = createSignal<AssistGridSpan | null>(null)
  const [mergeTargetPreview, setMergeTargetPreview] = createSignal<MergeTarget | null>(null)

  const preferredSnapTick = useStoreSync(useWorkspacePreferredSnapStore)

  let draggedWindowIdForSnap: string | null = null

  function getWorkspaceCanvas(): WorkspaceCanvasSize {
    const s = workspaceCanvasSize()
    if (s && s.width > 0 && s.height > 0) return s
    const el = workspaceAreaEl
    if (el) {
      return {
        width: Math.max(1, Math.round(el.clientWidth)),
        height: Math.max(1, Math.round(el.clientHeight)),
      }
    }
    return getViewportSize()
  }

  function clientInDomRect(clientX: number, clientY: number, r: DOMRect) {
    return clientX >= r.left && clientY >= r.top && clientX <= r.right && clientY <= r.bottom
  }

  const [pinsHydratedFor, setPinsHydratedFor] = createSignal('')

  const [layoutBaselinePresetId, setLayoutBaselinePresetId] = createSignal<string | null>(null)
  const [layoutBaselineSerialized, setLayoutBaselineSerialized] = createSignal<string | null>(null)
  const [layoutBaselineSnapshot, setLayoutBaselineSnapshot] =
    createSignal<PersistedWorkspaceState | null>(null)

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled: !shareConfig(),
  }))

  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<AuthConfig>('/api/auth/config'),
    staleTime: Infinity,
    enabled: !shareConfig(),
  }))

  const editableFolders = createMemo((): string[] => {
    const c = shareConfig()
    if (c?.sharePath) return [c.sharePath]
    return authQuery.data?.editableFolders ?? []
  })

  const sharePanel = createMemo((): WorkspaceShareConfig | null => {
    const c = shareConfig()
    if (!c) return null
    return { token: c.token, sharePath: c.sharePath }
  })

  const serverPinsReady = createMemo(() => (shareConfig() ? true : settingsQuery.isSuccess))

  const serverPinsList = createMemo((): PinnedTaskbarItem[] => {
    if (shareConfig()) return props.shareWorkspaceTaskbarPins ?? []
    return settingsQuery.data?.workspaceTaskbarPins ?? []
  })

  const serverLayoutPresets = createMemo((): WorkspaceLayoutPreset[] => {
    if (shareConfig()) return props.shareWorkspaceLayoutPresets ?? []
    return settingsQuery.data?.workspaceLayoutPresets ?? []
  })

  const presetsReady = createMemo(() => (shareConfig() ? true : settingsQuery.isSuccess))

  const layoutScope = createMemo(() =>
    workspaceLayoutScopeFromShareToken(shareConfig()?.token ?? null),
  )

  const persistPinsMutation = useMutation(() => ({
    mutationFn: (items: PinnedTaskbarItem[]) => {
      const c = shareConfig()
      if (c) {
        return post(`/api/share/${c.token}/workspaceTaskbarPins`, { items })
      }
      return post('/api/settings/workspaceTaskbarPins', { items })
    },
    onSettled: () => {
      const c = shareConfig()
      if (c) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(c.token) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      }
    },
  }))

  let lastHydratedStorageKey = ''

  function collectLayoutSnapshot(): PersistedWorkspaceState {
    const w = workspace()
    if (!w) {
      return {
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 2,
        pinnedTaskbarItems: [],
      }
    }
    return {
      windows: w.windows.filter((x) => x.id !== PLAYER_WINDOW_ID),
      activeWindowId: w.activeWindowId,
      activeTabMap: { ...w.activeTabMap },
      nextWindowId: w.nextWindowId,
      pinnedTaskbarItems: w.pinnedTaskbarItems ?? [],
    }
  }

  function applyLayoutSnapshot(
    snapshot: PersistedWorkspaceState,
    options?: { baselinePresetId?: string | null },
  ) {
    const normalized = normalizePersistedWorkspaceState(snapshot)
    if (!normalized?.windows.length) return
    const clone = JSON.parse(JSON.stringify(normalized)) as PersistedWorkspaceState
    setWorkspace(normalized)
    setLayoutBaselineSerialized(serializeWorkspacePersistedState(clone))
    setLayoutBaselineSnapshot(clone)
    if (options && 'baselinePresetId' in options) {
      setLayoutBaselinePresetId(options.baselinePresetId ?? null)
    }
  }

  function revertLayoutToBaseline() {
    const snap = layoutBaselineSnapshot()
    if (!snap) return
    applyLayoutSnapshot(JSON.parse(JSON.stringify(snap)) as PersistedWorkspaceState)
  }

  function syncLayoutBaselineToCurrent() {
    const snap = collectLayoutSnapshot()
    const clone = JSON.parse(JSON.stringify(snap)) as PersistedWorkspaceState
    setLayoutBaselineSerialized(serializeWorkspacePersistedState(clone))
    setLayoutBaselineSnapshot(clone)
  }

  function declareBaselinePresetId(id: string | null) {
    setLayoutBaselinePresetId(id)
  }

  const isLayoutDirty = createMemo(() => {
    const b = layoutBaselineSerialized()
    if (b == null) return false
    return serializeWorkspacePersistedState(collectLayoutSnapshot()) !== b
  })

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
    void settingsQuery.isSuccess
    void serverLayoutPresets()
    const presetsReadyNow = shareConfig() ? true : settingsQuery.isSuccess
    // Always prefer session draft in localStorage over a named preset in the URL.
    const loaded = loadPersisted(key)
    const src = browserSource()
    const scope = workspaceLayoutScopeFromShareToken(shareConfig()?.token ?? null)
    const presetsList = serverLayoutPresets()

    const applyPreset = (param: string) => {
      const found = presetsList.find((p) => p.id === param && p.scope === scope)
      const normalized = found ? normalizePersistedWorkspaceState(found.snapshot) : null
      if (!normalized?.windows.length) return false
      const clone = JSON.parse(JSON.stringify(normalized)) as PersistedWorkspaceState
      untrack(() => {
        setLayoutBaselinePresetId(param)
        setLayoutBaselineSerialized(serializeWorkspacePersistedState(clone))
        setLayoutBaselineSnapshot(clone)
        setWorkspace(normalized)
      })
      return true
    }

    const resetBaseline = () => {
      setLayoutBaselinePresetId(null)
      setLayoutBaselineSerialized(null)
      setLayoutBaselineSnapshot(null)
    }

    const setDefaultWorkspace = () => {
      resetBaseline()
      setWorkspace(defaultPersistedState(src))
    }

    if (lastHydratedStorageKey !== key) {
      lastHydratedStorageKey = key
      untrack(() => {
        let stripPresetFromUrl = false
        if (dirParam != null && dirParam !== '') {
          resetBaseline()
          setWorkspace({
            windows: [
              {
                id: 'workspace-window-1',
                type: 'browser',
                title: 'Browser 1',
                iconName: null,
                iconPath: dirParam,
                iconType: MediaType.FOLDER,
                iconIsVirtual: false,
                source: src,
                initialState: { dir: dirParam },
                tabGroupId: null,
                layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
              },
            ],
            activeWindowId: 'workspace-window-1',
            activeTabMap: {},
            nextWindowId: 2,
            pinnedTaskbarItems: [],
          })
          stripPresetFromUrl = !!presetParam
        } else if (loaded) {
          resetBaseline()
          setWorkspace(loaded)
          stripPresetFromUrl = !!presetParam
        } else if (presetParam && presetsReadyNow) {
          if (!applyPreset(presetParam)) {
            setDefaultWorkspace()
          }
          stripPresetFromUrl = true
        } else if (presetParam && !presetsReadyNow) {
          // Do not call setDefaultWorkspace(): writing a default draft here blocks the delayed
          // preset apply (second branch below) because loadPersisted(key) becomes truthy.
        } else {
          setDefaultWorkspace()
        }
        if (stripPresetFromUrl) {
          navigateSearchParams({ preset: null }, 'replace')
        }
        setPinsHydratedFor('')
      })
      return
    }

    if (presetParam && presetsReadyNow && !loadPersisted(key)) {
      untrack(() => {
        applyPreset(presetParam)
        navigateSearchParams({ preset: null }, 'replace')
        setPinsHydratedFor('')
      })
    }
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
    const el = workspaceAreaNode()
    if (!el) return
    let lastW = Math.round(el.clientWidth)
    let lastH = Math.round(el.clientHeight)
    if (lastW > 0 && lastH > 0) {
      setWorkspaceCanvasSize({ width: lastW, height: lastH })
    }
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      if (w <= 0 || h <= 0) return
      if (w === lastW && h === lastH) return
      if (lastW <= 0 || lastH <= 0) {
        lastW = w
        lastH = h
        setWorkspaceCanvasSize({ width: w, height: h })
        return
      }
      setWorkspace((prev) => {
        if (!prev) return prev
        const scaled = scaleSnappedWindowsBoundsForCanvasResize(
          prev.windows,
          { width: lastW, height: lastH },
          { width: w, height: h },
        )
        return { ...prev, windows: scaled }
      })
      lastW = w
      lastH = h
      setWorkspaceCanvasSize({ width: w, height: h })
    })
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  })

  createEffect(() => {
    if (!serverPinsReady()) return
    const { key } = storageSessionKeyFull()
    const w = workspace()
    if (!key || !w) return
    if (pinsHydratedFor() === key) return

    const serverPins = serverPinsList()
    untrack(() => {
      if (serverPins.length > 0) {
        setWorkspace((prev) => (prev ? { ...prev, pinnedTaskbarItems: serverPins } : prev))
      } else if ((w.pinnedTaskbarItems?.length ?? 0) > 0) {
        void persistPinsMutation.mutateAsync(w.pinnedTaskbarItems ?? [])
      }
    })
    setPinsHydratedFor(key)
  })

  function focusWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const target = w.windows.find((x) => x.id === windowId)
    if (!target) return
    const gid = groupIdForWindow(target)
    const leader = tabsInGroup(w.windows, gid)[0]
    const groupMinimized = leader?.layout?.minimized ?? false
    if (w.activeWindowId === windowId && !groupMinimized) return
    const maxZ = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1)
    const newZ = maxZ + 1
    setWorkspace({
      ...w,
      activeWindowId: windowId,
      activeTabMap: { ...w.activeTabMap, [gid]: windowId },
      windows: w.windows.map((win) =>
        groupIdForWindow(win) === gid
          ? { ...win, layout: { ...win.layout, zIndex: newZ, minimized: false } }
          : win,
      ),
    })
  }

  function dismissFloatingPlayerForViewer(focusWindowId: string) {
    setWorkspace((w) => {
      if (!w || !w.windows.some((x) => x.id === PLAYER_WINDOW_ID)) return w
      const next = w.windows.filter((x) => x.id !== PLAYER_WINDOW_ID)
      let activeWindowId = w.activeWindowId
      if (activeWindowId === PLAYER_WINDOW_ID) {
        activeWindowId = focusWindowId
      }
      return { ...w, windows: next, activeWindowId }
    })
  }

  function closeWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const t = w.windows.find((x) => x.id === windowId)
    const gid = t ? groupIdForWindow(t) : windowId
    const toRemove = new Set(w.windows.filter((x) => groupIdForWindow(x) === gid).map((x) => x.id))
    const key = storageSessionKeyFull().key
    for (const id of toRemove) {
      if (id === PLAYER_WINDOW_ID) {
        useWorkspacePlaybackStore.getState().closePlayer(key)
      }
    }
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
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            activeTabMap: { ...prev.activeTabMap, [groupId]: tabId },
            activeWindowId: tabId,
          }
        : prev,
    )
  }

  function closeTab(tabId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      if (tabId === PLAYER_WINDOW_ID) {
        useWorkspacePlaybackStore.getState().closePlayer(storageSessionKeyFull().key)
      }
      const victim = prev.windows.find((w) => w.id === tabId)
      if (!victim) return prev
      const gid = groupIdForWindow(victim)
      const members = prev.windows.filter((w) => groupIdForWindow(w) === gid)
      if (members.length <= 1) {
        const next = prev.windows.filter((w) => w.id !== tabId)
        let active = prev.activeWindowId
        if (active === tabId) active = next[next.length - 1]?.id ?? active
        const nextMap = { ...prev.activeTabMap }
        delete nextMap[gid]
        return { ...prev, windows: next, activeWindowId: active, activeTabMap: nextMap }
      }
      let next = prev.windows.filter((w) => w.id !== tabId)
      const still = next.filter((w) => groupIdForWindow(w) === gid)
      const nextMap = { ...prev.activeTabMap }
      if (still.length === 1) {
        next = next.map((w) => (w.id === still[0].id ? { ...w, tabGroupId: null } : w))
        delete nextMap[gid]
      } else if (prev.activeTabMap[gid] === tabId) {
        nextMap[gid] = still[0]?.id ?? prev.activeTabMap[gid]
      }
      let active = prev.activeWindowId
      if (active === tabId) {
        active = nextMap[gid] ?? still[0]?.id ?? next[next.length - 1]?.id ?? active
      }
      return { ...prev, windows: next, activeWindowId: active, activeTabMap: nextMap }
    })
  }

  function handleTabPullStart(groupId: string, tabId: string, e: PointerEvent) {
    const c = workspaceAreaEl?.getBoundingClientRect()
    if (!c) return

    const prev = workspace()
    if (!prev) return
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

        handleDragPointerMove(tabId, ev.clientX, ev.clientY)
        const cur = next.windows.find((w) => w.id === tabId)?.layout?.bounds ?? wb
        let nx = ev.clientX - c.left - grabDx
        let ny = ev.clientY - c.top - grabDy
        nx = Math.max(0, Math.min(nx, c.width - cur.width))
        const maxY = Math.max(0, c.height - WORKSPACE_TITLE_BAR_PX)
        ny = Math.max(0, Math.min(ny, maxY))
        updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
        return
      }

      handleDragPointerMove(tabId, ev.clientX, ev.clientY)
      const cur = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (!cur) return
      let nx = ev.clientX - c.left - grabDx
      let ny = ev.clientY - c.top - grabDy
      nx = Math.max(0, Math.min(nx, c.width - cur.width))
      const maxY = Math.max(0, c.height - WORKSPACE_TITLE_BAR_PX)
      ny = Math.max(0, Math.min(ny, maxY))
      updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
    }

    const onUp = (ev: PointerEvent) => {
      cleanup()
      if (!pulled) return
      const final = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (final) {
        onDragPointerEnd(tabId, final, ev.clientX, ev.clientY)
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
    useWorkspacePlaybackStore.getState().playFile(key, path, dir)
    const mediaKind = isVideoPath(path) ? 'video' : 'audio'
    useMediaPlayer.getState().startOrResumePlayback(path, mediaKind)
    const w = workspace()
    if (!w) return
    if (!isVideoPath(path)) {
      const next = w.windows.filter((x) => x.id !== PLAYER_WINDOW_ID)
      let active = w.activeWindowId
      if (active === PLAYER_WINDOW_ID) {
        active = next[next.length - 1]?.id ?? active
      }
      setWorkspace({ ...w, windows: next, activeWindowId: active })
      return
    }
    const zIndex = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1) + 1
    const existing = w.windows.find((win) => win.id === PLAYER_WINDOW_ID)
    let nextWindows: WorkspaceWindowDefinition[]
    if (!existing) {
      const newWin: WorkspaceWindowDefinition = {
        id: PLAYER_WINDOW_ID,
        type: 'player',
        title: getPlaybackTitle(path),
        iconName: null,
        iconPath: path,
        iconType: MediaType.VIDEO,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(
          undefined,
          createDefaultBounds(w.windows.length, 'player'),
          zIndex,
        ),
      }
      nextWindows = [...w.windows, newWin]
    } else {
      nextWindows = w.windows.map((win) =>
        win.id === PLAYER_WINDOW_ID
          ? {
              ...win,
              title: getPlaybackTitle(path),
              iconPath: path,
              iconType: MediaType.VIDEO,
              iconIsVirtual: false,
              source,
              layout: { ...win.layout, minimized: false, zIndex },
            }
          : win,
      )
    }
    setWorkspace({
      ...w,
      windows: nextWindows,
      activeWindowId: PLAYER_WINDOW_ID,
    })
  }

  function resizePlayerWindowForVideoMetadata(videoWidth: number, videoHeight: number) {
    if (videoWidth <= 0 || videoHeight <= 0) return
    const aspect = videoWidth / videoHeight
    setWorkspace((prev) => {
      if (!prev) return prev
      const player = prev.windows.find((x) => x.id === PLAYER_WINDOW_ID)
      if (!player || player.type !== 'player') return prev
      const currentBounds = player.layout?.bounds ?? null
      const newBounds = getPlayerBoundsForAspectRatio(aspect, currentBounds)
      const pb = player.layout?.bounds
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
          win.id === PLAYER_WINDOW_ID
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
      windows: w.windows.map((win) =>
        win.id === windowId ? { ...win, initialState: { ...win.initialState, dir } } : win,
      ),
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
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'browser',
      title: `Browser ${n}`,
      iconName: null,
      iconPath: '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
      source,
      initialState: options?.initialState?.dir != null ? { dir: options.initialState.dir } : {},
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
    if (getWorkspaceFileOpenTarget() === 'new-tab') {
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
    const customIcons = settingsQuery.data?.customIcons ?? {}
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
    void persistPinsMutation.mutateAsync(next)
  }

  function removePinnedItem(id: string) {
    const w = workspace()
    if (!w) return
    const next = (w.pinnedTaskbarItems ?? []).filter((p) => p.id !== id)
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void persistPinsMutation.mutateAsync(next)
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

  function getZoneBoundsForDrag(zone: SnapZone): WorkspaceBounds {
    const edge = dragEdgeGridSpan()
    const canvas = getWorkspaceCanvas()
    if (edge) {
      return assistGridSpanToBounds(canvas, edge)
    }
    const w = workspace()
    if (!w) return snapZoneToBoundsWithOccupied(zone, [], canvas)
    const ex = draggedWindowIdForSnap
    const excludeW = ex ? w.windows.find((x) => x.id === ex) : null
    const excludeGid = excludeW ? groupIdForWindow(excludeW) : null
    const occupied = w.windows
      .filter(
        (x) =>
          x.layout?.snapZone &&
          x.layout.bounds &&
          (excludeGid == null || groupIdForWindow(x) !== excludeGid),
      )
      .map((x) => ({ bounds: x.layout!.bounds!, snapZone: x.layout!.snapZone! }))
    void preferredSnapTick()
    const shape = useWorkspacePreferredSnapStore.getState().assistGridShape
    return snapZonePreviewBoundsForDrag(zone, canvas, w.windows, occupied, shape)
  }

  function handleDragPointerMove(windowId: string, clientX: number, clientY: number) {
    draggedWindowIdForSnap = windowId
    setDragSnapWindowId(windowId)
    const c = workspaceAreaEl
    const p = snapPreviewEl

    const ws = workspace()
    const hit = ws && c ? findMergeTarget(ws.windows, windowId, clientX, clientY) : null
    setMergeTargetPreview(hit)

    if (!c) return

    if (ws && hit) {
      setSnapAssistEngaged(false)
      setSnapAssistShown(false)
      setAssistHoverPick(null)
      setDragEdgeGridSpan(null)
      setDragSnapZone(null)
      applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag)
      return
    }

    const rect = c.getBoundingClientRect()
    const lx = clientX - rect.left
    const ly = clientY - rect.top
    void preferredSnapTick()
    const st = useWorkspacePreferredSnapStore.getState()
    const shape = st.assistGridShape
    const assistOn = st.snapAssistOnTopDrag
    const nearTop = ly <= SNAP_EDGE_THRESHOLD_PX
    const topInnerBand =
      assistOn && nearTop && Math.abs(lx - rect.width / 2) <= TOP_SNAP_ASSIST_CENTER_HALF_WIDTH_PX
    const assistRect = snapAssistRootEl?.getBoundingClientRect()
    const overAssistPanel =
      assistOn && assistRect ? clientInDomRect(clientX, clientY, assistRect) : false

    if (topInnerBand || overAssistPanel) {
      setSnapAssistEngaged(true)
    }

    const inAssistKeepaliveCorridor =
      assistOn && snapAssistEngaged() && ly <= TOP_SNAP_ASSIST_KEEPALIVE_PX

    const edgeSpan = detectEdgeAssistGridSpan(lx, ly, rect.width, rect.height, shape, {
      suppressTopEdgeSpans: false,
    })
    setDragEdgeGridSpan(edgeSpan)

    let z: SnapDetectResult | null = edgeSpan ? 'edge-grid' : null

    if (assistOn && snapAssistEngaged() && (overAssistPanel || inAssistKeepaliveCorridor)) {
      setSnapAssistShown(true)
    } else {
      setSnapAssistShown(false)
      if (
        assistOn &&
        snapAssistEngaged() &&
        !topInnerBand &&
        !overAssistPanel &&
        !inAssistKeepaliveCorridor
      ) {
        setSnapAssistEngaged(false)
      }
    }

    setDragSnapZone(z)
    if (p) applySnapPreviewLayout(p, z, c, getZoneBoundsForDrag)

    const assistBarVisible =
      assistOn && snapAssistEngaged() && (overAssistPanel || ly <= TOP_SNAP_ASSIST_KEEPALIVE_PX)
    if (assistBarVisible && snapAssistRootEl) {
      setAssistHoverPick(pickAssistSlotFromPoint(clientX, clientY, snapAssistRootEl))
    } else {
      setAssistHoverPick(null)
    }
  }

  function restoreDrag(
    windowId: string,
    clientX: number,
    _clientY: number,
  ): WorkspaceBounds | undefined {
    const w = workspace()
    const container = workspaceAreaEl?.getBoundingClientRect()
    if (!w || !container) return
    const win = w.windows.find((x) => x.id === windowId)
    if (!win) return
    const currentBounds = win.layout?.bounds
    const restoreBounds = win.layout?.restoreBounds
    const restoredW = restoreBounds?.width ?? currentBounds?.width ?? 500
    const restoredH = restoreBounds?.height ?? currentBounds?.height ?? 260
    const currentWidth = currentBounds?.width ?? restoredW
    const oX = container.left
    const grabRatio = currentBounds
      ? Math.min(Math.max((clientX - oX - currentBounds.x) / currentWidth, 0), 1)
      : 0.5
    const newX = clientX - oX - restoredW * grabRatio
    const newY = currentBounds?.y ?? 0
    unsnapWindow(windowId, { x: newX, y: newY })
    return { x: newX, y: newY, width: restoredW, height: restoredH }
  }

  function unsnapWindow(windowId: string, drop: { x: number; y: number } | null) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      return {
        ...prev,
        windows: prev.windows.map((w) => {
          if (gid && groupIdForWindow(w) !== gid) return w
          if (!gid && w.id !== windowId) return w
          const restored = w.layout?.restoreBounds ?? w.layout?.bounds
          return {
            ...w,
            layout: {
              ...w.layout,
              snapZone: null,
              fullscreen: false,
              bounds:
                drop && restored
                  ? { x: drop.x, y: drop.y, width: restored.width, height: restored.height }
                  : (restored ?? w.layout?.bounds ?? null),
              restoreBounds: null,
            },
          }
        }),
      }
    })
  }

  function snapWindowToAssistCustom(windowId: string, bounds: WorkspaceBounds) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      const canvas = getWorkspaceCanvas()
      const b: WorkspaceBounds = {
        x: Math.max(0, Math.min(bounds.x, canvas.width - 100)),
        y: Math.max(0, Math.min(bounds.y, canvas.height - 100)),
        width: Math.min(Math.max(bounds.width, 100), canvas.width),
        height: Math.min(Math.max(bounds.height, 100), canvas.height),
      }
      return {
        ...prev,
        activeWindowId: windowId,
        windows: prev.windows.map((w) => {
          if (gid && groupIdForWindow(w) !== gid) return w
          if (!gid && w.id !== windowId) return w
          return {
            ...w,
            layout: {
              ...w.layout,
              fullscreen: false,
              snapZone: 'assist-custom',
              minimized: false,
              zIndex: maxZ + 1,
              bounds: b,
              restoreBounds: w.layout?.restoreBounds ?? w.layout?.bounds ?? null,
            },
          }
        }),
      }
    })
  }

  function toggleFullscreenWindow(windowId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
      return {
        ...prev,
        activeWindowId: windowId,
        windows: prev.windows.map((w) => {
          const inGroup = gid && groupIdForWindow(w) === gid
          const solo = !gid && w.id === windowId
          if (!inGroup && !solo) return w
          const currentBounds = w.layout?.bounds ?? createDefaultBounds(0, w.type)
          const isFs = w.layout?.fullscreen ?? false
          return {
            ...w,
            layout: {
              ...w.layout,
              fullscreen: !isFs,
              snapZone: null,
              minimized: false,
              zIndex: maxZ + 1,
              bounds: isFs
                ? (w.layout?.restoreBounds ?? currentBounds)
                : createFullscreenBounds(getWorkspaceCanvas()),
              restoreBounds: isFs ? null : currentBounds,
            },
          }
        }),
      }
    })
  }

  function setWindowMinimized(windowId: string, minimized: boolean) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      return {
        ...prev,
        windows: prev.windows.map((w) =>
          gid && groupIdForWindow(w) === gid
            ? { ...w, layout: { ...w.layout, minimized } }
            : !gid && w.id === windowId
              ? { ...w, layout: { ...w.layout, minimized } }
              : w,
        ),
      }
    })
  }

  function updateWindowBounds(windowId: string, bounds: WorkspaceBounds) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      return {
        ...prev,
        windows: prev.windows.map((w) =>
          gid && groupIdForWindow(w) === gid
            ? { ...w, layout: { ...w.layout, bounds } }
            : w.id === windowId
              ? { ...w, layout: { ...w.layout, bounds } }
              : w,
        ),
      }
    })
  }

  function resizeSnappedWindowBounds(windowId: string, bounds: WorkspaceBounds, direction: string) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            windows: computeSnappedResizeWindows(prev.windows, windowId, bounds, direction),
          }
        : prev,
    )
  }

  function clearSnapAssistDragUi() {
    setSnapAssistShown(false)
    setSnapAssistEngaged(false)
    setAssistHoverPick(null)
    setDragEdgeGridSpan(null)
    setDragSnapWindowId(null)
    setMergeTargetPreview(null)
    draggedWindowIdForSnap = null
  }

  function onDragPointerEnd(
    windowId: string,
    bounds: WorkspaceBounds,
    clientX: number,
    clientY: number,
  ) {
    const edgeSpanEnd = dragEdgeGridSpan()
    const hadAssistUi = snapAssistShown()
    const assistRootAtEnd = snapAssistRootEl
    const c = workspaceAreaEl
    const p = snapPreviewEl
    if (c && p) applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag)
    setDragSnapZone(null)
    setDragEdgeGridSpan(null)

    const wsMerge = workspace()
    if (wsMerge) {
      const hit = findMergeTarget(wsMerge.windows, windowId, clientX, clientY)
      if (hit) {
        const targetWindow = wsMerge.windows.find((w) => groupIdForWindow(w) === hit.groupId)
        if (targetWindow) {
          clearSnapAssistDragUi()
          setWorkspace((prev) =>
            prev
              ? mergeWindowIntoGroupState(prev, windowId, targetWindow.id, hit.insertIndex)
              : prev,
          )
          return
        }
      }
    }

    if (hadAssistUi && assistRootAtEnd?.isConnected) {
      const picked = pickAssistSlotFromPoint(clientX, clientY, assistRootAtEnd)
      const assistRect = assistRootAtEnd.getBoundingClientRect()
      const inAssist = clientInDomRect(clientX, clientY, assistRect)

      if (inAssist && !picked) {
        clearSnapAssistDragUi()
        updateWindowBounds(windowId, bounds)
        return
      }

      if (picked) {
        clearSnapAssistDragUi()
        const matched = assistShapeMatchingSpan(picked.span)
        if (matched) {
          useWorkspacePreferredSnapStore.getState().setAssistGridShape(matched)
        }
        const snapB = assistGridSpanToBounds(getWorkspaceCanvas(), picked.span)
        snapWindowToAssistCustom(windowId, snapB)
        return
      }
    }

    clearSnapAssistDragUi()

    if (edgeSpanEnd) {
      snapWindowToAssistCustom(windowId, assistGridSpanToBounds(getWorkspaceCanvas(), edgeSpanEnd))
      return
    }

    const w = workspace()?.windows.find((x) => x.id === windowId)
    if (w?.layout?.snapZone || w?.layout?.fullscreen) {
      unsnapWindow(windowId, { x: bounds.x, y: bounds.y })
      return
    }
    updateWindowBounds(windowId, bounds)
  }

  const [pinMenu, setPinMenu] = createSignal<{
    x: number
    y: number
    pinId: string
  } | null>(null)

  const [playbackPlayingPath, setPlaybackPlayingPath] = createSignal<string | null>(null)
  createEffect(() => {
    const key = storageSessionKeyFull().key
    if (!key) return
    const read = () => useWorkspacePlaybackStore.getState().byKey[key]?.playing ?? null
    setPlaybackPlayingPath(read())
    const unsub = useWorkspacePlaybackStore.subscribe(() => setPlaybackPlayingPath(read()))
    onCleanup(unsub)
  })

  const mediaIconTick = useStoreSync(useMediaPlayer)

  const workspaceFileIconContext = (): FileIconContext => {
    void mediaIconTick()
    const st = useMediaPlayer.getState()
    const sp = sharePanel()
    return {
      customIcons: settingsQuery.data?.customIcons ?? {},
      knowledgeBases: settingsQuery.data?.knowledgeBases ?? [],
      playingPath: playbackPlayingPath(),
      currentFile: st.currentFile,
      mediaPlayerIsPlaying: st.isPlaying,
      mediaType: st.mediaType,
      mediaShare: sp ? { token: sp.token, sharePath: sp.sharePath } : null,
    }
  }

  const taskbarMouseHandled = { current: false }
  const taskbarGroupIds = createMemo(() => orderedAllGroupIds(workspace()?.windows ?? []))
  const taskbarActiveWindowId = createMemo(() => workspace()?.activeWindowId ?? null)

  createEffect(() => {
    const m = pinMenu()
    if (!m) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-pin-context-menu]')) return
      setPinMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    onCleanup(() => document.removeEventListener('mousedown', onDoc))
  })

  const renderedGroupIds = createMemo(() => orderedAllGroupIds(workspace()?.windows ?? []))
  const pinnedItems = createMemo(() => workspace()?.pinnedTaskbarItems ?? [])
  const pinnedItemsForTaskbar = createMemo(() => {
    void mediaIconTick()
    void playbackPlayingPath()
    return pinnedItems()
  })
  const hasWorkspaceWindows = createMemo(() => (workspace()?.windows.length ?? 0) > 0)
  const hasAnyTaskbarItems = createMemo(
    () => pinnedItems().length > 0 || taskbarGroupIds().length > 0,
  )

  /** Solid <For> passes props.each to mapArray as the list; it must be an array, not a memo fn. */
  const taskbarWindowRows = createMemo(() => {
    void mediaIconTick()
    void playbackPlayingPath()
    return (
      <For each={taskbarGroupIds()}>
        {(groupId) => (
          <TaskbarGroupRow
            groupId={groupId}
            workspace={workspace}
            activeWindowId={taskbarActiveWindowId}
            playingPath={playbackPlayingPath}
            fileIconContext={workspaceFileIconContext}
            taskbarMouseHandled={taskbarMouseHandled}
            focusWindow={focusWindow}
            setWindowMinimized={setWindowMinimized}
            closeWindow={closeWindow}
          />
        )}
      </For>
    )
  })

  return (
    <div class='workspace-layout pointer-events-auto fixed inset-0 flex flex-col overflow-hidden bg-background select-none'>
      <div
        class='relative min-h-0 flex-1 overflow-hidden'
        ref={(el) => {
          workspaceAreaEl = el ?? undefined
          setWorkspaceAreaNode(el)
        }}
      >
        <Show
          when={hasWorkspaceWindows()}
          fallback={
            <div class='flex h-full items-center justify-center p-6'>
              <div class='w-full max-w-md rounded-xl border border-border bg-card/95 p-8 text-center shadow-2xl backdrop-blur'>
                <div class='space-y-3'>
                  <div class='text-lg font-medium'>No windows are open</div>
                  <div class='text-sm text-muted-foreground'>
                    Start a browser window to build your workspace.
                  </div>
                  <button
                    type='button'
                    class='inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90'
                    onClick={() => openBrowser()}
                  >
                    Open Browser
                  </button>
                </div>
              </div>
            </div>
          }
        >
          <div
            ref={(el) => {
              snapPreviewEl = el ?? undefined
            }}
            data-snap-preview
            class='pointer-events-none absolute rounded-sm border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
            style={{ display: 'none', 'z-index': 99999 }}
          />
          <Show when={workspaceAreaNode()}>
            {(area) => (
              <WorkspaceSnapAssistBar
                container={area()}
                visible={snapAssistShown()}
                hoverPick={assistHoverPick()}
                rootRef={(el) => {
                  snapAssistRootEl = el
                }}
              />
            )}
          </Show>
          <For each={renderedGroupIds()}>
            {(gid) => {
              void mediaIconTick()
              void playbackPlayingPath()
              const tabs = () => tabsInGroup(workspace()?.windows ?? [], gid)
              const leader = () => tabs()[0]
              const visibleTabId = () => workspace()?.activeTabMap[gid] ?? leader()?.id ?? ''
              const tabList = () => tabs()
              const tabIds = createMemo(() => tabs().map((w) => w.id))
              return (
                <Show when={leader()}>
                  <WorkspaceWindowChrome
                    leaderWindowId={leader()!.id}
                    groupId={gid}
                    tabWindows={tabList}
                    visibleTabId={visibleTabId}
                    workspace={workspace}
                    fileIconContext={workspaceFileIconContext}
                    isActive={visibleTabId() === workspace()?.activeWindowId}
                    containerEl={() => workspaceAreaEl}
                    onFocusWindow={focusWindow}
                    onClose={closeWindow}
                    onMinimize={(id) => setWindowMinimized(id, true)}
                    onToggleFullscreen={toggleFullscreenWindow}
                    onOpenLayoutPicker={(wid, rect) =>
                      setLayoutPicker({ windowId: wid, anchor: rect })
                    }
                    onRestoreDrag={restoreDrag}
                    onDragPointerMove={handleDragPointerMove}
                    onDragPointerEnd={onDragPointerEnd}
                    onDragDuringMove={updateWindowBounds}
                    onResizeSnapped={resizeSnappedWindowBounds}
                    onUpdateBounds={updateWindowBounds}
                    onSelectTab={setActiveTab}
                    onCloseTab={closeTab}
                    onTabPullStart={handleTabPullStart}
                    mergeTargetPreview={mergeTargetPreview}
                    draggingWindowId={dragSnapWindowId}
                    onDropFileToTabBar={(data, insertIndex) =>
                      dropFileToTabBar(leader()!.id, data, insertIndex)
                    }
                  >
                    <For each={tabIds()}>
                      {(tabId) => {
                        const windowDef = createMemo(() => tabs().find((w) => w.id === tabId))
                        return (
                          <div
                            data-testid={
                              tabId === visibleTabId()
                                ? 'workspace-window-visible-content'
                                : undefined
                            }
                            class={`workspace-window-content relative h-full min-h-0 flex-1 overflow-hidden text-sm text-muted-foreground ${
                              tabId === visibleTabId() ? '' : 'hidden'
                            }`}
                            aria-hidden={tabId !== visibleTabId()}
                          >
                            <Show when={windowDef()?.type === 'browser'}>
                              <WorkspaceBrowserPane
                                windowId={tabId}
                                workspace={workspace}
                                sharePanel={sharePanel}
                                shareAllowUpload={props.shareAllowUpload ?? false}
                                shareCanEdit={
                                  props.shareConfig ? (props.shareCanEdit ?? false) : false
                                }
                                shareCanDelete={
                                  props.shareConfig ? (props.shareCanDelete ?? false) : false
                                }
                                shareIsKnowledgeBase={props.shareIsKnowledgeBase ?? false}
                                editableFolders={editableFolders()}
                                fileIconContext={workspaceFileIconContext}
                                onNavigateDir={navigateDir}
                                onOpenViewer={openViewerFromBrowser}
                                onAddToTaskbar={addPinnedItem}
                                onOpenInNewTab={(wid, file, path) =>
                                  openInNewTabInSameWindow(wid, file, path)
                                }
                                onRequestPlay={requestPlay}
                              />
                            </Show>
                            <Show when={windowDef()?.type === 'viewer'}>
                              <WorkspaceViewerPane
                                windowId={tabId}
                                storageKey={storageSessionKeyFull().key}
                                contentVisible={() => tabId === visibleTabId()}
                                workspace={workspace}
                                sharePanel={sharePanel}
                                editableFolders={editableFolders()}
                                shareCanEdit={
                                  props.shareConfig ? (props.shareCanEdit ?? false) : false
                                }
                                onUpdateViewing={updateWindowViewing}
                                onDismissFloatingPlayer={dismissFloatingPlayerForViewer}
                              />
                            </Show>
                            <Show when={windowDef()?.type === 'player'}>
                              <WorkspacePlayerPane
                                windowId={tabId}
                                storageKey={storageSessionKeyFull().key}
                                window={() => workspace()?.windows.find((w) => w.id === tabId)}
                                shareFallback={sharePanel}
                                onVideoMetadataLoaded={resizePlayerWindowForVideoMetadata}
                              />
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </WorkspaceWindowChrome>
                </Show>
              )
            }}
          </For>
          <Show when={layoutPicker()}>
            {(get) => {
              const p = get()
              const c = workspaceAreaEl
              if (!c) return null
              return (
                <WorkspaceTilingPicker
                  anchorRect={p.anchor}
                  container={c}
                  onSelectSpan={(span) => {
                    const r = c.getBoundingClientRect()
                    const canvas = { width: Math.max(1, r.width), height: Math.max(1, r.height) }
                    const matched = assistShapeMatchingSpan(span)
                    if (matched) {
                      useWorkspacePreferredSnapStore.getState().setAssistGridShape(matched)
                    }
                    snapWindowToAssistCustom(p.windowId, assistGridSpanToBounds(canvas, span))
                    setLayoutPicker(null)
                  }}
                  onClose={() => setLayoutPicker(null)}
                />
              )
            }}
          </Show>
        </Show>
      </div>

      <div class='relative bg-background px-3' style={{ 'z-index': '999999' }}>
        <div class='flex h-8 items-center gap-2'>
          <button
            type='button'
            title='Open browser window'
            class='flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400'
            onClick={() => openBrowser()}
          >
            <FolderOpen class='h-5 w-5' stroke-width={1.75} />
          </button>

          <div class='flex min-w-0 flex-1 items-center overflow-x-auto'>
            <Show when={hasAnyTaskbarItems()}>
              <Show when={pinnedItems().length > 0}>
                <div class='flex shrink-0 items-center gap-2'>
                  <For each={pinnedItemsForTaskbar()}>
                    {(pin) => {
                      const tooltip = `${pin.isDirectory ? 'Folder' : 'File'}: ${pin.path}`
                      return (
                        <div
                          class='flex shrink-0 items-center justify-center py-1 px-0.5'
                          data-taskbar-pin
                          draggable='true'
                          on:dragstart={(e: DragEvent) => {
                            const dt = e.dataTransfer
                            if (!dt) return
                            const d: FileDragData = {
                              path: pin.path,
                              isDirectory: pin.isDirectory,
                              sourceKind: pin.source.kind,
                              sourceToken: pin.source.token,
                            }
                            setFileDragData(dt, d)
                            dt.effectAllowed = 'copy'
                          }}
                        >
                          <div
                            role='button'
                            tabindex={0}
                            title={tooltip}
                            aria-label={tooltip}
                            class='flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none'
                            onClick={() => selectPinned(pin)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                selectPinned(pin)
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setPinMenu({ x: e.clientX, y: e.clientY, pinId: pin.id })
                            }}
                          >
                            {pinnedShellIcon(
                              pin,
                              settingsQuery.data?.customIcons ?? {},
                              workspaceFileIconContext(),
                            )}
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
              <Show when={pinnedItems().length > 0 && taskbarGroupIds().length > 0}>
                <div class='w-2 shrink-0' aria-hidden />
              </Show>
              <div class='flex min-w-0 flex-1 items-center gap-0 overflow-x-auto'>
                {taskbarWindowRows()}
              </div>
            </Show>
            <Show when={!hasAnyTaskbarItems()}>
              <div class='text-sm text-muted-foreground'>
                No windows open. Use the browser button to start a workspace.
              </div>
            </Show>
          </div>

          <div class='flex shrink-0 items-center gap-1 border-l border-border pl-2'>
            <Show when={isLayoutDirty()}>
              <span
                data-testid='workspace-layout-modified-badge'
                class='mr-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-400'
                title={
                  layoutBaselinePresetId()
                    ? 'Layout changed since this saved preset was applied'
                    : 'Layout changed since the last baseline'
                }
              >
                Modified
              </span>
            </Show>
            <WorkspaceTaskbarAudio
              storageKey={() => storageSessionKeyFull().key}
              shareCtx={() => {
                const c = workspaceSourceToMediaContext(browserSource())
                if (!c?.shareToken || !c.sharePath) return null
                return { token: c.shareToken, sharePath: c.sharePath }
              }}
              onShowVideo={() => {
                const key = storageSessionKeyFull().key
                const path = key
                  ? (useWorkspacePlaybackStore.getState().byKey[key]?.playing ?? null)
                  : null
                if (!path) return
                const dir = key ? useWorkspacePlaybackStore.getState().byKey[key]?.dir : undefined
                const w = workspace()
                const viewerWin = w?.windows.find(
                  (win) => win.type === 'viewer' && win.initialState?.viewing === path,
                )
                if (viewerWin) {
                  focusWindow(viewerWin.id)
                  return
                }
                requestPlay(browserSource(), path, dir ?? undefined)
              }}
            />
            <WorkspaceNamedLayoutMenu
              scope={layoutScope()}
              shareToken={shareConfig()?.token ?? null}
              presets={serverLayoutPresets()}
              presetsReady={presetsReady()}
              collectLayoutSnapshot={collectLayoutSnapshot}
              applyLayoutSnapshot={applyLayoutSnapshot}
              syncLayoutBaselineToCurrent={syncLayoutBaselineToCurrent}
              revertLayoutToBaseline={revertLayoutToBaseline}
              declareBaselinePresetId={declareBaselinePresetId}
              isLayoutDirty={isLayoutDirty()}
              layoutBaselinePresetId={layoutBaselinePresetId()}
            />
            <WorkspaceTaskbarSettings />
          </div>
        </div>
      </div>

      <Show when={pinMenu()}>
        {(get) => {
          const m = get()
          return (
            <div
              data-pin-context-menu
              class='fixed z-[1000000] min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
              style={{ left: `${m.x}px`, top: `${m.y}px` }}
              role='menu'
            >
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  removePinnedItem(m.pinId)
                  setPinMenu(null)
                }}
              >
                Unpin
              </button>
            </div>
          )
        }}
      </Show>
    </div>
  )
}
