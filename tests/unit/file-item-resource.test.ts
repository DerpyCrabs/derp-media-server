import { describe, expect, test } from 'bun:test'
import { adaptFileItemResource, LEGACY_FILESYSTEM_ROOT_ID } from '@/lib/domain/file-item-resource'
import { filesystemResourceAddress, resourceKey } from '@/lib/domain/resource'
import { MediaType, type FileItem } from '@/lib/types'

function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    name: 'clip.mp4',
    path: 'Media/clip.mp4',
    type: MediaType.VIDEO,
    size: 42,
    extension: 'mp4',
    isDirectory: false,
    ...overrides,
  }
}

describe('FileItem resource adapter', () => {
  test('characterizes every current FileItem presentation', () => {
    const cases = [
      [MediaType.VIDEO, 'mp4', 'video', 'video/mp4', ['read', 'stream', 'download']],
      [MediaType.AUDIO, 'mp3', 'audio', 'audio/mpeg', ['read', 'stream', 'download']],
      [MediaType.IMAGE, 'jpeg', 'image', 'image/jpeg', ['read', 'download']],
      [MediaType.TEXT, 'md', 'text', 'text/markdown', ['read', 'download']],
      [MediaType.PDF, 'pdf', 'pdf', 'application/pdf', ['read', 'download']],
      [MediaType.BOOK, 'fb2.zip', 'book', 'application/zip', ['read', 'download']],
      [MediaType.OTHER, 'zip', 'unsupported', 'application/octet-stream', ['read', 'download']],
    ] as const

    for (const [type, extension, presentation, mime, capabilities] of cases) {
      const adapted = adaptFileItemResource(file({ type, extension }))
      expect(adapted.resource).toMatchObject({ presentation, mime, capabilities })
    }

    const folder = adaptFileItemResource(
      file({ type: MediaType.FOLDER, extension: '', isDirectory: true }),
    )
    expect(folder.resource).toMatchObject({
      kind: 'folder',
      presentation: 'browse',
      capabilities: ['browse', 'download'],
    })
    expect(folder.resource.mime).toBeUndefined()
  })

  test('keeps exact legacy path for URLs and persisted payloads', () => {
    const original = file({ path: 'Media\\Albums//clip.mp4' })
    const adapted = adaptFileItemResource(original, {
      rootId: 'media-root',
      logicalPath: 'Albums\\clip.mp4',
    })

    expect(adapted.file).toBe(original)
    expect(adapted.legacyPath).toBe('Media\\Albums//clip.mp4')
    expect(filesystemResourceAddress(adapted.resource.key)).toEqual({
      rootId: 'media-root',
      path: 'Albums/clip.mp4',
    })
    expect(original.path).toBe('Media\\Albums//clip.mp4')
  })

  test('uses bounded legacy root fallback without pretending it is opaque identity', () => {
    const adapted = adaptFileItemResource(file())
    expect(filesystemResourceAddress(adapted.resource.key)).toEqual({
      rootId: LEGACY_FILESYSTEM_ROOT_ID,
      path: 'Media/clip.mp4',
    })
  })

  test('requires explicit keys for virtual items and preserves provider-owned ids', () => {
    const virtual = file({
      name: 'Session',
      path: 'Legacy Virtual Path/session/one',
      type: MediaType.OTHER,
      extension: '',
      isVirtual: true,
    })
    expect(() => adaptFileItemResource(virtual)).toThrow('explicit ResourceKey')

    const adapted = adaptFileItemResource(virtual, {
      key: resourceKey('fixture', 'opaque/../session:one'),
      kind: 'fixture-session',
      presentation: 'fixture-session',
      capabilities: ['read', 'fixture.branch'],
      mime: null,
    })
    expect(adapted.resource).toEqual({
      key: { provider: 'fixture', id: 'opaque/../session:one' },
      name: 'Session',
      kind: 'fixture-session',
      capabilities: ['read', 'fixture.branch'],
      presentation: 'fixture-session',
      size: 42,
    })
    expect(adapted.legacyPath).toBe('Legacy Virtual Path/session/one')
  })
})
