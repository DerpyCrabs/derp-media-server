import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { NavigationState } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { MediaType } from '@/lib/types'
import { hydrateFocusFromPersisted } from '@/lib/workspace-core'
import {
  createDefaultBounds,
  createFullscreenBounds,
  createWindowLayout,
  getPlayerBoundsForAspectRatio,
  getSourceLabel,
  getViewportSize,
  isVideoPath,
  PLAYER_WINDOW_ID,
  snapZoneToBounds,
} from '@/lib/workspace-geometry'
import { useWorkspaceFocusStore } from '@/lib/workspace-focus-store'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import { parseWorkspaceTaskbarPins, type WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'
import {
  buildWorkspaceSessionSlice,
  normalizedWindowsToArray,
  useWorkspaceSessionStore,
  type WorkspaceSessionSlice,
} from '@/lib/workspace-session-store'

export {
  SNAP_SIBLING_MAP,
  getPlayerBoundsForAspectRatio,
  snapZoneToBounds,
  snapZoneToBoundsWithOccupied,
} from '@/lib/workspace-geometry'
export type { WorkspaceBounds } from '@/lib/workspace-geometry'

export interface WorkspaceSource {
  kind: 'local' | 'share'
  rootPath?: string | null
  token?: string
  sharePath?: string | null
}

export type SnapZone =
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-half'
  | 'bottom-half'
  | 'top-third'
  | 'middle-third'
  | 'bottom-third'
  | 'left-third'
  | 'center-third'
  | 'right-third'
  | 'left-two-thirds'
  | 'right-two-thirds'
  | 'top-left-third'
  | 'top-center-third'
  | 'top-right-third'
  | 'bottom-left-third'
  | 'bottom-center-third'
  | 'bottom-right-third'

export interface WorkspaceWindowLayout {
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  } | null
  fullscreen?: boolean
  snapZone?: SnapZone | null
  minimized?: boolean
  zIndex?: number
  restoreBounds?: {
    x: number
    y: number
    width: number
    height: number
  } | null
}

export interface WorkspaceWindowDefinition {
  id: string
  type: 'browser' | 'viewer' | 'player'
  title: string
  iconName?: string | null
  iconPath?: string | null
  iconType?: MediaType | null
  iconIsVirtual?: boolean
  source: WorkspaceSource
  initialState: Partial<NavigationState>
  tabGroupId?: string | null
  layout?: WorkspaceWindowLayout
}

export type PinnedTaskbarItem = WorkspaceTaskbarPin

interface OpenWorkspaceWindowOptions {
  title?: string
  source?: WorkspaceSource
  initialState?: Partial<NavigationState>
  tabGroupId?: string | null
  layout?: WorkspaceWindowLayout
  insertIndex?: number
}

interface ShareConfig {
  token: string
  sharePath: string
}

interface UseWorkspaceOptions {
  initialDir?: string | null
  shareConfig?: ShareConfig | null
  /** Per-tab session id (must match URL `ws` query). */
  workspaceSessionId: string
  /** When there is no saved draft, optionally hydrate from this snapshot (e.g. `?preset=`). */
  initialLayoutSnapshot?: PersistedWorkspaceState | null
  initialLayoutPresetId?: string | null
  /** Hydrate from server after load; when unset/false, pins stay localStorage-only. */
  serverTaskbarPins?: PinnedTaskbarItem[]
  serverTaskbarPinsReady?: boolean
  persistTaskbarPinsToServer?: (items: PinnedTaskbarItem[]) => void
}

interface RequestPlayOptions {
  source: WorkspaceSource
  path: string
  dir?: string
}

