import { describe, expect, test } from 'bun:test'
import { getMediaType, getMediaTypeFromPath, getMimeType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'

describe('legacy opener media characterization', () => {
  const cases = [
    ['clip.mp4', MediaType.VIDEO, 'video/mp4'],
    ['track.mp3', MediaType.AUDIO, 'audio/mpeg'],
    ['photo.JPEG', MediaType.IMAGE, 'image/jpeg'],
    ['notes.md', MediaType.TEXT, 'text/markdown'],
    ['paper.pdf', MediaType.PDF, 'application/pdf'],
    ['novel.epub', MediaType.BOOK, 'application/epub+zip'],
    ['novel.fb2.zip', MediaType.BOOK, 'application/zip'],
    ['archive.zip', MediaType.OTHER, 'application/octet-stream'],
  ] as const

  for (const [path, mediaType, mimeType] of cases) {
    test(`${path} keeps ${mediaType} presentation`, () => {
      const extension = path.toLowerCase().endsWith('.fb2.zip')
        ? 'fb2.zip'
        : (path.split('.').at(-1) ?? '')
      expect(getMediaTypeFromPath(path)).toBe(mediaType)
      expect(getMimeType(extension)).toBe(mimeType)
    })
  }

  test('ambiguous OGG keeps video-first legacy classification', () => {
    expect(getMediaType('ogg')).toBe(MediaType.VIDEO)
    expect(getMimeType('ogg')).toBe('video/ogg')
  })

  test('folders remain caller-classified and extensionless files stay unsupported', () => {
    expect(getMediaType('')).toBe(MediaType.OTHER)
    expect(getMimeType('')).toBe('application/octet-stream')
  })
})
