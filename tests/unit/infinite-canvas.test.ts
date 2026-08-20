import { describe, expect, test } from 'bun:test'
import {
  CANVAS_GRID_SIZE,
  canvasWindowVisualBounds,
  findNearestFreeCanvasRect,
  snapCanvasRect,
} from '@/workspace/canvas/model/infinite-canvas'

describe('infinite canvas geometry', () => {
  test('quantizes position and dimensions to shared grid', () => {
    expect(snapCanvasRect({ x: 17, y: 47, width: 641, height: 479 })).toEqual({
      x: CANVAS_GRID_SIZE,
      y: CANVAS_GRID_SIZE,
      width: 640,
      height: 480,
    })
  })

  test('renders eight pixels between logically adjacent windows', () => {
    const left = canvasWindowVisualBounds({ x: 0, y: 0, width: 640, height: 480 })
    const right = canvasWindowVisualBounds({ x: 640, y: 0, width: 640, height: 480 })
    expect(right.x - (left.x + left.width)).toBe(8)
  })

  test('finds nearest free grid location without moving obstacles', () => {
    const obstacle = { x: 0, y: 0, width: 640, height: 480 }
    const placed = findNearestFreeCanvasRect(obstacle, [obstacle])
    expect(placed).not.toEqual(obstacle)
    expect(Math.abs(placed.x % CANVAS_GRID_SIZE)).toBe(0)
    expect(Math.abs(placed.y % CANVAS_GRID_SIZE)).toBe(0)
  })
})
