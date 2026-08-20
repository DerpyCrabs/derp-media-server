import type {
  PersistedWindowState,
  TabGroupSplitState,
  TilingPlacement,
  WindowDefinition,
  WindowLayout,
  WindowSource,
} from '@/lib/models/window-model'
import {
  createDefaultBounds,
  getSourceLabel,
  getViewportSize,
  reconcileLayoutBoundsFromSnapZones,
  WORKSPACE_WINDOW_MIN_VISIBLE_PX,
} from './workspace-geometry'
import { deletedHermesSessionIds } from '@/features/hermes/hermes-session-store'
import {
  CANVAS_MIN_WINDOW_HEIGHT,
  CANVAS_MIN_WINDOW_WIDTH,
  snapCanvasRect,
  type CanvasWindowSize,
  type CanvasWindowSizeKey,
} from '@/workspace/canvas/model/infinite-canvas'

export const DEFAULT_WORKSPACE_SOURCE: WindowSource = { kind: 'local', rootPath: null }

export const SPLIT_PANE_FRACTION_MIN = 0.3
export const SPLIT_PANE_FRACTION_MAX = 0.7
export const SPLIT_PANE_FRACTION_DEFAULT = 0.5

export function clampSplitPaneFraction(f: number): number {
  if (!Number.isFinite(f)) return SPLIT_PANE_FRACTION_DEFAULT
  return Math.min(SPLIT_PANE_FRACTION_MAX, Math.max(SPLIT_PANE_FRACTION_MIN, f))
}

export type PersistedWorkspaceState = PersistedWindowState

function sortTabMapKeys(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
}

export function serializeWorkspacePersistedState(state: PersistedWorkspaceState): string {
  return JSON.stringify(toPersistentWorkspaceState(state))
}

export function toPersistentWorkspaceState(
  state: PersistedWorkspaceState,
): PersistedWorkspaceState {
  const { windows, activeWindowId, activeTabMap, tabGroupSplits } =
    persistentWorkspaceProjection(state)
  return {
    workspaceType: state.workspaceType === 'canvas' ? 'canvas' : 'desktop',
    windows,
    activeWindowId,
    activeTabMap: sortTabMapKeys(activeTabMap),
    nextWindowId: state.nextWindowId,
    ...(tabGroupSplits ? { tabGroupSplits } : {}),
    ...(state.workspaceType === 'canvas' && state.canvas
      ? {
          canvas: {
            camera: { ...state.canvas.camera },
            maximizedWindowId: state.canvas.maximizedWindowId,
            windowSizeByType: Object.fromEntries(
              Object.entries(state.canvas.windowSizeByType).map(([key, size]) => [
                key,
                { ...size },
              ]),
            ),
            nextZIndex: state.canvas.nextZIndex,
          },
        }
      : {}),
  }
}

export function sanitizePersistedWorkspaceState(
  state: PersistedWorkspaceState,
): PersistedWorkspaceState {
  const projected = toPersistentWorkspaceState(state)
  const normalized = normalizePersistedWorkspaceState(projected, { reconcileSnapZones: false })
  if (!normalized) throw new Error('Invalid workspace document')
  return normalized
}

export function persistentWorkspaceWindows(windows: WindowDefinition[]) {
  return windows
    .filter((window) => window.type !== 'hermes' || !!window.hermes?.sessionId)
    .filter(
      (window) =>
        window.type !== 'hermes' ||
        !window.hermes?.sessionId ||
        !deletedHermesSessionIds.has(window.hermes.sessionId),
    )
    .map((window) => {
      if (window.type !== 'hermes') return window
      const { draftId: _draftId, ...hermes } = window.hermes ?? {}
      return { ...window, hermes }
    })
}

