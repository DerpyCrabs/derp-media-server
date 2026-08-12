import type { CanvasCamera, CanvasRect } from '@/lib/infinite-canvas'

export type CanvasMinimapModel = Readonly<{
  scale: number
  offsetX: number
  offsetY: number
  extent: CanvasRect
  windows: CanvasRect[]
  viewport: CanvasRect
}>

function union(rects: CanvasRect[]): CanvasRect {
  const left = Math.min(...rects.map((rect) => rect.x))
  const top = Math.min(...rects.map((rect) => rect.y))
  const right = Math.max(...rects.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function createCanvasMinimapModel(input: {
  windows: CanvasRect[]
  camera: CanvasCamera
  viewport: { width: number; height: number }
  width: number
  height: number
  padding?: number
}): CanvasMinimapModel | null {
  if (input.windows.length === 0 || input.width <= 0 || input.height <= 0) return null
  const zoom = Math.max(input.camera.zoom, 0.001)
  const viewport = {
    x: -input.camera.x / zoom,
    y: -input.camera.y / zoom,
    width: input.viewport.width / zoom,
    height: input.viewport.height / zoom,
  }
  const rawExtent = union([...input.windows, viewport])
  const worldPadding = Math.max(48, Math.max(rawExtent.width, rawExtent.height) * 0.04)
  const extent = {
    x: rawExtent.x - worldPadding,
    y: rawExtent.y - worldPadding,
    width: rawExtent.width + worldPadding * 2,
    height: rawExtent.height + worldPadding * 2,
  }
  const padding = input.padding ?? 8
  const scale = Math.min(
    Math.max(1, input.width - padding * 2) / extent.width,
    Math.max(1, input.height - padding * 2) / extent.height,
  )
  const offsetX = (input.width - extent.width * scale) / 2 - extent.x * scale
  const offsetY = (input.height - extent.height * scale) / 2 - extent.y * scale
  const project = (rect: CanvasRect): CanvasRect => ({
    x: rect.x * scale + offsetX,
    y: rect.y * scale + offsetY,
    width: Math.max(2, rect.width * scale),
    height: Math.max(2, rect.height * scale),
  })
  return {
    scale,
    offsetX,
    offsetY,
    extent,
    windows: input.windows.map(project),
    viewport: project(viewport),
  }
}

export function minimapPointToWorld(
  model: Pick<CanvasMinimapModel, 'scale' | 'offsetX' | 'offsetY'>,
  point: { x: number; y: number },
) {
  return {
    x: (point.x - model.offsetX) / model.scale,
    y: (point.y - model.offsetY) / model.scale,
  }
}
