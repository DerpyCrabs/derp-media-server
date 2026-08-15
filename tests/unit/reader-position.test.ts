import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_READER_POSITION,
  normalizeReaderPosition,
} from '../../src/features/reader/reader-position'

describe('reader position', () => {
  test('uses defaults for missing or invalid state', () => {
    expect(normalizeReaderPosition(null)).toEqual(DEFAULT_READER_POSITION)
    expect(normalizeReaderPosition({})).toEqual(DEFAULT_READER_POSITION)
    expect(DEFAULT_READER_POSITION.fitMode).toBe('manual')
    expect(DEFAULT_READER_POSITION.zoom).toBe(1)
  })

  test('clamps numeric state and rejects unknown modes', () => {
    expect(
      normalizeReaderPosition({
        pageIndex: -4,
        scrollTop: -20,
        zoom: 99,
        viewMode: 'spread',
        fitMode: 'height',
        selectionMode: 'image',
        defaultAction: 'translate',
      }),
    ).toEqual({
      pageIndex: 0,
      scrollTop: 0,
      zoom: 3,
      viewMode: 'continuous',
      fitMode: 'height',
      selectionMode: 'image',
      defaultAction: 'translate',
    })
  })
})
