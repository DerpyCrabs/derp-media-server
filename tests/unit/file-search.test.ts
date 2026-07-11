import { describe, expect, test } from 'bun:test'
import {
  fileSearchCodePointLength,
  fileSearchResultToFileItem,
  normalizeFileSearchText,
} from '@/lib/file-search'
import { isRecursiveWatchEligible } from '@/lib/file-search-watcher-policy'
import { MediaType } from '@/lib/types'

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

describe('recursive watcher policy', () => {
  test('allows bounded local Windows and macOS roots', () => {
    expect(
      isRecursiveWatchEligible({
        platform: 'win32',
        watchMode: 'auto',
        rootPath: 'D:\\Media',
        watcherCount: 0,
        maxRecursiveWatchers: 32,
      }),
    ).toBe(true)
    expect(
      isRecursiveWatchEligible({
        platform: 'darwin',
        watchMode: 'auto',
        rootPath: '/Volumes/Media',
        watcherCount: 4,
        maxRecursiveWatchers: 32,
      }),
    ).toBe(true)
  })

  test('rejects Linux, UNC, disabled and over-budget watchers', () => {
    const base = {
      watchMode: 'auto' as const,
      rootPath: '/media',
      watcherCount: 0,
      maxRecursiveWatchers: 32,
    }
    expect(isRecursiveWatchEligible({ ...base, platform: 'linux' })).toBe(false)
    expect(
      isRecursiveWatchEligible({ ...base, platform: 'win32', rootPath: '\\\\server\\media' }),
    ).toBe(false)
    expect(isRecursiveWatchEligible({ ...base, platform: 'darwin', watchMode: 'off' })).toBe(false)
    expect(
      isRecursiveWatchEligible({
        ...base,
        platform: 'win32',
        watcherCount: 32,
        maxRecursiveWatchers: 32,
      }),
    ).toBe(false)
  })
})
