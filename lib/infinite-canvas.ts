import type { WorkspaceWindowDefinition } from './use-workspace'
import { deletedHermesSessionIds } from './hermes-session-store'

export const CANVAS_STORAGE_KEY = 'infinite-canvas-state-v1'
export const CANVAS_SCHEMA_VERSION = 1
export const CANVAS_GRID_SIZE = 32
export const CANVAS_WINDOW_GAP = 8
export const CANVAS_MIN_ZOOM = 0.08
export const CANVAS_MAX_ZOOM = 1
export const CANVAS_MIN_WINDOW_WIDTH = 320
export const CANVAS_MIN_WINDOW_HEIGHT = 224

export type CanvasRect = { x: number; y: number; width: number; height: number }
export type CanvasCamera = { x: number; y: number; zoom: number }
export type CanvasWindowType = 'browser' | 'viewer' | 'hermes'
export type CanvasWindowSize = Pick<CanvasRect, 'width' | 'height'>

export type CanvasFrame = {
  id: string
  name: string
  color: string
  bounds: CanvasRect
}

export type CanvasWindow = {
  id: string
  definition: WorkspaceWindowDefinition
  bounds: CanvasRect
  frameId: string | null
  zIndex: number
}

export type InfiniteCanvasState = {
  version: 1
  frames: CanvasFrame[]
  windows: CanvasWindow[]
  camera: CanvasCamera
  windowSizeByType: Partial<Record<CanvasWindowType, CanvasWindowSize>>
  nextItemId: number
  nextZIndex: number
}

export function createEmptyCanvasState(): InfiniteCanvasState {
  return {
    version: CANVAS_SCHEMA_VERSION,
    frames: [],
    windows: [],
    camera: { x: 0, y: 0, zoom: 1 },
    windowSizeByType: {},
    nextItemId: 1,
    nextZIndex: 1,
  }
}

