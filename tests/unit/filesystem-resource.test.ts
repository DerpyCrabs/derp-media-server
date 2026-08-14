import { describe, expect, test } from 'bun:test'
import {
  FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID,
  filesystemResourceAddress,
  filesystemResourceKey,
  physicalFilesystemResourceAddress,
  resourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { MediaType } from '@/lib/types'
import {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemPathForResourceKey,
  filesystemResourceExtension,
  filesystemResourceIsDirectory,
  filesystemResourceMediaType,
} from '@/src/integrations/filesystem/resource'

function resource(
  path: string,
  presentation: string,
  overrides: Partial<ResourceSummary> = {},
): ResourceSummary {
  return {
    key: filesystemResourceKey(DEFAULT_FILESYSTEM_ROOT_ID, path),
    name: path.split('/').at(-1) ?? path,
    kind: 'file',
    capabilities: ['read'],
    presentation,
    ...overrides,
  }
}

describe('filesystem resource semantics', () => {
  test('uses typed presentation for media classification', () => {
    const cases = [
      ['video', MediaType.VIDEO],
      ['audio', MediaType.AUDIO],
      ['image', MediaType.IMAGE],
      ['text', MediaType.TEXT],
      ['pdf', MediaType.PDF],
      ['book', MediaType.BOOK],
      ['unsupported', MediaType.OTHER],
    ] as const

    for (const [presentation, type] of cases) {
      expect(filesystemResourceMediaType(resource('Media/item.bin', presentation))).toBe(type)
    }
  })

  test('recognizes browse resources and reads the opaque filesystem address', () => {
    const folder = resource('Media/Albums', 'browse', {
      kind: 'folder',
      capabilities: ['browse', 'download'],
    })
    expect(filesystemResourceIsDirectory(folder)).toBe(true)
    expect(filesystemPathForResourceKey(folder.key)).toBe('Media/Albums')
    expect(filesystemResourceAddress(folder.key)).toEqual({
      rootId: DEFAULT_FILESYSTEM_ROOT_ID,
      path: 'Media/Albums',
    })
    expect(filesystemResourceMediaType(folder)).toBe(MediaType.FOLDER)
  })

  test('reads extension metadata and rejects other providers', () => {
    expect(
      filesystemResourceExtension(
        resource('Media/archive.data', 'unsupported', { metadata: { extension: 'zip' } }),
      ),
    ).toBe('zip')
    expect(filesystemResourceExtension(resource('Media/archive.tar', 'unsupported'))).toBe('tar')
    expect(filesystemPathForResourceKey(resourceKey('fixture', 'opaque'))).toBeNull()
  })

  test('does not project virtual application collections as physical paths', () => {
    const favorites = filesystemResourceKey(FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID, 'favorites')

    expect(filesystemResourceAddress(favorites)).toEqual({
      rootId: FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID,
      path: 'favorites',
    })
    expect(physicalFilesystemResourceAddress(favorites)).toBeNull()
    expect(filesystemPathForResourceKey(favorites)).toBeNull()
  })
})
