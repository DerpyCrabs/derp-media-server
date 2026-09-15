import { describe, expect, test } from 'bun:test'
import { bookProgress } from '../../src/features/reader/contentTypes/book/book-progress'
import {
  getMediaExtensionFromPath,
  getMediaType,
  getMediaTypeFromPath,
  getMimeType,
} from '../../src/lib/media/media-utils'
import { MediaType } from '../../src/lib/files/types'
import {
  normalizeBookPath,
  resolveBookPath,
  splitBookHref,
} from '../../src/features/reader/contentTypes/book/book-path'

describe('book media', () => {
  test('detects EPUB, FB2, and compound FB2 ZIP paths', () => {
    expect(getMediaType('epub')).toBe(MediaType.BOOK)
    expect(getMediaType('fb2')).toBe(MediaType.BOOK)
    expect(getMediaTypeFromPath('Library/Novel.FB2.ZIP')).toBe(MediaType.BOOK)
    expect(getMediaExtensionFromPath('Library/Novel.FB2.ZIP')).toBe('fb2.zip')
    expect(getMediaExtensionFromPath('Library/README')).toBe('')
    expect(getMediaTypeFromPath('Library/archive.zip')).toBe(MediaType.OTHER)
    expect(getMimeType('epub')).toBe('application/epub+zip')
    expect(getMimeType('fb2.zip')).toBe('application/zip')
  })

  test('normalizes archive-relative chapter paths', () => {
    expect(normalizeBookPath('EPUB/Text/../Images/cover.jpg')).toBe('EPUB/Images/cover.jpg')
    expect(resolveBookPath('EPUB/Text/chapter.xhtml', '../Images/cover.jpg')).toBe(
      'EPUB/Images/cover.jpg',
    )
    expect(splitBookHref('EPUB/chapter.xhtml#note')).toEqual({
      path: 'EPUB/chapter.xhtml',
      anchor: 'note',
    })
  })
})

test('whole-book progress includes previous chapters and accounts for their lengths', () => {
  const chapters = [
    { id: 'front', textLength: 100 },
    { id: 'main', textLength: 900 },
  ]
  expect(bookProgress(chapters, 'main', 0.6)).toBeCloseTo(0.64)
  expect(bookProgress(chapters, 'main', 1)).toBe(1)
  expect(bookProgress(chapters, 'missing', 0.6)).toBeUndefined()
})
