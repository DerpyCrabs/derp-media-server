import { expect, test } from 'bun:test'
import { shuffleImages } from '@/features/viewer/image-order'
import { MediaType, type FileItem } from '@/lib/files/types'

test('image shuffle is reproducible independently of directory sorting and preserves every file', () => {
  const files: FileItem[] = Array.from({ length: 20 }, (_, i) => ({
    path: `Images/${i}.jpg`,
    name: `${i}.jpg`,
    type: MediaType.IMAGE,
    size: 1,
    extension: 'jpg',
    isDirectory: false,
  }))
  const original = [...files]
  const shuffled = shuffleImages(files, 'first-tab')
  expect(shuffled).toEqual(shuffleImages([...files].reverse(), 'first-tab'))
  expect(new Set(shuffled)).toEqual(new Set(files))
  expect(shuffled).not.toEqual(shuffleImages(files, 'second-tab'))
  expect(files).toEqual(original)
})
