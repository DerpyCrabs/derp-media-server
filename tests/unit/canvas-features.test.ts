import { describe, expect, test } from 'bun:test'
import {
  buildCanvasContext,
  createCanvasExport,
  createCanvasTemplateState,
  parseCanvasExport,
} from '@/lib/canvas-features'
import { createEmptyCanvasState } from '@/lib/infinite-canvas'

describe('canvas knowledge features', () => {
  test('round-trips portable canvas export', () => {
    const state = createEmptyCanvasState()
    const parsed = parseCanvasExport(createCanvasExport('Board rev B', state))
    expect(parsed?.name).toBe('Board rev B')
    expect(parsed?.state.windows).toEqual([])
  })

  test('creates frame-free knowledge templates', () => {
    const state = createCanvasTemplateState('hardware')
    expect(state.cards.map((card) => card.title)).toEqual([
      'Requirements',
      'Interfaces',
      'Firmware & software',
      'Bring-up checklist',
      'Validation evidence',
    ])
    expect('frames' in state).toBe(false)
    expect(state.cards.every((card) => !('frameId' in card))).toBe(true)
  })

  test('grounds selected document windows with supplied content', () => {
    const state = createEmptyCanvasState()
    state.windows.push({
      id: 'canvas-window-1',
      definition: {
        id: 'canvas-window-1',
        type: 'viewer',
        title: 'requirements.md',
        source: { kind: 'local', rootPath: null },
        initialState: { viewing: 'Notes/requirements.md' },
        tabGroupId: null,
      },
      bounds: { x: 0, y: 0, width: 640, height: 480 },
      zIndex: 1,
    })
    const context = buildCanvasContext(state, ['canvas-window-1'], {
      'canvas-window-1': { content: 'USB-C input, 20 V maximum.', truncated: true },
    })
    expect(context).toContain('USB-C input, 20 V maximum.')
    expect(context).toContain('Content truncated')
  })
})
