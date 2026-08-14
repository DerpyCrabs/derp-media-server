import { describe, expect, test } from 'bun:test'
import {
  createCanvasExport,
  parseCanvasExport as parseCanvasExportWithPersistence,
} from '@/lib/canvas-features'
import { createEmptyCanvasState } from '@/lib/infinite-canvas'
import { currentContentWindowPersistence } from '@/src/integrations/current-window-content'

const parseCanvasExport = (value: unknown) =>
  parseCanvasExportWithPersistence(value, currentContentWindowPersistence)

describe('canvas knowledge features', () => {
  test('round-trips portable canvas export', () => {
    const state = createEmptyCanvasState()
    const parsed = parseCanvasExport(createCanvasExport('Board rev B', state))
    expect(parsed?.name).toBe('Board rev B')
    expect(parsed?.state.windows).toEqual([])
  })
})
