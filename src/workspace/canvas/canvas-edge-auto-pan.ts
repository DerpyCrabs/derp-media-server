export const CANVAS_EDGE_AUTO_PAN_MARGIN = 72
export const CANVAS_EDGE_AUTO_PAN_MAX_SPEED = 900

type ViewportRect = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>

function edgeVelocity(
  position: number,
  start: number,
  end: number,
  margin: number,
  maxSpeed: number,
): number {
  if (position < start + margin) {
    return maxSpeed * Math.min(1, (start + margin - position) / margin)
  }
  if (position > end - margin) {
    return -maxSpeed * Math.min(1, (position - (end - margin)) / margin)
  }
  return 0
}

export function canvasEdgeAutoPanVelocity(
  clientX: number,
  clientY: number,
  viewport: ViewportRect,
  margin = CANVAS_EDGE_AUTO_PAN_MARGIN,
  maxSpeed = CANVAS_EDGE_AUTO_PAN_MAX_SPEED,
): { x: number; y: number } {
  return {
    x: edgeVelocity(clientX, viewport.left, viewport.right, margin, maxSpeed),
    y: edgeVelocity(clientY, viewport.top, viewport.bottom, margin, maxSpeed),
  }
}
