import { Window as HappyWindow } from 'happy-dom'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'

import type { MarkdownEditorController } from '@/lib/markdown/create-editor'
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
  'HTMLInputElement',
  'HTMLImageElement',
  'Node',
  'Text',
  'Document',
  'DOMParser',
  'Window',
  'Event',
  'KeyboardEvent',
  'MouseEvent',
  'ClipboardEvent',
  'DataTransfer',
  'File',
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
let animationFrameId = 0
const animationFrames = new Map<number, ReturnType<typeof setTimeout>>()
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  writable: true,
  value: (callback: FrameRequestCallback) => {
    const id = ++animationFrameId
    animationFrames.set(
      id,
      setTimeout(() => {
        animationFrames.delete(id)
        callback(testWindow.performance.now())
      }, 0),
    )
    return id
  },
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  writable: true,
  value: (id: number) => {
    const timer = animationFrames.get(id)
    if (timer) clearTimeout(timer)
    animationFrames.delete(id)
  },
})

const [
  { redo, undo },
  { clipboardHtmlLooksStructured, clipboardHtmlToMarkdown },
  editorModule,
  taskModule,
] = await Promise.all([
  import('@codemirror/commands'),
  import('@/lib/files/extract-paste-data'),
  import('@/lib/markdown/create-editor'),
  import('@/lib/markdown/task-lists'),
])
const { createMarkdownEditor } = editorModule
const { TaskCheckboxWidget } = taskModule

const controllers: MarkdownEditorController[] = []

function mountEditor(
  options: {
    doc?: string
    mode?: 'read' | 'edit'
    runtime?: Partial<MarkdownEditorRuntime>
  } = {},
) {
  const parent = document.createElement('div')
  document.body.append(parent)
  const changes: string[] = []
  const runtime: MarkdownEditorRuntime = {
    resolveImageUrl: () => null,
    openImage: () => {},
    onChange: (content) => changes.push(content),
    ...options.runtime,
  }
  const controller = createMarkdownEditor({
    parent,
    doc: options.doc ?? '',
    mode: options.mode ?? 'edit',
    ariaLabel: 'Markdown note',
    runtime,
  })
  controllers.push(controller)
  return { changes, controller, parent, runtime }
}

function dispatchClipboard(
  controller: MarkdownEditorController,
  values: { plain?: string; html?: string; image?: File },
) {
  const clipboardData = new DataTransfer()
  if (values.plain !== undefined) clipboardData.setData('text/plain', values.plain)
  if (values.html !== undefined) clipboardData.setData('text/html', values.html)
  if (values.image) clipboardData.items.add(values.image)
  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData,
  })
  controller.view.contentDOM.dispatchEvent(event)
  return { clipboardData, event }
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy()
  document.body.replaceChildren()
  for (const timer of animationFrames.values()) clearTimeout(timer)
  animationFrames.clear()
})