export function snapCanvasValue(value: number): number {
  return Math.round(value / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE
}

export function snapCanvasRect(rect: CanvasRect): CanvasRect {
  return {
    x: snapCanvasValue(rect.x),
    y: snapCanvasValue(rect.y),
    width: Math.max(CANVAS_MIN_WINDOW_WIDTH, snapCanvasValue(rect.width)),
    height: Math.max(CANVAS_MIN_WINDOW_HEIGHT, snapCanvasValue(rect.height)),
  }
}

export function rectsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function rectContainsRect(outer: CanvasRect, inner: CanvasRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

export function rectContainsPoint(rect: CanvasRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height
}

export function canvasWindowWorldBounds(window: CanvasWindow, frames: CanvasFrame[]): CanvasRect {
  if (!window.frameId) return window.bounds
  const frame = frames.find((candidate) => candidate.id === window.frameId)
  if (!frame) return window.bounds
  return {
    ...window.bounds,
    x: frame.bounds.x + window.bounds.x,
    y: frame.bounds.y + window.bounds.y,
  }
}

export function canvasWindowVisualBounds(bounds: CanvasRect): CanvasRect {
  const inset = CANVAS_WINDOW_GAP / 2
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(1, bounds.width - CANVAS_WINDOW_GAP),
    height: Math.max(1, bounds.height - CANVAS_WINDOW_GAP),
  }
}

export function withCanvasWindowWorldBounds(
  window: CanvasWindow,
  bounds: CanvasRect,
  frameId: string | null,
  frames: CanvasFrame[],
): CanvasWindow {
  if (!frameId) return { ...window, frameId: null, bounds }
  const frame = frames.find((candidate) => candidate.id === frameId)
  if (!frame) return { ...window, frameId: null, bounds }
  return {
    ...window,
    frameId,
    bounds: { ...bounds, x: bounds.x - frame.bounds.x, y: bounds.y - frame.bounds.y },
  }
}

export function frameAtWindowCenter(
  bounds: CanvasRect,
  frames: CanvasFrame[],
  excludeFrameId?: string | null,
): CanvasFrame | null {
  const x = bounds.x + bounds.width / 2
  const y = bounds.y + bounds.height / 2
  return (
    frames.find((frame) => frame.id !== excludeFrameId && rectContainsPoint(frame.bounds, x, y)) ??
    null
  )
}

export function reconcileFrameMembership(
  state: InfiniteCanvasState,
  changedFrameId?: string,
): InfiniteCanvasState {
  const frames = state.frames
  const changedFrame = changedFrameId
    ? frames.find((frame) => frame.id === changedFrameId)
    : undefined
  const windows = state.windows.map((window) => {
    const world = canvasWindowWorldBounds(window, frames)
    if (window.frameId) {
      const parent = frames.find((frame) => frame.id === window.frameId)
      if (
        !parent ||
        !rectContainsPoint(parent.bounds, world.x + world.width / 2, world.y + world.height / 2)
      ) {
        return withCanvasWindowWorldBounds(window, world, null, frames)
      }
      return window
    }
    if (!changedFrame || !rectContainsRect(changedFrame.bounds, world)) return window
    return withCanvasWindowWorldBounds(window, world, changedFrame.id, frames)
  })
  return { ...state, windows }
}

export function framesOverlap(frames: CanvasFrame[], frameId: string, bounds: CanvasRect): boolean {
  return frames.some((frame) => frame.id !== frameId && rectsOverlap(frame.bounds, bounds))
}

function ringOffsets(ring: number): Array<[number, number]> {
  if (ring === 0) return [[0, 0]]
  const offsets: Array<[number, number]> = []
  for (let x = -ring; x <= ring; x += 1) offsets.push([x, -ring])
  for (let y = -ring + 1; y <= ring; y += 1) offsets.push([ring, y])
  for (let x = ring - 1; x >= -ring; x -= 1) offsets.push([x, ring])
  for (let y = ring - 1; y > -ring; y -= 1) offsets.push([-ring, y])
  return offsets
}

export function findNearestFreeCanvasRect(
  requested: CanvasRect,
  obstacles: CanvasRect[],
  maxRings = 80,
): CanvasRect {
  const base = snapCanvasRect(requested)
  for (let ring = 0; ring <= maxRings; ring += 1) {
    for (const [dx, dy] of ringOffsets(ring)) {
      const candidate = {
        ...base,
        x: base.x + dx * CANVAS_GRID_SIZE,
        y: base.y + dy * CANVAS_GRID_SIZE,
      }
      if (!obstacles.some((obstacle) => rectsOverlap(candidate, obstacle))) return candidate
    }
  }
  return base
}

export function canvasContentBounds(state: InfiniteCanvasState): CanvasRect | null {
  const rects = [
    ...state.frames.map((frame) => frame.bounds),
    ...state.windows.map((window) => canvasWindowWorldBounds(window, state.frames)),
  ]
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseRect(value: unknown): CanvasRect | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<CanvasRect>
  const width = finiteNumber(raw.width, 0)
  const height = finiteNumber(raw.height, 0)
  if (width <= 0 || height <= 0) return null
  return {
    x: finiteNumber(raw.x, 0),
    y: finiteNumber(raw.y, 0),
    width,
    height,
  }
}

function parseWindowSize(value: unknown): CanvasWindowSize | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<CanvasWindowSize>
  const bounds = snapCanvasRect({
    x: 0,
    y: 0,
    width: finiteNumber(raw.width, 0),
    height: finiteNumber(raw.height, 0),
  })
  if (finiteNumber(raw.width, 0) <= 0 || finiteNumber(raw.height, 0) <= 0) return undefined
  return { width: bounds.width, height: bounds.height }
}

function canvasItemNumber(id: string): number {
  const match = /^canvas-(?:frame|window)-(\d+)$/.exec(id)
  return match ? Number(match[1]) : 0
}

