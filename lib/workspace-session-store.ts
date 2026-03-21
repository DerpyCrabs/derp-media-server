import type {
  SnapZone,
  WorkspaceWindowDefinition,
  WorkspaceWindowLayout,
} from '@/lib/use-workspace'
import { SNAP_SIBLING_MAP } from '@/lib/workspace-geometry'

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function gap1d(a0: number, a1: number, b0: number, b1: number): number {
  if (a1 < b0) return b0 - a1
  if (b1 < a0) return a0 - b1
  return 0
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
  const siblings = (target.layout?.snapZone && SNAP_SIBLING_MAP[target.layout.snapZone]) ?? {}
  const affectedZones = new Set<SnapZone>()
  for (const zones of Object.values(siblings)) {
    for (const z of zones) affectedZones.add(z)
  }

  const siblingUpdates = new Map<string, NonNullable<WorkspaceWindowLayout['bounds']>>()
  const EDGE_ALIGN_TOL = 8
  const MIN_SHARED_AXIS = 24

  const sharesVerticalEdge = (b: NonNullable<WorkspaceWindowLayout['bounds']>) => {
    const targetRight = oldBounds.x + oldBounds.width
    if (Math.abs(b.x - targetRight) > EDGE_ALIGN_TOL) return false
    const vOv = overlap1d(oldBounds.y, oldBounds.y + oldBounds.height, b.y, b.y + b.height)
    if (vOv >= MIN_SHARED_AXIS) return true
    if (
      vOv === 0 &&
      gap1d(oldBounds.y, oldBounds.y + oldBounds.height, b.y, b.y + b.height) <= EDGE_ALIGN_TOL
    )
      return true
    return false
  }
  const sharesHorizontalEdge = (b: NonNullable<WorkspaceWindowLayout['bounds']>) => {
    const targetBottom = oldBounds.y + oldBounds.height
    if (Math.abs(b.y - targetBottom) > EDGE_ALIGN_TOL) return false
    const hOv = overlap1d(oldBounds.x, oldBounds.x + oldBounds.width, b.x, b.x + b.width)
    if (hOv >= MIN_SHARED_AXIS) return true
    if (
      hOv === 0 &&
      gap1d(oldBounds.x, oldBounds.x + oldBounds.width, b.x, b.x + b.width) <= EDGE_ALIGN_TOL
    )
      return true
    return false
  }

  const isSpatialRightSibling = (w: (typeof current)[0]) => {
    const b = w.layout?.bounds
    if (!b) return false
    return sharesVerticalEdge(b)
  }
  const isSpatialLeftSibling = (w: (typeof current)[0]) => {
    const b = w.layout?.bounds
    if (!b) return false
    const siblingRight = b.x + b.width
    if (Math.abs(siblingRight - oldBounds.x) > EDGE_ALIGN_TOL) return false
    const vOv = overlap1d(oldBounds.y, oldBounds.y + oldBounds.height, b.y, b.y + b.height)
    if (vOv >= MIN_SHARED_AXIS) return true
    if (
      vOv === 0 &&
      gap1d(oldBounds.y, oldBounds.y + oldBounds.height, b.y, b.y + b.height) <= EDGE_ALIGN_TOL
    )
      return true
    return false
  }
  const isSpatialBottomSibling = (w: (typeof current)[0]) => {
    const b = w.layout?.bounds
    if (!b) return false
    return sharesHorizontalEdge(b)
  }
  const isSpatialTopSibling = (w: (typeof current)[0]) => {
    const b = w.layout?.bounds
    if (!b) return false
    const siblingBottom = b.y + b.height
    if (Math.abs(siblingBottom - oldBounds.y) > EDGE_ALIGN_TOL) return false
    const hOv = overlap1d(oldBounds.x, oldBounds.x + oldBounds.width, b.x, b.x + b.width)
    if (hOv >= MIN_SHARED_AXIS) return true
    if (
      hOv === 0 &&
      gap1d(oldBounds.x, oldBounds.x + oldBounds.width, b.x, b.x + b.width) <= EDGE_ALIGN_TOL
    )
      return true
    return false
  }

  let next = current.map((w) => {
    if (w.id === windowId) {
      return { ...w, layout: { ...w.layout, bounds: newBounds } }
    }

    const hasZoneMatch = w.layout?.snapZone && affectedZones.has(w.layout.snapZone)
    const wb = { ...(w.layout?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }) }
    if (!w.layout?.bounds) return w

    let updated = false

    if (
      direction.includes('right') &&
      newBounds.x + newBounds.width !== oldBounds.x + oldBounds.width
    ) {
      const delta = newBounds.x + newBounds.width - (oldBounds.x + oldBounds.width)
      const isSibling = hasZoneMatch && siblings.right?.includes(w.layout.snapZone!)
      const isSpatial = isSpatialRightSibling(w)
      if (isSibling || isSpatial) {
        wb.x += delta
        wb.width -= delta
        updated = true
      }
    }
    if (direction.includes('left') && newBounds.x !== oldBounds.x) {
      const delta = newBounds.x - oldBounds.x
      const isSibling = hasZoneMatch && siblings.left?.includes(w.layout.snapZone!)
      const isSpatial = isSpatialLeftSibling(w)
      if (isSibling || isSpatial) {
        wb.width += delta
        updated = true
      }
    }
    if (
      direction.includes('bottom') &&
      newBounds.y + newBounds.height !== oldBounds.y + oldBounds.height
    ) {
      const delta = newBounds.y + newBounds.height - (oldBounds.y + oldBounds.height)
      const isSibling = hasZoneMatch && siblings.bottom?.includes(w.layout.snapZone!)
      const isSpatial = isSpatialBottomSibling(w)
      if (isSibling || isSpatial) {
        wb.y += delta
        wb.height -= delta
        updated = true
      }
    }
    if (direction.includes('top') && newBounds.y !== oldBounds.y) {
      const delta = newBounds.y - oldBounds.y
      const isSibling = hasZoneMatch && siblings.top?.includes(w.layout.snapZone!)
      const isSpatial = isSpatialTopSibling(w)
      if (isSibling || isSpatial) {
        wb.height += delta
        updated = true
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
