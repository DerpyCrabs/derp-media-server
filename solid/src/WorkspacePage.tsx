import type { GlobalSettings } from '@/lib/use-settings'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import {
  createDefaultBounds,
  createFullscreenBounds,
  createWindowLayout,
  getPlaybackTitle,
  isVideoPath,
  PLAYER_WINDOW_ID,
} from '@/lib/workspace-geometry'
import type { FileDragData } from '@/lib/file-drag-data'
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
  snapZoneToBoundsWithOccupied,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import {
  workspaceLayoutScopeFromShareToken,
  type WorkspaceLayoutPreset,
} from '@/lib/workspace-layout-presets'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import { detectSnapZone, type SnapDetectResult } from '@/lib/use-snap-zones'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import File from 'lucide-solid/icons/file'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Folder from 'lucide-solid/icons/folder'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { useBrowserHistory, navigateSearchParams } from './browser-history'
import { useAdminEventsStream } from './lib/use-admin-events-stream'
import { applySnapPreviewLayout } from './workspace/snap-preview'
import { WorkspaceTilingPicker } from './workspace/WorkspaceTilingPicker'
import { findMergeTarget } from './workspace/merge-target'
import {
  addTabToGroupState,
  groupIdForWindow,
  mergeWindowIntoGroupState,
  openInNewTabInGroupState,
  orderedAllGroupIds,
  orderedVisibleGroupIds,
  splitWindowFromGroupState,
  tabsInGroup,
} from './workspace/tab-group-ops'
import { TaskbarGroupRow } from './workspace/WorkspaceTaskbarRows'
import { WorkspaceBrowserPane, type WorkspaceShareConfig } from './workspace/WorkspaceBrowserPane'
import { WorkspacePlayerPane } from './workspace/WorkspacePlayerPane'
import { WorkspaceViewerPane } from './workspace/WorkspaceViewerPane'
import { WorkspaceWindowChrome, type WorkspaceBounds } from './workspace/WorkspaceWindowChrome'
import { WorkspaceNamedLayoutMenu } from './workspace/WorkspaceNamedLayoutMenu'

const DEFAULT_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }

function isWorkspaceRoute(pathname: string) {
  return pathname === '/workspace' || /^\/share\/[^/]+\/workspace\/?$/.test(pathname)
}

function defaultPersistedState(source: WorkspaceSource): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: 'Browser 1',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
      },
    ],
    activeWindowId: 'workspace-window-1',
    activeTabMap: {},
    nextWindowId: 2,
    pinnedTaskbarItems: [],
  }
}

function persistWorkspaceState(storageKey: string, state: PersistedWorkspaceState) {
  try {
    const serializable = {
      ...state,
      windows: state.windows.filter((w) => w.id !== PLAYER_WINDOW_ID),
      pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
    }
    localStorage.setItem(storageKey, JSON.stringify(serializable))
  } catch {}
}

