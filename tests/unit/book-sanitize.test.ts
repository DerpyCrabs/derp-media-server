import { Window as HappyWindow } from 'happy-dom'
import { beforeAll, describe, expect, test } from 'bun:test'
import type { BookDocument } from '@/features/reader/book-types'

beforeAll(() => {
  const window = new HappyWindow({ url: 'http://localhost/' })
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    value: window.DOMParser,
  })
  Object.defineProperty(globalThis, 'XMLSerializer', {
    configurable: true,
    value: window.XMLSerializer,
  })
})

function document(styles: BookDocument['styles'], markup = '<p>Text</p>'): BookDocument {
  return {
    format: 'epub',
    metadata: { title: 'Book', authors: [] },
    chapters: [{ id: 'chapter', href: 'chapter.xhtml', title: 'Chapter', markup, textLength: 4 }],
    outline: [],
    resources: [],
    styles,
  }
}

describe('book sanitization', () => {
  test('drops bare stylesheet at-rules instead of copying unmatched CSS', async () => {
    const { renderBook } = await import('@/features/reader/book-sanitize')
    const rendered = renderBook(
      document([
        { path: 'remote.css', css: '@import url(https://attacker.invalid/book.css);' },
        { path: 'safe.css', css: 'p { color: red; background-image: url(https://bad); }' },
      ]),
    )

    expect(rendered.css).not.toContain('@import')
    expect(rendered.css).not.toContain('attacker.invalid')
    expect(rendered.css).not.toContain('background-image')
    expect(rendered.css).toContain('.book-document p {color:red}')
  })

  test('keeps malformed fragment text without throwing', async () => {
    const { renderBook } = await import('@/features/reader/book-sanitize')
    const rendered = renderBook(document([], '<a href="#%E0%A4%A">Broken fragment</a>'))

    expect(rendered.chapters[0]?.html).toContain('data-anchor="%E0%A4%A"')
  })
})
