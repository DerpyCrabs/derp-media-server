import { expect, test } from 'bun:test'
import { archiveChildren, isArchivePath } from '@/features/explorer/archive-contents'
const entries = [
  { path: 'folder/sub/item.txt', directory: false, size: 12 },
  { path: 'folder/file10.txt', directory: false, size: 10 },
  { path: 'folder/file2.txt', directory: false, size: 2 },
  { path: 'folder', directory: true, size: 0 },
  { path: 'folder-other/item.txt', directory: false, size: 1 },
]
test('archive browsing synthesizes missing directories and stays within path boundaries', () => {
  expect(archiveChildren(entries, '').map((entry) => entry.path)).toEqual([
    'folder',
    'folder-other',
  ])
  expect(archiveChildren(entries, 'folder').map((entry) => entry.path)).toEqual([
    'folder/sub',
    'folder/file2.txt',
    'folder/file10.txt',
  ])
  expect(archiveChildren(entries, 'folder/sub')).toEqual([entries[0]!])
  expect(archiveChildren(entries, 'folder', 'ITEM')).toEqual([entries[0]!])
})
test('archive format recognition keeps zipped books in their reader', () => {
  for (const path of ['a.ZIP', 'a.tar', 'a.tar.gz', 'a.TGZ', 'a.tar.xz', 'a.txz'])
    expect(isArchivePath(path)).toBe(true)
  for (const path of ['book.fb2.zip', 'BOOK.FB2.ZIP', 'a.gz', 'a.7z', 'a.zip.txt'])
    expect(isArchivePath(path)).toBe(false)
})
