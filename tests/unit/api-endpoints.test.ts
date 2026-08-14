import { describe, expect, test } from 'bun:test'
import { fileDownloadUrl, fileListUrl, fileSearchUrl } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'

describe('typed API endpoint paths', () => {
  test('encodes library file paths without changing their meaning', () => {
    expect(fileListUrl({ dir: 'Books & Notes/one.md' })).toBe(
      '/api/files?dir=Books+%26+Notes%2Fone.md',
    )
  })

  test('keeps host identity in paginated Explorer requests', () => {
    expect(fileListUrl({ dir: 'Hermes Sessions', surface: 'workspace', offset: 200 })).toBe(
      '/api/files?surface=workspace&dir=Hermes+Sessions&offset=200',
    )
    expect(fileListUrl({ dir: 'Hermes Sessions', surface: 'library', offset: 200 })).toBe(
      '/api/files?surface=library&dir=Hermes+Sessions&offset=200',
    )
    expect(fileListUrl({ dir: 'Hermes Sessions', surface: 'canvas', offset: 200 })).toBe(
      '/api/files?surface=canvas&dir=Hermes+Sessions&offset=200',
    )
    expect(queryKeys.filesPage('Hermes Sessions', 'workspace', 200)).toEqual([
      'files',
      'Hermes Sessions',
      'workspace',
      200,
    ])
    expect(queryKeys.filesPage('Hermes Sessions', 'library', 200)).toEqual([
      'files',
      'Hermes Sessions',
      'library',
      200,
    ])
  })

  test('root hydration key stays compatible with existing dehydrated state', () => {
    expect(queryKeys.filesPage('', undefined, 0)).toEqual(['files', ''])
    expect(queryKeys.filesPage('', 'library', 0)).toEqual(['files', ''])
    expect(fileListUrl({ dir: '', surface: 'library' })).toBe('/api/files?dir=')
  })

  test('encodes download and search inputs through the canonical endpoint module', () => {
    expect(fileDownloadUrl('Books & Notes/one.md')).toBe(
      '/api/files/download?path=Books%20%26%20Notes%2Fone.md',
    )
    expect(fileSearchUrl('one & two', 50)).toBe('/api/files/search?q=one+%26+two&limit=50')
  })
})
