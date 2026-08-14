import { describe, expect, test } from 'bun:test'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import {
  createRendererRegistry,
  type RendererDescriptor,
} from '@/src/features/open/renderer-registry'
import {
  FILESYSTEM_RENDERER_ID,
  filesystemRendererDescriptors,
} from '@/src/integrations/filesystem/renderers'

function resource(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    key: resourceKey('fixture', 'item'),
    name: 'item',
    kind: 'file',
    capabilities: ['read', 'stream', 'download'],
    presentation: 'unsupported',
    ...overrides,
  }
}

describe('renderer registry', () => {
  const registry = createRendererRegistry(filesystemRendererDescriptors)
  const cases = [
    ['video/mp4', 'unsupported', 'default', FILESYSTEM_RENDERER_ID.video],
    ['audio/mpeg', 'unsupported', 'play', FILESYSTEM_RENDERER_ID.audio],
    ['image/jpeg', 'unsupported', 'view', FILESYSTEM_RENDERER_ID.image],
    ['text/markdown; charset=utf-8', 'unsupported', 'default', FILESYSTEM_RENDERER_ID.text],
    ['application/pdf', 'unsupported', 'read', FILESYSTEM_RENDERER_ID.pdf],
    ['application/epub+zip', 'unsupported', 'read', FILESYSTEM_RENDERER_ID.book],
    ['application/zip', 'book', 'default', FILESYSTEM_RENDERER_ID.book],
    [undefined, 'text', 'default', FILESYSTEM_RENDERER_ID.text],
    [undefined, 'unsupported', 'view', FILESYSTEM_RENDERER_ID.unsupported],
  ] as const

  for (const [mime, presentation, intent, expected] of cases) {
    test(`maps ${mime ?? presentation} to ${expected} for ${intent}`, () => {
      expect(registry.resolve(resource({ mime, presentation }), intent)?.id).toBe(expected)
    })
  }

  test('classifies ambiguous OGG MIME types by media prefix', () => {
    expect(
      registry.resolve(resource({ mime: 'video/ogg', presentation: 'audio' }), 'default')?.id,
    ).toBe(FILESYSTEM_RENDERER_ID.video)
    expect(registry.resolve(resource({ mime: 'audio/ogg' }), 'default')?.id).toBe(
      FILESYSTEM_RENDERER_ID.audio,
    )
  })

  test('matches kinds for Reader without inferring from resource id or name', () => {
    expect(
      registry.resolve(
        resource({ kind: 'folder', presentation: 'browse', mime: undefined }),
        'read',
      )?.id,
    ).toBe(FILESYSTEM_RENDERER_ID.folderReader)
    expect(
      registry.resolve(
        resource({
          name: 'movie.mp4',
          key: resourceKey('fixture', 'looks/like/movie.mp4'),
          mime: undefined,
          presentation: 'unsupported',
        }),
        'default',
      )?.id,
    ).toBe(FILESYSTEM_RENDERER_ID.unsupported)
  })

  test('does not invoke lazy factories during registration or lookup', async () => {
    let loads = 0
    const descriptor: RendererDescriptor = {
      id: 'fixture-renderer',
      rules: [{ type: 'kind', value: 'fixture-card', intents: ['default'] }],
      load: async () => {
        loads += 1
        return { kind: 'content', mount: () => null }
      },
    }
    const registry = createRendererRegistry([descriptor])

    expect(loads).toBe(0)
    expect(registry.resolve(resource({ kind: 'fixture-card' }), 'default')?.id).toBe(
      'fixture-renderer',
    )
    expect(loads).toBe(0)
    expect(await registry.load('fixture-renderer')).toMatchObject({ kind: 'content' })
    expect(loads).toBe(1)
  })

  test('rejects duplicate ids and supports open integration renderer ids', () => {
    const descriptor: RendererDescriptor = {
      id: 'fixture-renderer',
      rules: [{ type: 'presentation', value: 'fixture-card' }],
      load: async () => ({ kind: 'content', mount: () => null }),
    }
    expect(() => createRendererRegistry([descriptor, descriptor])).toThrow('Duplicate renderer id')
  })
})
