export const CANVAS_GRID_SIZE = 32
export const CANVAS_WINDOW_GAP = 8
export const CANVAS_MIN_ZOOM = 0.08
export const CANVAS_MAX_ZOOM = 1
export const CANVAS_MIN_WINDOW_WIDTH = 320
export const CANVAS_MIN_WINDOW_HEIGHT = 224

export type CanvasRect = { x: number; y: number; width: number; height: number }
export type CanvasCamera = { x: number; y: number; zoom: number }
export type CanvasWindowType = 'browser' | 'viewer' | 'hermes'
export type CanvasWindowSizeKey =
  | CanvasWindowType
  | 'viewer-audio'
  | 'viewer-video'
  | 'viewer-image'
  | 'viewer-text'
  | 'viewer-pdf'
  | 'viewer-other'
export type CanvasWindowSize = Pick<CanvasRect, 'width' | 'height'>

export type CanvasWindow = {
  id: string
  bounds: CanvasRect
  zIndex: number
}

export type InfiniteCanvasState = {
  windows: CanvasWindow[]
  maximizedWindowId: string | null
  camera: CanvasCamera
  windowSizeByType: Partial<Record<CanvasWindowSizeKey, CanvasWindowSize>>
  nextItemId: number
  nextZIndex: number
}

export function createEmptyCanvasState(): InfiniteCanvasState {
  return {
    windows: [],
    maximizedWindowId: null,
    camera: { x: 0, y: 0, zoom: 1 },
    windowSizeByType: {},
    nextItemId: 1,
    nextZIndex: 1,
  }
}

export function cloneInfiniteCanvasState(state: InfiniteCanvasState): InfiniteCanvasState {
  return {
    ...state,
    camera: { ...state.camera },
    windowSizeByType: Object.fromEntries(
      Object.entries(state.windowSizeByType).map(([key, size]) => [key, { ...size }]),
    ),
    windows: state.windows.map((window) => ({
      ...window,
      bounds: { ...window.bounds },
    })),
  }
}

export function equalInfiniteCanvasState(
  left: InfiniteCanvasState,
  right: InfiniteCanvasState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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

export function canvasWindowVisualBounds(bounds: CanvasRect): CanvasRect {
  const inset = CANVAS_WINDOW_GAP / 2
  return {
    x: bounds.x + inset,
    y: bounds.y + inset,
    width: Math.max(1, bounds.width - CANVAS_WINDOW_GAP),
    height: Math.max(1, bounds.height - CANVAS_WINDOW_GAP),
  }
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
