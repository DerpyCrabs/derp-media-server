import { expect, test } from 'bun:test'
import { isPathEditable, type ClientMediaRoot } from '@/lib/utils'

const roots: ClientMediaRoot[] = [
  { name: 'E', editableFolders: ['Content/Notes', 'Notes/Notes'] },
  { name: 'Archive', editableFolders: [], readOnly: true },
]

test('legacy primary-root paths remain editable after a runtime mount appears', () => {
  expect(isPathEditable('Content/Notes/idea.md', ['Content/Notes'], roots)).toBe(true)
  expect(isPathEditable('Notes/Notes/Buffer.md', ['Notes/Notes'], roots)).toBe(true)
})

test('prefixed primary paths remain editable and runtime mounts stay read-only', () => {
  expect(isPathEditable('E/Content/Notes/idea.md', ['E/Content/Notes'], roots)).toBe(true)
  expect(isPathEditable('Archive/idea.md', ['E/Content/Notes'], roots)).toBe(false)
})
