import { describe, expect, test } from 'bun:test'
import type { ResourceSummary } from '@/lib/resource'
import { MediaType, type FileItem } from '@/lib/types'
import {
  grantOpenScope,
  OWNER_OPEN_SCOPE,
  resourceForFileItem,
} from '@/src/lib/legacy-resource-adapter'
import { openResource } from '@/src/lib/open-resource'

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

describe('legacy resource adapter', () => {
  test('prefers server-owned resource metadata without rewriting it', () => {
    const resource: ResourceSummary = {
      ref: { libraryId: 'library-1', resourceId: 'resource-1' },
      locator: { sourceId: 'source-1', providerLocator: 'opaque-provider-locator' },
      legacyLocator: 'Media/clip.mp4',
      version: 'provider-version',
      name: 'clip.mp4',
      kind: 'file',
      presentation: 'image',
      mimeType: 'image/jpeg',
      providerOperations: ['read'],
      availability: 'present',
    }

    expect(resourceForFileItem(file({ resource }))).toBe(resource)
  })

  test('characterizes legacy folder, playback, and viewer plans', () => {
    const folder = file({
      name: 'Album',
      path: 'Media/Album',
      type: MediaType.FOLDER,
      extension: '',
      isDirectory: true,
    })
    const video = file()
    const text = file({
      name: 'notes.md',
      path: 'Media/notes.md',
      type: MediaType.TEXT,
      extension: 'md',
    })

    expect(
      openResource(resourceForFileItem(folder), 'default', {
        surface: 'library',
        scope: OWNER_OPEN_SCOPE,
      }),
    ).toMatchObject({ kind: 'browse' })
    expect(
      openResource(resourceForFileItem(video), 'default', {
        surface: 'library',
        scope: OWNER_OPEN_SCOPE,
      }),
    ).toMatchObject({ kind: 'playback', media: 'video' })
    expect(
      openResource(resourceForFileItem(text), 'default', {
        surface: 'library',
        scope: OWNER_OPEN_SCOPE,
      }),
    ).toMatchObject({ kind: 'viewer', viewer: { id: 'text-viewer' } })
  })

  test('does not turn legacy numeric mtime into opaque ResourceVersion', () => {
    const resource = resourceForFileItem(file({ version: 1_723_456_789 }))
    expect(resource.version).toBeUndefined()
  })

  test('derives stable public Grant scope from path without retaining path or token', () => {
    const first = grantOpenScope('Shared\\Family')
    const second = grantOpenScope('/Shared/Family/')

    expect(first).toEqual(second)
    expect(first.kind).toBe('grant')
    expect(first.id).not.toContain('Shared')
    expect(first.id).not.toContain('token')
  })

  test('accepts semantic hints only for legacy provider projections', () => {
    const resource = resourceForFileItem(
      file({
        name: 'Session',
        path: 'Hermes Sessions/session/one',
        type: MediaType.OTHER,
        extension: '',
        isVirtual: true,
      }),
      {
        kind: 'conversation',
        presentation: 'conversation',
        providerOperations: ['read'],
        openTarget: { type: 'hermesSession', sessionId: 'one', readOnly: true },
      },
    )

    expect(
      openResource(resource, 'default', {
        surface: 'workspace',
        scope: OWNER_OPEN_SCOPE,
      }),
    ).toMatchObject({
      kind: 'conversation',
      target: { type: 'hermesSession', sessionId: 'one', readOnly: true },
    })
  })
})
