import { describe, expect, test } from 'bun:test'
import { fileDownloadHref } from '@/lib/download-urls'

describe('fileDownloadHref', () => {
  test('admin encodes path', () => {
    expect(fileDownloadHref('/a/b c', null)).toBe(
      '/api/files/download?path=' + encodeURIComponent('/a/b c'),
    )
  })

  test('share strips prefix and encodes relative', () => {
    expect(
      fileDownloadHref('/share/root/sub/file.png', {
        token: 'tok',
        sharePath: '/share/root',
      }),
    ).toBe('/api/share/tok/download?path=' + encodeURIComponent('sub/file.png'))
  })
})
