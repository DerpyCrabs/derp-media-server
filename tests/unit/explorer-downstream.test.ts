import { Effect } from 'effect'
import { expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { DomLifetime } from 'effectweb'
import {
  directoryViewport,
  type DirectoryViewport,
} from '@/features/explorer/virtual-directory-binding'
import { createFileBrowserDragController } from '@/features/explorer/file-browser-drag'
import { acquireDesktopOperations } from '@/desktop/operations'
import type { FileItem } from '@/lib/files/types'

const file = (path: string, isVirtual = false) =>
  ({ path, name: path, isVirtual, isDirectory: false, size: 1 }) as FileItem

test('native dragging keeps the selection and excludes virtual entries', async () => {
  const window = new Window() as unknown as globalThis.Window
  const calls: string[][] = []
  window.derpDesktop = {
    drag: async (paths) => {
      calls.push(paths)
    },
  } as NonNullable<globalThis.Window['derpDesktop']>
  const operations = acquireDesktopOperations(window)
  const drag = createFileBrowserDragController(
    { files: () => [], currentPath: () => '', editableFolders: [], allowMoveFile: () => undefined },
    window,
  )
  const event = { preventDefault() {} } as DragEvent
  try {
    drag
      .snapshot(drag.read(), { currentPath: '', editableFolders: [], canMove: false })
      .onFileDragStart(file('a'), event, [file('a'), file('b'), file('virtual', true)])
    await Effect.runPromise(operations.awaitIdle())
    drag
      .snapshot(drag.read(), { currentPath: '', editableFolders: [], canMove: false })
      .onFileDragStart(file('c'), event, [file('a'), file('b')])
    await Effect.runPromise(operations.awaitIdle())
    expect(calls).toEqual([['a', 'b'], ['c']])
  } finally {
    drag.dispose()
    operations.dispose()
  }
})

for (const kind of ['body', 'editor', 'dialog', 'disposed', 'detached'] as const) {
  test(`listing autofocus respects ${kind}`, () => {
    const window = new Window() as unknown as globalThis.Window
    const document = window.document
    const element = document.createElement('div')
    const row = document.createElement('button')
    row.dataset.filePath = 'a'
    element.append(row)
    document.body.append(element)
    let frame: FrameRequestCallback | undefined
    window.requestAnimationFrame = (callback) => {
      frame = callback
      return 1
    }
    window.cancelAnimationFrame = () => {}
    if (kind === 'editor') {
      const input = document.createElement('input')
      document.body.append(input)
      input.focus()
    }
    if (kind === 'dialog') {
      const dialog = document.createElement('div')
      dialog.role = 'dialog'
      dialog.getClientRects = () => [{}] as unknown as DOMRectList
      document.body.append(dialog)
    }
    const state: DirectoryViewport = {
      files: [file('a')],
      warmThumbnails: false,
      includeParent: false,
      target: { kind: 'window' },
      grid: false,
      range: { start: 0, end: 1, columns: 1, rowHeight: 37 },
      focusOnLoad: true,
      patch() {},
    }
    const lifetime = { measure: () => ({ schedule() {} }) } as unknown as DomLifetime
    const binding = directoryViewport(element, () => state, lifetime)
    try {
      if (kind === 'disposed') binding.dispose()
      if (kind === 'detached') element.remove()
      frame?.(0)
      expect(document.activeElement === row).toBe(kind === 'body')
    } finally {
      binding.dispose()
    }
  })
}
