import { describe, expect, test } from 'bun:test'
import { canvasEdgeAutoPanVelocity } from '@/canvas/canvas-edge-auto-pan'

const viewport = { left: 100, top: 50, right: 1100, bottom: 750 }

describe('canvas edge auto-pan', () => {
  test('stays still away from viewport edges', () => {
    expect(canvasEdgeAutoPanVelocity(500, 400, viewport)).toEqual({ x: 0, y: 0 })
  })

  test('pans toward each nearby edge', () => {
    expect(canvasEdgeAutoPanVelocity(100, 400, viewport).x).toBe(900)
    expect(canvasEdgeAutoPanVelocity(1100, 400, viewport).x).toBe(-900)
    expect(canvasEdgeAutoPanVelocity(500, 50, viewport).y).toBe(900)
    expect(canvasEdgeAutoPanVelocity(500, 750, viewport).y).toBe(-900)
  })

  test('ramps speed through edge margin and caps outside viewport', () => {
    expect(canvasEdgeAutoPanVelocity(136, 400, viewport).x).toBe(450)
    expect(canvasEdgeAutoPanVelocity(0, 400, viewport).x).toBe(900)
  })
})
