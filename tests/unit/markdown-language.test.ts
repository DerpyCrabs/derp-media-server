import { syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, test } from 'bun:test'

import { collectMarkdownImageTargets } from '@/lib/markdown-parser'
import { syntaxNodeIsActive, markdownModeFacet } from '@/src/media/markdown/live-preview'
import { markdownLanguage } from '@/src/media/markdown/markdown-language'

function markdownState(
  doc: string,
  options: { anchor?: number; head?: number; mode?: 'read' | 'edit' } = {},
): EditorState {
  return EditorState.create({
    doc,
    selection: {
      anchor: options.anchor ?? 0,
      head: options.head ?? options.anchor ?? 0,
    },
    extensions: [markdownLanguage, markdownModeFacet.of(options.mode ?? 'read')],
  })
}

function nodesNamed(state: EditorState, name: string) {
  const nodes: SyntaxNode[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === name) nodes.push(node.node)
    },
  })
  return nodes
}

describe('markdown parser dialect', () => {
  test('parses GFM blocks and inline constructs in one tree', () => {
    const source = [
      '# Heading',
      '',
      '**bold** *italic* ~~removed~~ `code`',
      '',
      '- [ ] open',
      '- [X] complete',
      '  - nested',
      '1. ordered',
      '',
      '[link](https://example.com) <https://autolink.test>',
      '',
      '> quote',
      '',
      '---',
      '',
      '```ts',
      'const value = 1',
      '```',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n')
    const state = markdownState(source)

    for (const name of [
      'ATXHeading1',
      'StrongEmphasis',
      'Emphasis',
      'Strikethrough',
      'InlineCode',
      'BulletList',
      'OrderedList',
      'Link',
      'Autolink',
      'Blockquote',
      'HorizontalRule',
      'FencedCode',
      'Table',
    ]) {
      expect(nodesNamed(state, name).length, name).toBeGreaterThan(0)
    }
    expect(
      nodesNamed(state, 'TaskMarker').map((node) => state.sliceDoc(node.from, node.to)),
    ).toEqual(['[ ]', '[X]'])
    expect(state.doc.toString()).toBe(source)
  })

  test('recognizes GFM extended bare autolinks as URL nodes', () => {
    const state = markdownState('https://example.com/path\n\nwww.example.com\n\nreader@example.com')

    expect(nodesNamed(state, 'URL').map((node) => state.sliceDoc(node.from, node.to))).toEqual([
      'https://example.com/path',
      'www.example.com',
      'reader@example.com',
    ])
  })

  test('keeps raw HTML inert in parser tree and source document', () => {
    const source = '<script>alert(1)</script>\n\n<div class="note">literal</div>'
    const state = markdownState(source)

    expect(
      nodesNamed(state, 'HTMLTag').length + nodesNamed(state, 'HTMLBlock').length,
    ).toBeGreaterThan(0)
    expect(state.doc.toString()).toBe(source)
  })
})

describe('Obsidian image parser extension', () => {
  test('parses target, optional alt text, whitespace, and uppercase extension', () => {
    const source = '![[  folder/photo.PNG  |  Cover image  ]]'
    const state = markdownState(source)
    const image = nodesNamed(state, 'ObsidianImage')[0]

    expect(image).toBeDefined()
    expect(state.sliceDoc(image.from, image.to)).toBe(source)
    expect(
      nodesNamed(state, 'ObsidianImageTarget').map((node) => state.sliceDoc(node.from, node.to)),
    ).toEqual(['folder/photo.PNG'])
    expect(
      nodesNamed(state, 'ObsidianImageAlt').map((node) => state.sliceDoc(node.from, node.to)),
    ).toEqual(['Cover image'])
    expect(
      nodesNamed(state, 'ObsidianImageMark').map((node) => state.sliceDoc(node.from, node.to)),
    ).toEqual(['![[', ']]'])
  })

  test('supports every configured image extension', () => {
    const extensions = [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'bmp',
      'ico',
      'tif',
      'tiff',
      'avif',
    ]
    const source = extensions.map((extension) => `![[file.${extension}]]`).join(' ')

    expect(nodesNamed(markdownState(source), 'ObsidianImage')).toHaveLength(extensions.length)
  })

  test('leaves unsupported, empty, and unclosed embeds as source fallback', () => {
    for (const source of ['![[note.pdf]]', '![[  ]]', '![[photo.png']) {
      const state = markdownState(source)
      expect(nodesNamed(state, 'ObsidianImage'), source).toHaveLength(0)
      expect(state.doc.toString()).toBe(source)
    }
  })

  test('parses repeated unclosed openers in linear time', () => {
    const source = '![[x'.repeat(25_000)
    const started = performance.now()
    const state = markdownState(source)

    expect(nodesNamed(state, 'ObsidianImage')).toHaveLength(0)
    expect(performance.now() - started).toBeLessThan(1_500)
    expect(state.doc.toString()).toBe(source)
  })

  test('does not span Obsidian embeds across lines or nested openers', () => {
    expect(nodesNamed(markdownState('![[photo\n.png]]'), 'ObsidianImage')).toHaveLength(0)
    const nested = markdownState('![[outer ![[inner.png]]')
    expect(
      nodesNamed(nested, 'ObsidianImage').map((node) => nested.sliceDoc(node.from, node.to)),
    ).toEqual(['![[inner.png]]'])
  })

  test('collects decoded inline, referenced, and Obsidian image targets', () => {
    const source = [
      '![inline](folder/a&amp;b.png)',
      '![full][A&amp; B] ![collapsed][] ![shortcut]',
      '![[wiki&amp;.png]] ![[wiki&amp;.png|duplicate]]',
      '',
      '[a& b]: <folder/full\\(image\\).png>',
      '[collapsed]: collapsed.png',
      '[shortcut]: shortcut.png',
    ].join('\n')

    expect(collectMarkdownImageTargets(source)).toEqual([
      'folder/a&b.png',
      'folder/full(image).png',
      'collapsed.png',
      'shortcut.png',
      'wiki&.png',
    ])
  })
})

describe('active syntax detection', () => {
  const source = 'before **bold** after'

  test('read mode never reveals source markers', () => {
    const state = markdownState(source, { anchor: 10, mode: 'read' })
    const strong = nodesNamed(state, 'StrongEmphasis')[0]

    expect(syntaxNodeIsActive(state, strong)).toBe(false)
  })

  test('edit cursor activates enclosing construct, not unrelated construct', () => {
    const inside = markdownState(source, { anchor: 10, mode: 'edit' })
    const insideStrong = nodesNamed(inside, 'StrongEmphasis')[0]
    expect(syntaxNodeIsActive(inside, insideStrong)).toBe(true)

    const outside = markdownState(source, { anchor: 1, mode: 'edit' })
    const outsideStrong = nodesNamed(outside, 'StrongEmphasis')[0]
    expect(syntaxNodeIsActive(outside, outsideStrong)).toBe(false)
  })

  test('non-empty selection activates only when it overlaps construct', () => {
    const overlap = markdownState(source, { anchor: 0, head: 9, mode: 'edit' })
    expect(syntaxNodeIsActive(overlap, nodesNamed(overlap, 'StrongEmphasis')[0])).toBe(true)

    const adjacent = markdownState(source, { anchor: 15, head: 16, mode: 'edit' })
    expect(syntaxNodeIsActive(adjacent, nodesNamed(adjacent, 'StrongEmphasis')[0])).toBe(false)
  })

  test('selection-only transaction never changes Markdown source', () => {
    const state = markdownState(source, { anchor: 1, mode: 'edit' })
    const transaction = state.update({ selection: { anchor: 10 } })

    expect(transaction.docChanged).toBe(false)
    expect(transaction.state.doc.toString()).toBe(source)
  })
})
