import { isVirtualFolderPath } from '@/lib/constants'
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
  insertWindowAtGroupIndex,
  isVideoPath,
  scaleSnappedWindowsBoundsForCanvasResize,
  snapZoneToBoundsWithOccupied,
  WORKSPACE_TITLE_BAR_PX,
  type WorkspaceCanvasSize,
} from '@/lib/workspace-geometry'
import { setFileDragData, type FileDragData } from '@/lib/file-drag-data'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  SnapZone,
  TabGroupSplitState,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspaceLayoutState,
  workspaceSourceToMediaContext,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import {
  workspaceLayoutScopeFromShareToken,
  type WorkspaceLayoutPreset,
} from '@/lib/workspace-layout-presets'
import { useWorkspaceAudio } from '@/lib/workspace-audio-store'
import {
  SNAP_EDGE_THRESHOLD_PX,
  TOP_SNAP_ASSIST_CENTER_HALF_WIDTH_PX,
  TOP_SNAP_ASSIST_KEEPALIVE_PX,
  type SnapDetectResult,
} from '@/lib/use-snap-zones'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { FLOATING_Z_PIN_MENU } from '@/lib/floating-z-index'
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
import {
  isWorkspaceTabIconColorKey,
  workspaceTabIconColorKeyToHex,
} from '@/lib/workspace-tab-icon-colors'
import { useThemeStore } from '@/lib/theme-store'
import {
  DEFAULT_FAVICON_DATA_URL,
  generateFaviconFromSvg,
  getLucideIconSvg,
  setFaviconHref,
} from '@/lib/dynamic-favicon-core'
import { FloatingContextMenu } from './file-browser/FloatingContextMenu'
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
  clampTabInsertIndex,
  ensureSplitActiveNotLeft,
  exitSplitViewState,
  getTabGroupSplit,
  groupIdForWindow,
  insertIndexAfterAllRightTabs,
  isSplitLeftTab,
  mergeWindowIntoGroupState,
  openInNewTabInGroupState,
  openInSplitViewFromBrowserState,
  orderedAllGroupIds,
  pruneTabGroupSplitsState,
  resolveGroupVisibleTabId,
  setSplitFractionState,
  setSplitLeftTabFromContextState,
  setTabPinnedAndReorderState,
  splitWindowFromGroupState,
  tabsInGroup,
} from './workspace/tab-group-ops'
import { TaskbarGroupRow } from './workspace/WorkspaceTaskbarRows'
import { WorkspaceBrowserPane, type WorkspaceShareConfig } from './workspace/WorkspaceBrowserPane'
import {
  WorkspaceViewerPane,
  type WorkspaceVideoListenOnlyDetail,
} from './workspace/WorkspaceViewerPane'
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
  const themeTick = useStoreSync(useThemeStore)

  const tabChromeRestore = { title: 'Media Server', href: DEFAULT_FAVICON_DATA_URL }
  let tabFaviconGen = 0

  onMount(() => {
    tabChromeRestore.title = document.title
    const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null
    if (link?.href) tabChromeRestore.href = link.href
  })

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
      windows: w.windows,
      activeWindowId: w.activeWindowId,
      activeTabMap: { ...w.activeTabMap },
      nextWindowId: w.nextWindowId,
      pinnedTaskbarItems: w.pinnedTaskbarItems ?? [],
      ...(w.browserTabTitle ? { browserTabTitle: w.browserTabTitle } : {}),
      ...(w.browserTabIcon ? { browserTabIcon: w.browserTabIcon } : {}),
      ...(w.browserTabIconColor ? { browserTabIconColor: w.browserTabIconColor } : {}),
    }
  }

  function applyLayoutSnapshot(
    snapshot: PersistedWorkspaceState,
    options?: { baselinePresetId?: string | null },
  ) {
    const normalized = normalizePersistedWorkspaceState(snapshot)
    if (!normalized?.windows.length) return
    const prev = workspace()
    const merged: PersistedWorkspaceState = {
      ...normalized,
      browserTabTitle: normalized.browserTabTitle ?? prev?.browserTabTitle,
      browserTabIcon: normalized.browserTabIcon ?? prev?.browserTabIcon,
      browserTabIconColor: normalized.browserTabIconColor ?? prev?.browserTabIconColor,
    }
    const clone = JSON.parse(JSON.stringify(merged)) as PersistedWorkspaceState
    setWorkspace(merged)
    setLayoutBaselineSerialized(serializeWorkspaceLayoutState(clone))
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
    setLayoutBaselineSerialized(serializeWorkspaceLayoutState(clone))
    setLayoutBaselineSnapshot(clone)
  }

  function declareBaselinePresetId(id: string | null) {
    setLayoutBaselinePresetId(id)
  }

  const isLayoutDirty = createMemo(() => {
    const b = layoutBaselineSerialized()
    if (b == null) return false
    return serializeWorkspaceLayoutState(collectLayoutSnapshot()) !== b
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
        setLayoutBaselineSerialized(serializeWorkspaceLayoutState(clone))
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
                title: dirParam.split(/[/\\]/).filter(Boolean).pop() ?? 'Browser 1',
                iconName: null,
                iconPath: dirParam,
                iconType: MediaType.FOLDER,
                iconIsVirtual: isVirtualFolderPath(dirParam),
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
    const c = workspaceAreaEl?.getBoundingClientRect()
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
    const read = () => useWorkspaceAudio.getState().playing ?? null
    setPlaybackPlayingPath(read())
    const unsub = useWorkspaceAudio.subscribe(() => setPlaybackPlayingPath(read()))
    onCleanup(unsub)
  })

  const wxAudioTick = useStoreSync(useWorkspaceAudio)

  const workspaceFileIconContext = (): FileIconContext => {
    void wxAudioTick()
    const key = storageSessionKeyFull().key
    const slice = key ? useWorkspaceAudio.getState().byKey[key] : undefined
    const tm = useWorkspaceAudio.getState()
    const sp = sharePanel()
    const playing = slice?.playing ?? null
    const audioOnly = slice?.audioOnly ?? false
    const audioMode = !!(playing && (!isVideoPath(playing) || audioOnly))
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const transportAudioForRow = !!playing && !!tm.playing && norm(playing) === norm(tm.playing)
    const taskbarDrivesIcon = audioMode && transportAudioForRow

    return {
      customIcons: settingsQuery.data?.customIcons ?? {},
      knowledgeBases: settingsQuery.data?.knowledgeBases ?? [],
      playingPath: playing,
      currentFile: audioMode ? playing : null,
      mediaPlayerIsPlaying: taskbarDrivesIcon ? tm.isPlaying : false,
      mediaType: audioMode ? 'audio' : null,
      mediaShare: sp ? { token: sp.token, sharePath: sp.sharePath } : undefined,
    }
  }

  const taskbarMouseHandled = { current: false }
  const taskbarGroupIds = createMemo(() => orderedAllGroupIds(workspace()?.windows ?? []))
  const taskbarActiveWindowId = createMemo(() => workspace()?.activeWindowId ?? null)

  const renderedGroupIds = createMemo(() => orderedAllGroupIds(workspace()?.windows ?? []))
  const pinnedItems = createMemo(() => workspace()?.pinnedTaskbarItems ?? [])
  const pinnedItemsForTaskbar = createMemo(() => {
    void wxAudioTick()
    void playbackPlayingPath()
    return pinnedItems()
  })
  const hasWorkspaceWindows = createMemo(() => (workspace()?.windows.length ?? 0) > 0)
  const hasAnyTaskbarItems = createMemo(
    () => pinnedItems().length > 0 || taskbarGroupIds().length > 0,
  )

  /** Solid <For> passes props.each to mapArray as the list; it must be an array, not a memo fn. */
  const taskbarWindowRows = createMemo(() => {
    void wxAudioTick()
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
              void wxAudioTick()
              void playbackPlayingPath()
              const tabs = () => tabsInGroup(workspace()?.windows ?? [], gid)
              const leader = () => tabs()[0]
              const visibleTabId = () => {
                const wk = workspace()
                if (!wk) return ''
                return resolveGroupVisibleTabId(wk, gid)
              }
              const tabList = () => tabs()
              const tabIds = createMemo(() => tabs().map((w) => w.id))
              const splitState = createMemo(() => {
                const w = workspace()
                return w ? getTabGroupSplit(w, gid) : undefined
              })
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
                    onToggleTabPinned={toggleTabPinned}
                    onTabPullStart={handleTabPullStart}
                    mergeTargetPreview={mergeTargetPreview}
                    draggingWindowId={dragSnapWindowId}
                    splitLeftTabId={() => splitState()?.leftTabId}
                    onExitSplitView={() =>
                      setWorkspace((p) => (p ? exitSplitViewState(p, gid) : p))
                    }
                    onUseAsSplitLeftTab={(tabId) =>
                      setWorkspace((p) => (p ? setSplitLeftTabFromContextState(p, tabId) : p))
                    }
                    onDropFileToTabBar={(data, insertIndex) =>
                      dropFileToTabBar(leader()!.id, data, insertIndex)
                    }
                  >
                    <Show
                      when={splitState()}
                      fallback={
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
                                    onOpenInSplitView={openInSplitViewFromBrowserPane}
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
                                    knowledgeBases={settingsQuery.data?.knowledgeBases ?? []}
                                    shareCanEdit={
                                      props.shareConfig ? (props.shareCanEdit ?? false) : false
                                    }
                                    onUpdateViewing={updateWindowViewing}
                                    onVideoMetadataLoaded={(vw, vh) =>
                                      resizeViewerWindowForVideoMetadata(tabId, vw, vh)
                                    }
                                    onListenOnlyHandoff={(d) =>
                                      listenOnlyHandoffFromWorkspaceViewer(tabId, d)
                                    }
                                    onListenOnlyDismissViewer={() =>
                                      closeTab(tabId, { ignoreTabPinForListenOnlyDismiss: true })
                                    }
                                  />
                                </Show>
                              </div>
                            )
                          }}
                        </For>
                      }
                    >
                      {(split) => {
                        const splitSnap = () =>
                          (split as unknown as () => TabGroupSplitState | undefined)()
                        const leftTabId = () => splitSnap()?.leftTabId ?? ''
                        const leftWindowDef = createMemo(() =>
                          tabs().find((w) => w.id === leftTabId()),
                        )
                        const rightWindowDef = createMemo(() =>
                          tabs().find((w) => w.id === visibleTabId()),
                        )
                        return (
                          <div class='flex h-full min-h-0 min-w-0 flex-1 flex-row'>
                            <div
                              data-testid='workspace-split-left-pane'
                              class='workspace-window-content relative min-h-0 min-w-0 flex flex-col overflow-hidden text-sm text-muted-foreground'
                              style={{
                                width: `${(splitSnap()?.leftPaneFraction ?? 0.5) * 100}%`,
                              }}
                            >
                              <Show when={leftWindowDef()?.type === 'browser'}>
                                <WorkspaceBrowserPane
                                  windowId={leftTabId()}
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
                                  onOpenInSplitView={openInSplitViewFromBrowserPane}
                                  onRequestPlay={requestPlay}
                                />
                              </Show>
                              <Show when={leftWindowDef()?.type === 'viewer'}>
                                <WorkspaceViewerPane
                                  windowId={leftTabId()}
                                  storageKey={storageSessionKeyFull().key}
                                  contentVisible={() => true}
                                  workspace={workspace}
                                  sharePanel={sharePanel}
                                  editableFolders={editableFolders()}
                                  knowledgeBases={settingsQuery.data?.knowledgeBases ?? []}
                                  shareCanEdit={
                                    props.shareConfig ? (props.shareCanEdit ?? false) : false
                                  }
                                  onUpdateViewing={updateWindowViewing}
                                  onVideoMetadataLoaded={(vw, vh) =>
                                    resizeViewerWindowForVideoMetadata(leftTabId(), vw, vh)
                                  }
                                  onListenOnlyHandoff={(d) =>
                                    listenOnlyHandoffFromWorkspaceViewer(leftTabId(), d)
                                  }
                                  onListenOnlyDismissViewer={() =>
                                    closeTab(leftTabId(), {
                                      ignoreTabPinForListenOnlyDismiss: true,
                                    })
                                  }
                                />
                              </Show>
                            </div>
                            <div
                              data-testid='workspace-split-divider'
                              data-no-window-drag
                              class='w-1.5 shrink-0 cursor-col-resize border-border bg-muted/40 hover:bg-primary/25'
                              style={{ 'border-left-width': '1px', 'border-right-width': '1px' }}
                              onPointerDown={(e) => startSplitPaneDrag(gid, e)}
                            />
                            <div
                              data-testid='workspace-split-right-pane'
                              class='workspace-window-content relative h-full min-h-0 min-w-0 flex-1 overflow-hidden text-sm text-muted-foreground'
                            >
                              <div
                                data-testid='workspace-window-visible-content'
                                class='h-full min-h-0'
                              >
                                <Show when={rightWindowDef()?.type === 'browser'}>
                                  <WorkspaceBrowserPane
                                    windowId={visibleTabId()}
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
                                    onOpenInSplitView={openInSplitViewFromBrowserPane}
                                    onRequestPlay={requestPlay}
                                  />
                                </Show>
                                <Show when={rightWindowDef()?.type === 'viewer'}>
                                  <WorkspaceViewerPane
                                    windowId={visibleTabId()}
                                    storageKey={storageSessionKeyFull().key}
                                    contentVisible={() => true}
                                    workspace={workspace}
                                    sharePanel={sharePanel}
                                    editableFolders={editableFolders()}
                                    knowledgeBases={settingsQuery.data?.knowledgeBases ?? []}
                                    shareCanEdit={
                                      props.shareConfig ? (props.shareCanEdit ?? false) : false
                                    }
                                    onUpdateViewing={updateWindowViewing}
                                    onVideoMetadataLoaded={(vw, vh) =>
                                      resizeViewerWindowForVideoMetadata(visibleTabId(), vw, vh)
                                    }
                                    onListenOnlyHandoff={(d) =>
                                      listenOnlyHandoffFromWorkspaceViewer(visibleTabId(), d)
                                    }
                                    onListenOnlyDismissViewer={() =>
                                      closeTab(visibleTabId(), {
                                        ignoreTabPinForListenOnlyDismiss: true,
                                      })
                                    }
                                  />
                                </Show>
                              </div>
                            </div>
                          </div>
                        )
                      }}
                    </Show>
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
            <WorkspaceTaskbarAudio
              storageKey={() => storageSessionKeyFull().key}
              shareCtx={() => {
                const c = workspaceSourceToMediaContext(browserSource())
                if (!c?.shareToken || !c.sharePath) return null
                return { token: c.shareToken, sharePath: c.sharePath }
              }}
              onShowVideo={() => {
                const key = storageSessionKeyFull().key
                const path = key ? (useWorkspaceAudio.getState().byKey[key]?.playing ?? null) : null
                if (!path) return
                const dir = key ? useWorkspaceAudio.getState().byKey[key]?.dir : undefined
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
              onStopPlayback={stopWorkspacePlaybackFromTaskbar}
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
            <WorkspaceTaskbarSettings
              browserTabTitle={() => workspace()?.browserTabTitle ?? ''}
              browserTabIcon={() => workspace()?.browserTabIcon ?? ''}
              browserTabIconColor={() => workspace()?.browserTabIconColor ?? ''}
              onBrowserTabTitleChange={(value) => {
                const t = value.trim()
                setWorkspace((prev) =>
                  prev ? { ...prev, browserTabTitle: t ? t.slice(0, 120) : undefined } : prev,
                )
              }}
              onBrowserTabIconChange={(value) => {
                const icon = value.trim().slice(0, 64)
                setWorkspace((prev) =>
                  prev
                    ? {
                        ...prev,
                        browserTabIcon: icon || undefined,
                        ...(!icon ? { browserTabIconColor: undefined } : {}),
                      }
                    : prev,
                )
              }}
              onBrowserTabIconColorChange={(value) => {
                const raw = value.trim()
                if (raw && !isWorkspaceTabIconColorKey(raw)) return
                setWorkspace((prev) =>
                  prev ? { ...prev, browserTabIconColor: raw || undefined } : prev,
                )
              }}
            />
          </div>
        </div>
      </div>

      <FloatingContextMenu
        state={pinMenu}
        anchor={(m) => ({ x: m.x, y: m.y })}
        onDismiss={() => setPinMenu(null)}
        zIndex={FLOATING_Z_PIN_MENU}
        data-slot='pin-context-menu'
        pinContextMenuRoot
      >
        {(m) => (
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
        )}
      </FloatingContextMenu>
    </div>
  )
}
