import { expect, test } from 'bun:test'
import { imagePrintLayout, type ImagePrintOptions } from '../../src/lib/printing/image-layout'
const defaults: ImagePrintOptions = { paper: 'a4', orientation: 'auto', margin: 10, width: null }
test('image printing fits proportionally and automatically chooses paper orientation', () => {
  const wide = imagePrintLayout(1200, 600, defaults)!
  expect(wide.pageWidth).toBe(297)
  expect(wide.width).toBe(277)
  expect(wide.height).toBe(138.5)
  expect(wide.left).toBe(10)
  const tall = imagePrintLayout(600, 1200, defaults)!
  expect(tall.pageHeight).toBe(297)
  expect(tall.height).toBe(277)
  expect(tall.width).toBe(138.5)
})
test('custom sizes preserve proportions and reject clipping, invalid margins and zero dimensions', () => {
  expect(imagePrintLayout(1200, 600, { ...defaults, width: 150 })?.height).toBe(75)
  expect(imagePrintLayout(1200, 600, { ...defaults, width: 300 })).toBeNull()
  expect(imagePrintLayout(0, 600, defaults)).toBeNull()
  expect(imagePrintLayout(1200, 600, { ...defaults, margin: NaN })).toBeNull()
  expect(imagePrintLayout(1200, 600, { ...defaults, width: 0 })).toBeNull()
  expect(imagePrintLayout(1200, 600, { ...defaults, margin: 31 })).toBeNull()
  const photo = imagePrintLayout(1800, 1200, { ...defaults, paper: 'photo', margin: 0 })!
  expect(photo.width).toBeCloseTo(152.4)
  expect(photo.height).toBeCloseTo(101.6)
  expect(photo.dpi).toBeCloseTo(300)
})
