import { Window as HappyWindow } from 'happy-dom'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import type { MarkdownEditorRuntime } from '@/lib/markdown/types'

const testWindow = new HappyWindow({ url: 'http://localhost/' })
const installedGlobals = [
  'window',
  'document',
  'navigator',
  'MutationObserver',
  'ResizeObserver',
  'Element',
  'HTMLElement',
  'Node',
  'Text',
  'Document',
  'Window',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'getComputedStyle',
] as const
const previousGlobals = new Map<string, PropertyDescriptor | undefined>()

for (const name of installedGlobals) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: name === 'window' ? testWindow : testWindow[name],
  })
}

const previousAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
const previousCancelAnimationFrame = Object.getOwnPropertyDescriptor(
  globalThis,
  'cancelAnimationFrame',
)
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  value: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
})

const [{ EditorState }, { EditorView }, { livePreviewExtension, markdownModeFacet }, language] =
  await Promise.all([
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@/lib/markdown/live-preview'),
    import('@/lib/markdown/markdown-language'),
  ])

const views: InstanceType<typeof EditorView>[] = []

function renderMarkdown(source: string, mode: 'read' | 'edit' = 'read') {
  const parent = document.createElement('div')
  document.body.append(parent)
  const runtime: MarkdownEditorRuntime = {
    resolveImageUrl: () => null,
    openImage: () => {},
    onChange: () => {},
  }
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        language.markdownLanguage,
        markdownModeFacet.of(mode),
        EditorState.readOnly.of(mode === 'read'),
        EditorView.editable.of(mode === 'edit'),
        livePreviewExtension(runtime),
      ],
    }),
  })
  views.push(view)
  return { parent, view }
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

afterAll(() => {
  for (const name of installedGlobals) {
    const descriptor = previousGlobals.get(name)
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete (globalThis as Record<string, unknown>)[name]
  }
  if (previousAnimationFrame) {
    Object.defineProperty(globalThis, 'requestAnimationFrame', previousAnimationFrame)
  } else {
    delete (globalThis as Record<string, unknown>).requestAnimationFrame
  }
  if (previousCancelAnimationFrame) {
    Object.defineProperty(globalThis, 'cancelAnimationFrame', previousCancelAnimationFrame)
  } else {
    delete (globalThis as Record<string, unknown>).cancelAnimationFrame
  }
  testWindow.close()
})

describe('Markdown read rendering', () => {
  test('renders CommonMark entities without interpreting raw HTML', () => {
    const source = 'Tom &amp; Jerry &#169; &#x1F600; <b>literal</b>'
    const { parent, view } = renderMarkdown(source)

    expect(parent.textContent).toContain('Tom & Jerry © 😀 <b>literal</b>')
    expect(view.state.doc.toString()).toBe(source)
    expect(parent.querySelector('b')).toBeNull()
  })

  test('renders hard-break markers invisibly while retaining line breaks', () => {
    const source = 'first\\\nsecond\n\nthird  \nfourth'
    const { parent, view } = renderMarkdown(source)

    expect(parent.textContent).not.toContain('first\\')
    expect(parent.textContent).not.toContain('third  ')
    expect(parent.querySelectorAll('.cm-line')).toHaveLength(5)
    expect(view.state.doc.toString()).toBe(source)
  })

  test('normalizes multiline code spans to CommonMark text', () => {
    const source = '` line one\nline two `'
    const { parent, view } = renderMarkdown(source)

    expect(parent.querySelector('.cm-md-inline-code')?.textContent).toBe('line one line two')
    expect(parent.textContent).not.toContain('`')
    expect(view.state.doc.toString()).toBe(source)
  })

  test('keeps multiline code spans as editable source fallback in edit mode', () => {
    const source = 'before\n\n`line one\nline two`'
    const { parent, view } = renderMarkdown(source, 'edit')

    expect(parent.textContent).toContain('`line one')
    expect(parent.textContent).toContain('line two`')
    expect(view.state.doc.toString()).toBe(source)
  })

  test('styles every content line of a multiline Setext heading', () => {
    const source = 'line one\nline two\n---'
    const { parent } = renderMarkdown(source)

    expect(parent.querySelectorAll('.cm-md-heading-2')).toHaveLength(2)
    expect(parent.textContent).not.toContain('---')
  })

  test('uses native anchors and classifies protocol-relative links as external', () => {
    const { parent } = renderMarkdown('[link](//example.com/?a=1&amp;b=2)')
    const anchor = parent.querySelector<HTMLAnchorElement>('a.cm-md-link')

    expect(anchor?.getAttribute('href')).toBe('//example.com/?a=1&b=2')
    expect(anchor?.getAttribute('target')).toBe('_blank')
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(anchor?.dataset.markdownExternal).toBe('true')
  })

  test('retains reference definitions across ordinary edits and refreshes changed definitions', () => {
    const source = '[link][id]\n\n[id]: /old'
    const { parent, view } = renderMarkdown(source)

    expect(parent.querySelector('a')?.getAttribute('href')).toBe('/old')
    view.dispatch({ changes: { from: 0, insert: 'prefix ' } })
    expect(parent.querySelector('a')?.getAttribute('href')).toBe('/old')

    const oldTarget = view.state.doc.toString().lastIndexOf('/old')
    view.dispatch({ changes: { from: oldTarget, to: oldTarget + 4, insert: '/new' } })
    expect(parent.querySelector('a')?.getAttribute('href')).toBe('/new')
  })
})