interface UseWorkspaceResult {
  storageKey: string
  windows: WorkspaceWindowDefinition[]
  activeWindowId: string | null
  playbackSource: WorkspaceSource | null
  activeTabMap: Record<string, string>
  focusWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
  openBrowserWindow: (options?: OpenWorkspaceWindowOptions) => string
  openViewerWindow: (
    options: OpenWorkspaceWindowOptions & { initialState: Partial<NavigationState> },
  ) => string
  openPlayerWindow: (options?: Pick<RequestPlayOptions, 'source' | 'path'>) => string | null
  updateWindowBounds: (
    windowId: string,
    bounds: NonNullable<WorkspaceWindowLayout['bounds']>,
  ) => void
  updateWindowPresentation: (
    windowId: string,
    presentation: {
      title?: string
      iconName?: string | null
      iconPath?: string | null
      iconType?: MediaType | null
      iconIsVirtual?: boolean
    },
  ) => void
  setWindowMinimized: (windowId: string, minimized: boolean) => void
  toggleWindowFullscreen: (windowId: string) => void
  snapWindow: (windowId: string, zone: SnapZone) => void
  unsnapWindow: (windowId: string, dropPosition?: { x: number; y: number }) => void
  resizeSnappedWindow: (
    windowId: string,
    newBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
    direction: string,
  ) => void
  mergeWindowIntoGroup: (windowId: string, targetWindowId: string, insertIndex?: number) => void
  splitWindowFromGroup: (
    windowId: string,
    offsetBounds?: NonNullable<WorkspaceWindowLayout['bounds']>,
  ) => void
  addTabToGroup: (sourceWindowId: string) => string
  openInNewTab: (
    sourceWindowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
    sourceOverride?: WorkspaceSource,
    insertIndex?: number,
  ) => string
  setActiveTab: (tabGroupId: string, windowId: string) => void
  updateWindowNavigationState: (windowId: string, state: Partial<NavigationState>) => void
  requestPlay: (options: RequestPlayOptions) => void
  pinnedTaskbarItems: PinnedTaskbarItem[]
  addPinnedItem: (item: Omit<PinnedTaskbarItem, 'id'>) => void
  removePinnedItem: (id: string) => void
  collectLayoutSnapshot: () => PersistedWorkspaceState
  applyLayoutSnapshot: (
    snapshot: PersistedWorkspaceState,
    options?: { baselinePresetId?: string | null },
  ) => void
  revertLayoutToBaseline: () => void
  /** Resets "modified" flag by aligning baseline to the current workspace. */
  syncLayoutBaselineToCurrent: () => void
  isLayoutDirty: boolean
  layoutBaselinePresetId: string | null
  /** After saving a new preset, attach its id to the current baseline without reloading windows. */
  declareBaselinePresetId: (id: string | null) => void
}

const DEFAULT_WORKSPACE_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }

const STORAGE_KEY = 'workspace-state'
const SAVE_DEBOUNCE_MS = 500
const EMPTY_ACTIVE_TAB_MAP: Record<string, string> = {}

export interface PersistedWorkspaceState {
  windows: WorkspaceWindowDefinition[]
  activeWindowId: string | null
  activeTabMap: Record<string, string>
  nextWindowId: number
  pinnedTaskbarItems: PinnedTaskbarItem[]
}

export function workspaceStorageBaseKey(shareToken?: string | null): string {
  return shareToken ? `${STORAGE_KEY}-share-${shareToken}` : STORAGE_KEY
}

export function workspaceStorageSessionKey(baseKey: string, workspaceSessionId: string): string {
  return `${baseKey}-ws-${workspaceSessionId}`
}

function sortTabMapKeys(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
}

/** Stable serialization for dirty detection and baseline compare. */
export function serializeWorkspacePersistedState(state: PersistedWorkspaceState): string {
  return JSON.stringify({
    windows: state.windows,
    activeWindowId: state.activeWindowId,
    activeTabMap: sortTabMapKeys(state.activeTabMap ?? {}),
    nextWindowId: state.nextWindowId,
    pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
  })
}

export function normalizePersistedWorkspaceState(data: unknown): PersistedWorkspaceState | null {
  if (!data || typeof data !== 'object') return null
  const parsed = data as PersistedWorkspaceState
  if (!Array.isArray(parsed.windows) || parsed.windows.length === 0) return null

  const viewport = getViewportSize()
  const validatedWindows = parsed.windows
    .filter(
      (w): w is WorkspaceWindowDefinition =>
        !!w &&
        typeof w.id === 'string' &&
        typeof w.type === 'string' &&
        !!w.source &&
        isValidSource(w.source),
    )
    .map((w, i) => {
      const b = w.layout?.bounds
      const bounds = b
        ? {
            x: Math.max(0, Math.min(b.x, viewport.width - 100)),
            y: Math.max(0, Math.min(b.y, viewport.height - 100)),
            width: Math.min(b.width, viewport.width),
            height: Math.min(b.height, viewport.height),
          }
        : createDefaultBounds(i, w.type)
      return {
        ...w,
        layout: {
          ...w.layout,
          bounds,
        },
      }
    })

  if (validatedWindows.length === 0) return null

  const rawPinned = Array.isArray(parsed.pinnedTaskbarItems) ? parsed.pinnedTaskbarItems : []
  const pinnedTaskbarItems = rawPinned.filter(isValidPinnedItem)

  return {
    windows: validatedWindows,
    activeWindowId: parsed.activeWindowId ?? null,
    activeTabMap: parsed.activeTabMap ?? {},
    nextWindowId: parsed.nextWindowId ?? validatedWindows.length + 1,
    pinnedTaskbarItems,
  }
}

