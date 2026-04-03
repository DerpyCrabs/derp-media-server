import type { NavigationState } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { MediaType } from '@/lib/types'
import {
  createDefaultBounds,
  getSourceLabel,
  getViewportSize,
  reconcileLayoutBoundsFromSnapZones,
  WORKSPACE_WINDOW_MIN_VISIBLE_PX,
} from '@/lib/workspace-geometry'
import { isWorkspaceTabIconColorKey } from '@/lib/workspace-tab-icon-colors'
import { parseWorkspaceTaskbarPins, type WorkspaceTaskbarPin } from '@/lib/workspace-taskbar-pins'
import type { WorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'

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
  /** When set on a browser, open-in-new-tab targets this window's tab group (if it still exists). */
  fileOpenTargetWindowId?: string | null
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
  fileOpenTarget?: WorkspaceFileOpenTarget
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
    ...(state.fileOpenTarget ? { fileOpenTarget: state.fileOpenTarget } : {}),
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
    ...(state.fileOpenTarget ? { fileOpenTarget: state.fileOpenTarget } : {}),
  })
}

function groupIdForWorkspaceMember(w: WorkspaceWindowDefinition): string {
  return w.tabGroupId ?? w.id
}

function parseWorkspaceFileOpenTargetField(v: unknown): WorkspaceFileOpenTarget | undefined {
  if (v === 'new-tab' || v === 'new-window') return v
  return undefined
}

function sanitizeBrowserFileOpenTargets(
  windows: WorkspaceWindowDefinition[],
): WorkspaceWindowDefinition[] {
  const ids = new Set(windows.map((w) => w.id))
  return windows.map((w) => {
    if (w.type !== 'browser') return w
    const tid = w.fileOpenTargetWindowId
    if (typeof tid === 'string' && tid.length > 0 && tid !== w.id && ids.has(tid)) {
      return w
    }
    if ('fileOpenTargetWindowId' in w) {
      const { fileOpenTargetWindowId: _drop, ...rest } = w
      return rest as WorkspaceWindowDefinition
    }
    return w
  })
}

/** Anchor window id for open-in-new-tab from a browser (for tests and WorkspacePage). */
export function resolveNewTabAnchorWindowId(
  state: Pick<PersistedWorkspaceState, 'windows'>,
  browserWindowId: string,
): string {
  const winDef = state.windows.find((x) => x.id === browserWindowId)
  if (!winDef || winDef.type !== 'browser') return browserWindowId
  const tid = winDef.fileOpenTargetWindowId
  if (typeof tid !== 'string' || tid.length === 0 || tid === browserWindowId) return browserWindowId
  return state.windows.some((w) => w.id === tid) ? tid : browserWindowId
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
  const vis = WORKSPACE_WINDOW_MIN_VISIBLE_PX
  const vw = Math.max(viewport.width, vis)
  const vh = Math.max(viewport.height, vis)
  const width = Math.min(Math.max(b.width, vis), vw)
  const height = Math.min(Math.max(b.height, vis), vh)
  const minX = vis - width
  const maxX = vw - vis
  const minY = vis - height
  const maxY = vh - vis
  const x = Math.max(minX, Math.min(b.x, maxX))
  const y = Math.max(minY, Math.min(b.y, maxY))
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

  const withOpenTargets = sanitizeBrowserFileOpenTargets(reconciledWindows)

  const rawPinned = Array.isArray(parsed.pinnedTaskbarItems) ? parsed.pinnedTaskbarItems : []
  const pinnedTaskbarItems = rawPinned.filter(isValidPinnedItem)

  const browserTabTitle = parseBrowserTabTitle(parsed.browserTabTitle)
  const browserTabIcon = parseBrowserTabIcon(parsed.browserTabIcon)
  const browserTabIconColor = parseBrowserTabIconColor(parsed.browserTabIconColor)
  const fileOpenTarget = parseWorkspaceFileOpenTargetField(parsed.fileOpenTarget)
  const tabGroupSplits = sanitizeTabGroupSplitsField(withOpenTargets, parsed.tabGroupSplits)
  const focus = ensureSplitWorkspaceFocus(
    withOpenTargets,
    parsed.activeTabMap ?? {},
    parsed.activeWindowId ?? null,
    tabGroupSplits,
  )

  return {
    windows: withOpenTargets,
    activeWindowId: focus.activeWindowId,
    activeTabMap: focus.activeTabMap,
    nextWindowId: parsed.nextWindowId ?? validatedWindows.length + 1,
    pinnedTaskbarItems,
    ...(tabGroupSplits ? { tabGroupSplits } : {}),
    ...(browserTabTitle ? { browserTabTitle } : {}),
    ...(browserTabIcon ? { browserTabIcon } : {}),
    ...(browserTabIconColor ? { browserTabIconColor } : {}),
    ...(fileOpenTarget ? { fileOpenTarget } : {}),
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