afterAll(() => {
  for (const timer of animationFrames.values()) clearTimeout(timer)
  animationFrames.clear()
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

describe('Markdown clipboard integration', () => {
  test('detects only HTML carrying meaningful block structure', () => {
    expect(clipboardHtmlLooksStructured('<h2>Heading</h2><p>Body</p>')).toBe(true)
    expect(clipboardHtmlLooksStructured('<div><ul><li>Item</li></ul></div>')).toBe(true)
    expect(clipboardHtmlLooksStructured('<p><strong>Inline only</strong></p>')).toBe(true)
    expect(clipboardHtmlLooksStructured('<p><span>Plain wrapper</span></p>')).toBe(false)
    expect(clipboardHtmlLooksStructured('')).toBe(false)
  })

  test('converts structured HTML before replacing selection in one undo step', () => {
    const html = [
      '<h2>Heading</h2>',
      '<blockquote><p><strong>Bold</strong> and <em>italic</em></p></blockquote>',
      '<ul><li>Item</li></ul>',
      '<pre><code>const value = 1\nnext()</code></pre>',
      '<p><a href="https://example.com">Link</a></p>',
    ].join('')
    const markdown = clipboardHtmlToMarkdown(html)
    const { controller, changes } = mountEditor({ doc: 'left OLD right' })
    controller.view.dispatch({ selection: { anchor: 5, head: 8 } })

    const { event } = dispatchClipboard(controller, {
      plain: 'flattened fallback',
      html,
    })

    expect(event.defaultPrevented).toBe(true)
    expect(controller.view.state.doc.toString()).toBe(`left ${markdown} right`)
    expect(controller.view.state.selection.main.anchor).toBe(5 + markdown.length)
    expect(changes).toEqual([`left ${markdown} right`])
    expect(markdown).toContain('```\nconst value = 1\nnext()\n```')
    expect(undo(controller.view)).toBe(true)
    expect(controller.view.state.doc.toString()).toBe('left OLD right')
  })

  test('preserves plain Markdown whitespace and punctuation exactly', () => {
    const plain = '# Raw\n\n\t- [ ] task  \n**bold**'
    const { controller, changes } = mountEditor({ doc: 'aXXz' })
    controller.view.dispatch({ selection: { anchor: 1, head: 3 } })

    const { event } = dispatchClipboard(controller, {
      plain,
      html: '<p>Trivial clipboard wrapper</p>',
    })

    expect(event.defaultPrevented).toBe(true)
    expect(controller.view.state.doc.toString()).toBe(`a${plain}z`)
    expect(changes).toEqual([`a${plain}z`])
  })

  test('preserves CRLF clipboard text while using normalized document positions', () => {
    const { controller, changes } = mountEditor({ doc: 'az' })
    controller.view.dispatch({ selection: { anchor: 1 } })

    dispatchClipboard(controller, { plain: 'one\r\ntwo' })

    expect(controller.view.state.doc.toString()).toBe('aone\ntwoz')
    expect(controller.view.state.selection.main.head).toBe(8)
    expect(changes).toEqual(['aone\r\ntwoz'])
  })

  test('gives image paste handler priority and passes CodeMirror selection offsets', () => {
    let receivedSelection: { from: number; to: number } | undefined
    let receivedEvent: ClipboardEvent | undefined
    const { controller, changes } = mountEditor({
      doc: 'abcdef',
      runtime: {
        onPasteImage(event, selection, complete) {
          receivedEvent = event
          receivedSelection = selection
          complete('![[paste.png]]')
          return true
        },
      },
    })
    controller.view.dispatch({ selection: { anchor: 2, head: 5 } })

    const { event } = dispatchClipboard(controller, {
      plain: 'must not insert',
      image: new File(['image'], 'paste.png', { type: 'image/png' }),
    })

    expect(receivedEvent).toBe(event)
    expect(receivedSelection).toEqual({ from: 2, to: 5 })
    expect(controller.view.state.doc.toString()).toBe('ab![[paste.png]]f')
    expect(changes).toEqual(['ab![[paste.png]]f'])
  })

  test('maps an async image insertion through typing and keeps it undoable', async () => {
    let completePaste: ((markdown: string | null) => boolean) | undefined
    let resolveUpload: ((handled: boolean) => void) | undefined
    const upload = new Promise<boolean>((resolve) => {
      resolveUpload = resolve
    })
    const { controller } = mountEditor({
      doc: 'abcdef',
      runtime: {
        onPasteImage(event, _selection, complete) {
          event.preventDefault()
          completePaste = complete
          return upload
        },
      },
    })
    controller.view.dispatch({ selection: { anchor: 2, head: 4 } })

    dispatchClipboard(controller, {
      image: new File(['image'], 'paste.png', { type: 'image/png' }),
    })
    controller.view.dispatch({
      changes: { from: controller.view.state.selection.main.head, insert: 'typed' },
      selection: { anchor: controller.view.state.selection.main.head + 5 },
      userEvent: 'input.type',
    })
    completePaste?.('![[paste.png]]')
    resolveUpload?.(true)
    await upload

    expect(controller.view.state.doc.toString()).toBe('ab![[paste.png]]typedef')
    expect(undo(controller.view)).toBe(true)
    expect(controller.view.state.doc.toString()).toBe('abcdtypedef')
  })

  test('does not erase edits made inside an asynchronous image paste selection', async () => {
    let completePaste: ((markdown: string | null) => boolean) | undefined
    let resolveUpload: ((handled: boolean) => void) | undefined
    const upload = new Promise<boolean>((resolve) => {
      resolveUpload = resolve
    })
    const { controller } = mountEditor({
      doc: 'abcdef',
      runtime: {
        onPasteImage(event, _selection, complete) {
          event.preventDefault()
          completePaste = complete
          return upload
        },
      },
    })
    controller.view.dispatch({ selection: { anchor: 2, head: 4 } })
    dispatchClipboard(controller, {
      image: new File(['image'], 'paste.png', { type: 'image/png' }),
    })

    controller.view.dispatch({
      changes: { from: 3, insert: 'X' },
      selection: { anchor: 4 },
      userEvent: 'input.type',
    })
    completePaste?.('![[paste.png]]')
    resolveUpload?.(true)
    await upload

    expect(controller.view.state.doc.toString()).toBe('ab![[paste.png]]Xef')
    expect(undo(controller.view)).toBe(true)
    expect(controller.view.state.doc.toString()).toBe('abcXdef')
  })

  test('finishes an asynchronous image paste after switching to read mode', async () => {
    let completePaste: ((markdown: string | null) => boolean) | undefined
    let resolveUpload: ((handled: boolean) => void) | undefined
    const upload = new Promise<boolean>((resolve) => {
      resolveUpload = resolve
    })
    const { changes, controller } = mountEditor({
      doc: 'note',
      runtime: {
        onPasteImage(event, _selection, complete) {
          event.preventDefault()
          completePaste = complete
          return upload
        },
      },
    })
    controller.view.dispatch({ selection: { anchor: 4 } })
    dispatchClipboard(controller, {
      image: new File(['image'], 'paste.png', { type: 'image/png' }),
    })

    controller.setMode('read', 'Markdown document')
    completePaste?.('![[paste.png]]')
    resolveUpload?.(true)
    await upload

    expect(controller.view.state.readOnly).toBe(true)
    expect(controller.view.state.doc.toString()).toBe('note![[paste.png]]')
    expect(changes).toEqual(['note![[paste.png]]'])
  })

  test('does not handle clipboard text while read-only', () => {
    const { controller, changes } = mountEditor({ doc: '**source**', mode: 'read' })
    const { event } = dispatchClipboard(controller, { plain: 'replacement' })

    expect(event.defaultPrevented).toBe(true)
    expect(controller.view.state.doc.toString()).toBe('**source**')
    expect(changes).toEqual([])
  })
})

describe('Markdown editor mode and external synchronization', () => {
  test('round-trips CRLF and CR documents through edits and read-mode copy', () => {
    for (const separator of ['\r\n', '\r'] as const) {
      const source = `first${separator}second`
      const { controller, changes } = mountEditor({ doc: source })
      controller.view.dispatch({ changes: { from: controller.view.state.doc.length, insert: '!' } })
      expect(changes.at(-1)).toBe(`${source}!`)

      controller.setMode('read', 'Markdown document')
      controller.view.dispatch({
        selection: { anchor: 0, head: controller.view.state.doc.length },
      })
      const clipboardData = new DataTransfer()
      controller.view.contentDOM.dispatchEvent(
        new ClipboardEvent('copy', {
          bubbles: true,
          cancelable: true,
          clipboardData,
        }),
      )
      expect(clipboardData.getData('text/plain')).toBe(`${source}!`)
    }
  })

  test('preserves mixed line endings through edits, paste, and read-mode copy', () => {
    const source = 'a\r\nb\nc\rd'
    const { controller, changes } = mountEditor({ doc: source })

    controller.view.dispatch({ changes: { from: 1, to: 4, insert: 'X' } })
    expect(changes.at(-1)).toBe('aXc\rd')

    controller.view.dispatch({ selection: { anchor: 2 } })
    dispatchClipboard(controller, { plain: '\r\nP\nQ\r' })
    expect(changes.at(-1)).toBe('aX\r\nP\nQ\rc\rd')

    controller.setMode('read', 'Markdown document')
    controller.view.dispatch({
      selection: { anchor: 0, head: controller.view.state.doc.length },
    })
    const clipboardData = new DataTransfer()
    controller.view.contentDOM.dispatchEvent(
      new ClipboardEvent('copy', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    )
    expect(clipboardData.getData('text/plain')).toBe('aX\r\nP\nQ\rc\rd')
  })

  test('preserves mixed pasted line endings through undo and redo history', () => {
    const { controller, changes } = mountEditor({ doc: 'left OLD right' })
    controller.view.dispatch({ selection: { anchor: 5, head: 8 } })
    const pasted = 'one\r\ntwo\nthree\r'

    dispatchClipboard(controller, { plain: pasted })
    expect(changes.at(-1)).toBe(`left ${pasted} right`)
    expect(undo(controller.view)).toBe(true)
    expect(changes.at(-1)).toBe('left OLD right')
    expect(redo(controller.view)).toBe(true)
    expect(changes.at(-1)).toBe(`left ${pasted} right`)
  })

  test('preserves uniform line-ending style through raw-paste history', () => {
    for (const [original, pasted] of [
      ['a\r\nb', 'x\ny'],
      ['a\nb', 'x\r\ny'],
    ] as const) {
      const { controller, changes } = mountEditor({ doc: original })
      controller.view.dispatch({
        selection: { anchor: 0, head: controller.view.state.doc.length },
      })

      dispatchClipboard(controller, { plain: pasted })
      expect(changes.at(-1)).toBe(pasted)
      expect(undo(controller.view)).toBe(true)
      expect(changes.at(-1)).toBe(original)
      expect(redo(controller.view)).toBe(true)
      expect(changes.at(-1)).toBe(pasted)
    }
  })

  test('keeps source synchronized when history groups adjacent deletes', () => {
    const { controller, changes } = mountEditor({ doc: 'abc' })
    controller.view.dispatch({
      changes: { from: 2, to: 3 },
      selection: { anchor: 2 },
      userEvent: 'delete.backward',
    })
    controller.view.dispatch({
      changes: { from: 1, to: 2 },
      selection: { anchor: 1 },
      userEvent: 'delete.backward',
    })

    expect(changes.at(-1)).toBe('a')
    expect(undo(controller.view)).toBe(true)
    expect(controller.view.state.doc.toString()).toBe('abc')
    expect(changes.at(-1)).toBe('abc')
    expect(redo(controller.view)).toBe(true)
    expect(changes.at(-1)).toBe('a')
  })

  test('accepts external mixed line endings without normalizing the next edit', () => {
    const { controller, changes } = mountEditor({ doc: 'old' })
    controller.setContent('first\r\nsecond\nthird')
    controller.view.dispatch({
      changes: { from: controller.view.state.doc.length, insert: '!' },
    })

    expect(changes).toEqual(['first\r\nsecond\nthird!'])
  })

  test('clamps external CRLF replacement selection to normalized document length', () => {
    const { controller } = mountEditor({ doc: 'long document' })
    controller.view.dispatch({ selection: { anchor: controller.view.state.doc.length } })

    expect(() => controller.setContent('a\r\n')).not.toThrow()
    expect(controller.view.state.doc.toString()).toBe('a\n')
    expect(controller.view.state.selection.main.head).toBe(controller.view.state.doc.length)
  })

  test('read mode blocks edits but permits annotated external replacement without feedback', () => {
    const { controller, changes } = mountEditor({ doc: 'local', mode: 'read' })

    controller.view.dispatch({ changes: { from: 0, to: 5, insert: 'blocked' } })
    expect(controller.view.state.doc.toString()).toBe('local')

    controller.setContent('remote')
    expect(controller.view.state.doc.toString()).toBe('remote')
    expect(changes).toEqual([])
    expect(undo(controller.view)).toBe(false)
  })

  test('external replacement preserves and clamps selection', () => {
    const { controller } = mountEditor({ doc: 'abcdefgh' })
    controller.view.dispatch({ selection: { anchor: 2, head: 7 } })

    controller.setContent('wxyz')

    expect(controller.view.state.selection.main.anchor).toBe(2)
    expect(controller.view.state.selection.main.head).toBe(4)
  })

  test('external replacement clears history instead of mapping undo into new content', () => {
    const { controller } = mountEditor({ doc: 'abc' })
    controller.view.dispatch({
      changes: { from: 0, to: 1, insert: 'x' },
      userEvent: 'input.type',
    })

    controller.setContent('remote')

    expect(undo(controller.view)).toBe(false)
    expect(controller.view.state.doc.toString()).toBe('remote')
  })

  test('external replacement invalidates pending asynchronous image paste', async () => {
    let completePaste: ((markdown: string | null) => boolean) | undefined
    let resolveUpload: ((handled: boolean) => void) | undefined
    const upload = new Promise<boolean>((resolve) => {
      resolveUpload = resolve
    })
    const { controller } = mountEditor({
      doc: 'first document',
      runtime: {
        onPasteImage(event, _selection, complete) {
          event.preventDefault()
          completePaste = complete
          return upload
        },
      },
    })
    controller.view.dispatch({ selection: { anchor: 0, head: 5 } })
    dispatchClipboard(controller, {
      image: new File(['image'], 'paste.png', { type: 'image/png' }),
    })

    controller.setContent('second document')
    expect(completePaste?.('![[paste.png]]')).toBe(false)
    resolveUpload?.(true)
    await upload

    expect(controller.view.state.doc.toString()).toBe('second document')
  })

  test('mode switch updates editability and regular edits emit changes', () => {
    const { controller, changes } = mountEditor({ doc: 'text', mode: 'read' })
    expect(controller.view.state.readOnly).toBe(true)
    expect(controller.view.contentDOM.getAttribute('role')).toBe('document')
    expect(controller.view.contentDOM.getAttribute('aria-readonly')).toBe('true')

    controller.setMode('edit', 'Edit Markdown note')
    expect(controller.view.state.readOnly).toBe(false)
    expect(controller.view.contentDOM.getAttribute('role')).toBe('textbox')
    expect(controller.view.contentDOM.getAttribute('aria-label')).toBe('Edit Markdown note')
    expect(controller.view.contentDOM.getAttribute('aria-readonly')).toBe('false')

    controller.view.dispatch({ changes: { from: 4, insert: '!' } })
    expect(changes).toEqual(['text!'])
  })

  test('Mod-s prevents browser save and invokes editor save while editable', () => {
    let saves = 0
    const { controller } = mountEditor({
      runtime: {
        onSave: () => {
          saves += 1
        },
      },
    })
    const event = new KeyboardEvent('keydown', {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })

    controller.view.contentDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(saves).toBe(1)
  })

  test('leaves Tab to native focus navigation outside Markdown lists', () => {
    for (const mode of ['edit', 'read'] as const) {
      const { controller } = mountEditor({ doc: 'plain text', mode })
      for (const shiftKey of [false, true]) {
        const event = new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey,
          bubbles: true,
          cancelable: true,
        })
        controller.view.contentDOM.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
      }
    }
  })

  test('runs blur save before target state can change', () => {
    let currentTarget = 'old'
    const savedTargets: string[] = []
    const { controller } = mountEditor({
      runtime: { onBlur: () => savedTargets.push(currentTarget) },
    })
    const internalButton = document.createElement('button')
    const outsideButton = document.createElement('button')
    controller.view.dom.append(internalButton)
    document.body.append(outsideButton)

    controller.view.focus()
    internalButton.focus()
    expect(savedTargets).toEqual([])

    controller.view.focus()
    outsideButton.focus()
    currentTarget = 'new'
    expect(savedTargets).toEqual(['old'])
  })

  test('uses native double-click recognition after selecting editable image source', () => {
    const imageSource = '![preview](photo.png)'
    const source = `before\n\n${imageSource}`
    const opened: { src: string; alt?: string }[] = []
    const { controller, parent } = mountEditor({
      doc: source,
      runtime: {
        resolveImageUrl: (src) => `http://localhost/${src}`,
        openImage: (src, alt) => opened.push({ src, alt }),
      },
    })
    const image = parent.querySelector<HTMLImageElement>('img.cm-md-image')
    expect(image).not.toBeNull()

    image?.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true }))

    const selection = controller.view.state.selection.main
    expect(controller.view.state.sliceDoc(selection.from, selection.to)).toBe(imageSource)
    expect(opened).toEqual([])

    const doubleClick = new MouseEvent('dblclick', {
      detail: 2,
      bubbles: true,
      cancelable: true,
    })
    controller.view.contentDOM.dispatchEvent(doubleClick)

    expect(doubleClick.defaultPrevented).toBe(true)
    expect(opened).toEqual([{ src: 'http://localhost/photo.png', alt: 'preview' }])
  })

  test('clears editable image activation across content and mode changes', () => {
    for (const invalidate of ['content', 'mode'] as const) {
      const opened: string[] = []
      const { controller, parent } = mountEditor({
        doc: 'before\n\n![preview](photo.png)',
        runtime: {
          resolveImageUrl: (src) => `http://localhost/${src}`,
          openImage: (src) => opened.push(src),
        },
      })
      const image = parent.querySelector<HTMLImageElement>('img.cm-md-image')
      expect(image).not.toBeNull()
      image?.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true }))

      if (invalidate === 'content') controller.setContent('short')
      else controller.setMode('read', 'Markdown document')
      controller.view.contentDOM.dispatchEvent(
        new MouseEvent('dblclick', { detail: 2, bubbles: true, cancelable: true }),
      )

      expect(opened).toEqual([])
    }
  })

  test('read-mode copy writes selected underlying Markdown source', () => {
    const source = '# Heading\n\n**bold**'
    const { controller } = mountEditor({ doc: source, mode: 'read' })
    controller.view.dispatch({ selection: { anchor: 0, head: source.length } })
    const clipboardData = new DataTransfer()
    const event = new ClipboardEvent('copy', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    })

    controller.view.contentDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(clipboardData.getData('text/plain')).toBe(source)
  })
})