function sanitizeWorkspaceFocus(
  windows: WindowDefinition[],
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

function groupIdForWorkspaceMember(w: WindowDefinition): string {
  return w.tabGroupId ?? w.id
}

function sanitizeBrowserFileOpenTargets(windows: WindowDefinition[]): WindowDefinition[] {
  const ids = new Set(windows.map((w) => w.id))
  return windows.map((w) => {
    if (w.type !== 'browser') return w
    const tid = w.fileOpenTargetWindowId
    if (typeof tid === 'string' && tid.length > 0 && tid !== w.id && ids.has(tid)) {
      return w
    }
    if ('fileOpenTargetWindowId' in w) {
      const { fileOpenTargetWindowId: _drop, ...rest } = w
      return rest as WindowDefinition
    }
    return w
  })
}

/** Anchor window id for open-in-new-tab from a browser. */
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
  windows: WindowDefinition[],
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
  windows: WindowDefinition[],
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
  b: NonNullable<WindowLayout['bounds']>,
  viewport: { width: number; height: number },
): NonNullable<WindowLayout['bounds']> {
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

function sanitizeTilingPlacement(value: unknown): TilingPlacement | null {
  if (!value || typeof value !== 'object') return null
  const t = value as TilingPlacement
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

const CANVAS_WINDOW_SIZE_KEYS: CanvasWindowSizeKey[] = [
  'browser',
  'viewer',
  'hermes',
  'viewer-audio',
  'viewer-video',
  'viewer-image',
  'viewer-text',
  'viewer-pdf',
  'viewer-other',
]

function sanitizeCanvasWindowSizes(
  value: unknown,
): Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  return Object.fromEntries(
    CANVAS_WINDOW_SIZE_KEYS.flatMap((key) => {
      const candidate = raw[key]
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const size = candidate as Partial<CanvasWindowSize>
      if (
        typeof size.width !== 'number' ||
        !Number.isFinite(size.width) ||
        size.width <= 0 ||
        typeof size.height !== 'number' ||
        !Number.isFinite(size.height) ||
        size.height <= 0
      ) {
        return []
      }
      const snapped = snapCanvasRect({ x: 0, y: 0, width: size.width, height: size.height })
      return [[key, { width: snapped.width, height: snapped.height }]]
    }),
  )
}

function requiredNextWorkspaceWindowId(windows: WindowDefinition[]): number {
  return windows.reduce((next, window) => {
    const match = /^workspace-window-(\d+)$/.exec(window.id)
    if (!match) return next
    const value = Number(match[1])
    return Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER
      ? Math.max(next, value + 1)
      : next
  }, windows.length + 1)
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
  if (!Array.isArray(parsed.windows)) return null
  if (parsed.workspaceType !== 'desktop' && parsed.workspaceType !== 'canvas') return null
  if (parsed.workspaceType === 'desktop' && parsed.canvas !== undefined) return null
  if (parsed.workspaceType === 'canvas' && !parsed.canvas) return null

  const reconcileSnapZones = options?.reconcileSnapZones !== false
  const viewport = getViewportSize()
  const workspaceType = parsed.workspaceType
  const validWindow = (w: unknown): w is WindowDefinition => {
    if (!w || typeof w !== 'object') return false
    const window = w as WindowDefinition
    return (
      typeof window.id === 'string' &&
      window.id.length > 0 &&
      (window.type === 'browser' || window.type === 'viewer' || window.type === 'hermes') &&
      typeof window.title === 'string' &&
      !!window.source &&
      isValidSource(window.source) &&
      (window.type !== 'hermes' ||
        (window.source.kind === 'local' && typeof window.hermes?.sessionId === 'string'))
    )
  }
  if (parsed.windows.some((window) => !validWindow(window))) return null
  if (new Set(parsed.windows.map((window) => window.id)).size !== parsed.windows.length) return null
  const validatedWindows = parsed.windows.map((w, i) => {
    const b = w.layout?.bounds
    const canvasBoundsValid =
      workspaceType === 'canvas' &&
      b &&
      Number.isFinite(b.x) &&
      Number.isFinite(b.y) &&
      Number.isFinite(b.width) &&
      Number.isFinite(b.height) &&
      b.width > 0 &&
      b.height > 0
    const fallbackBounds = createDefaultBounds(i, w.type === 'browser' ? 'browser' : 'viewer')
    const bounds =
      workspaceType === 'canvas'
        ? canvasBoundsValid
          ? {
              x: b.x,
              y: b.y,
              width: Math.max(CANVAS_MIN_WINDOW_WIDTH, b.width),
              height: Math.max(CANVAS_MIN_WINDOW_HEIGHT, b.height),
            }
          : fallbackBounds
        : (b ?? fallbackBounds)
    const tiling = sanitizeTilingPlacement(w.layout?.tiling)
    return {
      ...w,
      layout: {
        ...w.layout,
        bounds,
        ...(w.layout && 'tiling' in w.layout ? { tiling } : {}),
      },
    }
  })

  const hasSemanticTiling = validatedWindows.some((w) => w.layout?.tiling)
  const reconciledWindows =
    workspaceType === 'canvas'
      ? validatedWindows
      : reconcileSnapZones || hasSemanticTiling
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

  const tabGroupSplits = sanitizeTabGroupSplitsField(withOpenTargets, parsed.tabGroupSplits)
  const focus = sanitizeWorkspaceFocus(
    withOpenTargets,
    parsed.activeTabMap && typeof parsed.activeTabMap === 'object' ? parsed.activeTabMap : {},
    typeof parsed.activeWindowId === 'string' ? parsed.activeWindowId : null,
    tabGroupSplits,
  )

  return {
    workspaceType,
    windows: withOpenTargets,
    activeWindowId: focus.activeWindowId,
    activeTabMap: focus.activeTabMap,
    nextWindowId: Math.max(
      requiredNextWorkspaceWindowId(withOpenTargets),
      Number.isSafeInteger(parsed.nextWindowId) && parsed.nextWindowId > 0
        ? parsed.nextWindowId
        : 1,
    ),
    ...(tabGroupSplits ? { tabGroupSplits } : {}),
    ...(workspaceType === 'canvas'
      ? {
          canvas: {
            camera: {
              x: Number.isFinite(parsed.canvas?.camera?.x) ? parsed.canvas!.camera.x : 0,
              y: Number.isFinite(parsed.canvas?.camera?.y) ? parsed.canvas!.camera.y : 0,
              zoom: Number.isFinite(parsed.canvas?.camera?.zoom)
                ? Math.min(1, Math.max(0.08, parsed.canvas!.camera.zoom))
                : 1,
            },
            maximizedWindowId:
              typeof parsed.canvas?.maximizedWindowId === 'string' &&
              withOpenTargets.some((window) => window.id === parsed.canvas!.maximizedWindowId)
                ? parsed.canvas.maximizedWindowId
                : null,
            windowSizeByType: sanitizeCanvasWindowSizes(parsed.canvas?.windowSizeByType),
            nextZIndex:
              typeof parsed.canvas?.nextZIndex === 'number' &&
              Number.isFinite(parsed.canvas.nextZIndex)
                ? Math.max(1, Math.floor(parsed.canvas.nextZIndex))
                : Math.max(1, ...withOpenTargets.map((window) => (window.layout?.zIndex ?? 0) + 1)),
          },
        }
      : {}),
  }
}

function isValidSource(s: unknown): s is WindowSource {
  if (!s || typeof s !== 'object' || !('kind' in s)) return false
  return (s as WindowSource).kind === 'local'
}

export function getWorkspaceWindowTitle(
  window: Pick<WindowDefinition, 'title' | 'type' | 'source' | 'initialState'>,
): string {
  if (window.title.trim()) {
    return window.title
  }

  if (window.type === 'viewer') return `${getSourceLabel(window.source)} Viewer`
  return getSourceLabel(window.source)
}
