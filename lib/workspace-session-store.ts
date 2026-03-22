import type { WorkspaceWindowDefinition, WorkspaceWindowLayout } from '@/lib/use-workspace'

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function gap1d(a0: number, a1: number, b0: number, b1: number): number {
  if (a1 < b0) return b0 - a1
  if (b1 < a0) return a0 - b1
  return 0
}

const EDGE_ALIGN_TOL = 8
const MIN_SHARED_AXIS = 24

function verticalSpanOverlap(ay0: number, ay1: number, by0: number, by1: number): boolean {
  const vOv = overlap1d(ay0, ay1, by0, by1)
  if (vOv >= MIN_SHARED_AXIS) return true
  return gap1d(ay0, ay1, by0, by1) <= EDGE_ALIGN_TOL
}

function horizontalSpanOverlap(ax0: number, ax1: number, bx0: number, bx1: number): boolean {
  const hOv = overlap1d(ax0, ax1, bx0, bx1)
  if (hOv >= MIN_SHARED_AXIS) return true
  return gap1d(ax0, ax1, bx0, bx1) <= EDGE_ALIGN_TOL
}

/** Pure layout update for snapped multi-window resize; `current` is the authoritative session windows. */
export function computeSnappedResizeWindows(
  current: WorkspaceWindowDefinition[],
  windowId: string,
  newBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
  direction: string,
): WorkspaceWindowDefinition[] {
  const target = current.find((w) => w.id === windowId)
  if (!target?.layout?.bounds) {
    return current.map((w) =>
      w.id === windowId ? { ...w, layout: { ...w.layout, bounds: newBounds } } : w,
    )
  }

  const oldBounds = target.layout.bounds
  const ox0 = oldBounds.x
  const oy0 = oldBounds.y
  const ox1 = oldBounds.x + oldBounds.width
  const oy1 = oldBounds.y + oldBounds.height
  const nx0 = newBounds.x
  const ny0 = newBounds.y
  const nx1 = newBounds.x + newBounds.width
  const ny1 = newBounds.y + newBounds.height

  const deltaLeft = nx0 - ox0
  const deltaRight = nx1 - ox1
  const deltaTop = ny0 - oy0
  const deltaBottom = ny1 - oy1

  const siblingUpdates = new Map<string, NonNullable<WorkspaceWindowLayout['bounds']>>()

  let next = current.map((w) => {
    if (w.id === windowId) {
      return { ...w, layout: { ...w.layout, bounds: newBounds } }
    }

    const wb = { ...(w.layout?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }) }
    if (!w.layout?.bounds) return w

    let updated = false

    if (direction.includes('right') && deltaRight !== 0) {
      const gutter = ox1
      if (verticalSpanOverlap(oy0, oy1, wb.y, wb.y + wb.height)) {
        if (Math.abs(wb.x - gutter) <= EDGE_ALIGN_TOL) {
          wb.x += deltaRight
          wb.width -= deltaRight
          updated = true
        } else if (
          Math.abs(wb.x + wb.width - gutter) <= EDGE_ALIGN_TOL &&
          wb.x < gutter - EDGE_ALIGN_TOL
        ) {
          wb.width += deltaRight
          updated = true
        }
      }
    }

    if (direction.includes('left') && deltaLeft !== 0) {
      const gutter = ox0
      if (verticalSpanOverlap(oy0, oy1, wb.y, wb.y + wb.height)) {
        if (
          Math.abs(wb.x + wb.width - gutter) <= EDGE_ALIGN_TOL &&
          wb.x < gutter - EDGE_ALIGN_TOL
        ) {
          wb.width += deltaLeft
          updated = true
        } else if (
          Math.abs(wb.x - gutter) <= EDGE_ALIGN_TOL &&
          wb.x + wb.width > gutter + EDGE_ALIGN_TOL
        ) {
          wb.x += deltaLeft
          wb.width -= deltaLeft
          updated = true
        }
      }
    }

    if (direction.includes('bottom') && deltaBottom !== 0) {
      const gutter = oy1
      if (horizontalSpanOverlap(ox0, ox1, wb.x, wb.x + wb.width)) {
        if (Math.abs(wb.y - gutter) <= EDGE_ALIGN_TOL) {
          wb.y += deltaBottom
          wb.height -= deltaBottom
          updated = true
        } else if (
          Math.abs(wb.y + wb.height - gutter) <= EDGE_ALIGN_TOL &&
          wb.y < gutter - EDGE_ALIGN_TOL
        ) {
          wb.height += deltaBottom
          updated = true
        }
      }
    }

    if (direction.includes('top') && deltaTop !== 0) {
      const gutter = oy0
      if (horizontalSpanOverlap(ox0, ox1, wb.x, wb.x + wb.width)) {
        if (
          Math.abs(wb.y + wb.height - gutter) <= EDGE_ALIGN_TOL &&
          wb.y < gutter - EDGE_ALIGN_TOL
        ) {
          wb.height += deltaTop
          updated = true
        } else if (
          Math.abs(wb.y - gutter) <= EDGE_ALIGN_TOL &&
          wb.y + wb.height > gutter + EDGE_ALIGN_TOL
        ) {
          wb.y += deltaTop
          wb.height -= deltaTop
          updated = true
        }
      }
    }

    if (
      !updated ||
      (wb.x === w.layout.bounds.x &&
        wb.y === w.layout.bounds.y &&
        wb.width === w.layout.bounds.width &&
        wb.height === w.layout.bounds.height)
    ) {
      return w
    }

    const gid = w.tabGroupId ?? w.id
    siblingUpdates.set(gid, wb)
    return { ...w, layout: { ...w.layout, bounds: wb } }
  })

  if (siblingUpdates.size > 0) {
    next = next.map((w) => {
      const gid = w.tabGroupId ?? w.id
      const syncBounds = siblingUpdates.get(gid)
      if (syncBounds && w.id !== windowId) {
        const b = w.layout?.bounds
        if (
          !b ||
          b.x !== syncBounds.x ||
          b.y !== syncBounds.y ||
          b.width !== syncBounds.width ||
          b.height !== syncBounds.height
        ) {
          return { ...w, layout: { ...w.layout, bounds: syncBounds } }
        }
      }
      return w
    })
  }

  return next
}
