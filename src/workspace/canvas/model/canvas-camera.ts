import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  type CanvasCamera,
  type CanvasRect,
} from './infinite-canvas'

export function cameraForCanvasBounds(options: {
  bounds: CanvasRect
  viewport: { width: number; height: number }
  padding: number
  maxZoom?: number
}): CanvasCamera {
  const { bounds, viewport, padding } = options
  const zoom = Math.min(
    options.maxZoom ?? CANVAS_MAX_ZOOM,
    CANVAS_MAX_ZOOM,
    Math.max(
      CANVAS_MIN_ZOOM,
      Math.min(
        (viewport.width - padding * 2) / Math.max(1, bounds.width),
        (viewport.height - padding * 2) / Math.max(1, bounds.height),
      ),
    ),
  )
  return {
    zoom,
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  }
}
