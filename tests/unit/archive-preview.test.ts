import { describe, expect, test } from 'bun:test'
import {
  archiveEntryUrl,
  archivePreviewKind,
  previewText,
} from '../../src/features/viewer/archive-preview'
describe('archive previews', () => {
  test('only recognized media is rendered; HTML and SVG remain source text', () => {
    expect(archivePreviewKind('folder/photo.PNG')).toBe('image')
    expect(archivePreviewKind('manual.pdf')).toBe('pdf')
    expect(archivePreviewKind('clip.mp4')).toBe('video')
    expect(archivePreviewKind('track.flac')).toBe('audio')
    expect(archivePreviewKind('page.html')).toBe('text')
    expect(archivePreviewKind('image.svg')).toBe('text')
    expect(archiveEntryUrl('Books/a & b.zip', 'Книга/#1.txt')).toBe(
      '/api/files/archive-entry?path=Books%2Fa%20%26%20b.zip&entry=%D0%9A%D0%BD%D0%B8%D0%B3%D0%B0%2F%231.txt',
    )
  })
  test('text decoding keeps line endings and rejects invalid UTF-8 and binary content', async () => {
    expect(await previewText(new Blob(['Привет\r\nworld\n']))).toBe('Привет\r\nworld\n')
    expect(await previewText(new Blob([new Uint8Array([255, 254, 17])]))).toBeUndefined()
    expect(await previewText(new Blob(['a\0b']))).toBeUndefined()
    expect(await previewText(new Blob(['']))).toBe('')
    expect(await previewText(new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]))).toBeUndefined()
  })
})
