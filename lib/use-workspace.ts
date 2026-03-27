import type { NavigationState } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { MediaType } from '@/lib/types'
import {
  createDefaultBounds,
  getSourceLabel,
  getViewportSize,
  reconcileLayoutBoundsFromSnapZones,
} from '@/lib/workspace-geometry'
import { isWorkspaceTabIconColorKey } from '@/lib/workspace-tab-icon-colors'
import { parseWorkspaceTaskbarPins, type WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'

export interface WorkspaceSource {
  kind: 'local' | 'share'
  rootPath?: string | null
  token?: string
  sharePath?: string | null
}

export type SnapZone =
  | 'assist-custom'
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
  type: 'browser' | 'viewer'
  title: string
  iconName?: string | null
  iconPath?: string | null
  iconType?: MediaType | null
  iconIsVirtual?: boolean
  source: WorkspaceSource
  initialState: Partial<NavigationState>
  tabGroupId?: string | null
  openedFromWindowId?: string | null
  /** Pinned tabs stay on the left and cannot be closed from the strip. */
  tabPinned?: boolean
  layout?: WorkspaceWindowLayout
}

export type PinnedTaskbarItem = WorkspaceTaskbarPin

export interface TabGroupSplitState {
  leftTabId: string
  /** Left pane width as a fraction of content width (0.3–0.7). */
  leftPaneFraction: number
}

const STORAGE_KEY = 'workspace-state'

export const SPLIT_PANE_FRACTION_MIN = 0.3
export const SPLIT_PANE_FRACTION_MAX = 0.7
export const SPLIT_PANE_FRACTION_DEFAULT = 0.5

export function clampSplitPaneFraction(f: number): number {
  if (!Number.isFinite(f)) return SPLIT_PANE_FRACTION_DEFAULT
  return Math.min(SPLIT_PANE_FRACTION_MAX, Math.max(SPLIT_PANE_FRACTION_MIN, f))
}

export interface PersistedWorkspaceState {
  windows: WorkspaceWindowDefinition[]
  activeWindowId: string | null
  activeTabMap: Record<string, string>
  nextWindowId: number
  pinnedTaskbarItems: PinnedTaskbarItem[]
  browserTabTitle?: string
  browserTabIcon?: string
  browserTabIconColor?: string
  tabGroupSplits?: Record<string, TabGroupSplitState>
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

const MAX_BROWSER_TAB_TITLE_LEN = 120
const MAX_BROWSER_TAB_ICON_LEN = 64

function parseBrowserTabTitle(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, MAX_BROWSER_TAB_TITLE_LEN)
  return t.length > 0 ? t : undefined
}

function parseBrowserTabIcon(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, MAX_BROWSER_TAB_ICON_LEN)
  if (!t.length) return undefined
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(t)) return undefined
  return t
}

function parseBrowserTabIconColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  if (!t.length) return undefined
  return isWorkspaceTabIconColorKey(t) ? t : undefined
}

export function serializeWorkspacePersistedState(state: PersistedWorkspaceState): string {
  return JSON.stringify({
    windows: state.windows,
    activeWindowId: state.activeWindowId,
    activeTabMap: sortTabMapKeys(state.activeTabMap ?? {}),
    nextWindowId: state.nextWindowId,
    pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
    ...(state.tabGroupSplits && Object.keys(state.tabGroupSplits).length > 0
      ? { tabGroupSplits: state.tabGroupSplits }
      : {}),
    ...(state.browserTabTitle ? { browserTabTitle: state.browserTabTitle } : {}),
    ...(state.browserTabIcon ? { browserTabIcon: state.browserTabIcon } : {}),
    ...(state.browserTabIconColor ? { browserTabIconColor: state.browserTabIconColor } : {}),
  })
}

export function serializeWorkspaceLayoutState(state: PersistedWorkspaceState): string {
  return JSON.stringify({
    windows: state.windows,
    activeWindowId: state.activeWindowId,
    activeTabMap: sortTabMapKeys(state.activeTabMap ?? {}),
    nextWindowId: state.nextWindowId,
    pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
    ...(state.tabGroupSplits && Object.keys(state.tabGroupSplits).length > 0
      ? { tabGroupSplits: state.tabGroupSplits }
      : {}),
  })
}

const MIN_VISIBLE_WINDOW = 100

function groupIdForWorkspaceMember(w: WorkspaceWindowDefinition): string {
  return w.tabGroupId ?? w.id
}

