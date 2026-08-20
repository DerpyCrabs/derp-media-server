import { describe, expect, test } from 'bun:test'
import { cameraForCanvasBounds } from '@/workspace/canvas/model/canvas-camera'

describe('canvas camera reveal', () => {
  test('never zooms in while revealing a newly opened window', () => {
    const currentZoom = 0.2
    const camera = cameraForCanvasBounds({
      bounds: { x: 4000, y: 3000, width: 640, height: 480 },
      viewport: { width: 1200, height: 800 },
      padding: 24,
      maxZoom: currentZoom,
    })

    expect(camera.zoom).toBeLessThanOrEqual(currentZoom)
  })

  test('zooms out enough to fit a window larger than the current viewport', () => {
    const camera = cameraForCanvasBounds({
      bounds: { x: 0, y: 0, width: 2000, height: 1500 },
      viewport: { width: 1000, height: 700 },
      padding: 24,
      maxZoom: 1,
    })

    expect(camera.zoom).toBeLessThan(1)
    expect(2000 * camera.zoom).toBeLessThanOrEqual(1000 - 48)
    expect(1500 * camera.zoom).toBeLessThanOrEqual(700 - 48)
  })
})
