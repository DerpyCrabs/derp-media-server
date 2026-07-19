import type { WorkspaceTilingPlacement, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  tilingPlacementToBounds,
  type WorkspaceBounds,
  type WorkspaceCanvasSize,
} from '@/lib/workspace-geometry'

const EDGE_MERGE_TOL_PX = 4

function layoutGroupKey(w: WorkspaceWindowDefinition): string {
  return w.tabGroupId ?? w.id
}

function mergeEdges(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const v of sorted) {
    const last = out[out.length - 1]
    if (last == null || v - last > EDGE_MERGE_TOL_PX) out.push(v)
  }
  return out
}

function nearestEdgeIndex(edges: number[], value: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < edges.length; i++) {
    const d = Math.abs(edges[i]! - value)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

function inferCanvasFromBounds(rects: WorkspaceBounds[]): WorkspaceCanvasSize {
  let width = 1
  let height = 1
  for (const b of rects) {
    width = Math.max(width, b.x + b.width)
    height = Math.max(height, b.y + b.height)
  }
  return { width: Math.round(width), height: Math.round(height) }
}

function placementForBounds(
  bounds: WorkspaceBounds,
  colEdges: number[],
  rowEdges: number[],
  canvas: WorkspaceCanvasSize,
): WorkspaceTilingPlacement | null {
  const cols = colEdges.length - 1
  const rows = rowEdges.length - 1
  if (cols < 1 || rows < 1) return null
  const colStart = nearestEdgeIndex(colEdges, bounds.x)
  const colEnd = nearestEdgeIndex(colEdges, bounds.x + bounds.width)
  const rowStart = nearestEdgeIndex(rowEdges, bounds.y)
  const rowEnd = nearestEdgeIndex(rowEdges, bounds.y + bounds.height)
  if (colEnd <= colStart || rowEnd <= rowStart) return null
  return {
    cols,
    rows,
    colStart,
    colEnd,
    rowStart,
    rowEnd,
    colLines: colEdges.map((x) => x / canvas.width),
    rowLines: rowEdges.map((y) => y / canvas.height),
  }
}

/**
 * Legacy layouts stored `snapZone: 'assist-custom'` with pixel bounds and no `tiling`.
 * Infer a shared grid from those bounds, attach first-class `tiling`, and drop `assist-custom`.
 */
export function migrateLegacyAssistCustomToTiling(
  windows: WorkspaceWindowDefinition[],
  canvas?: WorkspaceCanvasSize | null,
): WorkspaceWindowDefinition[] {
  const legacy = windows.filter(
    (w) =>
      w.layout?.snapZone === 'assist-custom' &&
      !w.layout.fullscreen &&
      !w.layout.minimized &&
      w.layout.bounds,
  )
  if (legacy.length === 0) {
    // Still strip assist-custom when tiling is already present.
    return windows.map((w) =>
      w.layout?.snapZone === 'assist-custom' && w.layout.tiling
        ? { ...w, layout: { ...w.layout, snapZone: null } }
        : w,
    )
  }

  const repByGroup = new Map<string, WorkspaceBounds>()
  for (const w of legacy) {
    const key = layoutGroupKey(w)
    if (!repByGroup.has(key)) repByGroup.set(key, w.layout!.bounds!)
  }
  const rects = [...repByGroup.values()]
  const resolvedCanvas =
    canvas && canvas.width > 0 && canvas.height > 0 ? canvas : inferCanvasFromBounds(rects)

  const colEdges = mergeEdges([
    0,
    resolvedCanvas.width,
    ...rects.flatMap((b) => [b.x, b.x + b.width]),
  ])
  const rowEdges = mergeEdges([
    0,
    resolvedCanvas.height,
    ...rects.flatMap((b) => [b.y, b.y + b.height]),
  ])

  const tilingByGroup = new Map<string, WorkspaceTilingPlacement>()
  for (const [key, bounds] of repByGroup) {
    const existing = windows.find((w) => layoutGroupKey(w) === key)?.layout?.tiling
    if (existing) {
      tilingByGroup.set(key, existing)
      continue
    }
    const inferred = placementForBounds(bounds, colEdges, rowEdges, resolvedCanvas)
    if (inferred) tilingByGroup.set(key, inferred)
  }

  if (tilingByGroup.size === 0) {
    return windows.map((w) =>
      w.layout?.snapZone === 'assist-custom'
        ? { ...w, layout: { ...w.layout, snapZone: null } }
        : w,
    )
  }

  return windows.map((w) => {
    const key = layoutGroupKey(w)
    const tiling = tilingByGroup.get(key)
    if (!tiling) {
      if (w.layout?.snapZone === 'assist-custom') {
        return { ...w, layout: { ...w.layout, snapZone: null } }
      }
      return w
    }
    return {
      ...w,
      layout: {
        ...w.layout,
        snapZone: null,
        tiling,
        bounds: tilingPlacementToBounds(tiling, resolvedCanvas),
      },
    }
  })
}