function loadPersisted(storageKey: string): PersistedWorkspaceState | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return normalizePersistedWorkspaceState(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

type AuthConfig = { enabled: boolean; editableFolders: string[] }

export type WorkspacePageProps = {
  shareConfig?: { token: string; sharePath: string } | null
  shareWorkspaceTaskbarPins?: PinnedTaskbarItem[]
  shareWorkspaceLayoutPresets?: WorkspaceLayoutPreset[]
  shareAllowUpload?: boolean
  shareCanEdit?: boolean
}

export function WorkspacePage(props: WorkspacePageProps = {}) {
  const history = useBrowserHistory()
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
        : DEFAULT_SOURCE,
  )

  const storageSessionKeyFull = createMemo(() => {
    const loc = history()
    const sid = new URLSearchParams(loc.search).get('ws') ?? ''
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    return { sid, key: sid ? workspaceStorageSessionKey(base, sid) : '' }
  })

  const [workspace, setWorkspace] = createSignal<PersistedWorkspaceState | null>(null)

  let workspaceAreaEl: HTMLDivElement | undefined
  let snapPreviewEl: HTMLDivElement | undefined
  const [layoutPicker, setLayoutPicker] = createSignal<{
    windowId: string
    anchor: DOMRect
  } | null>(null)
  let dragZoneRef: SnapDetectResult | null = null
  let draggedWindowIdForSnap: string | null = null

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
    if (shareConfig()) return []
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
  let presetUrlResolvedForKey = ''

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
    let sid = new URLSearchParams(loc.search).get('ws') ?? ''
    if (!sid) {
      sid = crypto.randomUUID()
      navigateSearchParams({ ws: sid }, 'replace')
    }
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    const key = workspaceStorageSessionKey(base, sid)
    const params = new URLSearchParams(loc.search)
    const dirParam = params.get('dir')
    const presetParam = params.get('preset')
    void settingsQuery.isSuccess
    void serverLayoutPresets()
    const presetsReadyNow = shareConfig() ? true : settingsQuery.isSuccess
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
      presetUrlResolvedForKey = ''
      untrack(() => {
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
        } else if (loaded) {
          resetBaseline()
          setWorkspace(loaded)
        } else if (presetParam && presetsReadyNow) {
          if (applyPreset(presetParam)) {
            presetUrlResolvedForKey = key
          } else {
            setDefaultWorkspace()
          }
        } else if (presetParam && !presetsReadyNow) {
          setDefaultWorkspace()
        } else {
          setDefaultWorkspace()
        }
        setPinsHydratedFor('')
      })
      return
    }

    if (
      presetParam &&
      presetsReadyNow &&
      !loaded &&
      presetUrlResolvedForKey !== key &&
      applyPreset(presetParam)
    ) {
      presetUrlResolvedForKey = key
      untrack(() => setPinsHydratedFor(''))
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
    }, 500)
    onCleanup(() => {
      if (persistTimer) {
        clearTimeout(persistTimer)
        persistTimer = null
      }
    })
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

  function addTab(leaderId: string) {
    setWorkspace((prev) => (prev ? addTabToGroupState(prev, leaderId) : prev))
  }

  function handleDetachTab(tabId: string, clientX: number, clientY: number) {
    const c = workspaceAreaEl?.getBoundingClientRect()
    if (!c) return
    const w = workspace()
    const win = w?.windows.find((x) => x.id === tabId)
    const currentBounds = win?.layout?.bounds
    const restoreBounds = win?.layout?.restoreBounds
    const width = restoreBounds?.width ?? currentBounds?.width ?? 500
    const height = restoreBounds?.height ?? currentBounds?.height ?? 400
    const newX = clientX - c.left - width / 2
    const newY = Math.max(0, clientY - c.top - 16)
    setWorkspace((prev) =>
      prev ? splitWindowFromGroupState(prev, tabId, { x: newX, y: newY, width, height }) : prev,
    )
    focusWindow(tabId)
  }

  function requestPlay(source: WorkspaceSource, path: string, dir?: string) {
    const key = storageSessionKeyFull().key
    useWorkspacePlaybackStore.getState().playFile(key, path, dir)
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
    const w = workspace()
    if (!w) return snapZoneToBoundsWithOccupied(zone, [])
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
    return snapZoneToBoundsWithOccupied(zone, occupied)
  }

  function handleDragPointerMove(windowId: string, clientX: number, clientY: number) {
    draggedWindowIdForSnap = windowId
    const c = workspaceAreaEl
    const p = snapPreviewEl
    if (!c || !p) return
    const rect = c.getBoundingClientRect()
    const z = detectSnapZone(clientX - rect.left, clientY - rect.top, rect.width, rect.height)
    dragZoneRef = z
    applySnapPreviewLayout(p, z, c, getZoneBoundsForDrag)
  }

  function restoreDrag(windowId: string, clientX: number, clientY: number) {
    const w = workspace()
    const container = workspaceAreaEl?.getBoundingClientRect()
    if (!w || !container) return
    const win = w.windows.find((x) => x.id === windowId)
    if (!win) return
    const currentBounds = win.layout?.bounds
    const restoreBounds = win.layout?.restoreBounds
    const restoredW = restoreBounds?.width ?? currentBounds?.width ?? 500
    const currentWidth = currentBounds?.width ?? restoredW
    const oX = container.left
    const grabRatio = currentBounds
      ? Math.min(Math.max((clientX - oX - currentBounds.x) / currentWidth, 0), 1)
      : 0.5
    const newX = clientX - oX - restoredW * grabRatio
    const newY = currentBounds?.y ?? 0
    unsnapWindow(windowId, { x: newX, y: newY })
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

  function snapWindowState(windowId: string, zone: SnapZone) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      const occupied = prev.windows
        .filter(
          (x) =>
            x.layout?.snapZone && x.layout.bounds && (gid == null || groupIdForWindow(x) !== gid),
        )
        .map((x) => ({ bounds: x.layout!.bounds!, snapZone: x.layout!.snapZone! }))
      const snapBounds = snapZoneToBoundsWithOccupied(zone, occupied)
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
              snapZone: zone,
              minimized: false,
              zIndex: maxZ + 1,
              bounds: snapBounds,
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
              bounds: isFs ? (w.layout?.restoreBounds ?? currentBounds) : createFullscreenBounds(),
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

  function onDragPointerEnd(
    windowId: string,
    bounds: WorkspaceBounds,
    clientX: number,
    clientY: number,
  ) {
    const zone = dragZoneRef
    const c = workspaceAreaEl
    const p = snapPreviewEl
    if (c && p) applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag)
    dragZoneRef = null
    draggedWindowIdForSnap = null

    const wsMerge = workspace()
    if (wsMerge) {
      const hit = findMergeTarget(wsMerge.windows, windowId, clientX, clientY)
      if (hit) {
        const targetWindow = wsMerge.windows.find((w) => groupIdForWindow(w) === hit.groupId)
        if (targetWindow) {
          setWorkspace((prev) =>
            prev
              ? mergeWindowIntoGroupState(prev, windowId, targetWindow.id, hit.insertIndex)
              : prev,
          )
          return
        }
      }
    }

    if (zone === 'top') {
      toggleFullscreenWindow(windowId)
      return
    }
    if (zone) {
      snapWindowState(windowId, zone as SnapZone)
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

  const taskbarMouseHandled = { current: false }
  const taskbarGroupIds = createMemo(() => orderedAllGroupIds(workspace()?.windows ?? []))

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

  const visibleGroupIds = createMemo(() => orderedVisibleGroupIds(workspace()?.windows ?? []))
  const pinnedItems = createMemo(() => workspace()?.pinnedTaskbarItems ?? [])
  const hasWorkspaceWindows = createMemo(() => (workspace()?.windows.length ?? 0) > 0)
  const hasAnyTaskbarItems = createMemo(
    () => pinnedItems().length > 0 || taskbarGroupIds().length > 0,
  )

  /** Solid <For> passes props.each to mapArray as the list; it must be an array, not a memo fn. */
  const taskbarWindowRows = createMemo(() => (
    <For each={taskbarGroupIds()}>
      {(groupId) => (
        <TaskbarGroupRow
          groupId={groupId}
          workspace={workspace}
          playingPath={playbackPlayingPath}
          taskbarMouseHandled={taskbarMouseHandled}
          focusWindow={focusWindow}
          setWindowMinimized={setWindowMinimized}
          closeWindow={closeWindow}
        />
      )}
    </For>
  ))

  return (
    <div class='workspace-layout pointer-events-auto fixed inset-0 flex flex-col overflow-hidden bg-background select-none'>
      <div
        class='relative min-h-0 flex-1 overflow-hidden'
        ref={(el) => {
          workspaceAreaEl = el
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
          <For each={visibleGroupIds()}>
            {(gid) => {
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
                    onDetachTab={handleDetachTab}
                    onAddTab={() => addTab(leader()!.id)}
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
                            class={`min-h-0 flex-1 overflow-hidden text-sm text-muted-foreground ${
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
                                editableFolders={editableFolders()}
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
                                workspace={workspace}
                                sharePanel={sharePanel}
                                editableFolders={editableFolders()}
                                shareCanEdit={
                                  props.shareConfig ? (props.shareCanEdit ?? false) : false
                                }
                                onUpdateViewing={updateWindowViewing}
                              />
                            </Show>
                            <Show when={windowDef()?.type === 'player'}>
                              <WorkspacePlayerPane
                                windowId={tabId}
                                storageKey={storageSessionKeyFull().key}
                                window={() => workspace()?.windows.find((w) => w.id === tabId)}
                                shareFallback={sharePanel}
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
                  onSelectZone={(zone) => {
                    snapWindowState(p.windowId, zone)
                    setLayoutPicker(null)
                  }}
                  onSelectFullscreen={() => {
                    toggleFullscreenWindow(p.windowId)
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
                  <For each={pinnedItems()}>
                    {(pin) => {
                      const tooltip = `${pin.isDirectory ? 'Folder' : 'File'}: ${pin.path}`
                      return (
                        <button
                          type='button'
                          title={tooltip}
                          aria-label={tooltip}
                          class='flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground'
                          onClick={() => selectPinned(pin)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            setPinMenu({ x: e.clientX, y: e.clientY, pinId: pin.id })
                          }}
                        >
                          <Show
                            when={pin.isDirectory}
                            fallback={<File class='h-5 w-5' stroke-width={1.75} />}
                          >
                            <Folder class='h-5 w-5' stroke-width={1.75} />
                          </Show>
                        </button>
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
