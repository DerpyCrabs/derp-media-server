import type { NavigationState } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { MediaType } from '@/lib/types'
import {
  createDefaultBounds,
  getSourceLabel,
  getViewportSize,
  reconcileLayoutBoundsFromSnapZones,
} from '@/lib/workspace-geometry'
import { parseWorkspaceTaskbarPins, type WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'

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

const STORAGE_KEY = 'workspace-state'

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

  const reconciledWindows = reconcileLayoutBoundsFromSnapZones(validatedWindows)

  const rawPinned = Array.isArray(parsed.pinnedTaskbarItems) ? parsed.pinnedTaskbarItems : []
  const pinnedTaskbarItems = rawPinned.filter(isValidPinnedItem)

  return {
    windows: reconciledWindows,
    activeWindowId: parsed.activeWindowId ?? null,
    activeTabMap: parsed.activeTabMap ?? {},
    nextWindowId: parsed.nextWindowId ?? validatedWindows.length + 1,
    pinnedTaskbarItems,
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
