import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMediaType } from '@/lib/media-utils'
import { useInMemoryNavigationSession, type NavigationState } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { MediaType } from '@/lib/types'

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

interface OpenWorkspaceWindowOptions {
  title?: string
  source?: WorkspaceSource
  initialState?: Partial<NavigationState>
  tabGroupId?: string | null
  layout?: WorkspaceWindowLayout
}

interface ShareConfig {
  token: string
  sharePath: string
}

interface UseWorkspaceOptions {
  initialDir?: string | null
  shareConfig?: ShareConfig | null
}

interface RequestPlayOptions {
  source: WorkspaceSource
  path: string
  dir?: string
}

interface UseWorkspaceResult {
  windows: WorkspaceWindowDefinition[]
  activeWindowId: string | null
  playbackSource: WorkspaceSource | null
  playbackSession: ReturnType<typeof useInMemoryNavigationSession>
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
  mergeWindowIntoGroup: (windowId: string, targetWindowId: string) => void
  splitWindowFromGroup: (
    windowId: string,
    offsetBounds?: NonNullable<WorkspaceWindowLayout['bounds']>,
  ) => void
  addTabToGroup: (sourceWindowId: string) => string
  openInNewTab: (
    sourceWindowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
  ) => string
  setActiveTab: (tabGroupId: string, windowId: string) => void
  updateWindowNavigationState: (windowId: string, state: Partial<NavigationState>) => void
  requestPlay: (options: RequestPlayOptions) => void
}

const DEFAULT_WORKSPACE_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }
const PLAYER_WINDOW_ID = 'workspace-player-window'
const TASKBAR_HEIGHT = 44
const PLAYER_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'])
const SNAP_SIBLING_MAP: Record<SnapZone, Record<string, SnapZone[]>> = {
  left: { right: ['right', 'top-right', 'bottom-right'] },
  right: { left: ['left', 'top-left', 'bottom-left'] },
  'top-left': { right: ['top-right'], bottom: ['bottom-left'] },
  'top-right': { left: ['top-left'], bottom: ['bottom-right'] },
  'bottom-left': { right: ['bottom-right'], top: ['top-left'] },
  'bottom-right': { left: ['bottom-left'], top: ['top-right'] },
  'left-third': { right: ['center-third', 'right-two-thirds'] },
  'center-third': { left: ['left-third'], right: ['right-third'] },
  'right-third': { left: ['center-third', 'left-two-thirds'] },
  'left-two-thirds': { right: ['right-third'] },
  'right-two-thirds': { left: ['left-third'] },
  'top-left-third': { right: ['top-center-third'], bottom: ['bottom-left-third'] },
  'top-center-third': {
    left: ['top-left-third'],
    right: ['top-right-third'],
    bottom: ['bottom-center-third'],
  },
  'top-right-third': { left: ['top-center-third'], bottom: ['bottom-right-third'] },
  'bottom-left-third': { right: ['bottom-center-third'], top: ['top-left-third'] },
  'bottom-center-third': {
    left: ['bottom-left-third'],
    right: ['bottom-right-third'],
    top: ['top-center-third'],
  },
  'bottom-right-third': { left: ['bottom-center-third'], top: ['top-right-third'] },
}

const STORAGE_KEY = 'workspace-state'
const SAVE_DEBOUNCE_MS = 500

interface PersistedWorkspaceState {
  windows: WorkspaceWindowDefinition[]
  activeWindowId: string | null
  activeTabMap: Record<string, string>
  nextWindowId: number
}

function saveWorkspaceState(state: PersistedWorkspaceState, key: string = STORAGE_KEY) {
  try {
    const serializable = {
      ...state,
      windows: state.windows.filter((w) => w.id !== PLAYER_WINDOW_ID),
    }
    localStorage.setItem(key, JSON.stringify(serializable))
  } catch {}
}