function sanitizeTabGroupSplitsField(
  windows: WorkspaceWindowDefinition[],
  raw: unknown,
): Record<string, TabGroupSplitState> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, TabGroupSplitState> = {}
  for (const [gid, sp] of Object.entries(raw as Record<string, unknown>)) {
    if (!sp || typeof sp !== 'object') continue
    const leftTabId = (sp as { leftTabId?: unknown }).leftTabId
    if (typeof leftTabId !== 'string') continue
    const members = windows.filter((w) => groupIdForWorkspaceMember(w) === gid)
    const leftWin = members.find((w) => w.id === leftTabId)
    if (!leftWin) continue
    if (members.filter((w) => w.id !== leftTabId).length < 1) continue
    const rawFrac = (sp as { leftPaneFraction?: unknown }).leftPaneFraction
    const frac =
      typeof rawFrac === 'number' && Number.isFinite(rawFrac)
        ? clampSplitPaneFraction(rawFrac)
        : SPLIT_PANE_FRACTION_DEFAULT
    out[gid] = { leftTabId, leftPaneFraction: frac }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function ensureSplitWorkspaceFocus(
  windows: WorkspaceWindowDefinition[],
  activeTabMap: Record<string, string>,
  activeWindowId: string | null,
  splits: Record<string, TabGroupSplitState> | undefined,
): { activeTabMap: Record<string, string>; activeWindowId: string | null } {
  if (!splits) return { activeTabMap, activeWindowId }
  let nextMap = { ...activeTabMap }
  let nextActive = activeWindowId
  for (const [gid, sp] of Object.entries(splits)) {
    const members = windows.filter((w) => groupIdForWorkspaceMember(w) === gid)
    const firstRight = members.find((w) => w.id !== sp.leftTabId)
    if (nextMap[gid] === sp.leftTabId && firstRight) nextMap[gid] = firstRight.id
    if (nextActive === sp.leftTabId && firstRight) nextActive = firstRight.id
  }
  return { activeTabMap: nextMap, activeWindowId: nextActive }
}

function clampBoundsToViewport(
  b: NonNullable<WorkspaceWindowLayout['bounds']>,
  viewport: { width: number; height: number },
): NonNullable<WorkspaceWindowLayout['bounds']> {
  const vw = Math.max(viewport.width, MIN_VISIBLE_WINDOW)
  const vh = Math.max(viewport.height, MIN_VISIBLE_WINDOW)
  const width = Math.min(Math.max(b.width, MIN_VISIBLE_WINDOW), vw)
  const height = Math.min(Math.max(b.height, MIN_VISIBLE_WINDOW), vh)
  const x = Math.max(0, Math.min(b.x, vw - width))
  const y = Math.max(0, Math.min(b.y, vh - height))
  return { x, y, width, height }
}

export type NormalizePersistedWorkspaceOptions = {
  /**
   * When true (default), recompute pixel bounds from `snapZone` for snapped groups.
   * Used for named presets / stale server snapshots. Disable when hydrating a local session
   * draft so user-resized tiles keep their saved bounds instead of resetting to template splits.
   */
  reconcileSnapZones?: boolean
}

export function normalizePersistedWorkspaceState(
  data: unknown,
  options?: NormalizePersistedWorkspaceOptions,
): PersistedWorkspaceState | null {
  if (!data || typeof data !== 'object') return null
  const parsed = data as PersistedWorkspaceState
  if (!Array.isArray(parsed.windows) || parsed.windows.length === 0) return null

  const reconcileSnapZones = options?.reconcileSnapZones !== false
  const viewport = getViewportSize()
  const validatedWindows = parsed.windows
    .filter(
      (w): w is WorkspaceWindowDefinition =>
        !!w &&
        typeof w.id === 'string' &&
        (w.type === 'browser' || w.type === 'viewer') &&
        !!w.source &&
        isValidSource(w.source),
    )
    .map((w, i) => {
      const b = w.layout?.bounds
      const bounds = b ? clampBoundsToViewport(b, viewport) : createDefaultBounds(i, w.type)
      return {
        ...w,
        layout: {
          ...w.layout,
          bounds,
        },
      }
    })

  if (validatedWindows.length === 0) return null

  const reconciledWindows = reconcileSnapZones
    ? reconcileLayoutBoundsFromSnapZones(validatedWindows)
    : validatedWindows

  const rawPinned = Array.isArray(parsed.pinnedTaskbarItems) ? parsed.pinnedTaskbarItems : []
  const pinnedTaskbarItems = rawPinned.filter(isValidPinnedItem)

  const browserTabTitle = parseBrowserTabTitle(parsed.browserTabTitle)
  const browserTabIcon = parseBrowserTabIcon(parsed.browserTabIcon)
  const browserTabIconColor = parseBrowserTabIconColor(parsed.browserTabIconColor)
  const tabGroupSplits = sanitizeTabGroupSplitsField(reconciledWindows, parsed.tabGroupSplits)
  const focus = ensureSplitWorkspaceFocus(
    reconciledWindows,
    parsed.activeTabMap ?? {},
    parsed.activeWindowId ?? null,
    tabGroupSplits,
  )

  return {
    windows: reconciledWindows,
    activeWindowId: focus.activeWindowId,
    activeTabMap: focus.activeTabMap,
    nextWindowId: parsed.nextWindowId ?? validatedWindows.length + 1,
    pinnedTaskbarItems,
    ...(tabGroupSplits ? { tabGroupSplits } : {}),
    ...(browserTabTitle ? { browserTabTitle } : {}),
    ...(browserTabIcon ? { browserTabIcon } : {}),
    ...(browserTabIconColor ? { browserTabIconColor } : {}),
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

  return window.type === 'viewer'
    ? `${getSourceLabel(window.source)} Viewer`
    : getSourceLabel(window.source)
}