describe('Markdown reference preview', () => {
  test('renders nested formatting inside reference links and hides definitions', () => {
    const source = '[**bold** and *italic*][id]\n\n[id]: https://example.com'
    const { parent } = mountEditor({ doc: source, mode: 'read' })
    const renderedLinkText = Array.from(
      parent.querySelectorAll<HTMLElement>('[data-markdown-link="https://example.com"]'),
    )
      .map((element) => element.textContent)
      .join('')

    expect(renderedLinkText).toBe('bold and italic')
    expect(parent.querySelector('.cm-md-strong')?.textContent).toBe('bold')
    expect(parent.querySelector('.cm-md-emphasis')?.textContent).toBe('italic')
    expect(parent.textContent).not.toContain('[id]: https://example.com')
  })

  test('renders reference images through normal URL resolution', () => {
    const source = '![preview][asset]\n\n[asset]: folder/photo.png'
    const { parent } = mountEditor({
      doc: source,
      mode: 'read',
      runtime: { resolveImageUrl: (src) => `http://localhost/${src}` },
    })
    const image = parent.querySelector<HTMLImageElement>('img.cm-md-image')

    expect(image?.alt).toBe('preview')
    expect(image?.src).toBe('http://localhost/folder/photo.png')
    expect(parent.textContent).not.toContain('[asset]: folder/photo.png')
  })
})

