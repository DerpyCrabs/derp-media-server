import { describe, expect, test } from 'bun:test'
import { MediaType, type FileItem } from '../../src/lib/files/types'
import { sortFileItems } from '../../src/features/explorer/file-display-settings'

function item(
  name: string,
  options: Partial<Pick<FileItem, 'isDirectory' | 'isVirtual' | 'size' | 'createdDate'>> = {},
): FileItem {
  const isDirectory = options.isDirectory ?? false
  return {
    name,
    path: name,
    type: isDirectory ? MediaType.FOLDER : MediaType.OTHER,
    size: options.size ?? 0,
    createdDate: options.createdDate,
    extension: '',
    isDirectory,
    isVirtual: options.isVirtual,
  }
}

describe('file display sorting', () => {
  test('uses natural case-insensitive names and keeps folders first', () => {
    const files = [item('file10'), item('Folder', { isDirectory: true }), item('File2')]
    expect(
      sortFileItems(files, { field: 'name', direction: 'asc' }).map((file) => file.name),
    ).toEqual(['Folder', 'File2', 'file10'])
  })

  test('sorts file sizes descending while name-sorting folders', () => {
    const files = [
      item('b-folder', { isDirectory: true }),
      item('small', { size: 1 }),
      item('a-folder', { isDirectory: true }),
      item('large', { size: 10 }),
    ]
    expect(
      sortFileItems(files, { field: 'size', direction: 'desc' }).map((file) => file.name),
    ).toEqual(['a-folder', 'b-folder', 'large', 'small'])
  })

  test('keeps missing creation dates last in both directions', () => {
    const files = [
      item('missing'),
      item('new', { createdDate: 20 }),
      item('old', { createdDate: 10 }),
    ]
    expect(
      sortFileItems(files, { field: 'createdDate', direction: 'asc' }).map((file) => file.name),
    ).toEqual(['old', 'new', 'missing'])
    expect(
      sortFileItems(files, { field: 'createdDate', direction: 'desc' }).map((file) => file.name),
    ).toEqual(['new', 'old', 'missing'])
  })

  test('keeps virtual folders before real folders for every sort field', () => {
    const files = [
      item('Archive', { isDirectory: true, createdDate: 20 }),
      item('Favorites', { isDirectory: true, isVirtual: true }),
      item('Most Played', { isDirectory: true, isVirtual: true }),
    ]

    expect(
      sortFileItems(files, { field: 'createdDate', direction: 'desc' }).map((file) => file.name),
    ).toEqual(['Favorites', 'Most Played', 'Archive'])
  })
})
