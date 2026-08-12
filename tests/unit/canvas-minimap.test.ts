import { createCanvasMinimapModel, minimapPointToWorld } from '@/src/canvas/canvas-minimap'
import { describe, expect, test } from 'bun:test'

describe('canvas minimap', () => {
  test('projects windows and the current viewport inside the overview', () => {
    const model = createCanvasMinimapModel({
      windows: [
        { x: 100, y: 200, width: 640, height: 480 },
        { x: 900, y: 300, width: 320, height: 240 },
      ],
      camera: { x: -200, y: -100, zoom: 0.5 },
      viewport: { width: 1000, height: 700 },
      width: 192,
      height: 128,
    })
    expect(model).not.toBeNull()
    expect(model!.windows).toHaveLength(2)
    for (const rect of [...model!.windows, model!.viewport]) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(192)
      expect(rect.y + rect.height).toBeLessThanOrEqual(128)
    }
  })

  test('maps overview coordinates back to world coordinates', () => {
    const model = createCanvasMinimapModel({
      windows: [{ x: 10, y: 20, width: 300, height: 200 }],
      camera: { x: 0, y: 0, zoom: 1 },
      viewport: { width: 500, height: 400 },
      width: 192,
      height: 128,
    })!
    const point = minimapPointToWorld(model, {
      x: 125 * model.scale + model.offsetX,
      y: 85 * model.scale + model.offsetY,
    })
    expect(point.x).toBeCloseTo(125)
    expect(point.y).toBeCloseTo(85)
  })

  test('does not render an empty overview', () => {
    expect(
      createCanvasMinimapModel({
        windows: [],
        camera: { x: 0, y: 0, zoom: 1 },
        viewport: { width: 500, height: 400 },
        width: 192,
        height: 128,
      }),
    ).toBeNull()
  })
})
