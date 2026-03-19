import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMediaType } from '@/lib/media-utils'
import { useInMemoryNavigationSession, type NavigationState } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { MediaType } from '@/lib/types'
import { useWorkspaceFocusStore } from '@/lib/workspace-focus-store'
import { parseWorkspaceTaskbarPins, type WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'

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

function insertWindowAtGroupIndex(
  current: WorkspaceWindowDefinition[],
  windowToInsert: WorkspaceWindowDefinition,
  groupId: string,
  insertIndex: number,
): WorkspaceWindowDefinition[] {
  const groupIndices: number[] = []
  current.forEach((w, i) => {
    const gid = w.tabGroupId ?? w.id
    if (gid === groupId) groupIndices.push(i)
  })
  const targetGlobalIndex =
    insertIndex >= groupIndices.length
      ? (groupIndices[groupIndices.length - 1] ?? -1) + 1
      : groupIndices[insertIndex]
  return [
    ...current.slice(0, targetGlobalIndex),
    windowToInsert,
    ...current.slice(targetGlobalIndex),
  ]
}

interface ShareConfig {
  token: string
  sharePath: string
}

interface UseWorkspaceOptions {
  initialDir?: string | null
  shareConfig?: ShareConfig | null
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
}

const DEFAULT_WORKSPACE_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }
const PLAYER_WINDOW_ID = 'workspace-player-window'
const TASKBAR_HEIGHT = 32
const PLAYER_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'])

export const SNAP_SIBLING_MAP: Record<SnapZone, Record<string, SnapZone[]>> = {
  left: { right: ['right', 'top-right', 'bottom-right'] },
  right: { left: ['left', 'top-left', 'bottom-left'] },
  'top-left': { right: ['top-right'], bottom: ['bottom-left'] },
  'top-right': { left: ['top-left'], bottom: ['bottom-right'] },
  'bottom-left': { right: ['bottom-right'], top: ['top-left', 'top-half'] },
  'bottom-right': { left: ['bottom-left'], top: ['top-right', 'top-half'] },
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
  'top-half': { bottom: ['bottom-half', 'bottom-left', 'bottom-right'] },
  'bottom-half': { top: ['top-half'] },
  'top-third': { bottom: ['middle-third'] },
  'middle-third': { top: ['top-third'], bottom: ['bottom-third'] },
  'bottom-third': { top: ['middle-third'] },
}

const STORAGE_KEY = 'workspace-state'
const SAVE_DEBOUNCE_MS = 500

interface PersistedWorkspaceState {
  windows: WorkspaceWindowDefinition[]
  activeWindowId: string | null
  activeTabMap: Record<string, string>
  nextWindowId: number
  pinnedTaskbarItems: PinnedTaskbarItem[]
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
      activeWindowId: parsed.activeWindowId,
      activeTabMap: parsed.activeTabMap ?? {},
      nextWindowId: parsed.nextWindowId ?? validatedWindows.length + 1,
      pinnedTaskbarItems,
    }
  } catch {
    return null
  }
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

export type WorkspaceBounds = NonNullable<WorkspaceWindowLayout['bounds']>

/** Height of the player window title bar (drag handle + border). Must match workspace window header. */
const PLAYER_WINDOW_HEADER_HEIGHT = 33

/**
 * Computes player window bounds that fit the viewport and match the given aspect ratio (width/height).
 * Accounts for the window title bar so the video content area has the correct aspect ratio.
 * Preserves window center when currentBounds is provided.
 */
