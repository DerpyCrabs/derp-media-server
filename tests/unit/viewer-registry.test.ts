import { describe, expect, test } from 'bun:test'
import type { ResourceSummary } from '@/lib/resource'
import { builtInViewerRegistry } from '@/src/lib/viewer-registry'

function resource(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    ref: { libraryId: 'library-1', resourceId: 'resource-1' },
    locator: { sourceId: 'source-1', providerLocator: 'item' },
    legacyLocator: 'item',
    name: 'item',
    kind: 'file',
    presentation: 'unsupported',
    providerOperations: ['read'],
    availability: 'present',
    ...overrides,
  }
}

describe('built-in ViewerRegistry', () => {
  const cases = [
    ['video/mp4', 'unsupported', 'video-player'],
    ['audio/mpeg', 'unsupported', 'audio-player'],
    ['image/jpeg', 'unsupported', 'image-viewer'],
    ['text/markdown; charset=utf-8', 'unsupported', 'text-viewer'],
    ['application/pdf', 'unsupported', 'pdf-reader'],
    ['application/epub+zip', 'unsupported', 'book-reader'],
    [undefined, 'text', 'text-viewer'],
    [undefined, 'unsupported', 'unsupported-file'],
  ] as const

  for (const [mimeType, presentation, expected] of cases) {
    test(`maps ${mimeType ?? presentation} to ${expected}`, () => {
      expect(builtInViewerRegistry.lookup(resource({ mimeType, presentation }))?.id).toBe(expected)
    })
  }

  test('keeps ambiguous OGG video-first compatibility', () => {
    expect(
      builtInViewerRegistry.lookup(resource({ mimeType: 'video/ogg', presentation: 'audio' }))?.id,
    ).toBe('video-player')
    expect(
      builtInViewerRegistry.lookup(resource({ mimeType: 'application/ogg', presentation: 'audio' }))
        ?.id,
    ).toBe('video-player')
    expect(builtInViewerRegistry.lookup(resource({ mimeType: 'audio/ogg' }))?.id).toBe(
      'audio-player',
    )
  })

  test('maps browsable and conversation kinds before file presentation', () => {
    expect(
      builtInViewerRegistry.lookup(resource({ kind: 'folder', presentation: 'image' })),
    ).toBeNull()
    expect(
      builtInViewerRegistry.lookup(resource({ kind: 'folder', presentation: 'browse' }), 'read')
        ?.id,
    ).toBe('folder-reader')
    expect(
      builtInViewerRegistry.lookup(resource({ kind: 'conversation', presentation: 'unsupported' }))
        ?.id,
    ).toBe('conversation')
  })

  test('read intent only selects supported reader implementations', () => {
    expect(
      builtInViewerRegistry.lookup(resource({ mimeType: 'application/pdf' }), 'read')?.id,
    ).toBe('pdf-reader')
    expect(builtInViewerRegistry.lookup(resource({ mimeType: 'image/png' }), 'read')).toBeNull()
  })
})
