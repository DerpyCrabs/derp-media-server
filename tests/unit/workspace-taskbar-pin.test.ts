import { expect, test } from 'bun:test'
import { MediaType, type FileItem } from '@/lib/files/types'
import {
  createTaskbarPin,
  planTaskbarPinAdd,
  taskbarPinIdentity,
  taskbarPinLabel,
} from '@/workspace/model/workspace-taskbar-pin'

const file: FileItem = {
  name: 'Cover',
  path: 'books/cover.jpg',
  type: MediaType.IMAGE,
  size: 10,
  extension: 'jpg',
  isDirectory: false,
}

for (const renderer of ['desktop', 'canvas']) {
  test(`${renderer} pin factory preserves source and custom icon`, () => {
    expect(
      createTaskbarPin({
        file,
        source: { kind: 'local', rootPath: 'media-b' },
        customIcons: { 'books/cover.jpg': 'cover-art' },
      }),
    ).toEqual({
      id: 'workspace-pin:%5B%22local%22%2C%22media-b%22%2C%22books%2Fcover.jpg%22%5D',
      path: 'books/cover.jpg',
      isDirectory: false,
      title: 'Cover',
      customIconName: 'cover-art',
      isVirtual: undefined,
      source: { kind: 'local', rootPath: 'media-b' },
    })
  })
}

test('pin identity includes the source root', () => {
  expect(
    taskbarPinIdentity({ path: 'books/cover.jpg', source: { kind: 'local', rootPath: 'a' } }),
  ).not.toBe(
    taskbarPinIdentity({ path: 'books/cover.jpg', source: { kind: 'local', rootPath: 'b' } }),
  )
})

test('pin ids are deterministic across equivalent path separators', () => {
  const slash = createTaskbarPin({
    file,
    source: { kind: 'local', rootPath: 'media/a' },
    customIcons: {},
  })
  const backslash = createTaskbarPin({
    file: { ...file, path: 'books\\cover.jpg' },
    source: { kind: 'local', rootPath: 'media\\a' },
    customIcons: {},
  })
  expect(backslash.id).toBe(slash.id)
  expect(backslash.path).toBe('books/cover.jpg')
})

test('pin add plan dedupes only the same source target', () => {
  const existing = createTaskbarPin({
    file,
    source: { kind: 'local', rootPath: 'media-a' },
    customIcons: {},
  })
  expect(
    planTaskbarPinAdd({
      pins: [existing],
      file,
      source: { kind: 'local', rootPath: 'media-a' },
      customIcons: {},
    }),
  ).toEqual({ kind: 'existing', pinId: existing.id })
  expect(
    planTaskbarPinAdd({
      pins: [existing],
      file,
      source: { kind: 'local', rootPath: 'media-b' },
      customIcons: {},
    }).kind,
  ).toBe('add')
})

test('pin label is shared across renderers', () => {
  expect(
    taskbarPinLabel(
      createTaskbarPin({
        file: { ...file, name: 'Documents', path: 'Documents', isDirectory: true },
        source: { kind: 'local' },
        customIcons: {},
      }),
    ),
  ).toBe('Folder: Documents')
})
