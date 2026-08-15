import { describe, expect, test } from 'bun:test'
import { fileDownloadHref } from '@/lib/files/download-urls'

describe('fileDownloadHref', () => {
  test('encodes the file path', () => {
    expect(fileDownloadHref('/a/b c')).toBe(
      '/api/files/download?path=' + encodeURIComponent('/a/b c'),
    )
  })
})
