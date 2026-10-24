import { expect, test } from 'bun:test'
import { selectFiles } from '../../src/features/explorer/file-selection'
import { MediaType, type FileItem } from '../../src/lib/files/types'
const files: FileItem[] = ['a', 'b', 'virtual', 'c', 'd'].map((name) => ({
  name,
  path: name,
  size: 0,
  extension: '',
  type: MediaType.OTHER,
  isDirectory: false,
  isVirtual: name === 'virtual',
}))
test('Cmd selection toggles and Shift follows displayed order while excluding virtual entries', () => {
  expect(selectFiles(['a'], 'a', files[4]!, files, { metaKey: true }, false)).toEqual({
    selected: ['a', 'd'],
    anchor: 'd',
  })
  expect(selectFiles(['a', 'd'], 'd', files[1]!, files, { shiftKey: true }, false)).toEqual({
    selected: ['b', 'c', 'd'],
    anchor: 'd',
  })
  expect(
    selectFiles(['a'], 'd', files[1]!, files, { shiftKey: true, ctrlKey: true }, false).selected,
  ).toEqual(['a', 'b', 'c', 'd'])
  expect(selectFiles(['a'], 'a', files[0]!, files, { metaKey: true }, false).selected).toEqual([])
})
test('explicit selection mode toggles without modifiers and stale anchors fall back to single selection', () => {
  expect(selectFiles(['a'], 'a', files[1]!, files, {}, true).selected).toEqual(['a', 'b'])
  expect(selectFiles(['a'], 'missing', files[4]!, files, { shiftKey: true }, false)).toEqual({
    selected: ['d'],
    anchor: 'd',
  })
})
