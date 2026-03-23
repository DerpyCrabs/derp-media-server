import { describe, expect, test } from 'bun:test'
import { buildResolveMarkdownImageUrl } from '@/lib/resolve-markdown-image-url'

describe('buildResolveMarkdownImageUrl (share + KB)', () => {
  test('bare filename in KB note resolves to kbRoot/images for share media URL', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Notes/sub/page.md',
      {
        token: 'tok',
        sharePath: 'Notes',
        isDirectory: true,
      },
      ['Notes'],
    )
    const url = resolve('diagram.png')
    expect(url).toContain('/api/share/tok/media/')
    expect(url).toContain('images')
    expect(url).toContain('diagram.png')
  })

  test('admin path still resolves bare KB filenames under images/', () => {
    const resolve = buildResolveMarkdownImageUrl('Notes/page.md', null, ['Notes'])
    const url = resolve('photo.png')
    expect(url).toBe('/api/media/Notes/images/photo.png')
  })
})
