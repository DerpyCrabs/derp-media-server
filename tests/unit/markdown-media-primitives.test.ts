import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, test } from 'bun:test'

import { extractObsidianImage, extractStandardImage } from '@/lib/markdown/images'
import {
  createMarkdownReferenceResolver,
  extractMarkdownLink,
  isSafeMarkdownHref,
  markdownLinkAttributes,
  normalizeMarkdownReferenceLabel,
  openMarkdownLink,
} from '@/lib/markdown/links'
import { markdownLanguage } from '@/lib/markdown/markdown-language'
import { toggledTaskMarker } from '@/lib/markdown/task-lists'

function parsed(source: string): EditorState {
  return EditorState.create({ doc: source, extensions: [markdownLanguage] })
}

function findNode(state: EditorState, name: string, index = 0): SyntaxNode {
  const matches: SyntaxNode[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === name) matches.push(node.node)
    },
  })
  const match = matches[index]
  if (!match) throw new Error(`Missing ${name} node at index ${index}`)
  return match
}

function referenceResolver(state: EditorState) {
  return createMarkdownReferenceResolver(syntaxTree(state).topNode, state.doc)
}

describe('Markdown image extraction', () => {
  test('extracts standard image bounds, unescaped alt, and angle-bracket URL', () => {
    const source = 'before ![a\\*b](<folder/my image.png>) after'
    const state = parsed(source)

    expect(extractStandardImage(findNode(state, 'Image'), state.doc)).toEqual({
      from: 7,
      to: 37,
      src: 'folder/my image.png',
      alt: 'a*b',
      syntax: 'standard',
    })
  })

  test('decodes entities in standard image destinations and alt text', () => {
    const source = '![A &amp; B](images/a&amp;b.png)'
    const state = parsed(source)

    expect(extractStandardImage(findNode(state, 'Image'), state.doc)).toMatchObject({
      src: 'images/a&b.png',
      alt: 'A & B',
    })
  })

  test('uses rendered inline text for standard image alt text', () => {
    const source = '![**Strong** and *soft*, ` code `, [label](https://example.com)](image.png)'
    const state = parsed(source)

    expect(extractStandardImage(findNode(state, 'Image'), state.doc)?.alt).toBe(
      'Strong and soft, code, label',
    )
  })

  test('rejects empty standard image URL and non-image syntax node', () => {
    const empty = parsed('![alt]()')
    expect(extractStandardImage(findNode(empty, 'Image'), empty.doc)).toBeNull()

    const link = parsed('[label](photo.png)')
    expect(extractStandardImage(findNode(link, 'Link'), link.doc)).toBeNull()
  })

  test('resolves full, collapsed, and shortcut image references', () => {
    const source = [
      '![full][asset] ![collapsed][] ![shortcut]',
      '',
      '[ASSET]: <folder/full image.png>',
      '[collapsed]: folder/collapsed.png',
      '[shortcut]: folder/shortcut.png',
    ].join('\n')
    const state = parsed(source)
    const resolveReference = referenceResolver(state)

    expect(
      [0, 1, 2].map((index) => {
        const image = extractStandardImage(
          findNode(state, 'Image', index),
          state.doc,
          resolveReference,
        )
        return image && { src: image.src, alt: image.alt }
      }),
    ).toEqual([
      { src: 'folder/full image.png', alt: 'full' },
      { src: 'folder/collapsed.png', alt: 'collapsed' },
      { src: 'folder/shortcut.png', alt: 'shortcut' },
    ])
  })

  test('keeps image references inert when no definition exists', () => {
    const state = parsed('![alt][missing]')
    expect(
      extractStandardImage(findNode(state, 'Image'), state.doc, referenceResolver(state)),
    ).toBeNull()
  })

  test('extracts Obsidian image with explicit alt', () => {
    const source = 'x ![[ folder/photo.webp | Preview ]] y'
    const state = parsed(source)

    expect(extractObsidianImage(findNode(state, 'ObsidianImage'), state.doc)).toEqual({
      from: 2,
      to: 36,
      src: 'folder/photo.webp',
      alt: 'Preview',
      syntax: 'obsidian',
    })
  })

  test('decodes entities in Obsidian targets and alt text', () => {
    const source = '![[photo&amp;.png|A &amp; B]]'
    const state = parsed(source)

    expect(extractObsidianImage(findNode(state, 'ObsidianImage'), state.doc)).toMatchObject({
      src: 'photo&.png',
      alt: 'A & B',
    })
  })

  test('uses Obsidian target as alt when alias is absent or blank', () => {
    for (const source of ['![[photo.png]]', '![[photo.png|  ]]']) {
      const state = parsed(source)
      expect(extractObsidianImage(findNode(state, 'ObsidianImage'), state.doc)?.alt).toBe(
        'photo.png',
      )
    }
  })

  test('rejects non-Obsidian syntax node', () => {
    const state = parsed('![alt](photo.png)')
    expect(extractObsidianImage(findNode(state, 'Image'), state.doc)).toBeNull()
  })
})