export function parseInfiniteCanvasState(value: unknown): InfiniteCanvasState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<InfiniteCanvasState>
  if (
    raw.version !== CANVAS_SCHEMA_VERSION ||
    !Array.isArray(raw.frames) ||
    !Array.isArray(raw.windows)
  ) {
    return null
  }
  const itemIds = new Set<string>()
  const frames: CanvasFrame[] = []
  for (const value of raw.frames) {
    if (!value || typeof value !== 'object') continue
    const frame = value as Partial<CanvasFrame>
    const bounds = parseRect(frame.bounds)
    if (
      !bounds ||
      typeof frame.id !== 'string' ||
      typeof frame.name !== 'string' ||
      itemIds.has(frame.id)
    )
      continue
    itemIds.add(frame.id)
    frames.push({
      id: frame.id,
      name: frame.name,
      color: typeof frame.color === 'string' ? frame.color : '#6366f1',
      bounds,
    })
  }
  const windows: CanvasWindow[] = []
  for (const value of raw.windows) {
    if (!value || typeof value !== 'object') continue
    const window = value as Partial<CanvasWindow>
    const bounds = parseRect(window.bounds)
    const definition = window.definition
    if (
      !bounds ||
      typeof window.id !== 'string' ||
      itemIds.has(window.id) ||
      !definition ||
      typeof definition !== 'object'
    )
      continue
    if (
      definition.id !== window.id ||
      (definition.type !== 'browser' &&
        definition.type !== 'viewer' &&
        definition.type !== 'hermes')
    )
      continue
    itemIds.add(window.id)
    const initialStateRaw =
      definition.initialState && typeof definition.initialState === 'object'
        ? definition.initialState
        : {}
    windows.push({
      id: window.id,
      definition: {
        ...definition,
        title: typeof definition.title === 'string' ? definition.title : window.id,
        source: { kind: 'local' },
        initialState: {
          ...(typeof initialStateRaw.dir === 'string' ? { dir: initialStateRaw.dir } : {}),
          ...(typeof initialStateRaw.viewing === 'string'
            ? { viewing: initialStateRaw.viewing }
            : {}),
        },
        ...(definition.type === 'hermes' && typeof definition.hermes?.sessionId === 'string'
          ? {
              hermes: {
                sessionId: definition.hermes.sessionId,
                readOnly: !!definition.hermes.readOnly,
              },
            }
          : {}),
        tabGroupId: null,
      },
      bounds,
      frameId:
        typeof window.frameId === 'string' && frames.some((frame) => frame.id === window.frameId)
          ? window.frameId
          : null,
      zIndex: Math.max(1, Math.floor(finiteNumber(window.zIndex, 1))),
    })
  }
  const cameraRaw = raw.camera as Partial<CanvasCamera> | undefined
  const sizesRaw = raw.windowSizeByType as
    | Partial<Record<CanvasWindowType, CanvasWindowSize>>
    | undefined
  const browserSize = parseWindowSize(sizesRaw?.browser)
  const viewerSize = parseWindowSize(sizesRaw?.viewer)
  const hermesSize = parseWindowSize(sizesRaw?.hermes)
  const nextItemId = Math.max(0, ...Array.from(itemIds, canvasItemNumber)) + 1
  const nextZIndex = Math.max(0, ...windows.map((window) => window.zIndex)) + 1
  return {
    version: CANVAS_SCHEMA_VERSION,
    frames,
    windows,
    camera: {
      x: finiteNumber(cameraRaw?.x, 0),
      y: finiteNumber(cameraRaw?.y, 0),
      zoom: Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, finiteNumber(cameraRaw?.zoom, 1))),
    },
    windowSizeByType: {
      ...(browserSize ? { browser: browserSize } : {}),
      ...(viewerSize ? { viewer: viewerSize } : {}),
      ...(hermesSize ? { hermes: hermesSize } : {}),
    },
    nextItemId: Math.max(
      nextItemId,
      Math.floor(finiteNumber(raw.nextItemId, windows.length + frames.length + 1)),
    ),
    nextZIndex: Math.max(nextZIndex, Math.floor(finiteNumber(raw.nextZIndex, windows.length + 1))),
  }
}

export function loadInfiniteCanvasState(storage: Pick<Storage, 'getItem'>): InfiniteCanvasState {
  try {
    const raw = storage.getItem(CANVAS_STORAGE_KEY)
    if (!raw) return createEmptyCanvasState()
    return parseInfiniteCanvasState(JSON.parse(raw)) ?? createEmptyCanvasState()
  } catch {
    return createEmptyCanvasState()
  }
}

export function serializeInfiniteCanvasState(state: InfiniteCanvasState): string {
  return JSON.stringify({
    ...state,
    windows: state.windows
      .filter(
        (window) => window.definition.type !== 'hermes' || !!window.definition.hermes?.sessionId,
      )
      .filter(
        (window) =>
          window.definition.type !== 'hermes' ||
          !window.definition.hermes?.sessionId ||
          !deletedHermesSessionIds.has(window.definition.hermes.sessionId),
      )
      .map((window) => {
        if (window.definition.type !== 'hermes') return window
        const { draftId: _draftId, ...hermes } = window.definition.hermes ?? {}
        return { ...window, definition: { ...window.definition, hermes } }
      }),
  })
}
