import { describe, expect, test } from 'bun:test'
import { readerStateUrl } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'

describe('typed API endpoint paths', () => {
  test('encodes reader document identity', () => {
    expect(readerStateUrl('Books & Notes/one.md')).toBe(
      '/api/reader-state?path=Books+%26+Notes%2Fone.md',
    )
  })

  test('keeps host identity in application query keys', () => {
    expect(queryKeys.filesPage('Books', 'workspace', 200)).toEqual([
      'files',
      'Books',
      'workspace',
      200,
    ])
    expect(queryKeys.filesPage('', 'library', 0)).toEqual(['files', ''])
  })
})
