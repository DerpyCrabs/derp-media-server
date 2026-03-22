import { layoutViewportClientSize } from '@/lib/layout-viewport'

const EDGE = 8

export type ClampFixedMenuArgs = {
  preferredLeft: number
  width: number
  height: number
  /**
   * Vertical placement relative to an anchor segment (viewport coords).
   * Tries below `anchorBottom + gap`, then above `anchorTop - gap`, then clamps (same idea as WorkspaceTilingPicker).
   */
  flip: {
    anchorTop: number
    anchorBottom: number
    gap: number
  }
}

/** Clamp top-left for a `position: fixed` menu so it stays inside the layout viewport. */
export function clampFixedMenuPosition(args: ClampFixedMenuArgs): { left: number; top: number } {
  const { w: vw, h: vh } = layoutViewportClientSize()
  const pw = Math.max(1, args.width)
  const ph = Math.max(1, args.height)
  const { anchorTop, anchorBottom, gap } = args.flip

  let top = anchorBottom + gap
  if (top + ph > vh - EDGE) {
    top = anchorTop - ph - gap
  }
  if (top + ph > vh - EDGE) {
    top = vh - ph - EDGE
  }
  if (top < EDGE) top = EDGE

  let left = args.preferredLeft
  if (left > vw - pw - EDGE) left = vw - pw - EDGE
  if (left < EDGE) left = EDGE

  return { left, top }
}