function parsePersistedWorkspaceStateJson(raw: string): PersistedWorkspaceState | null {
  try {
    return normalizePersistedWorkspaceState(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

function isValidSource(s: unknown): s is WorkspaceSource {
  if (!s || typeof s !== 'object' || !('kind' in s)) return false
  const k = (s as WorkspaceSource).kind
  if (k === 'local') return true
  if (k === 'share') return typeof (s as WorkspaceSource).token === 'string'
  return false
}

function isValidPinnedItem(p: unknown): p is PinnedTaskbarItem {
  return parseWorkspaceTaskbarPins([p]).length === 1
}

function saveWorkspaceState(state: PersistedWorkspaceState, key: string = STORAGE_KEY) {
  try {
    const serializable = {
      ...state,
      windows: state.windows.filter((w) => w.id !== PLAYER_WINDOW_ID),
      pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
    }
    localStorage.setItem(key, JSON.stringify(serializable))
  } catch {}
}

function loadWorkspaceState(key: string = STORAGE_KEY): PersistedWorkspaceState | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(key)
  if (!raw) return null
  return parsePersistedWorkspaceStateJson(raw)
}

export function loadPinnedTaskbarItemsOnly(key: string = STORAGE_KEY): PinnedTaskbarItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { pinnedTaskbarItems?: unknown }
    return parseWorkspaceTaskbarPins(parsed.pinnedTaskbarItems)
  } catch {
    return []
  }
}

export function workspaceSourceToMediaContext(
  source: WorkspaceSource | null | undefined,
): SourceContext | undefined {
  if (!source || source.kind !== 'share') {
    return undefined
  }

  return {
    shareToken: source.token ?? null,
    sharePath: source.sharePath ?? null,
  }
}

export function getWorkspaceWindowTitle(
  window: Pick<WorkspaceWindowDefinition, 'title' | 'type' | 'source'>,
): string {
  if (window.title.trim()) {
    return window.title
  }

  if (window.type === 'player') {
    return 'Video Player'
  }

  return window.type === 'viewer'
    ? `${getSourceLabel(window.source)} Viewer`
    : getSourceLabel(window.source)
}

