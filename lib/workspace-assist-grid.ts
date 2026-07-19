import {
  defaultWorkspaceGridLines,
  tilingPlacementToBounds,
  type WorkspaceBounds,
  type WorkspaceCanvasSize,
} from '@/lib/workspace-geometry'
import type { WorkspaceTilingPlacement, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { migrateLegacyAssistCustomToTiling } from '@/lib/workspace-tiling-migrate'
import { SNAP_EDGE_THRESHOLD_PX } from '@/lib/use-snap-zones'

export const ASSIST_GRID_SHAPES = ['3x2', '3x3', '2x2', '2x3'] as const
export type AssistGridShape = (typeof ASSIST_GRID_SHAPES)[number]

export function isAssistGridShape(s: string): s is AssistGridShape {
  return (ASSIST_GRID_SHAPES as readonly string[]).includes(s)
}

export function assistShapeToDims(shape: AssistGridShape): {
  cols: number
  rows: number
} {
  switch (shape) {
    case '3x2':
      return { cols: 3, rows: 2 }
    case '3x3':
      return { cols: 3, rows: 3 }
    case '2x2':
      return { cols: 2, rows: 2 }
    case '2x3':
      return { cols: 2, rows: 3 }
  }
}

/** Resolve persisted / picked span dimensions to a known assist shape, if it matches. */
export function assistShapeMatchingSpan(span: AssistGridSpan): AssistGridShape | null {
  for (const s of ASSIST_GRID_SHAPES) {
    const d = assistShapeToDims(s)
    if (d.cols === span.gridCols && d.rows === span.gridRows) return s
  }
  return null
}

export type AssistGridSpan = {
  gridCols: number
  gridRows: number
  gc0: number
  gc1: number
  gr0: number
  gr1: number
}

export type EdgeAssistDetectOptions = {
  /** When true, top edge uses snap assist bar instead of edge spans (center band only). */
  suppressTopEdgeSpans: boolean
}

function topBottomEdgeSlot(
  cursorX: number,
  cw: number,
  cols: number,
): { gc0: number; gc1: number } {
  const slots = cols * 2 - 1
  const t = Math.min(Math.max((cursorX / cw) * slots, 0), slots - Number.EPSILON)
  const slot = Math.min(slots - 1, Math.floor(t))
  if (slot % 2 === 0) {
    const c = slot / 2
    return { gc0: c, gc1: c }
  }
  const i = (slot - 1) / 2
  return { gc0: i, gc1: i + 1 }
}

function leftRightEdgeSlot(
  cursorY: number,
  ch: number,
  rows: number,
): { gr0: number; gr1: number } {
  const slots = rows * 2 - 1
  const t = Math.min(Math.max((cursorY / ch) * slots, 0), slots - Number.EPSILON)
  const slot = Math.min(slots - 1, Math.floor(t))
  if (slot % 2 === 0) {
    const r = slot / 2
    return { gr0: r, gr1: r }
  }
  const i = (slot - 1) / 2
  return { gr0: i, gr1: i + 1 }
}

/**
 * Edge snap spans matching the assist grid: single cells on corners, pair slots between tiles
 * along each edge (same idea as gutter hits in the assist bar).
 */
export function detectEdgeAssistGridSpan(
  lx: number,
  ly: number,
  cw: number,
  ch: number,
  shape: AssistGridShape,
  opts: EdgeAssistDetectOptions,
): AssistGridSpan | null {
  const { cols, rows } = assistShapeToDims(shape)
  const nearL = lx <= SNAP_EDGE_THRESHOLD_PX
  const nearR = lx >= cw - SNAP_EDGE_THRESHOLD_PX
  const nearT = ly <= SNAP_EDGE_THRESHOLD_PX
  const nearB = ly >= ch - SNAP_EDGE_THRESHOLD_PX

  if (nearL && nearT) {
    return { gridCols: cols, gridRows: rows, gc0: 0, gc1: 0, gr0: 0, gr1: 0 }
  }
  if (nearR && nearT) {
    return {
      gridCols: cols,
      gridRows: rows,
      gc0: cols - 1,
      gc1: cols - 1,
      gr0: 0,
      gr1: 0,
    }
  }
  if (nearL && nearB) {
    return {
      gridCols: cols,
      gridRows: rows,
      gc0: 0,
      gc1: 0,
      gr0: rows - 1,
      gr1: rows - 1,
    }
  }
  if (nearR && nearB) {
    return {
      gridCols: cols,
      gridRows: rows,
      gc0: cols - 1,
      gc1: cols - 1,
      gr0: rows - 1,
      gr1: rows - 1,
    }
  }

  if (nearT && !opts.suppressTopEdgeSpans) {
    const { gc0, gc1 } = topBottomEdgeSlot(lx, cw, cols)
    return { gridCols: cols, gridRows: rows, gc0, gc1, gr0: 0, gr1: 0 }
  }

  if (nearB) {
    const { gc0, gc1 } = topBottomEdgeSlot(lx, cw, cols)
    return {
      gridCols: cols,
      gridRows: rows,
      gc0,
      gc1,
      gr0: rows - 1,
      gr1: rows - 1,
    }
  }

  if (nearL) {
    const { gr0, gr1 } = leftRightEdgeSlot(ly, ch, rows)
    return { gridCols: cols, gridRows: rows, gc0: 0, gc1: 0, gr0, gr1 }
  }

  if (nearR) {
    const { gr0, gr1 } = leftRightEdgeSlot(ly, ch, rows)
    return {
      gridCols: cols,
      gridRows: rows,
      gc0: cols - 1,
      gc1: cols - 1,
      gr0,
      gr1,
    }
  }

  return null
}

/** Build a tiling placement for an assist span, reusing an existing resized grid when present. */
export function assistSpanToTilingPlacement(
  span: AssistGridSpan,
  existing?: Pick<WorkspaceTilingPlacement, 'colLines' | 'rowLines'> | null,
): WorkspaceTilingPlacement {
  return {
    cols: span.gridCols,
    rows: span.gridRows,
    colStart: span.gc0,
    colEnd: span.gc1 + 1,
    rowStart: span.gr0,
    rowEnd: span.gr1 + 1,
    colLines:
      existing?.colLines?.length === span.gridCols + 1
        ? existing.colLines
        : defaultWorkspaceGridLines(span.gridCols),
    rowLines:
      existing?.rowLines?.length === span.gridRows + 1
        ? existing.rowLines
        : defaultWorkspaceGridLines(span.gridRows),
  }
}

/** Shared col/row lines from any window already on the same assist grid, if present. */
export function findSharedAssistGridLines(
  windows: WorkspaceWindowDefinition[],
  span: AssistGridSpan,
): Pick<WorkspaceTilingPlacement, 'colLines' | 'rowLines'> | null {
  const existing = windows.find(
    (candidate) =>
      candidate.layout?.tiling?.cols === span.gridCols &&
      candidate.layout.tiling.rows === span.gridRows,
  )?.layout?.tiling
  if (!existing) return null
  return { colLines: existing.colLines, rowLines: existing.rowLines }
}

/**
 * Pixel bounds for an assist span. When `existing` lines are provided (resized grid),
 * bounds follow those lines — not equal divisions.
 */
export function assistGridSpanToBounds(
  canvas: WorkspaceCanvasSize,
  span: AssistGridSpan,
  existing?: Pick<WorkspaceTilingPlacement, 'colLines' | 'rowLines'> | null,
): WorkspaceBounds {
  return tilingPlacementToBounds(assistSpanToTilingPlacement(span, existing), canvas)
}

/**
 * Pure layout update: place `windowId` (and its tab group) into an assist span.
 * Reuses resized grid lines from any peer already on the same cols×rows grid.
 */
export function applyAssistCustomSnapToWindows(
  windows: WorkspaceWindowDefinition[],
  windowId: string,
  span: AssistGridSpan,
  canvas: WorkspaceCanvasSize,
  options?: { zIndex?: number },
): WorkspaceWindowDefinition[] {
  const migrated = migrateLegacyAssistCustomToTiling(windows, canvas)
  const target = migrated.find((w) => w.id === windowId)
  if (!target) return windows
  const groupId = target.tabGroupId ?? target.id
  const existing = findSharedAssistGridLines(migrated, span)
  const tiling = assistSpanToTilingPlacement(span, existing)
  const bounds = tilingPlacementToBounds(tiling, canvas)
  return migrated.map((w) => {
    if ((w.tabGroupId ?? w.id) !== groupId) return w
    return {
      ...w,
      layout: {
        ...w.layout,
        fullscreen: false,
        snapZone: null,
        tiling,
        minimized: false,
        zIndex: options?.zIndex ?? w.layout?.zIndex,
        bounds,
        restoreBounds: w.layout?.restoreBounds ?? w.layout?.bounds ?? null,
      },
    }
  })
}

export function assistGridSpansEqual(a: AssistGridSpan, b: AssistGridSpan): boolean {
  return (
    a.gridCols === b.gridCols &&
    a.gridRows === b.gridRows &&
    a.gc0 === b.gc0 &&
    a.gc1 === b.gc1 &&
    a.gr0 === b.gr0 &&
    a.gr1 === b.gr1
  )
}

/** Grid line indices (1-based) for overlay placement in a (cols*2-1) × (rows*2-1) CSS grid. */
export function assistSpanToGridLines(span: AssistGridSpan): {
  colStart: number
  colEnd: number
  rowStart: number
  rowEnd: number
} {
  return {
    colStart: span.gc0 * 2 + 1,
    colEnd: span.gc1 * 2 + 2,
    rowStart: span.gr0 * 2 + 1,
    rowEnd: span.gr1 * 2 + 2,
  }
}