describe('task checkbox widget', () => {
  test('read widget is checked when needed, disabled, and non-tabbable', () => {
    const widget = new TaskCheckboxWidget(2, '[X]', 'read')
    const dispatches: unknown[] = []
    const checkbox = widget.toDOM({
      dispatch: (value: unknown) => dispatches.push(value),
      focus: () => {},
    } as never) as HTMLInputElement

    expect(checkbox.type).toBe('checkbox')
    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(true)
    expect(checkbox.tabIndex).toBe(-1)
    expect(checkbox.dataset.markdownTask).toBe('read')
    checkbox.dispatchEvent(new Event('change'))
    expect(dispatches).toEqual([])
  })

  test('edit widget toggles only marker character using lowercase x', () => {
    const widget = new TaskCheckboxWidget(4, '[ ]', 'edit')
    const dispatches: unknown[] = []
    let focused = false
    const checkbox = widget.toDOM({
      dispatch: (value: unknown) => dispatches.push(value),
      focus: () => {
        focused = true
      },
    } as never) as HTMLInputElement

    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))

    expect(dispatches).toEqual([
      {
        changes: { from: 5, to: 6, insert: 'x' },
        userEvent: 'input.markdown.task',
      },
    ])
    expect(focused).toBe(true)
  })

  test('uppercase completed widget stays uppercase until toggled off', () => {
    const dispatches: unknown[] = []
    const checkbox = new TaskCheckboxWidget(10, '[X]', 'edit').toDOM({
      dispatch: (value: unknown) => dispatches.push(value),
      focus: () => {},
    } as never) as HTMLInputElement

    expect(checkbox.checked).toBe(true)
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change'))
    expect(dispatches).toEqual([
      {
        changes: { from: 11, to: 12, insert: ' ' },
        userEvent: 'input.markdown.task',
      },
    ])
  })

  test('widget equality includes position, marker, and mode', () => {
    const widget = new TaskCheckboxWidget(2, '[ ]', 'edit')
    expect(widget.eq(new TaskCheckboxWidget(2, '[ ]', 'edit'))).toBe(true)
    expect(widget.eq(new TaskCheckboxWidget(3, '[ ]', 'edit'))).toBe(false)
    expect(widget.eq(new TaskCheckboxWidget(2, '[x]', 'edit'))).toBe(false)
    expect(widget.eq(new TaskCheckboxWidget(2, '[ ]', 'read'))).toBe(false)
    expect(widget.ignoreEvent()).toBe(true)
  })
})
