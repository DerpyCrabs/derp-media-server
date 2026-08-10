import { describe, expect, test } from 'bun:test'
import { DEFAULT_READER_POSITION, parseReaderPosition } from '../../lib/reader-position'

describe('reader position', () => {
  test('uses defaults for missing or invalid state', () => {
    expect(parseReaderPosition(null)).toEqual(DEFAULT_READER_POSITION)
    expect(parseReaderPosition('{broken')).toEqual(DEFAULT_READER_POSITION)
    expect(DEFAULT_READER_POSITION.fitMode).toBe('manual')
    expect(DEFAULT_READER_POSITION.zoom).toBe(1)
  })

  test('clamps numeric state and rejects unknown modes', () => {
    expect(
      parseReaderPosition(
        JSON.stringify({
          pageIndex: -4,
          scrollTop: -20,
          zoom: 99,
          viewMode: 'spread',
          fitMode: 'height',
          selectionMode: 'image',
          defaultAction: 'translate',
        }),
      ),
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
