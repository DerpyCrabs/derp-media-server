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

export function fitCrop(image: { width: number; height: number }, ratio: number | null): CropRect {
  const width = ratio ? Math.min(image.width, image.height * ratio) : image.width
  const height = ratio ? width / ratio : image.height
  return {
    x: Math.round((image.width - width) / 2),
    y: Math.round((image.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

export function resizeCrop(
  rect: CropRect,
  handle: string,
  dx: number,
  dy: number,
  image: { width: number; height: number },
  ratio: number | null,
): CropRect {
  if (handle === 'move')
    return {
      ...rect,
      x: Math.round(Math.max(0, Math.min(image.width - rect.width, rect.x + dx))),
      y: Math.round(Math.max(0, Math.min(image.height - rect.height, rect.y + dy))),
    }
  const west = handle.includes('w'),
    north = handle.includes('n')
  const horizontal = west || handle.includes('e'),
    vertical = north || handle.includes('s')
  const anchorX = west ? rect.x + rect.width : horizontal ? rect.x : rect.x + rect.width / 2
  const anchorY = north ? rect.y + rect.height : vertical ? rect.y : rect.y + rect.height / 2
  const maxWidth = horizontal
    ? west
      ? anchorX
      : image.width - anchorX
    : 2 * Math.min(anchorX, image.width - anchorX)
  const maxHeight = vertical
    ? north
      ? anchorY
      : image.height - anchorY
    : 2 * Math.min(anchorY, image.height - anchorY)
  let width = Math.max(1, Math.min(maxWidth, rect.width + (horizontal ? (west ? -dx : dx) : 0)))
  let height = Math.max(1, Math.min(maxHeight, rect.height + (vertical ? (north ? -dy : dy) : 0)))
  if (ratio) {
    if (!horizontal || (vertical && Math.abs(dy) > Math.abs(dx / ratio))) width = height * ratio
    else height = width / ratio
    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    width *= scale
    height *= scale
  }
  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  return {
    x: Math.max(
      0,
      Math.min(
        image.width - width,
        Math.round(horizontal ? (west ? anchorX - width : anchorX) : anchorX - width / 2),
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        image.height - height,
        Math.round(vertical ? (north ? anchorY - height : anchorY) : anchorY - height / 2),
      ),
    ),
    width,
    height,
  }
}
