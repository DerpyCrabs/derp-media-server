import { describe, expect, test } from 'bun:test'
import {
  fileSearchCodePointLength,
  fileSearchResultToFileItem,
  normalizeFileSearchText,
} from '@/lib/files/file-search'
import { MediaType } from '@/lib/files/types'

describe('file search helpers', () => {
  test('normalizes case, separators and diacritics without changing result paths', () => {
    expect(normalizeFileSearchText('  Café\\ЛЕТО.JPG  ')).toBe('cafe/лето.jpg')
    expect(fileSearchCodePointLength('📁ab')).toBe(3)
    expect(fileSearchCodePointLength(normalizeFileSearchText('a\u0301b'))).toBe(2)
  })

  test('converts search results into browser file items', () => {
    expect(
      fileSearchResultToFileItem({
        name: 'movie.mp4',
        path: 'Movies/movie.mp4',
        parentPath: 'Movies',
        rootId: 'root',
        rootName: 'Media',
        isDirectory: false,
        extension: 'mp4',
        type: MediaType.VIDEO,
      }),
    ).toEqual({
      name: 'movie.mp4',
      path: 'Movies/movie.mp4',
      type: MediaType.VIDEO,
      size: 0,
      extension: 'mp4',
      isDirectory: false,
    })
  })
})