function loadWorkspaceState(key: string = STORAGE_KEY): PersistedWorkspaceState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedWorkspaceState
    if (!Array.isArray(parsed.windows) || parsed.windows.length === 0) return null

    const viewport = getViewportSize()
    const validatedWindows = parsed.windows
      .filter(
        (w): w is WorkspaceWindowDefinition =>
          !!w && typeof w.id === 'string' && typeof w.type === 'string' && !!w.source,
      )
      .map((w) => {
        if (!w.layout?.bounds) return w
        const b = w.layout.bounds
        return {
          ...w,
          layout: {
            ...w.layout,
            bounds: {
              x: Math.max(0, Math.min(b.x, viewport.width - 100)),
              y: Math.max(0, Math.min(b.y, viewport.height - 100)),
              width: Math.min(b.width, viewport.width),
              height: Math.min(b.height, viewport.height),
            },
          },
        }
      })

    if (validatedWindows.length === 0) return null

    return {
      windows: validatedWindows,
      activeWindowId: parsed.activeWindowId,
      activeTabMap: parsed.activeTabMap ?? {},
      nextWindowId: parsed.nextWindowId ?? validatedWindows.length + 1,
    }
  } catch {
    return null
  }
}

function getSourceLabel(source: WorkspaceSource): string {
  return source.kind === 'share' ? 'Share' : 'Browser'
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 720 }
  }

  return {
    width: window.innerWidth,
    height: Math.max(window.innerHeight - TASKBAR_HEIGHT, 480),
  }
}

function createDefaultBounds(
  index: number,
  type: WorkspaceWindowDefinition['type'],
): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()
  const maxWidth = Math.max(viewport.width - 48, 420)
  const maxHeight = Math.max(viewport.height - 48, 320)

  if (type === 'player') {
    const width = Math.min(Math.max(Math.round(viewport.width * 0.62), 720), maxWidth)
    const height = Math.min(Math.max(Math.round(viewport.height * 0.62), 420), maxHeight)

    return {
      x: Math.max(Math.round((viewport.width - width) / 2), 16),
      y: Math.max(Math.round((viewport.height - height) / 2), 16),
      width,
      height,
    }
  }

  const width = Math.min(Math.max(Math.round(viewport.width * 0.34), 420), maxWidth)
  const height = Math.min(Math.max(Math.round(viewport.height * 0.58), 360), maxHeight)
  const offset = index * 28

  return {
    x: Math.min(24 + offset, Math.max(viewport.width - width - 16, 16)),
    y: Math.min(24 + offset, Math.max(viewport.height - height - 16, 16)),
    width,
    height,
  }
}

function createFullscreenBounds(): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()

  return {
    x: 0,
    y: 0,
    width: Math.max(viewport.width, 360),
    height: Math.max(viewport.height, 240),
  }
}

export function snapZoneToBounds(zone: SnapZone): NonNullable<WorkspaceWindowLayout['bounds']> {
  return snapZoneToBoundsWithOccupied(zone, [])
}

const LEFT_SIDE_ZONES: SnapZone[] = [
  'left',
  'top-left',
  'bottom-left',
  'left-third',
  'left-two-thirds',
  'top-left-third',
  'bottom-left-third',
]
const RIGHT_SIDE_ZONES: SnapZone[] = [
  'right',
  'top-right',
  'bottom-right',
  'right-third',
  'right-two-thirds',
  'top-right-third',
  'bottom-right-third',
]
const TOP_SIDE_ZONES: SnapZone[] = [
  'top-left',
  'top-right',
  'top-left-third',
  'top-center-third',
  'top-right-third',
]
const BOTTOM_SIDE_ZONES: SnapZone[] = [
  'bottom-left',
  'bottom-right',
  'bottom-left-third',
  'bottom-center-third',
  'bottom-right-third',
]

