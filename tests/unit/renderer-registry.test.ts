import { describe, expect, test } from 'bun:test'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import {
  BUILT_IN_RENDERER_ID,
  builtInRendererDescriptors,
  createRendererRegistry,
  type RendererDescriptor,
} from '@/src/features/open/renderer-registry'

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
  const registry = createRendererRegistry(builtInRendererDescriptors)
  const cases = [
    ['video/mp4', 'unsupported', 'default', BUILT_IN_RENDERER_ID.video],
    ['audio/mpeg', 'unsupported', 'play', BUILT_IN_RENDERER_ID.audio],
    ['image/jpeg', 'unsupported', 'view', BUILT_IN_RENDERER_ID.image],
    ['text/markdown; charset=utf-8', 'unsupported', 'default', BUILT_IN_RENDERER_ID.text],
    ['application/pdf', 'unsupported', 'read', BUILT_IN_RENDERER_ID.pdf],
    ['application/epub+zip', 'unsupported', 'read', BUILT_IN_RENDERER_ID.book],
    ['application/zip', 'book', 'default', BUILT_IN_RENDERER_ID.book],
    [undefined, 'text', 'default', BUILT_IN_RENDERER_ID.text],
    [undefined, 'unsupported', 'view', BUILT_IN_RENDERER_ID.unsupported],
  ] as const

  for (const [mime, presentation, intent, expected] of cases) {
    test(`maps ${mime ?? presentation} to ${expected} for ${intent}`, () => {
      expect(registry.resolve(resource({ mime, presentation }), intent)?.id).toBe(expected)
    })
  }

  test('keeps ambiguous OGG video-first compatibility', () => {
    expect(
      registry.resolve(resource({ mime: 'video/ogg', presentation: 'audio' }), 'default')?.id,
    ).toBe(BUILT_IN_RENDERER_ID.video)
    expect(registry.resolve(resource({ mime: 'audio/ogg' }), 'default')?.id).toBe(
      BUILT_IN_RENDERER_ID.audio,
    )
  })

  test('matches kinds for Reader without inferring from resource id or name', () => {
    expect(
      registry.resolve(
        resource({ kind: 'folder', presentation: 'browse', mime: undefined }),
        'read',
      )?.id,
    ).toBe(BUILT_IN_RENDERER_ID.folderReader)
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
    ).toBe(BUILT_IN_RENDERER_ID.unsupported)
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
