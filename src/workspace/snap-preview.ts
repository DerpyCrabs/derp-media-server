import type { SnapZone } from '@/lib/use-workspace'
import type { SnapDetectResult } from '@/lib/use-snap-zones'

export function applySnapPreviewLayout(
  el: HTMLElement | null | undefined,
  zone: SnapDetectResult | null,
  container: HTMLElement,
  getZoneBounds: (z: SnapZone) => { x: number; y: number; width: number; height: number },
) {
  if (!el) return
  if (!zone) {
    el.style.display = 'none'
    return
  }
  if (zone === 'top') {
    el.style.display = 'block'
    el.style.left = '0px'
    el.style.top = '0px'
    el.style.width = `${container.clientWidth}px`
    el.style.height = `${container.clientHeight}px`
    return
  }
  const b = getZoneBounds(zone as SnapZone)
  el.style.display = 'block'
  el.style.left = `${b.x}px`
  el.style.top = `${b.y}px`
  el.style.width = `${b.width}px`
  el.style.height = `${b.height}px`
}
