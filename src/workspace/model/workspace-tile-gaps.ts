export type WorkspaceRect = {
  x: number
  y: number
  width: number
  height: number
}

type CanvasSize = { width: number; height: number }

const EDGE_TOLERANCE = 1

export function applyWorkspaceTileGap(
  bounds: WorkspaceRect,
  canvas: CanvasSize | null,
  gap: number,
  tiled: boolean,
): WorkspaceRect {
  if (!tiled || gap <= 0) return bounds

  const half = gap / 2
  const left = half + (bounds.x <= EDGE_TOLERANCE ? half : 0)
  const top = half + (bounds.y <= EDGE_TOLERANCE ? half : 0)
  const right =
    half + (canvas && bounds.x + bounds.width >= canvas.width - EDGE_TOLERANCE ? half : 0)
  const bottom =
    half + (canvas && bounds.y + bounds.height >= canvas.height - EDGE_TOLERANCE ? half : 0)

  return {
    x: bounds.x + left,
    y: bounds.y + top,
    width: Math.max(0, bounds.width - left - right),
    height: Math.max(0, bounds.height - top - bottom),
  }
}
