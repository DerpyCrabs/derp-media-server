import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_READER_POSITION,
  normalizeBookReaderPosition,
  normalizePagedReaderPosition,
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

  test('normalizes legacy saved state into a discriminated paged position', () => {
    expect(
      normalizePagedReaderPosition({
        pageIndex: 2,
        scrollTop: 1_809,
        zoom: 1.4,
        viewMode: 'page',
        fitMode: 'width',
        outlineExpanded: ['one', 2, 'two'],
        selectionMode: 'image',
        defaultAction: 'translate',
      }),
    ).toEqual({
      kind: 'paged',
      pageIndex: 2,
      scrollTop: 1_809,
      zoom: 1.4,
      viewMode: 'page',
      fitMode: 'width',
      outlineExpanded: ['one', 'two'],
    })
  })

  test('keeps only book navigation fields in a book position', () => {
    expect(
      normalizeBookReaderPosition({
        chapterId: 'chapter-2',
        anchor: 'middle',
        chapterProgress: 4,
        outlineExpanded: ['contents'],
        pageIndex: 9,
        zoom: 3,
      }),
    ).toEqual({
      kind: 'book',
      chapterId: 'chapter-2',
      anchor: 'middle',
      chapterProgress: 1,
      outlineExpanded: ['contents'],
    })
  })
})
