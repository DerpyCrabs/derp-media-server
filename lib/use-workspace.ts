import { contentWindowKind, type ContentWindowDefinition } from '@/lib/content-window'
import {
  persistedContentWindowRecord,
  restorePersistedContentWindow,
} from '@/lib/content-window-persistence'
import {
  createDefaultBounds,
  getViewportSize,
  reconcileLayoutBoundsFromSnapZones,
  WORKSPACE_WINDOW_MIN_VISIBLE_PX,
} from '@/lib/workspace-geometry'
import { isWorkspaceTabIconColorKey } from '@/lib/workspace-tab-icon-colors'
import {
  parseWorkspaceTaskbarPins,
  serializeWorkspaceTaskbarPins,
  type WorkspaceTaskbarPin,
} from '@/lib/workspace-taskbar-pins'
import type { WorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'

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
  /** Semantic tiling placement; pixel bounds are derived from its shared grid lines. */
  tiling?: WorkspaceTilingPlacement | null
}

export interface WorkspaceTilingPlacement {
  cols: number
  rows: number
  colStart: number
  colEnd: number
  rowStart: number
  rowEnd: number
  colLines: number[]
  rowLines: number[]
}

export interface WorkspaceWindowDefinition extends ContentWindowDefinition {
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

export function workspaceStorageBaseKey(): string {
  return STORAGE_KEY
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
  const { windows, activeWindowId, activeTabMap, tabGroupSplits } =
    persistentWorkspaceProjection(state)
  return JSON.stringify({
    windows: windows.flatMap((window) => {
      const persisted = persistedWorkspaceWindowContent(window)
      return persisted ? [persisted] : []
    }),
    activeWindowId,
    activeTabMap: sortTabMapKeys(activeTabMap),
    nextWindowId: state.nextWindowId,
    pinnedTaskbarItems: serializeWorkspaceTaskbarPins(state.pinnedTaskbarItems ?? []),
    ...(tabGroupSplits ? { tabGroupSplits } : {}),
    ...(state.browserTabTitle ? { browserTabTitle: state.browserTabTitle } : {}),
    ...(state.browserTabIcon ? { browserTabIcon: state.browserTabIcon } : {}),
    ...(state.browserTabIconColor ? { browserTabIconColor: state.browserTabIconColor } : {}),
    ...(state.fileOpenTarget ? { fileOpenTarget: state.fileOpenTarget } : {}),
  })
}

export function serializeWorkspaceLayoutState(state: PersistedWorkspaceState): string {
  const { windows, activeWindowId, activeTabMap, tabGroupSplits } =
    persistentWorkspaceProjection(state)
  return JSON.stringify({
    windows: windows.flatMap((window) => {
      const persisted = persistedWorkspaceWindowContent(window)
      return persisted ? [persisted] : []
    }),
    activeWindowId,
    activeTabMap: sortTabMapKeys(activeTabMap),
    nextWindowId: state.nextWindowId,
    pinnedTaskbarItems: serializeWorkspaceTaskbarPins(state.pinnedTaskbarItems ?? []),
    ...(tabGroupSplits ? { tabGroupSplits } : {}),
    ...(state.fileOpenTarget ? { fileOpenTarget: state.fileOpenTarget } : {}),
  })
}

export function persistentWorkspaceWindows(windows: WorkspaceWindowDefinition[]) {
  return windows.filter((window) => persistedWorkspaceWindowContent(window) !== null)
}

export function persistedWorkspaceWindowContent(
  window: WorkspaceWindowDefinition,
): Record<string, unknown> | null {
  return persistedContentWindowRecord(window)
}

function sanitizeWorkspaceFocus(
  windows: WorkspaceWindowDefinition[],
  rawActiveTabMap: unknown,
  rawActiveWindowId: unknown,
  splits: Record<string, TabGroupSplitState> | undefined,
  preferredGroupId?: string,
) {
  const byId = new Map(windows.map((window) => [window.id, window]))
  const activeTabMap: Record<string, string> = {}
  if (rawActiveTabMap && typeof rawActiveTabMap === 'object' && !Array.isArray(rawActiveTabMap)) {
    for (const [groupId, windowId] of Object.entries(rawActiveTabMap)) {
      if (typeof windowId !== 'string') continue
      const window = byId.get(windowId)
      if (window && groupIdForWorkspaceMember(window) === groupId) activeTabMap[groupId] = windowId
    }
  }
  let activeWindowId = typeof rawActiveWindowId === 'string' ? rawActiveWindowId : null
  if (!activeWindowId || !byId.has(activeWindowId)) {
    activeWindowId =
      (preferredGroupId
        ? windows.find((window) => groupIdForWorkspaceMember(window) === preferredGroupId)?.id
        : undefined) ??
      windows.at(-1)?.id ??
      null
  }
  return ensureSplitWorkspaceFocus(windows, activeTabMap, activeWindowId, splits)
}

function persistentWorkspaceProjection(state: PersistedWorkspaceState) {
  const windows = persistentWorkspaceWindows(state.windows)
  const tabGroupSplits = sanitizeTabGroupSplitsField(windows, state.tabGroupSplits)
  const previousActive = state.windows.find((window) => window.id === state.activeWindowId)
  const focus = sanitizeWorkspaceFocus(
    windows,
    state.activeTabMap,
    state.activeWindowId,
    tabGroupSplits,
    previousActive ? groupIdForWorkspaceMember(previousActive) : undefined,
  )
  return { windows, tabGroupSplits, ...focus }
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
    if (contentWindowKind(w) !== 'browser') return w
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
  if (!winDef || contentWindowKind(winDef) !== 'browser') return browserWindowId
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

function sanitizeTilingPlacement(value: unknown): WorkspaceTilingPlacement | null {
  if (!value || typeof value !== 'object') return null
  const t = value as WorkspaceTilingPlacement
  if (!Number.isInteger(t.cols) || !Number.isInteger(t.rows) || t.cols < 1 || t.rows < 1)
    return null
  if (
    !Number.isInteger(t.colStart) ||
    !Number.isInteger(t.colEnd) ||
    !Number.isInteger(t.rowStart) ||
    !Number.isInteger(t.rowEnd) ||
    t.colStart < 0 ||
    t.colEnd > t.cols ||
    t.colStart >= t.colEnd ||
    t.rowStart < 0 ||
    t.rowEnd > t.rows ||
    t.rowStart >= t.rowEnd
  ) {
    return null
  }
  const validLines = (lines: unknown, count: number): lines is number[] =>
    Array.isArray(lines) &&
    lines.length === count + 1 &&
    lines.every(
      (line, index) =>
        typeof line === 'number' &&
        Number.isFinite(line) &&
        line >= 0 &&
        line <= 1 &&
        (index === 0 || line >= lines[index - 1]!),
    )
  if (!validLines(t.colLines, t.cols) || !validLines(t.rowLines, t.rows)) return null
  if (
    t.colLines[0] !== 0 ||
    t.colLines[t.cols] !== 1 ||
    t.rowLines[0] !== 0 ||
    t.rowLines[t.rows] !== 1
  ) {
    return null
  }
  return {
    cols: t.cols,
    rows: t.rows,
    colStart: t.colStart,
    colEnd: t.colEnd,
    rowStart: t.rowStart,
    rowEnd: t.rowEnd,
    colLines: t.colLines.slice(),
    rowLines: t.rowLines.slice(),
  }
}

export type NormalizePersistedWorkspaceOptions = {
  /**
   * When true (default), recompute pixel bounds from `snapZone` for snapped groups.
   * Used for named presets / stale server snapshots. Disable when hydrating a local session
   * draft so user-resized tiles keep their saved bounds instead of resetting to template splits.
   */
  reconcileSnapZones?: boolean
}

export function restorePersistedWorkspaceWindowContent(
  value: unknown,
): WorkspaceWindowDefinition | null {
  return restorePersistedContentWindow(value, [
    'tabGroupId',
    'openedFromWindowId',
    'tabPinned',
    'layout',
    'fileOpenTargetWindowId',
  ]) as WorkspaceWindowDefinition | null
}

export function normalizePersistedWorkspaceState(
  data: unknown,
  options?: NormalizePersistedWorkspaceOptions,
): PersistedWorkspaceState | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const allowedFields = new Set([
    'windows',
    'activeWindowId',
    'activeTabMap',
    'nextWindowId',
    'pinnedTaskbarItems',
    'browserTabTitle',
    'browserTabIcon',
    'browserTabIconColor',
    'tabGroupSplits',
    'fileOpenTarget',
  ])
  if (Object.keys(data).some((field) => !allowedFields.has(field))) return null
  const parsed = data as PersistedWorkspaceState
  if (
    !Array.isArray(parsed.windows) ||
    parsed.windows.length === 0 ||
    (parsed.activeWindowId !== null && typeof parsed.activeWindowId !== 'string') ||
    !parsed.activeTabMap ||
    typeof parsed.activeTabMap !== 'object' ||
    Array.isArray(parsed.activeTabMap) ||
    !Number.isSafeInteger(parsed.nextWindowId) ||
    parsed.nextWindowId < 1 ||
    !Array.isArray(parsed.pinnedTaskbarItems)
  ) {
    return null
  }

  const reconcileSnapZones = options?.reconcileSnapZones !== false
  const viewport = getViewportSize()
  const validatedWindows = parsed.windows
    .map(restorePersistedWorkspaceWindowContent)
    .filter(
      (w): w is WorkspaceWindowDefinition =>
        !!w && typeof w.id === 'string' && (!!w.contentInstance || !!w.contentRecoveryReason),
    )
    .map((w, i) => {
      const b = w.layout?.bounds
      const bounds =
        b ?? createDefaultBounds(i, contentWindowKind(w) === 'browser' ? 'browser' : 'viewer')
      return {
        ...w,
        layout: {
          ...w.layout,
          bounds,
          tiling: sanitizeTilingPlacement(w.layout?.tiling),
        },
      }
    })

  if (validatedWindows.length === 0) return null

  const hasSemanticTiling = validatedWindows.some((w) => w.layout?.tiling)
  const reconciledWindows =
    reconcileSnapZones || hasSemanticTiling
      ? reconcileLayoutBoundsFromSnapZones(validatedWindows, viewport)
      : validatedWindows.map((w) => {
          const b = w.layout?.bounds
          if (!b) return w
          return {
            ...w,
            layout: {
              ...w.layout,
              bounds: clampBoundsToViewport(b, viewport),
            },
          }
        })

  const withOpenTargets = sanitizeBrowserFileOpenTargets(reconciledWindows)

  const pinnedTaskbarItems = parseWorkspaceTaskbarPins(parsed.pinnedTaskbarItems)

  const browserTabTitle = parseBrowserTabTitle(parsed.browserTabTitle)
  const browserTabIcon = parseBrowserTabIcon(parsed.browserTabIcon)
  const browserTabIconColor = parseBrowserTabIconColor(parsed.browserTabIconColor)
  const fileOpenTarget = parseWorkspaceFileOpenTargetField(parsed.fileOpenTarget)
  const tabGroupSplits = sanitizeTabGroupSplitsField(withOpenTargets, parsed.tabGroupSplits)
  const focus = sanitizeWorkspaceFocus(
    withOpenTargets,
    parsed.activeTabMap,
    parsed.activeWindowId,
    tabGroupSplits,
  )

  return {
    windows: withOpenTargets,
    activeWindowId: focus.activeWindowId,
    activeTabMap: focus.activeTabMap,
    nextWindowId: parsed.nextWindowId,
    pinnedTaskbarItems,
    ...(tabGroupSplits ? { tabGroupSplits } : {}),
    ...(browserTabTitle ? { browserTabTitle } : {}),
    ...(browserTabIcon ? { browserTabIcon } : {}),
    ...(browserTabIconColor ? { browserTabIconColor } : {}),
    ...(fileOpenTarget ? { fileOpenTarget } : {}),
  }
}

export function getWorkspaceWindowTitle(
  window: Pick<WorkspaceWindowDefinition, 'id' | 'title' | 'contentInstance'>,
): string {
  if (window.title.trim()) {
    return window.title
  }

  return contentWindowKind(window) === 'viewer' ? 'Browser Viewer' : 'Browser'
}