export function getPlayerBoundsForAspectRatio(
  aspectRatio: number,
  currentBounds: WorkspaceBounds | null,
): WorkspaceBounds {
  const viewport = getViewportSize()
  const maxWidth = Math.max(viewport.width - 48, 420)
  const maxWindowHeight = Math.max(viewport.height - 48, 320)
  const maxContentHeight = maxWindowHeight - PLAYER_WINDOW_HEADER_HEIGHT
  const minWidth = 360
  const minWindowHeight = 240

  let contentWidth: number
  let contentHeight: number
  if (maxContentHeight * aspectRatio <= maxWidth) {
    contentHeight = maxContentHeight
    contentWidth = Math.round(contentHeight * aspectRatio)
  } else {
    contentWidth = maxWidth
    contentHeight = Math.round(contentWidth / aspectRatio)
  }
  let width = Math.max(minWidth, Math.min(maxWidth, contentWidth))
  let height = Math.round(width / aspectRatio) + PLAYER_WINDOW_HEADER_HEIGHT
  if (height > maxWindowHeight) {
    height = maxWindowHeight
    width = Math.round((height - PLAYER_WINDOW_HEADER_HEIGHT) * aspectRatio)
    width = Math.max(minWidth, Math.min(maxWidth, width))
  } else if (height < minWindowHeight) {
    height = minWindowHeight
    width = Math.round((height - PLAYER_WINDOW_HEADER_HEIGHT) * aspectRatio)
    width = Math.max(minWidth, Math.min(maxWidth, width))
  }

  let x: number
  let y: number
  if (currentBounds) {
    x = Math.round(currentBounds.x + (currentBounds.width - width) / 2)
    y = Math.round(currentBounds.y + (currentBounds.height - height) / 2)
  } else {
    x = Math.round((viewport.width - width) / 2)
    y = Math.round((viewport.height - height) / 2)
  }
  x = Math.max(16, Math.min(viewport.width - width - 16, x))
  y = Math.max(16, Math.min(viewport.height - height - 16, y))

  return { x, y, width, height }
}