export function snapZoneToBoundsWithOccupied(
  zone: SnapZone,
  occupied: ReadonlyArray<{
    bounds: NonNullable<WorkspaceWindowLayout['bounds']>
    snapZone: SnapZone
  }>,
): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()
  const halfW = Math.round(viewport.width / 2)
  const halfH = Math.round(viewport.height / 2)
  const thirdW = Math.round(viewport.width / 3)
  const twoThirdW = Math.round((viewport.width * 2) / 3)

  const defaultBounds: NonNullable<WorkspaceWindowLayout['bounds']> = (() => {
    switch (zone) {
      case 'left':
        return { x: 0, y: 0, width: halfW, height: viewport.height }
      case 'right':
        return { x: halfW, y: 0, width: viewport.width - halfW, height: viewport.height }
      case 'top-left':
        return { x: 0, y: 0, width: halfW, height: halfH }
      case 'top-right':
        return { x: halfW, y: 0, width: viewport.width - halfW, height: halfH }
      case 'bottom-left':
        return { x: 0, y: halfH, width: halfW, height: viewport.height - halfH }
      case 'bottom-right':
        return {
          x: halfW,
          y: halfH,
          width: viewport.width - halfW,
          height: viewport.height - halfH,
        }
      case 'left-third':
        return { x: 0, y: 0, width: thirdW, height: viewport.height }
      case 'center-third':
        return { x: thirdW, y: 0, width: twoThirdW - thirdW, height: viewport.height }
      case 'right-third':
        return { x: twoThirdW, y: 0, width: viewport.width - twoThirdW, height: viewport.height }
      case 'left-two-thirds':
        return { x: 0, y: 0, width: twoThirdW, height: viewport.height }
      case 'right-two-thirds':
        return { x: thirdW, y: 0, width: viewport.width - thirdW, height: viewport.height }
      case 'top-left-third':
        return { x: 0, y: 0, width: thirdW, height: halfH }
      case 'top-center-third':
        return { x: thirdW, y: 0, width: twoThirdW - thirdW, height: halfH }
      case 'top-right-third':
        return { x: twoThirdW, y: 0, width: viewport.width - twoThirdW, height: halfH }
      case 'bottom-left-third':
        return { x: 0, y: halfH, width: thirdW, height: viewport.height - halfH }
      case 'bottom-center-third':
        return { x: thirdW, y: halfH, width: twoThirdW - thirdW, height: viewport.height - halfH }
      case 'bottom-right-third':
        return {
          x: twoThirdW,
          y: halfH,
          width: viewport.width - twoThirdW,
          height: viewport.height - halfH,
        }
    }
  })()

  if (occupied.length === 0) return defaultBounds

  const leftOccupied = occupied.filter((o) => LEFT_SIDE_ZONES.includes(o.snapZone))
  const rightOccupied = occupied.filter((o) => RIGHT_SIDE_ZONES.includes(o.snapZone))
  const topOccupied = occupied.filter((o) => TOP_SIDE_ZONES.includes(o.snapZone))
  const bottomOccupied = occupied.filter((o) => BOTTOM_SIDE_ZONES.includes(o.snapZone))

  let { x, y, width, height } = defaultBounds

  if (RIGHT_SIDE_ZONES.includes(zone) && leftOccupied.length > 0) {
    const leftEdge = Math.max(...leftOccupied.map((o) => o.bounds.x + o.bounds.width))
    x = leftEdge
    width = viewport.width - leftEdge
  }
  if (LEFT_SIDE_ZONES.includes(zone) && rightOccupied.length > 0) {
    const rightEdge = Math.min(...rightOccupied.map((o) => o.bounds.x))
    width = rightEdge
  }
  if (BOTTOM_SIDE_ZONES.includes(zone) && topOccupied.length > 0) {
    const topEdge = Math.max(...topOccupied.map((o) => o.bounds.y + o.bounds.height))
    y = topEdge
    height = viewport.height - topEdge
  }
  if (TOP_SIDE_ZONES.includes(zone) && bottomOccupied.length > 0) {
    const bottomEdge = Math.min(...bottomOccupied.map((o) => o.bounds.y))
    height = bottomEdge - y
  }

  return { x, y, width, height }
}

function createWindowLayout(
  layout: WorkspaceWindowLayout | undefined,
  fallbackBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
  zIndex: number,
): WorkspaceWindowLayout {
  return {
    bounds: layout?.bounds ?? fallbackBounds,
    fullscreen: layout?.fullscreen ?? false,
    snapZone: layout?.snapZone ?? null,
    minimized: layout?.minimized ?? false,
    zIndex: layout?.zIndex ?? zIndex,
    restoreBounds: layout?.restoreBounds ?? null,
  }
}

function getPlaybackTitle(path: string | undefined) {
  if (!path) return 'Video Player'

  const normalized = path.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop()
  return fileName || 'Video Player'
}

function isVideoPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension ? PLAYER_EXTENSIONS.has(extension) : false
}

