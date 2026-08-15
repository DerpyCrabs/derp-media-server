import { describe, expect, test } from 'bun:test'
import { applyWorkspaceTileGap } from '@/workspace/model/workspace-tile-gaps'
import { normalizeTiledWindowGap } from '@/workspace/model/workspace-preferred-snap-store'

describe('workspace tile gaps', () => {
  test('keeps configured outer gap and one configured gap between tiles', () => {
    const canvas = { width: 1000, height: 600 }
    const left = applyWorkspaceTileGap({ x: 0, y: 0, width: 500, height: 600 }, canvas, 12, true)
    const right = applyWorkspaceTileGap({ x: 500, y: 0, width: 500, height: 600 }, canvas, 12, true)

    expect(left).toEqual({ x: 12, y: 12, width: 482, height: 576 })
    expect(right).toEqual({ x: 506, y: 12, width: 482, height: 576 })
    expect(right.x - (left.x + left.width)).toBe(12)
  })

  test('does not alter floating windows or disabled gaps', () => {
    const bounds = { x: 20, y: 30, width: 400, height: 300 }
    expect(applyWorkspaceTileGap(bounds, { width: 800, height: 600 }, 10, false)).toBe(bounds)
    expect(applyWorkspaceTileGap(bounds, { width: 800, height: 600 }, 0, true)).toBe(bounds)
  })

  test('normalizes persisted gap values', () => {
    expect(normalizeTiledWindowGap(-2)).toBe(0)
    expect(normalizeTiledWindowGap(7.6)).toBe(8)
    expect(normalizeTiledWindowGap(200)).toBe(24)
    expect(normalizeTiledWindowGap('8')).toBe(0)
  })
})
