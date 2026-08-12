import { describe, expect, test } from 'bun:test'
import type { ResourceSummary } from '@/lib/resource'
import {
  builtInViewerRegistry,
  viewerMediaType,
  viewerPaneDescriptorForWindow,
  viewerReaderKind,
} from '@/src/lib/viewer-registry'
import { MediaType } from '@/lib/types'

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

  test('renderer dispatch follows descriptor IDs without path inference', () => {
    expect(viewerMediaType('image-viewer')).toBe(MediaType.IMAGE)
    expect(viewerMediaType('unsupported-file')).toBe(MediaType.OTHER)
    expect(viewerReaderKind('pdf-reader')).toBe('pdf')
    expect(viewerReaderKind('folder-reader')).toBe('folder')
  })

  test('selects the dynamically loaded Pane implementation from durable viewer state', () => {
    const explicit = viewerPaneDescriptorForWindow({
      viewerId: 'image-viewer',
      initialState: { viewing: 'Pictures/photo.bin' },
    })
    expect(explicit?.id).toBe('image-viewer')
    expect(typeof explicit?.pane).toBe('function')
    expect(explicit?.load).toBe(explicit?.pane)

    const text = viewerPaneDescriptorForWindow({
      viewerId: 'text-viewer',
      initialState: { viewing: 'Documents/photo.bin' },
    })
    expect(text?.pane).not.toBe(explicit?.pane)

    expect(
      viewerPaneDescriptorForWindow({
        initialState: { viewing: 'Documents/guide.pdf', readerKind: 'pdf' },
      })?.id,
    ).toBe('pdf-reader')
    expect(
      viewerPaneDescriptorForWindow({ initialState: { viewing: 'Music/track.mp3' } })?.id,
    ).toBe('audio-player')
    expect(builtInViewerRegistry.byId?.('conversation')?.role).toBe('conversation')
  })

  test('covers every ResourceKind before MIME fallbacks', () => {
    const browsable = ['library', 'source', 'folder', 'collection', 'conversationProject'] as const
    for (const kind of browsable) {
      expect(
        builtInViewerRegistry.lookup(
          resource({ kind, mimeType: 'image/png', presentation: 'image' }),
        ),
      ).toBeNull()
    }
    for (const kind of ['conversation', 'draft'] as const) {
      expect(
        builtInViewerRegistry.lookup(
          resource({ kind, mimeType: 'image/png', presentation: 'image' }),
        )?.id,
      ).toBe('conversation')
    }
    expect(
      builtInViewerRegistry.lookup(
        resource({ kind: 'file', mimeType: 'image/png', presentation: 'unsupported' }),
      )?.id,
    ).toBe('image-viewer')
  })

  test('covers every supported MIME family and read intent', () => {
    const cases = [
      ['video/mp4', 'video-player', null],
      ['video/ogg', 'video-player', null],
      ['application/ogg', 'video-player', null],
      ['audio/mpeg', 'audio-player', null],
      ['audio/ogg', 'audio-player', null],
      ['image/png', 'image-viewer', null],
      ['text/plain', 'text-viewer', null],
      ['application/json', 'text-viewer', null],
      ['application/xml', 'text-viewer', null],
      ['application/javascript', 'text-viewer', null],
      ['application/pdf', 'pdf-reader', 'pdf-reader'],
      ['application/epub+zip', 'book-reader', 'book-reader'],
      ['application/x-fictionbook+xml', 'book-reader', 'book-reader'],
    ] as const
    for (const [mimeType, defaultViewer, reader] of cases) {
      const input = resource({ mimeType, presentation: 'unsupported' })
      expect(builtInViewerRegistry.lookup(input)?.id).toBe(defaultViewer)
      expect(builtInViewerRegistry.lookup(input, 'read')?.id ?? null).toBe(reader)
    }
  })
})
