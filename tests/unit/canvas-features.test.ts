import { describe, expect, test } from 'bun:test'
import {
  buildCanvasContext,
  createReadingQuoteBody,
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

  test('uses readable titles for relationships in AI context', () => {
    const state = createCanvasTemplateState('project')
    state.connectors.push({
      id: 'canvas-connector-8',
      fromId: state.cards[0]!.id,
      toId: state.cards[1]!.id,
      label: 'informs',
      color: '#64748b',
    })
    const context = buildCanvasContext(state, [state.cards[0]!.id, state.cards[1]!.id])
    expect(context).toContain('- Project brief -> Architecture notes: informs')
    expect(context).not.toContain('canvas-card-1 -> canvas-card-2')
  })

  test('formats reading quotes with source provenance', () => {
    expect(createReadingQuoteBody('Line one\nLine two', 'Docs/design.md')).toBe(
      '> Line one\n> Line two\n\nSource: Docs/design.md',
    )
  })

  test('preserves chosen source order in AI context', () => {
    const state = createCanvasTemplateState('project')
    const context = buildCanvasContext(state, [state.cards[1]!.id, state.cards[0]!.id])
    expect(context.indexOf('## Architecture notes')).toBeLessThan(
      context.indexOf('## Project brief'),
    )
  })
})
