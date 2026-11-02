import { expect, test } from 'bun:test'
import {
  cropImage,
  fitCrop,
  resizeCrop,
  flipImage,
  originalTransform,
  parseImageTransform,
  resizeImage,
  rotateImage,
  selectionFromPoints,
  validImageSize,
  type ImageTransform,
} from '@/features/image-editor/image-transform'
const point = (image: ImageTransform, x: number, y: number) => {
  const [a, b, c, d, e, f] = image.matrix
  return [a * x + c * y + e, b * x + d * y + f]
}
test('cropped image keeps the same original pixels through rotation and resize', () => {
  const cropped = cropImage(originalTransform(1000, 800), {
    x: 200,
    y: 100,
    width: 400,
    height: 300,
  })!
  expect(point(cropped, 200, 100)).toEqual([0, 0])
  const rotated = rotateImage(cropped)
  expect([rotated.width, rotated.height]).toEqual([300, 400])
  expect(point(rotated, 200, 100)).toEqual([300, 0])
  expect(point(rotated, 600, 400)).toEqual([0, 400])
  const resized = resizeImage(rotated, 150, 200)!
  expect(point(resized, 600, 400)).toEqual([0, 200])
  expect(point(resized, 200, 100)).toEqual([150, 0])
})
test('inverse rotations and flips restore the source transform', () => {
  const original = originalTransform(640, 480)
  expect(rotateImage(rotateImage(original), false)).toEqual(original)
  expect(flipImage(flipImage(original, true), true)).toEqual(original)
  expect(flipImage(flipImage(original, false), false)).toEqual(original)
})
test('selection clamps reverse drags to the image and edits reject out-of-bounds dimensions', () => {
  expect(
    selectionFromPoints({ x: 140, y: 90 }, { x: -20, y: -10 }, { width: 100, height: 80 }),
  ).toEqual({ x: 0, y: 0, width: 100, height: 80 })
  const original = originalTransform(100, 80)
  expect(cropImage(original, { x: 50, y: 0, width: 80, height: 40 })).toBeNull()
  expect(resizeImage(original, 0, 50)).toBeNull()
  expect(validImageSize(10000, 10000)).toBe(false)
  expect(validImageSize(100.5, 50)).toBe(false)
})

test('restored image transforms reject invalid sizes, singular matrices and nonfinite coordinates', () => {
  const edit = rotateImage(originalTransform(800, 600))
  expect(parseImageTransform(JSON.stringify(edit))).toEqual(edit)
  for (const content of [
    'null',
    '{}',
    'not-json',
    JSON.stringify({ ...edit, width: 100000 }),
    JSON.stringify({ ...edit, matrix: [0, 0, 0, 0, 0, 0] }),
    JSON.stringify({ ...edit, matrix: [1, 0, 0, 1, null, 0] }),
  ])
    expect(parseImageTransform(content)).toBeNull()
})

test('crop presets fit inside portrait and landscape images', () => {
  expect(fitCrop({ width: 800, height: 600 }, 1)).toEqual({ x: 100, y: 0, width: 600, height: 600 })
  expect(fitCrop({ width: 600, height: 800 }, 16 / 9)).toEqual({
    x: 0,
    y: 231,
    width: 600,
    height: 338,
  })
})
test('crop handles preserve the opposite corner and clamp movement to the image', () => {
  const image = { width: 800, height: 600 },
    rect = { x: 100, y: 100, width: 300, height: 200 }
  expect(resizeCrop(rect, 'nw', -900, -900, image, null)).toEqual({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  })
  expect(resizeCrop(rect, 'move', 900, -900, image, null)).toEqual({
    x: 500,
    y: 0,
    width: 300,
    height: 200,
  })
})
test('fixed crop proportions survive every edge and corner at image boundaries', () => {
  const image = { width: 800, height: 600 }
  for (const ratio of [1, 4 / 3, 9 / 16])
    for (const handle of ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e']) {
      const rect = resizeCrop(fitCrop(image, ratio), handle, 900, -900, image, ratio)
      expect(cropImage(originalTransform(image.width, image.height), rect)).not.toBeNull()
      expect(Math.abs(rect.width - rect.height * ratio)).toBeLessThanOrEqual(1)
    }
})