describe('Markdown link extraction and safety', () => {
  test('extracts standard link label, bounds, and angle-bracket destination', () => {
    const source = 'x [label](<https://example.com/a b>) y'
    const state = parsed(source)

    expect(extractMarkdownLink(findNode(state, 'Link'), state.doc)).toEqual({
      from: 2,
      to: 36,
      labelFrom: 3,
      labelTo: 8,
      href: 'https://example.com/a b',
    })
  })

  test('resolves full, collapsed, and shortcut link references', () => {
    const source = [
      '[full][asset] [collapsed][] [shortcut]',
      '',
      '[ASSET]: <https://example.com/full path>',
      '[collapsed]: /collapsed',
      '[shortcut]: /shortcut',
    ].join('\n')
    const state = parsed(source)
    const resolveReference = referenceResolver(state)

    expect(
      [0, 1, 2].map((index) =>
        extractMarkdownLink(findNode(state, 'Link', index), state.doc, resolveReference),
      ),
    ).toMatchObject([
      { href: 'https://example.com/full path' },
      { href: '/collapsed' },
      { href: '/shortcut' },
    ])
  })

  test('normalizes reference case, whitespace, and escaped punctuation', () => {
    const source = '[label][A\\*   B]\n\n[a* b]: /normalized'
    const state = parsed(source)

    expect(normalizeMarkdownReferenceLabel(' A\\*  b ')).toBe('A* B')
    expect(
      extractMarkdownLink(findNode(state, 'Link'), state.doc, referenceResolver(state))?.href,
    ).toBe('/normalized')
  })

  test('uses first duplicate definition and rejects unknown references', () => {
    const duplicate = parsed('[label][id]\n\n[id]: /first\n[id]: /second')
    expect(
      extractMarkdownLink(findNode(duplicate, 'Link'), duplicate.doc, referenceResolver(duplicate))
        ?.href,
    ).toBe('/first')

    const unknown = parsed('[label][missing]')
    expect(
      extractMarkdownLink(findNode(unknown, 'Link'), unknown.doc, referenceResolver(unknown)),
    ).toBeNull()
  })

  test('extracts explicit URL autolink', () => {
    const source = '<https://example.com/path>'
    const state = parsed(source)

    expect(extractMarkdownLink(findNode(state, 'Autolink'), state.doc)).toEqual({
      from: 0,
      to: source.length,
      labelFrom: 1,
      labelTo: source.length - 1,
      href: 'https://example.com/path',
    })
  })

  test('normalizes email autolinks to mailto destinations', () => {
    const bracketed = parsed('<reader@example.com>')
    expect(extractMarkdownLink(findNode(bracketed, 'Autolink'), bracketed.doc)?.href).toBe(
      'mailto:reader@example.com',
    )

    const bare = parsed('reader@example.com')
    expect(extractMarkdownLink(findNode(bare, 'URL'), bare.doc)?.href).toBe(
      'mailto:reader@example.com',
    )
  })

  test('extracts GFM bare HTTP URL', () => {
    const source = 'https://example.com/path'
    const state = parsed(source)

    expect(extractMarkdownLink(findNode(state, 'URL'), state.doc)).toEqual({
      from: 0,
      to: source.length,
      labelFrom: 0,
      labelTo: source.length,
      href: source,
    })
  })

  test('normalizes GFM bare www link to HTTP destination', () => {
    const source = 'www.example.com/path'
    const state = parsed(source)

    expect(extractMarkdownLink(findNode(state, 'URL'), state.doc)).toEqual({
      from: 0,
      to: source.length,
      labelFrom: 0,
      labelTo: source.length,
      href: `http://${source}`,
    })
  })

  test('rejects unrelated syntax nodes', () => {
    const state = parsed('plain text')
    expect(extractMarkdownLink(syntaxTree(state).topNode, state.doc)).toBeNull()
  })

  test('allows web, mail, phone, relative, and fragment destinations', () => {
    for (const href of [
      'https://example.com',
      'HTTP://example.com',
      'mailto:reader@example.com',
      'tel:+123',
      '../notes/page.md',
      '#section',
    ]) {
      expect(isSafeMarkdownHref(href), href).toBe(true)
    }
  })

  test('rejects executable, unsupported, empty, and obfuscated schemes', () => {
    for (const href of [
      '',
      '   ',
      'javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com/file',
    ]) {
      expect(isSafeMarkdownHref(href), href).toBe(false)
    }
  })

  test('adds external metadata only for HTTP(S) links', () => {
    const base = {
      from: 1,
      to: 10,
      labelFrom: 2,
      labelTo: 5,
      href: 'https://example.com',
    }
    expect(markdownLinkAttributes(base)).toEqual({
      role: 'link',
      tabindex: '0',
      'data-markdown-link': 'https://example.com',
      'data-markdown-from': '1',
      'data-markdown-to': '10',
      'data-markdown-external': 'true',
    })
    expect(markdownLinkAttributes({ ...base, href: '/local' })).not.toHaveProperty(
      'data-markdown-external',
    )
  })

  test('opens external links safely and ignores unsafe links', () => {
    const previousWindow = globalThis.window
    const calls: unknown[][] = []
    const opened = { opener: {} }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: (...args: unknown[]) => {
          calls.push(args)
          return opened
        },
        location: { assign: (...args: unknown[]) => calls.push(args) },
      },
    })

    try {
      openMarkdownLink('javascript:alert(1)')
      expect(calls).toEqual([])

      openMarkdownLink('https://example.com')
      expect(calls).toEqual([['https://example.com', '_blank', 'noopener,noreferrer']])
      expect(opened.opener).toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: previousWindow,
      })
    }
  })
})

describe('task marker toggle', () => {
  test('checks open tasks using lowercase x', () => {
    expect(toggledTaskMarker('[ ]')).toBe('[x]')
  })

  test('unchecks lowercase and uppercase completed tasks', () => {
    expect(toggledTaskMarker('[x]')).toBe('[ ]')
    expect(toggledTaskMarker('[X]')).toBe('[ ]')
  })

  test('leaves malformed markers untouched', () => {
    for (const marker of ['', '[  ]', '[y]', ' [ ]', '[x] trailing']) {
      expect(toggledTaskMarker(marker), marker).toBeNull()
    }
  })
})
