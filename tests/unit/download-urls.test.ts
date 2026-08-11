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

  test('keeps crafted Grant tokens inside one encoded route segment', () => {
    const token = 'x/../../../api/files?dir=Vault#'
    expect(fileDownloadHref('/share/root/file.png', { token, sharePath: '/share/root' })).toBe(
      `/api/share/${encodeURIComponent(token)}/download?path=file.png`,
    )
  })
})