function computeInitialWorkspaceSessionSlice(ctx: {
  storageKey: string
  initialDir: string | null | undefined
  defaultSource: WorkspaceSource
  initialLayoutSnapshot: PersistedWorkspaceState | null | undefined
  initialLayoutPresetId: string | null | undefined
  getPersistedState: () => PersistedWorkspaceState | null
  setPersistedRef: (p: PersistedWorkspaceState | null) => void
}): WorkspaceSessionSlice {
  const {
    storageKey,
    initialDir,
    defaultSource,
    initialLayoutSnapshot,
    initialLayoutPresetId,
    getPersistedState,
    setPersistedRef,
  } = ctx

  let nextWindowId = 2
  let nextZIndex = 2
  let layoutBaselineSnapshot: PersistedWorkspaceState | null = null
  let layoutBaselineSerialized: string | null = null
  let layoutBaselinePresetId: string | null = null
  let windows: WorkspaceWindowDefinition[]
  let pinnedTaskbarItems: PinnedTaskbarItem[]

  const hasExplicitFolder = initialDir != null && initialDir !== ''
  if (hasExplicitFolder) {
    setPersistedRef(null)
    useWorkspaceFocusStore.getState().hydrateIfNeeded(storageKey, {
      activeWindowId: 'workspace-window-1',
      activeTabMap: {},
    })
    windows = [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: 'Browser 1',
        iconName: null,
        iconPath: initialDir,
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: defaultSource,
        initialState: { dir: initialDir },
        tabGroupId: null,
        layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
      },
    ]
    pinnedTaskbarItems = loadPinnedTaskbarItemsOnly(storageKey)
  } else {
    const persisted = getPersistedState()
    if (persisted) {
      hydrateFocusFromPersisted(storageKey, persisted)
      const maxId = persisted.windows.reduce((max, w) => {
        const match = w.id.match(/workspace-window-(\d+)/)
        return match ? Math.max(max, Number(match[1])) : max
      }, 1)
      const maxZ = persisted.windows.reduce((max, w) => Math.max(max, w.layout?.zIndex ?? 0), 1)
      nextWindowId = Math.max(persisted.nextWindowId, maxId + 1)
      nextZIndex = maxZ + 1
      windows = persisted.windows
      pinnedTaskbarItems = persisted.pinnedTaskbarItems ?? []
    } else if (initialLayoutSnapshot) {
      const fromPreset = normalizePersistedWorkspaceState(initialLayoutSnapshot)
      if (fromPreset && fromPreset.windows.length > 0) {
        setPersistedRef(fromPreset)
        hydrateFocusFromPersisted(storageKey, fromPreset)
        const maxId = fromPreset.windows.reduce((max, w) => {
          const match = w.id.match(/workspace-window-(\d+)/)
          return match ? Math.max(max, Number(match[1])) : max
        }, 1)
        const maxZ = fromPreset.windows.reduce((max, w) => Math.max(max, w.layout?.zIndex ?? 0), 1)
        nextWindowId = Math.max(fromPreset.nextWindowId, maxId + 1)
        nextZIndex = maxZ + 1
        if (initialLayoutPresetId) {
          layoutBaselineSnapshot = JSON.parse(JSON.stringify(fromPreset)) as PersistedWorkspaceState
          layoutBaselineSerialized = serializeWorkspacePersistedState(fromPreset)
          layoutBaselinePresetId = initialLayoutPresetId
        }
        windows = fromPreset.windows
        pinnedTaskbarItems = fromPreset.pinnedTaskbarItems ?? []
      } else {
        setPersistedRef(null)
        useWorkspaceFocusStore.getState().hydrateIfNeeded(storageKey, {
          activeWindowId: 'workspace-window-1',
          activeTabMap: {},
        })
        windows = [
          {
            id: 'workspace-window-1',
            type: 'browser',
            title: 'Browser 1',
            iconName: null,
            iconPath: '',
            iconType: MediaType.FOLDER,
            iconIsVirtual: false,
            source: defaultSource,
            initialState: {},
            tabGroupId: null,
            layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
          },
        ]
        pinnedTaskbarItems = loadPinnedTaskbarItemsOnly(storageKey)
      }
    } else {
      setPersistedRef(null)
      useWorkspaceFocusStore.getState().hydrateIfNeeded(storageKey, {
        activeWindowId: 'workspace-window-1',
        activeTabMap: {},
      })
      windows = [
        {
          id: 'workspace-window-1',
          type: 'browser',
          title: 'Browser 1',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: defaultSource,
          initialState: {},
          tabGroupId: null,
          layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
        },
      ]
      pinnedTaskbarItems = loadPinnedTaskbarItemsOnly(storageKey)
    }
  }

  return buildWorkspaceSessionSlice(
    windows,
    nextWindowId,
    nextZIndex,
    pinnedTaskbarItems,
    defaultSource,
    layoutBaselinePresetId,
    layoutBaselineSerialized,
    layoutBaselineSnapshot,
  )
}

