import { describe, expect, test } from 'bun:test'
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
