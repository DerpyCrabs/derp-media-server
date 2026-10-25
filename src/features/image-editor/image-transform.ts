export type ImageMatrix = readonly [number, number, number, number, number, number]
export type ImageTransform = { width: number; height: number; matrix: ImageMatrix }
export type CropRect = { x: number; y: number; width: number; height: number }
export const MAX_IMAGE_PIXELS = 40_000_000

export function validImageSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width * height <= MAX_IMAGE_PIXELS &&
    width <= 16384 &&
    height <= 16384
  )
}
export const originalTransform = (width: number, height: number): ImageTransform => ({
  width,
  height,
  matrix: [1, 0, 0, 1, 0, 0],
})
function compose(left: ImageMatrix, right: ImageMatrix): ImageMatrix {
  const [a, b, c, d, e, f] = left
  const [g, h, i, j, k, l] = right
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ]
}
export function rotateImage(state: ImageTransform, clockwise = true): ImageTransform {
  return {
    width: state.height,
    height: state.width,
    matrix: compose(
      clockwise ? [0, 1, -1, 0, state.height, 0] : [0, -1, 1, 0, 0, state.width],
      state.matrix,
    ),
  }
}
export function flipImage(state: ImageTransform, horizontal: boolean): ImageTransform {
  return {
    ...state,
    matrix: compose(
      horizontal ? [-1, 0, 0, 1, state.width, 0] : [1, 0, 0, -1, 0, state.height],
      state.matrix,
    ),
  }
}
export function cropImage(state: ImageTransform, rect: CropRect): ImageTransform | null {
  if (
    !validImageSize(rect.width, rect.height) ||
    !Number.isInteger(rect.x) ||
    !Number.isInteger(rect.y) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > state.width ||
    rect.y + rect.height > state.height
  )
    return null
  return {
    width: rect.width,
    height: rect.height,
    matrix: compose([1, 0, 0, 1, -rect.x, -rect.y], state.matrix),
  }
}
export function resizeImage(
  state: ImageTransform,
  width: number,
  height: number,
): ImageTransform | null {
  if (!validImageSize(width, height)) return null
  return {
    width,
    height,
    matrix: compose([width / state.width, 0, 0, height / state.height, 0, 0], state.matrix),
  }
}
export function selectionFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  image: { width: number; height: number },
): CropRect {
  const left = Math.max(0, Math.min(image.width - 1, Math.round(Math.min(start.x, end.x))))
  const top = Math.max(0, Math.min(image.height - 1, Math.round(Math.min(start.y, end.y))))
  const right = Math.max(left + 1, Math.min(image.width, Math.round(Math.max(start.x, end.x))))
  const bottom = Math.max(top + 1, Math.min(image.height, Math.round(Math.max(start.y, end.y))))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
export function drawEditedImage(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  edit: ImageTransform,
  maxDimension?: number,
  background?: string,
): void {
  const scale = maxDimension ? Math.min(1, maxDimension / Math.max(edit.width, edit.height)) : 1
  canvas.width = Math.max(1, Math.round(edit.width * scale))
  canvas.height = Math.max(1, Math.round(edit.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image editing is unavailable in this browser.')
  if (background) {
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const [a, b, c, d, e, f] = edit.matrix
  const sx = canvas.width / edit.width,
    sy = canvas.height / edit.height
  context.setTransform(a * sx, b * sy, c * sx, d * sy, e * sx, f * sy)
  context.drawImage(source, 0, 0)
  context.resetTransform()
}

export function parseImageTransform(content: string): ImageTransform | null {
  try {
    const edit: unknown = JSON.parse(content)
    if (
      !edit ||
      typeof edit !== 'object' ||
      !('width' in edit) ||
      !('height' in edit) ||
      !('matrix' in edit)
    )
      return null
    if (
      typeof edit.width !== 'number' ||
      typeof edit.height !== 'number' ||
      !validImageSize(edit.width, edit.height)
    )
      return null
    if (
      !Array.isArray(edit.matrix) ||
      edit.matrix.length !== 6 ||
      !edit.matrix.every(
        (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e12,
      )
    )
      return null
    const [a, b, c, d, e, f] = edit.matrix as number[]
    if (Math.abs(a! * d! - b! * c!) < 1e-16) return null
    return { width: edit.width, height: edit.height, matrix: [a!, b!, c!, d!, e!, f!] }
  } catch {
    return null
  }
}