function getInitialWindowIcon(
  type: WorkspaceWindowDefinition['type'],
  initialState: Partial<NavigationState>,
): Pick<WorkspaceWindowDefinition, 'iconPath' | 'iconType' | 'iconIsVirtual'> {
  if (type === 'browser') {
    return {
      iconPath: initialState.dir ?? '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
    }
  }

  if (type === 'player') {
    return {
      iconPath: initialState.playing ?? '',
      iconType: MediaType.VIDEO,
      iconIsVirtual: false,
    }
  }

  if (type === 'viewer' && initialState.viewing) {
    return {
      iconPath: initialState.viewing,
      iconType: getMediaType(initialState.viewing.split('.').pop() ?? ''),
      iconIsVirtual: false,
    }
  }

  return {
    iconPath: '',
    iconType: MediaType.OTHER,
    iconIsVirtual: false,
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

export function useWorkspace({
  initialDir = null,
  shareConfig = null,
}: UseWorkspaceOptions = {}): UseWorkspaceResult {
  const storageKey = shareConfig ? `${STORAGE_KEY}-share-${shareConfig.token}` : STORAGE_KEY

  const defaultSource: WorkspaceSource = useMemo(
    () =>
      shareConfig
        ? { kind: 'share', token: shareConfig.token, sharePath: shareConfig.sharePath }
        : DEFAULT_WORKSPACE_SOURCE,
    [shareConfig],
  )

  const playbackSession = useInMemoryNavigationSession()
  const nextWindowIdRef = useRef(2)
  const nextZIndexRef = useRef(2)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistedRef = useRef<PersistedWorkspaceState | null | undefined>(undefined)

  function getPersistedState() {
    if (persistedRef.current === undefined) {
      persistedRef.current = loadWorkspaceState(storageKey)
    }
    return persistedRef.current
  }

  const [windows, setWindows] = useState<WorkspaceWindowDefinition[]>(() => {
    // When opening with an explicit folder (e.g. "Open in Workspace"), use a fresh
    // single-window layout for that folder instead of restoring the saved layout.
    const hasExplicitFolder = initialDir != null && initialDir !== ''
    if (hasExplicitFolder) {
      return [
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
        } satisfies WorkspaceWindowDefinition,
      ]
    }
    const persisted = getPersistedState()
    if (persisted) {
      const maxId = persisted.windows.reduce((max, w) => {
        const match = w.id.match(/workspace-window-(\d+)/)
        return match ? Math.max(max, Number(match[1])) : max
      }, 1)
      const maxZ = persisted.windows.reduce((max, w) => Math.max(max, w.layout?.zIndex ?? 0), 1)
      nextWindowIdRef.current = Math.max(persisted.nextWindowId, maxId + 1)
      nextZIndexRef.current = maxZ + 1
      return persisted.windows
    }
    return [
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
      } satisfies WorkspaceWindowDefinition,
    ]
  })
  const [activeWindowId, setActiveWindowId] = useState<string | null>(() => {
    const hasExplicitFolder = initialDir != null && initialDir !== ''
    if (hasExplicitFolder) return 'workspace-window-1'
    return getPersistedState()?.activeWindowId ?? 'workspace-window-1'
  })
  const [activeTabMap, setActiveTabMap] = useState<Record<string, string>>(() => {
    const hasExplicitFolder = initialDir != null && initialDir !== ''
    if (hasExplicitFolder) return {}
    return getPersistedState()?.activeTabMap ?? {}
  })
  const [playbackSource, setPlaybackSource] = useState<WorkspaceSource | null>(defaultSource)

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveWorkspaceState(
        {
          windows,
          activeWindowId,
          activeTabMap,
          nextWindowId: nextWindowIdRef.current,
        },
        storageKey,
      )
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [windows, activeWindowId, activeTabMap, storageKey])

  const updateWindow = useCallback(
    (
      windowId: string,
      updater: (window: WorkspaceWindowDefinition) => WorkspaceWindowDefinition,
    ) => {
      setWindows((current) => {
        let changed = false
        const next = current.map((w) => {
          if (w.id !== windowId) return w
          const updated = updater(w)
          if (updated !== w) changed = true
          return updated
        })
        return changed ? next : current
      })
    },
    [],
  )

  const createWindow = useCallback(
    (
      type: WorkspaceWindowDefinition['type'],
      {
        title,
        source = defaultSource,
        initialState = {},
        tabGroupId = null,
        layout = {},
      }: OpenWorkspaceWindowOptions,
    ) => {
      const id = `workspace-window-${nextWindowIdRef.current++}`
      const zIndex = nextZIndexRef.current++
      const windowCount = windows.filter((window) => window.type === type).length
      const initialIcon = getInitialWindowIcon(type, initialState)
      const nextWindow: WorkspaceWindowDefinition = {
        id,
        type,
        title:
          title ??
          `${type === 'viewer' ? 'Viewer' : type === 'player' ? 'Player' : getSourceLabel(source)} ${
            windowCount + 1
          }`,
        iconName: null,
        ...initialIcon,
        source,
        initialState,
        tabGroupId,
        layout: createWindowLayout(layout, createDefaultBounds(windows.length, type), zIndex),
      }

      setWindows((current) => [...current, nextWindow])
      setActiveWindowId(id)
      return id
    },
    [windows, defaultSource],
  )

  const openBrowserWindow = useCallback(
    (options: OpenWorkspaceWindowOptions = {}) => createWindow('browser', options),
    [createWindow],
  )

  const focusWindow = useCallback(
    (windowId: string) => {
      const zIndex = nextZIndexRef.current++
      updateWindow(windowId, (window) => ({
        ...window,
        layout: {
          ...window.layout,
          minimized: false,
          zIndex,
        },
      }))
      setActiveWindowId(windowId)
    },
    [updateWindow],
  )

  const openPlayerWindow = useCallback(
    (options?: Pick<RequestPlayOptions, 'source' | 'path'>) => {
      const playingPath = options?.path ?? playbackSession.state.playing
      if (!playingPath || !isVideoPath(playingPath)) {
        return null
      }

      const existing = windows.find((window) => window.id === PLAYER_WINDOW_ID)
      const source = options?.source ?? playbackSource ?? defaultSource
      const zIndex = nextZIndexRef.current++

      if (existing) {
        updateWindow(PLAYER_WINDOW_ID, (window) => ({
          ...window,
          title: getPlaybackTitle(playingPath),
          source,
          layout: {
            ...window.layout,
            minimized: false,
            zIndex,
          },
        }))
        setActiveWindowId(PLAYER_WINDOW_ID)
        return PLAYER_WINDOW_ID
      }

      const nextWindow: WorkspaceWindowDefinition = {
        id: PLAYER_WINDOW_ID,
        type: 'player',
        title: getPlaybackTitle(playingPath),
        iconName: null,
        iconPath: playingPath,
        iconType: MediaType.VIDEO,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(
          undefined,
          createDefaultBounds(windows.length, 'player'),
          zIndex,
        ),
      }

      setWindows((current) => [...current, nextWindow])
      setActiveWindowId(PLAYER_WINDOW_ID)
      return PLAYER_WINDOW_ID
    },
    [playbackSession.state.playing, playbackSource, defaultSource, updateWindow, windows],
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
      updateWindow(windowId, (window) => ({
        ...window,
        layout: {
          ...window.layout,
          minimized,
        },
      }))
      setActiveWindowId((current) => (current === windowId && minimized ? null : windowId))
    },
    [updateWindow],
  )

  const toggleWindowFullscreen = useCallback(
    (windowId: string) => {
      const zIndex = nextZIndexRef.current++
      updateWindow(windowId, (window) => {
        const currentBounds = window.layout?.bounds ?? createDefaultBounds(0, window.type)
        const isFullscreen = window.layout?.fullscreen ?? false

        return {
          ...window,
          layout: {
            ...window.layout,
            fullscreen: !isFullscreen,
            snapZone: null,
            minimized: false,
            zIndex,
            bounds: isFullscreen
              ? (window.layout?.restoreBounds ?? currentBounds)
              : createFullscreenBounds(),
            restoreBounds: isFullscreen ? null : currentBounds,
          },
        }
      })
      setActiveWindowId(windowId)
    },
    [updateWindow],
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncWindowBounds = () => {
      const fsBounds = createFullscreenBounds()

      setWindows((current) => {
        let hasChanges = false

        const nextWindows = current.map((w) => {
          if (w.layout?.fullscreen) {
            const cur = w.layout.bounds
            if (
              cur &&
              cur.x === fsBounds.x &&
              cur.y === fsBounds.y &&
              cur.width === fsBounds.width &&
              cur.height === fsBounds.height
            ) {
              return w
            }
            hasChanges = true
            return { ...w, layout: { ...w.layout, bounds: fsBounds } }
          }

          if (w.layout?.snapZone) {
            const snapBounds = snapZoneToBounds(w.layout.snapZone)
            const cur = w.layout.bounds
            if (
              cur &&
              cur.x === snapBounds.x &&
              cur.y === snapBounds.y &&
              cur.width === snapBounds.width &&
              cur.height === snapBounds.height
            ) {
              return w
            }
            hasChanges = true
            return { ...w, layout: { ...w.layout, bounds: snapBounds } }
          }

          return w
        })

        return hasChanges ? nextWindows : current
      })
    }

    window.addEventListener('resize', syncWindowBounds)
    return () => window.removeEventListener('resize', syncWindowBounds)
  }, [])

  const closeWindow = useCallback(
    (windowId: string) => {
      setWindows((current) => {
        const nextWindows = current.filter((window) => window.id !== windowId)
        setActiveWindowId((currentActive) => {
          if (currentActive !== windowId) {
            return currentActive
          }

          return nextWindows.at(-1)?.id ?? null
        })
        return nextWindows
      })
    },
    [setWindows],
  )

  const requestPlay = useCallback(
    ({ source, path, dir }: RequestPlayOptions) => {
      setPlaybackSource(source)
      playbackSession.playFile(path, dir)

      if (isVideoPath(path)) {
        const zIndex = nextZIndexRef.current++
        setWindows((current) => {
          const existing = current.find((window) => window.id === PLAYER_WINDOW_ID)
          if (!existing) {
            return [
              ...current,
              {
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
                  createDefaultBounds(current.length, 'player'),
                  zIndex,
                ),
              },
            ]
          }

          return current.map((window) =>
            window.id === PLAYER_WINDOW_ID
              ? {
                  ...window,
                  title: getPlaybackTitle(path),
                  iconPath: path,
                  iconType: MediaType.VIDEO,
                  iconIsVirtual: false,
                  source,
                  layout: {
                    ...window.layout,
                    minimized: false,
                    zIndex,
                  },
                }
              : window,
          )
        })
        setActiveWindowId(PLAYER_WINDOW_ID)
        return
      }

      setWindows((current) => current.filter((window) => window.id !== PLAYER_WINDOW_ID))
      setActiveWindowId((current) => (current === PLAYER_WINDOW_ID ? null : current))
    },
    [playbackSession],
  )

  const snapWindowFn = useCallback((windowId: string, zone: SnapZone) => {
    const zIndex = nextZIndexRef.current++
    setWindows((current) => {
      const occupied = current
        .filter((w) => w.id !== windowId && w.layout?.snapZone && w.layout?.bounds)
        .map((w) => ({ bounds: w.layout!.bounds!, snapZone: w.layout!.snapZone! }))
      const snapBounds = snapZoneToBoundsWithOccupied(zone, occupied)
      return current.map((w) =>
        w.id === windowId
          ? {
              ...w,
              layout: {
                ...w.layout,
                fullscreen: false,
                snapZone: zone,
                minimized: false,
                zIndex,
                bounds: snapBounds,
                restoreBounds: w.layout?.restoreBounds ?? w.layout?.bounds ?? null,
              },
            }
          : w,
      )
    })
    setActiveWindowId(windowId)
  }, [])

  const unsnapWindow = useCallback(
    (windowId: string, dropPosition?: { x: number; y: number }) => {
      updateWindow(windowId, (w) => {
        const restored = w.layout?.restoreBounds ?? w.layout?.bounds
        return {
          ...w,
          layout: {
            ...w.layout,
            snapZone: null,
            fullscreen: false,
            bounds:
              dropPosition && restored
                ? {
                    x: dropPosition.x,
                    y: dropPosition.y,
                    width: restored.width,
                    height: restored.height,
                  }
                : (restored ?? null),
            restoreBounds: null,
          },
        }
      })
    },
    [updateWindow],
  )

  const resizeSnappedWindow = useCallback(
    (
      windowId: string,
      newBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
      direction: string,
    ) => {
      setWindows((current) => {
        const target = current.find((w) => w.id === windowId)
        if (!target?.layout?.snapZone || !target.layout.bounds) {
          return current.map((w) =>
            w.id === windowId ? { ...w, layout: { ...w.layout, bounds: newBounds } } : w,
          )
        }

        const oldBounds = target.layout.bounds
        const siblings = SNAP_SIBLING_MAP[target.layout.snapZone] ?? {}
        const affectedZones = new Set<SnapZone>()
        for (const zones of Object.values(siblings)) {
          for (const z of zones) affectedZones.add(z)
        }

        return current.map((w) => {
          if (w.id === windowId) {
            return { ...w, layout: { ...w.layout, bounds: newBounds } }
          }

          if (!w.layout?.snapZone || !w.layout.bounds || !affectedZones.has(w.layout.snapZone)) {
            return w
          }

          const wb = { ...w.layout.bounds }

          if (
            direction.includes('right') &&
            newBounds.x + newBounds.width !== oldBounds.x + oldBounds.width
          ) {
            const delta = newBounds.x + newBounds.width - (oldBounds.x + oldBounds.width)
            if (siblings.right?.includes(w.layout.snapZone)) {
              wb.x += delta
              wb.width -= delta
            }
          }
          if (direction.includes('left') && newBounds.x !== oldBounds.x) {
            const delta = newBounds.x - oldBounds.x
            if (siblings.left?.includes(w.layout.snapZone)) {
              wb.width += delta
            }
          }
          if (
            direction.includes('bottom') &&
            newBounds.y + newBounds.height !== oldBounds.y + oldBounds.height
          ) {
            const delta = newBounds.y + newBounds.height - (oldBounds.y + oldBounds.height)
            if (siblings.bottom?.includes(w.layout.snapZone)) {
              wb.y += delta
              wb.height -= delta
            }
          }
          if (direction.includes('top') && newBounds.y !== oldBounds.y) {
            const delta = newBounds.y - oldBounds.y
            if (siblings.top?.includes(w.layout.snapZone)) {
              wb.height += delta
            }
          }

          if (
            wb.x === w.layout.bounds.x &&
            wb.y === w.layout.bounds.y &&
            wb.width === w.layout.bounds.width &&
            wb.height === w.layout.bounds.height
          ) {
            return w
          }

          return { ...w, layout: { ...w.layout, bounds: wb } }
        })
      })
    },
    [],
  )

  const mergeWindowIntoGroup = useCallback(
    (windowId: string, targetWindowId: string) => {
      setWindows((current) => {
        const target = current.find((w) => w.id === targetWindowId)
        if (!target) return current

        const groupId = target.tabGroupId || targetWindowId
        return current.map((w) => {
          if (w.id === targetWindowId && !w.tabGroupId) {
            return { ...w, tabGroupId: groupId }
          }
          if (w.id === windowId) {
            return {
              ...w,
              tabGroupId: groupId,
              layout: { ...w.layout, bounds: target.layout?.bounds, zIndex: target.layout?.zIndex },
            }
          }
          return w
        })
      })
      setActiveTabMap((prev) => {
        const target = windows.find((w) => w.id === targetWindowId)
        const groupId = target?.tabGroupId || targetWindowId
        return { ...prev, [groupId]: windowId }
      })
    },
    [windows],
  )

  const splitWindowFromGroup = useCallback(
    (windowId: string, offsetBounds?: NonNullable<WorkspaceWindowLayout['bounds']>) => {
      setWindows((current) => {
        const w = current.find((win) => win.id === windowId)
        if (!w?.tabGroupId) return current

        const groupId = w.tabGroupId
        const groupWindows = current.filter((win) => win.tabGroupId === groupId)
        const defaultBounds =
          offsetBounds ??
          (() => {
            const base = w.layout?.bounds ?? createDefaultBounds(0, w.type)
            return { x: base.x + 30, y: base.y + 30, width: base.width, height: base.height }
          })()

        const nextWindows = current.map((win) => {
          if (win.id === windowId) {
            return {
              ...win,
              tabGroupId: null,
              layout: { ...win.layout, bounds: defaultBounds, zIndex: nextZIndexRef.current++ },
            }
          }
          return win
        })

        if (groupWindows.length === 2) {
          return nextWindows.map((win) =>
            win.tabGroupId === groupId ? { ...win, tabGroupId: null } : win,
          )
        }

        return nextWindows
      })

      setActiveTabMap((prev) => {
        const w = windows.find((win) => win.id === windowId)
        if (!w?.tabGroupId) return prev
        const groupId = w.tabGroupId
        const remaining = windows.filter((win) => win.tabGroupId === groupId && win.id !== windowId)
        if (remaining.length === 0) {
          const { [groupId]: _, ...rest } = prev
          return rest
        }
        if (prev[groupId] === windowId) {
          return { ...prev, [groupId]: remaining[0].id }
        }
        return prev
      })

      setActiveWindowId(windowId)
    },
    [windows],
  )

  const setActiveTab = useCallback((tabGroupId: string, windowId: string) => {
    setActiveTabMap((prev) => ({ ...prev, [tabGroupId]: windowId }))
    setActiveWindowId(windowId)
  }, [])

  const addTabToGroup = useCallback(
    (sourceWindowId: string) => {
      const sourceWindow = windows.find((w) => w.id === sourceWindowId)
      if (!sourceWindow) return sourceWindowId

      const groupId = sourceWindow.tabGroupId || sourceWindowId
      const id = `workspace-window-${nextWindowIdRef.current++}`
      const zIndex = sourceWindow.layout?.zIndex ?? nextZIndexRef.current++

      const newWindow: WorkspaceWindowDefinition = {
        id,
        type: sourceWindow.type,
        title: '',
        iconName: null,
        iconPath: '',
        iconType: sourceWindow.type === 'browser' ? MediaType.FOLDER : MediaType.OTHER,
        iconIsVirtual: false,
        source: sourceWindow.source,
        initialState:
          sourceWindow.type === 'browser' ? { dir: sourceWindow.initialState.dir ?? null } : {},
        tabGroupId: groupId,
        layout: {
          bounds: sourceWindow.layout?.bounds,
          fullscreen: sourceWindow.layout?.fullscreen,
          snapZone: sourceWindow.layout?.snapZone,
          minimized: false,
          zIndex,
          restoreBounds: sourceWindow.layout?.restoreBounds,
        },
      }

      setWindows((current) => {
        const updated = current.map((w) => {
          if (w.id === sourceWindowId && !w.tabGroupId) {
            return { ...w, tabGroupId: groupId }
          }
          return w
        })
        return [...updated, newWindow]
      })

      setActiveTabMap((prev) => ({ ...prev, [groupId]: id }))
      setActiveWindowId(id)
      return id
    },
    [windows],
  )

  const openInNewTab = useCallback(
    (
      sourceWindowId: string,
      file: { path: string; isDirectory: boolean; isVirtual?: boolean },
      currentPath: string,
    ) => {
      const sourceWindow = windows.find((w) => w.id === sourceWindowId)
      if (!sourceWindow || file.isVirtual) return sourceWindowId
      const groupId = sourceWindow.tabGroupId || sourceWindowId
      const layout = sourceWindow.layout
        ? {
            ...sourceWindow.layout,
            minimized: false,
            zIndex: sourceWindow.layout.zIndex ?? nextZIndexRef.current++,
          }
        : undefined

      let newWindowId: string
      if (file.isDirectory) {
        newWindowId = openBrowserWindow({
          source: sourceWindow.source,
          initialState: { dir: file.path },
          tabGroupId: groupId,
          layout,
        })
      } else {
        const dir = file.path.split(/[/\\]/).slice(0, -1).join('/') || currentPath
        const title = file.path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer'
        newWindowId = openViewerWindow({
          source: sourceWindow.source,
          title,
          initialState: { dir, viewing: file.path },
          tabGroupId: groupId,
          layout,
        })
      }
      setActiveTab(groupId, newWindowId)
      return newWindowId
    },
    [windows, openBrowserWindow, openViewerWindow, setActiveTab],
  )

  const updateWindowNavigationState = useCallback(
    (windowId: string, navState: Partial<NavigationState>) => {
      updateWindow(windowId, (w) => {
        const currentDir = w.initialState.dir ?? null
        const currentViewing = w.initialState.viewing ?? null
        const nextDir = navState.dir ?? null
        const nextViewing = navState.viewing ?? null
        if (currentDir === nextDir && currentViewing === nextViewing) return w
        return {
          ...w,
          initialState: { ...w.initialState, dir: nextDir, viewing: nextViewing },
        }
      })
    },
    [updateWindow],
  )

  return useMemo(
    () => ({
      windows,
      activeWindowId,
      playbackSource,
      playbackSession,
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
    }),
    [
      windows,
      activeWindowId,
      playbackSource,
      playbackSession,
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
    ],
  )
}
