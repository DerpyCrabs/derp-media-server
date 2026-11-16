import { expect, test } from 'bun:test'
import {
  createExplorerRowMenu,
  type ExplorerRowMenuConfig,
} from '@/features/explorer/explorer-row-menu'
import { MediaType, type FileItem } from '@/lib/files/types'

test('extract is offered only for real supported archives in writable folders', () => {
  const calls: string[] = []
  const config: ExplorerRowMenuConfig = {
    api: { menu: null, dismiss: () => calls.push('dismiss'), confirmDelete: () => {} },
    permissions: {
      editableFolders: ['Notes'],
      currentDirectoryEditable: true,
      hasEditableFolders: true,
    },
    edit: { download: () => {}, extract: (file) => calls.push(file.path) },
    open: {},
    metadata: {},
  }
  const file: FileItem = {
    name: 'backup.zip',
    path: 'Notes/backup.zip',
    type: MediaType.OTHER,
    extension: 'zip',
    size: 0,
    isDirectory: false,
  }
  const menu = createExplorerRowMenu(config)
  expect(menu.available('extract', file)).toBe(true)
  expect(menu.available('extract', { ...file, isDirectory: true })).toBe(false)
  expect(menu.available('extract', { ...file, isVirtual: true })).toBe(false)
  expect(menu.available('extract', { ...file, path: 'Notes/book.fb2.zip' })).toBe(false)
  expect(menu.available('extract', { ...file, path: 'Notes/note.txt' })).toBe(false)
  expect(
    createExplorerRowMenu({
      ...config,
      permissions: { ...config.permissions, currentDirectoryEditable: false },
    }).available('extract', file),
  ).toBe(false)
  menu.run('extract', file)
  expect(calls).toEqual(['Notes/backup.zip', 'dismiss'])
})
