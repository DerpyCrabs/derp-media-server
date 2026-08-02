import { describe, expect, test } from 'bun:test'
import { buildResolveMarkdownImageUrl } from '@/lib/resolve-markdown-image-url'

describe('buildResolveMarkdownImageUrl (share + KB)', () => {
  test('bare KB attachment under full-vault directory share uses share-relative route', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Notes/sub/page.md',
      {
        token: 'tok',
        sharePath: 'Notes',
        isDirectory: true,
      },
      ['Notes'],
    )

    expect(resolve('diagram.png')).toBe('/api/share/tok/media/images/diagram.png')
  })

  test('nested KB directory share uses full KB attachment path for server exception', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Notes/projects/note.md',
      {
        token: 'tok',
        sharePath: 'Notes/projects',
        isDirectory: true,
      },
      ['Notes'],
    )

    expect(resolve('diagram.png')).toBe(
      '/api/share/tok/knowledge-base-image/Notes/images/diagram.png',
    )
    expect(resolve('Notes/images/diagram.png')).toBe(
      '/api/share/tok/knowledge-base-image/Notes/images/diagram.png',
    )
  })

  test('single-file KB share uses full KB attachment path for server exception', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Notes/projects/note.md',
      {
        token: 'tok',
        sharePath: 'Notes/projects/note.md',
        isDirectory: false,
      },
      ['Notes'],
    )

    expect(resolve('diagram.png')).toBe('/api/share/tok/media/Notes/images/diagram.png')
  })

  test('non-KB single-file share allows only direct sibling images attachments', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Shared/note.md',
      {
        token: 'tok',
        sharePath: 'Shared/note.md',
        isDirectory: false,
      },
      [],
    )

    expect(resolve('images/pic one.png')).toBe('/api/share/tok/media/Shared/images/pic%20one.png')
    expect(resolve('Shared/images/pic.png')).toBe('/api/share/tok/media/Shared/images/pic.png')
    expect(resolve('pic.png')).toBe('/api/share/tok/media/Shared/pic.png')
    expect(resolve('assets/pic.png')).toBeNull()
    expect(resolve('images/nested/pic.png')).toBeNull()
    expect(resolve('images/not-an-image.txt')).toBeNull()
  })

  test('root single-file share resolves sibling attachments from root', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'note.md',
      { token: 'tok', sharePath: 'note.md', isDirectory: false },
      [],
    )

    expect(resolve('pic.png')).toBe('/api/share/tok/media/pic.png')
    expect(resolve('images/pic.png')).toBe('/api/share/tok/media/images/pic.png')
  })

  test('decodes URL paths exactly once and preserves literal percent filenames', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Shared/note.md',
      { token: 'tok', sharePath: 'Shared/note.md', isDirectory: false },
      [],
    )

    expect(resolve('images/a%20b.png')).toBe('/api/share/tok/media/Shared/images/a%20b.png')
    expect(resolve('images/a%2520b.png')).toBe('/api/share/tok/media/Shared/images/a%2520b.png')
    expect(resolve('images/bad%2.png')).toBeNull()
  })

  test('directory share resolves root and normalized note-relative image paths', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Shared/Project/notes/note.md',
      {
        token: 'tok',
        sharePath: 'Shared/Project',
        isDirectory: true,
      },
      [],
    )

    expect(resolve('Shared/Project/images/pic.png')).toBe('/api/share/tok/media/images/pic.png')
    expect(resolve('../images/pic.png')).toBe('/api/share/tok/media/images/pic.png')
    expect(resolve('../../../Private/pic.png')).toBeNull()
  })

  test('share resolver never falls back to admin route', () => {
    const resolve = buildResolveMarkdownImageUrl(
      'Shared/note.md',
      { token: 'tok', sharePath: 'Shared/note.md', isDirectory: false },
      [],
    )

    expect(resolve('outside/pic.png')).toBeNull()
    expect(resolve('https://example.com/pic.png')).toBe('https://example.com/pic.png')
  })

  test('admin path still resolves bare KB filenames under images/', () => {
    const resolve = buildResolveMarkdownImageUrl('Notes/page.md', null, ['Notes'])
    const url = resolve('photo.png')
    expect(url).toBe('/api/media/Notes/images/photo.png')
  })

  test('admin URLs also distinguish spaces from literal percent escapes', () => {
    const resolve = buildResolveMarkdownImageUrl('Shared/note.md', null, [])

    expect(resolve('images/a%20b.png')).toBe('/api/media/images/a%20b.png')
    expect(resolve('images/a%2520b.png')).toBe('/api/media/images/a%2520b.png')
  })
})
