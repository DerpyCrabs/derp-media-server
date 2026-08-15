import { describe, expect, test } from 'bun:test'
import { buildResolveMarkdownImageUrl } from '@/lib/markdown/resolve-markdown-image-url'

describe('buildResolveMarkdownImageUrl', () => {
  test('resolves knowledge-base attachments through the media API', () => {
    const resolve = buildResolveMarkdownImageUrl('Notes/page.md', ['Notes'])
    expect(resolve('photo.png')).toBe('/api/media/Notes/images/photo.png')
  })

  test('preserves external URLs and encodes local paths', () => {
    const resolve = buildResolveMarkdownImageUrl('Notes/page.md', [])
    expect(resolve('https://example.com/photo.png')).toBe('https://example.com/photo.png')
    expect(resolve('images/a%20b.png')).toBe('/api/media/images/a%20b.png')
  })
})