export function useWorkspace({
  initialDir = null,
  shareConfig = null,
  workspaceSessionId,
  initialLayoutSnapshot = null,
  initialLayoutPresetId = null,
  serverTaskbarPins = [],
  serverTaskbarPinsReady = false,
  persistTaskbarPinsToServer,
}: UseWorkspaceOptions): UseWorkspaceResult {
  const legacyBaseKey = workspaceStorageBaseKey(shareConfig?.token)
  const storageKey = workspaceStorageSessionKey(legacyBaseKey, workspaceSessionId)

  const defaultSource: WorkspaceSource = useMemo(
    () =>
      shareConfig
        ? { kind: 'share', token: shareConfig.token, sharePath: shareConfig.sharePath }
        : DEFAULT_WORKSPACE_SOURCE,
    [shareConfig],
  )

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistedRef = useRef<PersistedWorkspaceState | null | undefined>(undefined)
  const windowsRef = useRef<WorkspaceWindowDefinition[]>([])

  function getPersistedState() {
    if (persistedRef.current === undefined) {
      persistedRef.current = loadWorkspaceState(storageKey)
    }
    return persistedRef.current
  }

  const initialSlice = useMemo(
    (): WorkspaceSessionSlice =>
      computeInitialWorkspaceSessionSlice({
        storageKey,
        initialDir,
        defaultSource,
        initialLayoutSnapshot,
        initialLayoutPresetId,
        getPersistedState,
        setPersistedRef: (p) => {
          persistedRef.current = p
        },
      }),
    [storageKey, initialDir, defaultSource, initialLayoutSnapshot, initialLayoutPresetId],
  )

  useLayoutEffect(() => {
    useWorkspaceSessionStore.getState().replaceSession(storageKey, initialSlice)
  }, [storageKey, initialSlice])

  const session =
    useWorkspaceSessionStore(useShallow((s) => s.sessions[storageKey] ?? initialSlice)) ??
    initialSlice
  const windows = useMemo(() => normalizedWindowsToArray(session), [session])
  const pinnedTaskbarItems = session.pinnedTaskbarItems
  const playbackSource = session.playbackSource
  const layoutBaselineSerialized = session.layoutBaselineSerialized
  const layoutBaselinePresetId = session.layoutBaselinePresetId

  const activeWindowId = useWorkspaceFocusStore((s) => s.byKey[storageKey]?.activeWindowId ?? null)
  const activeTabMap = useWorkspaceFocusStore(
    useShallow((s) => s.byKey[storageKey]?.activeTabMap ?? EMPTY_ACTIVE_TAB_MAP),
  )

  const setFocusStoreActiveWindowId = useCallback(
    (id: string | null) => useWorkspaceFocusStore.getState().setActiveWindowId(storageKey, id),
    [storageKey],
  )
  const setFocusStoreActiveTab = useCallback(
    (tabGroupId: string, windowId: string) =>
      useWorkspaceFocusStore.getState().setActiveTab(storageKey, tabGroupId, windowId),
    [storageKey],
  )
  const persistTaskbarPinsRef = useRef(persistTaskbarPinsToServer)
  persistTaskbarPinsRef.current = persistTaskbarPinsToServer
  const serverPinsHydratedRef = useRef(false)
  const pinsServerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    serverPinsHydratedRef.current = false
  }, [storageKey])

  useEffect(() => {
    if (!serverTaskbarPinsReady) return
    if (serverPinsHydratedRef.current) return
    const local = loadPinnedTaskbarItemsOnly(storageKey)
    const store = useWorkspaceSessionStore.getState()
    if (serverTaskbarPins.length > 0) {
      store.setPinnedTaskbarItems(storageKey, serverTaskbarPins)
    } else if (local.length > 0) {
      store.setPinnedTaskbarItems(storageKey, local)
      queueMicrotask(() => persistTaskbarPinsRef.current?.(local))
    }
    serverPinsHydratedRef.current = true
  }, [serverTaskbarPinsReady, serverTaskbarPins, storageKey])

  useEffect(() => {
    if (!serverTaskbarPinsReady || !persistTaskbarPinsToServer || !serverPinsHydratedRef.current) {
      return
    }
    if (pinsServerSaveTimerRef.current) clearTimeout(pinsServerSaveTimerRef.current)
    pinsServerSaveTimerRef.current = setTimeout(() => {
      persistTaskbarPinsRef.current?.(pinnedTaskbarItems)
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (pinsServerSaveTimerRef.current) clearTimeout(pinsServerSaveTimerRef.current)
    }
  }, [pinnedTaskbarItems, serverTaskbarPinsReady, persistTaskbarPinsToServer])

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      const focus = useWorkspaceFocusStore.getState().getFocusState(storageKey)
      const layoutOverlay = focus.layoutByWindowId ?? {}
      const windowsToSave = windows.map((w) => ({
        ...w,
        layout: w.layout ? { ...w.layout, ...layoutOverlay[w.id] } : undefined,
      }))
      const sess = useWorkspaceSessionStore.getState().sessions[storageKey]
      saveWorkspaceState(
        {
          windows: windowsToSave,
          activeWindowId: focus.activeWindowId,
          activeTabMap: focus.activeTabMap,
          nextWindowId: sess?.nextWindowId ?? 2,
          pinnedTaskbarItems,
        },
        storageKey,
      )
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [windows, pinnedTaskbarItems, storageKey, activeWindowId, activeTabMap])

  windowsRef.current = windows

  const store = useWorkspaceSessionStore.getState

  const updateWindow = useCallback(
    (
      windowId: string,
      updater: (window: WorkspaceWindowDefinition) => WorkspaceWindowDefinition,
    ) => {
      store().updateWindow(storageKey, windowId, updater)
    },
    [storageKey],
  )

  const createWindow = useCallback(
    (type: WorkspaceWindowDefinition['type'], options: OpenWorkspaceWindowOptions) =>
      store().createWindow(storageKey, type, options, defaultSource),
    [storageKey, defaultSource],
  )

  const openBrowserWindow = useCallback(
    (options: OpenWorkspaceWindowOptions = {}) => createWindow('browser', options),
    [createWindow],
  )

  const focusWindow = useCallback(
    (windowId: string) => {
      store().focusWindow(storageKey, windowId)
    },
    [storageKey],
  )

  const openPlayerWindow = useCallback(
    (options?: Pick<RequestPlayOptions, 'source' | 'path'>) => {
      const playingPath =
        options?.path ?? useWorkspacePlaybackStore.getState().byKey[storageKey]?.playing ?? null
      return store().openPlayerWindow(storageKey, {
        path: options?.path,
        source: options?.source ?? playbackSource ?? defaultSource,
        playingPath,
        defaultSource,
      })
    },
    [storageKey, playbackSource, defaultSource],
  )

  const openViewerWindow = useCallback(
    (options: OpenWorkspaceWindowOptions & { initialState: Partial<NavigationState> }) =>
      createWindow('viewer', options),
    [createWindow],
  )

  const updateWindowBounds = useCallback(
    (windowId: string, bounds: NonNullable<WorkspaceWindowLayout['bounds']>) => {
      updateWindow(windowId, (window) => ({
        ...window,
        layout: {
          ...window.layout,
          bounds,
        },
      }))
    },
    [updateWindow],
  )

  const updateWindowPresentation = useCallback(
    (
      windowId: string,
      presentation: {
        title?: string
        iconName?: string | null
        iconPath?: string | null
        iconType?: MediaType | null
        iconIsVirtual?: boolean
      },
    ) => {
      updateWindow(windowId, (window) => {
        const nextTitle = presentation.title ?? window.title
        const nextIconName =
          presentation.iconName === undefined ? (window.iconName ?? null) : presentation.iconName
        const nextIconPath =
          presentation.iconPath === undefined ? (window.iconPath ?? null) : presentation.iconPath
        const nextIconType =
          presentation.iconType === undefined ? (window.iconType ?? null) : presentation.iconType
        const nextIconIsVirtual =
          presentation.iconIsVirtual === undefined
            ? (window.iconIsVirtual ?? false)
            : presentation.iconIsVirtual

        if (
          nextTitle === window.title &&
          nextIconName === (window.iconName ?? null) &&
          nextIconPath === (window.iconPath ?? null) &&
          nextIconType === (window.iconType ?? null) &&
          nextIconIsVirtual === (window.iconIsVirtual ?? false)
        ) {
          return window
        }

        return {
          ...window,
          title: nextTitle,
          iconName: nextIconName,
          iconPath: nextIconPath,
          iconType: nextIconType,
          iconIsVirtual: nextIconIsVirtual,
        }
      })
    },
    [updateWindow],
  )

  const setWindowMinimized = useCallback(
    (windowId: string, minimized: boolean) => {
      useWorkspaceFocusStore.getState().setWindowLayoutOverlay(storageKey, windowId, { minimized })
      const current = useWorkspaceFocusStore.getState().getFocusState(storageKey).activeWindowId
      if (current !== windowId || !minimized) {
        setFocusStoreActiveWindowId(windowId)
        return
      }
      const ws = windowsRef.current
      const minimizingW = ws.find((w) => w.id === windowId)
      const minimizingGroupId = minimizingW?.tabGroupId ?? minimizingW?.id ?? windowId
      const layoutMap =
        useWorkspaceFocusStore.getState().getFocusState(storageKey).layoutByWindowId ?? {}

      let nextId: string | null = null
      let maxZ = -1
      const seen = new Set<string>()
      for (const w of ws) {
        const gid = w.tabGroupId ?? w.id
        if (gid === minimizingGroupId) continue
        if (seen.has(gid)) continue
        seen.add(gid)
        const leader = ws.find((x) => (x.tabGroupId ?? x.id) === gid)
        if (!leader?.layout) continue
        const effectiveMinimized = layoutMap[leader.id]?.minimized ?? leader.layout.minimized
        if (effectiveMinimized) continue
        const z = layoutMap[leader.id]?.zIndex ?? leader.layout.zIndex ?? 0
        if (z > maxZ) {
          maxZ = z
          nextId = leader.id
        }
      }
      setFocusStoreActiveWindowId(nextId)
    },
    [storageKey, setFocusStoreActiveWindowId],
  )

  const toggleWindowFullscreen = useCallback(
    (windowId: string) => {
      store().toggleWindowFullscreen(storageKey, windowId)
    },
    [storageKey],
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncWindowBounds = () => {
      store().syncWindowBoundsFromViewport(storageKey)
    }

    window.addEventListener('resize', syncWindowBounds)
    return () => window.removeEventListener('resize', syncWindowBounds)
  }, [storageKey])

  const closeWindow = useCallback(
    (windowId: string) => {
      store().closeWindow(storageKey, windowId)
    },
    [storageKey],
  )

  const requestPlay = useCallback(
    ({ source, path, dir }: RequestPlayOptions) => {
      useWorkspacePlaybackStore.getState().playFile(storageKey, path, dir)
      store().requestPlay(storageKey, { source, path, isVideo: isVideoPath(path) })
    },
    [storageKey],
  )

  const snapWindowFn = useCallback(
    (windowId: string, zone: SnapZone) => {
      store().snapWindow(storageKey, windowId, zone)
    },
    [storageKey],
  )

  const unsnapWindow = useCallback(
    (windowId: string, dropPosition?: { x: number; y: number }) => {
      store().unsnapWindow(storageKey, windowId, dropPosition)
    },
    [storageKey],
  )

  const resizeSnappedWindow = useCallback(
    (
      windowId: string,
      newBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
      direction: string,
    ) => {
      store().resizeSnappedWindow(storageKey, windowId, newBounds, direction)
    },
    [storageKey],
  )

  const mergeWindowIntoGroup = useCallback(
    (windowId: string, targetWindowId: string, insertIndex?: number) => {
      store().mergeWindowIntoGroup(storageKey, windowId, targetWindowId, insertIndex)
    },
    [storageKey],
  )

  const splitWindowFromGroup = useCallback(
    (windowId: string, offsetBounds?: NonNullable<WorkspaceWindowLayout['bounds']>) => {
      store().splitWindowFromGroup(storageKey, windowId, offsetBounds)
    },
    [storageKey],
  )

  const setActiveTab = useCallback(
    (tabGroupId: string, windowId: string) => {
      setFocusStoreActiveTab(tabGroupId, windowId)
      setFocusStoreActiveWindowId(windowId)
    },
    [setFocusStoreActiveTab, setFocusStoreActiveWindowId],
  )

  const addTabToGroup = useCallback(
    (sourceWindowId: string) => {
      return store().addTabToGroup(storageKey, sourceWindowId)
    },
    [storageKey],
  )

  const openInNewTab = useCallback(
    (
      sourceWindowId: string,
      file: { path: string; isDirectory: boolean; isVirtual?: boolean },
      currentPath: string,
      sourceOverride?: WorkspaceSource,
      insertIndex?: number,
    ) => {
      const sourceWindow = windows.find((w) => w.id === sourceWindowId)
      if (!sourceWindow || file.isVirtual) return sourceWindowId
      const groupId = sourceWindow.tabGroupId || sourceWindowId
      const nextZ = store().sessions[storageKey]?.nextZIndex ?? 2
      const layout = sourceWindow.layout
        ? {
            ...sourceWindow.layout,
            minimized: false,
            zIndex: sourceWindow.layout.zIndex ?? nextZ,
          }
        : undefined
      const source = sourceOverride ?? sourceWindow.source

      let newWindowId: string
      if (file.isDirectory) {
        newWindowId = openBrowserWindow({
          source,
          initialState: { dir: file.path },
          tabGroupId: groupId,
          layout,
          insertIndex,
        })
      } else {
        const dir = file.path.split(/[/\\]/).slice(0, -1).join('/') || currentPath
        const title = file.path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer'
        newWindowId = openViewerWindow({
          source,
          title,
          initialState: { dir, viewing: file.path },
          tabGroupId: groupId,
          layout,
          insertIndex,
        })
      }
      setActiveTab(groupId, newWindowId)
      return newWindowId
    },
    [windows, openBrowserWindow, openViewerWindow, setActiveTab],
  )

  const updateWindowNavigationState = useCallback(
    (windowId: string, navState: Partial<NavigationState>) => {
      store().updateWindowNavigationState(storageKey, windowId, navState)
    },
    [storageKey],
  )

  const addPinnedItem = useCallback(
    (item: Omit<PinnedTaskbarItem, 'id'>) => {
      store().addPinnedItem(storageKey, item)
    },
    [storageKey],
  )

  const removePinnedItem = useCallback(
    (id: string) => {
      store().removePinnedItem(storageKey, id)
    },
    [storageKey],
  )

  const collectLayoutSnapshot = useCallback((): PersistedWorkspaceState => {
    const snap = store().collectLayoutSnapshot(storageKey)
    if (!snap) {
      const focus = useWorkspaceFocusStore.getState().getFocusState(storageKey)
      return {
        windows: [],
        activeWindowId: focus.activeWindowId,
        activeTabMap: focus.activeTabMap,
        nextWindowId: 2,
        pinnedTaskbarItems: [],
      }
    }
    return snap
  }, [storageKey])

  const currentLayoutSnapshotSerialized = useMemo(
    () => serializeWorkspacePersistedState(collectLayoutSnapshot()),
    [collectLayoutSnapshot],
  )

  const isLayoutDirty =
    layoutBaselineSerialized !== null &&
    currentLayoutSnapshotSerialized !== layoutBaselineSerialized

  const applyLayoutSnapshot = useCallback(
    (snapshot: PersistedWorkspaceState, options?: { baselinePresetId?: string | null }) => {
      const normalized = normalizePersistedWorkspaceState(snapshot)
      if (!normalized) return
      persistedRef.current = normalized
      store().applyLayoutSnapshot(storageKey, normalized, options)
    },
    [storageKey],
  )

  const revertLayoutToBaseline = useCallback(() => {
    const b = store().sessions[storageKey]?.layoutBaselineSnapshot
    if (!b) return
    applyLayoutSnapshot(b)
  }, [storageKey, applyLayoutSnapshot])

  const syncLayoutBaselineToCurrent = useCallback(() => {
    store().syncLayoutBaselineToCurrent(storageKey)
  }, [storageKey])

  const declareBaselinePresetId = useCallback(
    (id: string | null) => {
      store().setLayoutBaselinePresetId(storageKey, id)
    },
    [storageKey],
  )

  return useMemo(
    () => ({
      storageKey,
      windows,
      activeWindowId,
      playbackSource,
      activeTabMap,
      focusWindow,
      closeWindow,
      openBrowserWindow,
      openViewerWindow,
      openPlayerWindow,
      updateWindowBounds,
      updateWindowPresentation,
      setWindowMinimized,
      toggleWindowFullscreen,
      snapWindow: snapWindowFn,
      unsnapWindow,
      resizeSnappedWindow,
      mergeWindowIntoGroup,
      splitWindowFromGroup,
      addTabToGroup,
      openInNewTab,
      setActiveTab,
      updateWindowNavigationState,
      requestPlay,
      pinnedTaskbarItems,
      addPinnedItem,
      removePinnedItem,
      collectLayoutSnapshot,
      applyLayoutSnapshot,
      revertLayoutToBaseline,
      syncLayoutBaselineToCurrent,
      isLayoutDirty,
      layoutBaselinePresetId,
      declareBaselinePresetId,
    }),
    [
      storageKey,
      windows,
      activeWindowId,
      activeTabMap,
      playbackSource,
      focusWindow,
      closeWindow,
      openBrowserWindow,
      openViewerWindow,
      openPlayerWindow,
      updateWindowBounds,
      updateWindowPresentation,
      setWindowMinimized,
      toggleWindowFullscreen,
      snapWindowFn,
      unsnapWindow,
      resizeSnappedWindow,
      mergeWindowIntoGroup,
      splitWindowFromGroup,
      addTabToGroup,
      openInNewTab,
      setActiveTab,
      updateWindowNavigationState,
      requestPlay,
      pinnedTaskbarItems,
      addPinnedItem,
      removePinnedItem,
      collectLayoutSnapshot,
      applyLayoutSnapshot,
      revertLayoutToBaseline,
      syncLayoutBaselineToCurrent,
      isLayoutDirty,
      layoutBaselinePresetId,
      declareBaselinePresetId,
    ],
  )
}
