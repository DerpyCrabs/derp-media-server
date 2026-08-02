import type { SnapZone } from '@/lib/use-workspace'
import type { SnapDetectResult } from '@/lib/use-snap-zones'
import { applyWorkspaceTileGap, type WorkspaceRect } from '@/lib/workspace-tile-gaps'

export function applySnapPreviewBounds(
  el: HTMLElement,
  bounds: WorkspaceRect,
  container: HTMLElement,
  tiledWindowGap: number,
) {
  const rect = container.getBoundingClientRect()
  const visual = applyWorkspaceTileGap(
    bounds,
    { width: rect.width, height: rect.height },
    tiledWindowGap,
    true,
  )
  el.style.display = 'block'
  el.style.left = `${visual.x}px`
  el.style.top = `${visual.y}px`
  el.style.width = `${visual.width}px`
  el.style.height = `${visual.height}px`
  el.style.borderRadius = tiledWindowGap > 0 ? '0.5rem' : '0px'
}

export function applySnapPreviewLayout(
  el: HTMLElement | null | undefined,
  zone: SnapDetectResult | null,
  container: HTMLElement,
  getZoneBounds: (z: SnapZone) => { x: number; y: number; width: number; height: number },
  tiledWindowGap = 0,
) {
  if (!el) return
  if (!zone) {
    el.style.display = 'none'
    return
  }
  if (zone === 'snap-assist') {
    el.style.display = 'none'
    return
  }
  if (zone === 'edge-grid') {
    const b = getZoneBounds('left')
    if (b.width <= 0) {
      el.style.display = 'none'
      return
    }
    applySnapPreviewBounds(el, b, container, tiledWindowGap)
    return
  }
  const b = getZoneBounds(zone as SnapZone)
  applySnapPreviewBounds(el, b, container, tiledWindowGap)
}
