import { describe, expect, test } from 'bun:test'
import { detectEdgeAssistGridSpan } from '@/lib/workspace-assist-grid'
import { segmentIndex } from '@/lib/use-snap-zones'

describe('segmentIndex', () => {
  test('splits width into segments', () => {
    expect(segmentIndex(10, 300, 3)).toBe(0)
    expect(segmentIndex(150, 300, 3)).toBe(1)
    expect(segmentIndex(290, 300, 3)).toBe(2)
  })
})

describe('detectEdgeAssistGridSpan', () => {
  const cw = 900
  const ch = 600

  test('top edge left third cell for 3x2', () => {
    const s = detectEdgeAssistGridSpan(80, 10, cw, ch, '3x2', { suppressTopEdgeSpans: false })
    expect(s).toEqual({
      gridCols: 3,
      gridRows: 2,
      gc0: 0,
      gc1: 0,
      gr0: 0,
      gr1: 0,
    })
  })

  test('top edge between first and second column merges two top cells', () => {
    const s = detectEdgeAssistGridSpan(320, 10, cw, ch, '3x2', { suppressTopEdgeSpans: false })
    expect(s).toEqual({
      gridCols: 3,
      gridRows: 2,
      gc0: 0,
      gc1: 1,
      gr0: 0,
      gr1: 0,
    })
  })

  test('suppresses top edge when in top assist center band', () => {
    const s = detectEdgeAssistGridSpan(cw / 2, 10, cw, ch, '3x2', { suppressTopEdgeSpans: true })
    expect(s).toBeNull()
  })

  test('top edge center cell for 3x3', () => {
    const s = detectEdgeAssistGridSpan(cw / 2, 10, cw, ch, '3x3', { suppressTopEdgeSpans: false })
    expect(s).toEqual({
      gridCols: 3,
      gridRows: 3,
      gc0: 1,
      gc1: 1,
      gr0: 0,
      gr1: 0,
    })
  })
})
