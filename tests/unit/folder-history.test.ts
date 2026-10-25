import { expect, test } from 'bun:test'
import {
  folderHistoryTarget,
  initialFolderHistory,
  visitFolder,
} from '../../src/features/explorer/folder-history'

test('folder history remembers root, back and forward and truncates a replaced branch', () => {
  let history = visitFolder(visitFolder(initialFolderHistory(''), 'Notes'), 'Notes/First')
  expect(folderHistoryTarget(history, 1)).toBeUndefined()
  expect(folderHistoryTarget(history, -1)).toEqual({ index: 1, path: 'Notes' })
  history = { ...history, index: 1 }
  expect(folderHistoryTarget(history, -1)).toEqual({ index: 0, path: '' })
  expect(folderHistoryTarget(history, 1)?.path).toBe('Notes/First')
  history = visitFolder(history, 'Notes/Second')
  expect(history.entries).toEqual(['', 'Notes', 'Notes/Second'])
  expect(folderHistoryTarget(history, 1)).toBeUndefined()
  expect(visitFolder(history, 'Notes/Second')).toBe(history)
})

test('history is bounded and independent for each browser', () => {
  const other = initialFolderHistory('Other')
  let history = initialFolderHistory('')
  for (let i = 0; i < 150; i++) history = visitFolder(history, `folder-${i}`)
  expect(history.entries).toHaveLength(100)
  expect(history.entries[history.index]).toBe('folder-149')
  expect(other.entries).toEqual(['Other'])
  expect(folderHistoryTarget(other, -1)).toBeUndefined()
})