function createDefaultBounds(
  index: number,
  type: WorkspaceWindowDefinition['type'],
): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()
  const maxWidth = Math.max(viewport.width - 48, 420)
  const maxHeight = Math.max(viewport.height - 48, 320)
  const isVertical = viewport.height > viewport.width

  if (type === 'player') {
    return getPlayerBoundsForAspectRatio(16 / 9, null)
  }

  let width: number
  let height: number
  if (isVertical) {
    width = Math.min(Math.max(Math.round(viewport.width * 0.9), 360), maxWidth)
    height = Math.min(Math.max(Math.round(viewport.height * 0.55), 360), maxHeight)
  } else {
    width = Math.min(Math.max(Math.round(viewport.width * 0.34), 420), maxWidth)
    height = Math.min(Math.max(Math.round(viewport.height * 0.58), 360), maxHeight)
  }

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
  'top-half',
  'top-third',
  'middle-third',
  'top-left-third',
  'top-center-third',
  'top-right-third',
]
const BOTTOM_SIDE_ZONES: SnapZone[] = [
  'bottom-left',
  'bottom-right',
  'bottom-half',
  'middle-third',
  'bottom-third',
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
  const thirdH = Math.round(viewport.height / 3)
  const twoThirdH = Math.round((viewport.height * 2) / 3)

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
      case 'top-half':
        return { x: 0, y: 0, width: viewport.width, height: halfH }
      case 'bottom-half':
        return { x: 0, y: halfH, width: viewport.width, height: viewport.height - halfH }
      case 'top-third':
        return { x: 0, y: 0, width: viewport.width, height: thirdH }
      case 'middle-third':
        return { x: 0, y: thirdH, width: viewport.width, height: twoThirdH - thirdH }
      case 'bottom-third':
        return { x: 0, y: twoThirdH, width: viewport.width, height: viewport.height - twoThirdH }
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

  const isThirdZone = zone.includes('third')
  const leftOccupied = occupied.filter((o) => LEFT_SIDE_ZONES.includes(o.snapZone))
  const rightOccupied = occupied.filter((o) => RIGHT_SIDE_ZONES.includes(o.snapZone))
  const topOccupied = occupied.filter((o) => TOP_SIDE_ZONES.includes(o.snapZone))
  const bottomOccupied = occupied.filter((o) => BOTTOM_SIDE_ZONES.includes(o.snapZone))

  let { x, y, width, height } = defaultBounds

  // Horizontal adjustment: skip for third zones to preserve 1/3 proportions.
  // The "fill remaining space" logic only makes sense for half-based layouts.
  if (!isThirdZone) {
    if (RIGHT_SIDE_ZONES.includes(zone) && leftOccupied.length > 0) {
      const leftEdge = Math.max(...leftOccupied.map((o) => o.bounds.x + o.bounds.width))
      x = leftEdge
      width = viewport.width - leftEdge
    }
    if (LEFT_SIDE_ZONES.includes(zone) && rightOccupied.length > 0) {
      const rightEdge = Math.min(...rightOccupied.map((o) => o.bounds.x))
      width = rightEdge
    }
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
  serverTaskbarPins = [],
  serverTaskbarPinsReady = false,
  persistTaskbarPinsToServer,
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
  const windowsRef = useRef<WorkspaceWindowDefinition[]>([])

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
      useWorkspaceFocusStore.getState().hydrateIfNeeded(storageKey, {
        activeWindowId: 'workspace-window-1',
        activeTabMap: {},
      })
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
      const layoutByWindowId: Record<string, { zIndex?: number; minimized?: boolean }> = {}
      for (const w of persisted.windows) {
        if (w.layout && (w.layout.zIndex != null || w.layout.minimized != null)) {
          layoutByWindowId[w.id] = {
            ...(w.layout.zIndex != null && { zIndex: w.layout.zIndex }),
            ...(w.layout.minimized != null && { minimized: w.layout.minimized }),
          }
        }
      }
      useWorkspaceFocusStore.getState().hydrateIfNeeded(storageKey, {
        activeWindowId: persisted.activeWindowId,
        activeTabMap: persisted.activeTabMap ?? {},
        layoutByWindowId: Object.keys(layoutByWindowId).length > 0 ? layoutByWindowId : undefined,
      })
      const maxId = persisted.windows.reduce((max, w) => {
        const match = w.id.match(/workspace-window-(\d+)/)
        return match ? Math.max(max, Number(match[1])) : max
      }, 1)
      const maxZ = persisted.windows.reduce((max, w) => Math.max(max, w.layout?.zIndex ?? 0), 1)
      nextWindowIdRef.current = Math.max(persisted.nextWindowId, maxId + 1)
      nextZIndexRef.current = maxZ + 1
      return persisted.windows
    }
    useWorkspaceFocusStore.getState().hydrateIfNeeded(storageKey, {
      activeWindowId: 'workspace-window-1',
      activeTabMap: {},
    })
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

  const focusState = useWorkspaceFocusStore((s) => s.byKey[storageKey] ?? null)
  const activeWindowId = focusState?.activeWindowId ?? null
  const activeTabMap = useMemo(() => focusState?.activeTabMap ?? {}, [focusState?.activeTabMap])

  const setFocusStoreActiveWindowId = useCallback(
    (id: string | null) => useWorkspaceFocusStore.getState().setActiveWindowId(storageKey, id),
    [storageKey],
  )
  const setFocusStoreActiveTab = useCallback(
    (tabGroupId: string, windowId: string) =>
      useWorkspaceFocusStore.getState().setActiveTab(storageKey, tabGroupId, windowId),
    [storageKey],
  )
  const setFocusStoreActiveTabMap = useCallback(
    (updater: (prev: Record<string, string>) => Record<string, string>) =>
      useWorkspaceFocusStore.getState().setActiveTabMap(storageKey, updater),
    [storageKey],
  )
  const [playbackSource, setPlaybackSource] = useState<WorkspaceSource | null>(defaultSource)
  const persistTaskbarPinsRef = useRef(persistTaskbarPinsToServer)
  persistTaskbarPinsRef.current = persistTaskbarPinsToServer
  const serverPinsHydratedRef = useRef(false)
  const pinsServerSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [pinnedTaskbarItems, setPinnedTaskbarItems] = useState<PinnedTaskbarItem[]>(() =>
    loadPinnedTaskbarItemsOnly(storageKey),
  )

  useEffect(() => {
    serverPinsHydratedRef.current = false
  }, [storageKey])

  useEffect(() => {
    if (!serverTaskbarPinsReady) return
    if (serverPinsHydratedRef.current) return
    const local = loadPinnedTaskbarItemsOnly(storageKey)
    if (serverTaskbarPins.length > 0) {
      setPinnedTaskbarItems(serverTaskbarPins)
    } else if (local.length > 0) {
      setPinnedTaskbarItems(local)
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
      saveWorkspaceState(
        {
          windows: windowsToSave,
          activeWindowId: focus.activeWindowId,
          activeTabMap: focus.activeTabMap,
          nextWindowId: nextWindowIdRef.current,
          pinnedTaskbarItems,
        },
        storageKey,
      )
    }, SAVE_DEBOUNCE_MS)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [windows, pinnedTaskbarItems, storageKey, focusState])

  windowsRef.current = windows

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
        insertIndex,
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

      setWindows((current) => {
        if (tabGroupId != null && insertIndex != null) {
          return insertWindowAtGroupIndex(current, nextWindow, tabGroupId, insertIndex)
        }
        return [...current, nextWindow]
      })
      setFocusStoreActiveWindowId(id)
      return id
    },
    [windows, defaultSource, setFocusStoreActiveWindowId],
  )

  const openBrowserWindow = useCallback(
    (options: OpenWorkspaceWindowOptions = {}) => createWindow('browser', options),
    [createWindow],
  )

  const focusWindow = useCallback(
    (windowId: string) => {
      const zIndex = nextZIndexRef.current++
      const current = windowsRef.current
      const focused = current.find((w) => w.id === windowId)
      const groupId = focused ? (focused.tabGroupId ?? focused.id) : null
      if (groupId != null) {
        const windowIds = current.filter((w) => (w.tabGroupId ?? w.id) === groupId).map((w) => w.id)
        useWorkspaceFocusStore.getState().setGroupLayoutOverlay(storageKey, windowIds, {
          zIndex,
          minimized: false,
        })
      }
      setFocusStoreActiveWindowId(windowId)
    },
    [storageKey, setFocusStoreActiveWindowId],
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
        setFocusStoreActiveWindowId(PLAYER_WINDOW_ID)
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
      setFocusStoreActiveWindowId(PLAYER_WINDOW_ID)
      return PLAYER_WINDOW_ID
    },
    [
      playbackSession.state.playing,
      playbackSource,
      defaultSource,
      updateWindow,
      windows,
      setFocusStoreActiveWindowId,
    ],
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
      setFocusStoreActiveWindowId(windowId)
    },
    [updateWindow, setFocusStoreActiveWindowId],
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
        const closedW = current.find((w) => w.id === windowId)
        const groupId = closedW?.tabGroupId

        if (groupId) {
          const remainingInGroup = nextWindows.filter((w) => (w.tabGroupId ?? w.id) === groupId)
          const nextTabId = remainingInGroup[0]?.id
          setFocusStoreActiveTabMap((prev) =>
            nextTabId && prev[groupId] === windowId ? { ...prev, [groupId]: nextTabId } : prev,
          )
        }

        const currentActive = useWorkspaceFocusStore
          .getState()
          .getFocusState(storageKey).activeWindowId
        if (currentActive === windowId) {
          let nextActive: string | null
          if (groupId) {
            const remainingInGroup = nextWindows.filter((w) => (w.tabGroupId ?? w.id) === groupId)
            nextActive = remainingInGroup[0]?.id ?? nextWindows.at(-1)?.id ?? null
          } else {
            nextActive = nextWindows.at(-1)?.id ?? null
          }
          setFocusStoreActiveWindowId(nextActive)
        }
        return nextWindows
      })
    },
    [storageKey, setFocusStoreActiveWindowId, setFocusStoreActiveTabMap],
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
        setFocusStoreActiveWindowId(PLAYER_WINDOW_ID)
        return
      }

      setWindows((current) => current.filter((window) => window.id !== PLAYER_WINDOW_ID))
      const currentActive = useWorkspaceFocusStore
        .getState()
        .getFocusState(storageKey).activeWindowId
      if (currentActive === PLAYER_WINDOW_ID) {
        setFocusStoreActiveWindowId(null)
      }
    },
    [playbackSession, storageKey, setFocusStoreActiveWindowId],
  )

  const snapWindowFn = useCallback(
    (windowId: string, zone: SnapZone) => {
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
      setFocusStoreActiveWindowId(windowId)
    },
    [setFocusStoreActiveWindowId],
  )

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
        if (!target?.layout?.bounds) {
          return current.map((w) =>
            w.id === windowId ? { ...w, layout: { ...w.layout, bounds: newBounds } } : w,
          )
        }

        const oldBounds = target.layout.bounds
        const siblings = (target.layout?.snapZone && SNAP_SIBLING_MAP[target.layout.snapZone]) ?? {}
        const affectedZones = new Set<SnapZone>()
        for (const zones of Object.values(siblings)) {
          for (const z of zones) affectedZones.add(z)
        }

        const siblingUpdates = new Map<string, NonNullable<WorkspaceWindowLayout['bounds']>>()
        const TOLERANCE = 5

        const isSpatialRightSibling = (w: (typeof current)[0]) => {
          const b = w.layout?.bounds
          if (!b) return false
          const targetRight = oldBounds.x + oldBounds.width
          return Math.abs(b.x - targetRight) <= TOLERANCE
        }
        const isSpatialLeftSibling = (w: (typeof current)[0]) => {
          const b = w.layout?.bounds
          if (!b) return false
          const siblingRight = b.x + b.width
          return Math.abs(siblingRight - oldBounds.x) <= TOLERANCE
        }
        const isSpatialBottomSibling = (w: (typeof current)[0]) => {
          const b = w.layout?.bounds
          if (!b) return false
          const targetBottom = oldBounds.y + oldBounds.height
          return Math.abs(b.y - targetBottom) <= TOLERANCE
        }
        const isSpatialTopSibling = (w: (typeof current)[0]) => {
          const b = w.layout?.bounds
          if (!b) return false
          const siblingBottom = b.y + b.height
          return Math.abs(siblingBottom - oldBounds.y) <= TOLERANCE
        }

        let next = current.map((w) => {
          if (w.id === windowId) {
            return { ...w, layout: { ...w.layout, bounds: newBounds } }
          }

          const hasZoneMatch = w.layout?.snapZone && affectedZones.has(w.layout.snapZone)
          const wb = { ...(w.layout?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }) }
          if (!w.layout?.bounds) return w

          let updated = false

          if (
            direction.includes('right') &&
            newBounds.x + newBounds.width !== oldBounds.x + oldBounds.width
          ) {
            const delta = newBounds.x + newBounds.width - (oldBounds.x + oldBounds.width)
            const isSibling = hasZoneMatch && siblings.right?.includes(w.layout.snapZone!)
            const isSpatial = !hasZoneMatch && isSpatialRightSibling(w)
            if (isSibling || isSpatial) {
              wb.x += delta
              wb.width -= delta
              updated = true
            }
          }
          if (direction.includes('left') && newBounds.x !== oldBounds.x) {
            const delta = newBounds.x - oldBounds.x
            const isSibling = hasZoneMatch && siblings.left?.includes(w.layout.snapZone!)
            const isSpatial = !hasZoneMatch && isSpatialLeftSibling(w)
            if (isSibling || isSpatial) {
              wb.width += delta
              updated = true
            }
          }
          if (
            direction.includes('bottom') &&
            newBounds.y + newBounds.height !== oldBounds.y + oldBounds.height
          ) {
            const delta = newBounds.y + newBounds.height - (oldBounds.y + oldBounds.height)
            const isSibling = hasZoneMatch && siblings.bottom?.includes(w.layout.snapZone!)
            const isSpatial = !hasZoneMatch && isSpatialBottomSibling(w)
            if (isSibling || isSpatial) {
              wb.y += delta
              wb.height -= delta
              updated = true
            }
          }
          if (direction.includes('top') && newBounds.y !== oldBounds.y) {
            const delta = newBounds.y - oldBounds.y
            const isSibling = hasZoneMatch && siblings.top?.includes(w.layout.snapZone!)
            const isSpatial = !hasZoneMatch && isSpatialTopSibling(w)
            if (isSibling || isSpatial) {
              wb.height += delta
              updated = true
            }
          }

          if (
            !updated ||
            (wb.x === w.layout.bounds.x &&
              wb.y === w.layout.bounds.y &&
              wb.width === w.layout.bounds.width &&
              wb.height === w.layout.bounds.height)
          ) {
            return w
          }

          const groupId = w.tabGroupId ?? w.id
          siblingUpdates.set(groupId, wb)
          return { ...w, layout: { ...w.layout, bounds: wb } }
        })

        if (siblingUpdates.size > 0) {
          next = next.map((w) => {
            const gid = w.tabGroupId ?? w.id
            const syncBounds = siblingUpdates.get(gid)
            if (syncBounds && w.id !== windowId) {
              const b = w.layout?.bounds
              if (
                !b ||
                b.x !== syncBounds.x ||
                b.y !== syncBounds.y ||
                b.width !== syncBounds.width ||
                b.height !== syncBounds.height
              ) {
                return { ...w, layout: { ...w.layout, bounds: syncBounds } }
              }
            }
            return w
          })
        }

        return next
      })
    },
    [],
  )

  const mergeWindowIntoGroup = useCallback(
    (windowId: string, targetWindowId: string, insertIndex?: number) => {
      setWindows((current) => {
        const target = current.find((w) => w.id === targetWindowId)
        const moved = current.find((w) => w.id === windowId)
        if (!target || !moved) return current

        const groupId = target.tabGroupId || targetWindowId
        const updatedMoved: WorkspaceWindowDefinition = {
          ...moved,
          tabGroupId: groupId,
          layout: {
            ...moved.layout,
            bounds: target.layout?.bounds ?? moved.layout?.bounds,
            zIndex: target.layout?.zIndex ?? moved.layout?.zIndex,
          },
        }
        if (insertIndex == null) {
          return current.map((w) => {
            if (w.id === targetWindowId && !w.tabGroupId) return { ...w, tabGroupId: groupId }
            if (w.id === windowId) return updatedMoved
            return w
          })
        }
        const withTabGroup = current.map((w) => {
          if (w.id === targetWindowId && !w.tabGroupId) return { ...w, tabGroupId: groupId }
          return w
        })
        const withoutMoved = withTabGroup.filter((w) => w.id !== windowId)
        return insertWindowAtGroupIndex(withoutMoved, updatedMoved, groupId, insertIndex)
      })
      setFocusStoreActiveTabMap((prev) => {
        const target = windows.find((w) => w.id === targetWindowId)
        const groupId = target?.tabGroupId || targetWindowId
        return { ...prev, [groupId]: windowId }
      })
    },
    [windows, setFocusStoreActiveTabMap],
  )

  const splitWindowFromGroup = useCallback(
    (windowId: string, offsetBounds?: NonNullable<WorkspaceWindowLayout['bounds']>) => {
      setWindows((current) => {
        const w = current.find((win) => win.id === windowId)
        if (!w?.tabGroupId) return current

        const groupId = w.tabGroupId
        const groupWindows = current.filter((win) => win.tabGroupId === groupId)
        const groupLayout = w.layout
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
              layout: {
                ...win.layout,
                bounds: defaultBounds,
                snapZone: null,
                fullscreen: false,
                restoreBounds: win.layout?.bounds ?? win.layout?.restoreBounds ?? null,
                zIndex: nextZIndexRef.current++,
              },
            }
          }
          return win
        })

        if (groupWindows.length === 2) {
          return nextWindows.map((win) => {
            if (win.tabGroupId !== groupId) return win
            const fallbackBounds = createDefaultBounds(0, win.type)
            return {
              ...win,
              tabGroupId: null,
              layout: groupLayout
                ? {
                    ...groupLayout,
                    bounds: groupLayout.bounds ?? win.layout?.bounds ?? fallbackBounds,
                    snapZone: groupLayout.snapZone ?? null,
                    restoreBounds: groupLayout.restoreBounds ?? groupLayout.bounds ?? null,
                  }
                : win.layout,
            }
          })
        }

        return nextWindows
      })

      setFocusStoreActiveTabMap((prev) => {
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

      setFocusStoreActiveWindowId(windowId)
    },
    [windows, setFocusStoreActiveTabMap, setFocusStoreActiveWindowId],
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

      setFocusStoreActiveTabMap((prev) => ({ ...prev, [groupId]: id }))
      setFocusStoreActiveWindowId(id)
      return id
    },
    [windows, setFocusStoreActiveTabMap, setFocusStoreActiveWindowId],
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
      const layout = sourceWindow.layout
        ? {
            ...sourceWindow.layout,
            minimized: false,
            zIndex: sourceWindow.layout.zIndex ?? nextZIndexRef.current++,
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

  const addPinnedItem = useCallback((item: Omit<PinnedTaskbarItem, 'id'>) => {
    setPinnedTaskbarItems((prev) => {
      const key = (p: PinnedTaskbarItem) => `${p.path}:${p.source.kind}:${p.source.token ?? ''}`
      const newKey = `${item.path}:${item.source.kind}:${item.source.token ?? ''}`
      if (prev.some((p) => key(p) === newKey)) return prev
      const id = `pinned-${Date.now()}-${Math.random().toString(36).slice(2)}`
      return [...prev, { ...item, id }]
    })
  }, [])

  const removePinnedItem = useCallback((id: string) => {
    setPinnedTaskbarItems((prev) => prev.filter((p) => p.id !== id))
  }, [])

  return useMemo(
    () => ({
      storageKey,
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
      pinnedTaskbarItems,
      addPinnedItem,
      removePinnedItem,
    }),
    [
      storageKey,
      windows,
      activeWindowId,
      activeTabMap,
      playbackSource,
      playbackSession,
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
    ],
  )
}
