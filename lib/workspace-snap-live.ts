import type { AssistGridShape } from '@/lib/workspace-assist-grid'
import type { SnapZone, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  snapZoneToBoundsWithOccupied,
  type WorkspaceBounds,
  type WorkspaceCanvasSize,
} from '@/lib/workspace-geometry'

const MERGE_TOL = 6

/** Browser workspace window chrome title bar (matches `h-8`). */
export const WORKSPACE_TITLE_BAR_PX = 32

function mergeCloseSorted(sorted: number[]): number[] {
  if (sorted.length === 0) return []
  const out: number[] = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!
    if (n - out[out.length - 1]! <= MERGE_TOL) {
      out[out.length - 1] = Math.round((out[out.length - 1]! + n) / 2)
    } else {
      out.push(n)
    }
  }
  return out
}

function collectEdgeCoordinates(
  windows: WorkspaceWindowDefinition[],
  canvas: WorkspaceCanvasSize,
  axis: 'x' | 'y',
  span: number,
): number[] {
  const set = new Set<number>([0, span])
  for (const w of windows) {
    const b = w.layout?.bounds
    if (!b || !w.layout?.snapZone || w.layout.minimized || w.layout.fullscreen) continue
    if (axis === 'x') {
      set.add(Math.max(0, Math.min(span, Math.round(b.x))))
      set.add(Math.max(0, Math.min(span, Math.round(b.x + b.width))))
    } else {
      set.add(Math.max(0, Math.min(span, Math.round(b.y))))
      set.add(Math.max(0, Math.min(span, Math.round(b.y + b.height))))
    }
  }
  return mergeCloseSorted([...set].sort((a, b) => a - b))
}

function equalSplits(span: number, segments: number): number[] {
  return Array.from({ length: segments + 1 }, (_, i) => Math.round((span * i) / segments))
}

function pickAxisLines(raw: number[], span: number, segments: number): number[] {
  const merged = mergeCloseSorted([...new Set([0, span, ...raw])].sort((a, b) => a - b))
  if (merged.length >= segments + 1) {
    if (merged.length === segments + 1) return merged
    if (merged.length > segments + 1) return equalSplits(span, segments)
  }
  return equalSplits(span, segments)
}

const LIVE_GRID: Record<string, Partial<Record<SnapZone, [number, number]>>> = {
  thirds3x2: {
    'top-left-third': [0, 0],
    'top-center-third': [1, 0],
    'top-right-third': [2, 0],
    'bottom-left-third': [0, 1],
    'bottom-center-third': [1, 1],
    'bottom-right-third': [2, 1],
  },
  quarters: {
    'top-left': [0, 0],
    'top-right': [1, 0],
    'bottom-left': [0, 1],
    'bottom-right': [1, 1],
  },
  leftRight: {
    left: [0, 0],
    right: [1, 0],
  },
  topBottom: {
    'top-half': [0, 0],
    'bottom-half': [0, 1],
  },
  verticalThirds: {
    'top-third': [0, 0],
    'middle-third': [0, 1],
    'bottom-third': [0, 2],
  },
  /** 2×3 grid: named zones not mapped; live preview falls back to template bounds. */
  grid2x3: {},
}

function shapeToLiveGridKey(
  shape: AssistGridShape | null | undefined,
): keyof typeof LIVE_GRID | null {
  if (!shape) return null
  switch (shape) {
    case '3x2':
      return 'thirds3x2'
    case '2x2':
      return 'quarters'
    case '2x3':
      return 'grid2x3'
    default:
      return null
  }
}

function gridDims(key: keyof typeof LIVE_GRID): { cols: number; rows: number } {
  switch (key) {
    case 'thirds3x2':
      return { cols: 3, rows: 2 }
    case 'quarters':
      return { cols: 2, rows: 2 }
    case 'leftRight':
      return { cols: 2, rows: 1 }
    case 'topBottom':
      return { cols: 1, rows: 2 }
    case 'verticalThirds':
      return { cols: 1, rows: 3 }
    case 'grid2x3':
      return { cols: 2, rows: 3 }
    default:
      return { cols: 1, rows: 1 }
  }
}

function liveCellBounds(
  zone: SnapZone,
  canvas: WorkspaceCanvasSize,
  windows: WorkspaceWindowDefinition[],
  assistGridShape: AssistGridShape | null | undefined,
): WorkspaceBounds | null {
  const gk = shapeToLiveGridKey(assistGridShape)
  if (!gk) return null
  const cellMap = LIVE_GRID[gk]
  const cell = cellMap[zone]
  if (!cell) return null
  const [col, row] = cell
  const { cols, rows } = gridDims(gk)

  const xRaw = collectEdgeCoordinates(windows, canvas, 'x', canvas.width)
  const yRaw = collectEdgeCoordinates(windows, canvas, 'y', canvas.height)
  const xs = pickAxisLines(xRaw, canvas.width, cols)
  const ys = pickAxisLines(yRaw, canvas.height, rows)

  if (col + 1 >= xs.length || row + 1 >= ys.length) return null
  const x = xs[col]!
  const y = ys[row]!
  const width = xs[col + 1]! - x
  const height = ys[row + 1]! - y
  if (width < 50 || height < 50) return null
  return { x, y, width, height }
}

export function snapZonePreviewBoundsForDrag(
  zone: SnapZone,
  canvas: WorkspaceCanvasSize,
  windows: WorkspaceWindowDefinition[],
  occupied: ReadonlyArray<{ bounds: WorkspaceBounds; snapZone: SnapZone }>,
  preferredAssistGridShape: AssistGridShape | null | undefined,
): WorkspaceBounds {
  const live = liveCellBounds(zone, canvas, windows, preferredAssistGridShape)
  if (live) {
    if (occupied.length === 0) return live
    return intersectOccupiedAware(live, zone, occupied, canvas)
  }
  return snapZoneToBoundsWithOccupied(zone, occupied, canvas)
}

function intersectOccupiedAware(
  live: WorkspaceBounds,
  zone: SnapZone,
  occupied: ReadonlyArray<{ bounds: WorkspaceBounds; snapZone: SnapZone }>,
  canvas: WorkspaceCanvasSize,
): WorkspaceBounds {
  const template = snapZoneToBoundsWithOccupied(zone, occupied, canvas)
  const x0 = Math.max(live.x, template.x)
  const y0 = Math.max(live.y, template.y)
  const x1 = Math.min(live.x + live.width, template.x + template.width)
  const y1 = Math.min(live.y + live.height, template.y + template.height)
  const w = Math.max(100, x1 - x0)
  const h = Math.max(100, y1 - y0)
  return {
    x: Math.max(0, Math.min(x0, canvas.width - w)),
    y: Math.max(0, Math.min(y0, canvas.height - h)),
    width: Math.min(w, canvas.width),
    height: Math.min(h, canvas.height),
  }
}
