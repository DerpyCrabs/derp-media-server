import { expect, test } from 'bun:test'
import { createCanvasSelection } from '@/workspace/canvas/model/canvas-selection'
import { defaultPersistedState } from '@/workspace/shared/workspace-page-persistence'
import { DEFAULT_WORKSPACE_SOURCE } from '@/workspace/model/workspace'

test('resolved selection retains identity until focus, membership or selected IDs change', () => {
  let document = defaultPersistedState(DEFAULT_WORKSPACE_SOURCE)
  const first = document.windows[0]!
  document = { ...document, windows: [first, { ...first, id: 'second' }], activeWindowId: first.id }
  const selection = createCanvasSelection({ workspace: () => document })
  const initial = selection.selectedIds()
  expect(selection.selectedIds()).toBe(initial)
  document = { ...document, nextWindowId: document.nextWindowId + 1 }
  expect(selection.selectedIds()).toBe(initial)
  selection.toggle('second')
  const both = selection.selectedIds()
  expect(both).toEqual([first.id, 'second'])
  expect(selection.focusedId()).toBe('second')
  expect(selection.selectedIds()).toBe(both)
  document = { ...document, windows: [first] }
  expect(selection.selectedIds()).toEqual([first.id])
  expect(selection.focusedId()).toBeNull()
  document = { ...document, windows: [first, { ...first, id: 'second' }], activeWindowId: 'second' }
  expect(selection.selectedIds()).toEqual(['second'])
  expect(selection.focusedId()).toBe('second')
  selection.clear()
  expect(selection.selectedIds()).toEqual([])
  expect(selection.focusedId()).toBeNull()
  selection.dispose()
})
