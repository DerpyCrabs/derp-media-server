import { describe, expect, test } from 'bun:test'
import { createCanvasExport, parseCanvasExport } from '@/lib/canvas-features'
import { createEmptyCanvasState } from '@/lib/infinite-canvas'

describe('canvas knowledge features', () => {
  test('round-trips portable canvas export', () => {
    const state = createEmptyCanvasState()
    const parsed = parseCanvasExport(createCanvasExport('Board rev B', state))
    expect(parsed?.name).toBe('Board rev B')
    expect(parsed?.state.windows).toEqual([])
  })
})
