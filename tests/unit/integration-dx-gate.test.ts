import { describe, expect, test } from 'bun:test'
import { isContentInstance, type ContentInstance } from '@/lib/domain/content'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import { defineIntegrationModule } from '@/src/features/content/contracts'
import { createContentRegistry } from '@/src/features/content/registry'
import { createContentRuntime } from '@/src/features/content/runtime'
import type { PlaybackItem } from '@/src/features/playback'
import { createSearchCoordinator } from '@/src/features/search/coordinator'
import { createIntegrationAvailability } from '@/src/integrations/availability'

const fixtureRootKey = resourceKey('fixture', 'root')
const fixtureItem: ResourceSummary = {
  key: resourceKey('fixture', 'item-1'),
  name: 'Fixture item',
  kind: 'fixture-item',
  mime: 'application/x-fixture',
  capabilities: ['read', 'fixture.open'],
}
const fixtureContent: ContentInstance = {
  id: 'fixture-window',
  type: 'resource',
  resource: fixtureItem.key,
  renderer: 'fixture.renderer',
}
const fixturePlaybackItem: PlaybackItem = {
  resource: fixtureItem.key,
  name: fixtureItem.name,
  media: 'audio',
}
const FixturePlaybackLifecycle = () => null

function fixtureIntegration() {
  return defineIntegrationModule({
    id: 'fixture',
    name: 'Fixture',
    root: {
      key: fixtureRootKey,
      name: 'Fixture root',
      kind: 'fixture-root',
      capabilities: ['browse'],
    },
    browse: {
      browse: async ({ location }) => ({
        schemaVersion: 1 as const,
        location,
        breadcrumbs: [],
        items: [fixtureItem],
        total: 1,
      }),
    },
    inspect: { inspect: async () => fixtureItem },
    playback: {
      createItem: (resource) =>
        resource.key.provider === 'fixture'
          ? { resource: resource.key, name: resource.name, media: 'audio' as const }
          : null,
      createQueue: (resources) =>
        resources.map((resource) => ({
          resource: resource.key,
          name: resource.name,
          media: 'audio' as const,
        })),
      resolveSource: ({ item }) => ({
        kind: 'resolved' as const,
        url: `fixture-media:${item.resource.id}`,
      }),
      lifecycle: FixturePlaybackLifecycle,
    },
    actions: {
      list: () => [
        {
          id: 'fixture.open',
          operation: 'open',
          label: 'Open',
          capability: 'fixture.open',
          interaction: 'immediate' as const,
        },
      ],
      run: async () => ({ content: fixtureContent }),
    },
    search: [
      {
        id: 'fixture.search',
        label: 'Fixture',
        search: async () => ({
          results: [{ id: 'fixture:item-1', title: fixtureItem.name, resource: fixtureItem }],
        }),
      },
    ],
    content: [
      {
        id: 'fixture.renderer',
        rules: [{ type: 'kind' as const, value: fixtureItem.kind }],
        matchesContent: (instance) =>
          instance.type === 'resource' && instance.renderer === 'fixture.renderer',
        load: async () => ({ kind: 'content' as const, mount: () => 'fallback renderer' }),
      },
    ],
    surface: {
      supports: (instance) =>
        instance.type === 'resource' && instance.renderer === 'fixture.renderer',
      load: async () => ({
        mount: ({ instance }) => `fixture surface:${instance().id}`,
      }),
    },
    codecs: [
      {
        id: 'fixture.codec',
        version: 1,
        supports: (instance) =>
          instance.type === 'resource' && instance.renderer === 'fixture.renderer',
        encode: (instance) => instance,
        decode: (value) =>
          isContentInstance(value)
            ? ({ ok: true, instance: value } as const)
            : ({ ok: false, reason: 'Invalid fixture content', recoverable: value } as const),
      },
    ],
  })
}

describe('frontend integration DX gate', () => {
  test('one module registration reaches availability, resources, search, codec, surface, and playback', async () => {
    const availability = createIntegrationAvailability()
    const module = fixtureIntegration()
    const registry = createContentRegistry([module], {
      enabled: availability.isEnabled,
      root: availability.root,
    })
    const runtime = createContentRuntime(registry)

    expect(registry.module('fixture')).toBe(module)
    expect(registry.roots()).toEqual([])
    expect(registry.browse(fixtureRootKey)).toBeNull()
    expect(registry.inspect(fixtureItem.key)).toBeNull()
    expect(registry.actions(fixtureItem)).toBeNull()
    expect(registry.playbackItem(fixtureItem)).toBeNull()
    expect(registry.searches()).toEqual([])

    availability.replace([
      {
        id: 'fixture',
        name: 'Fixture server',
        capabilities: ['browse', 'inspect', 'actions', 'search'],
        root: {
          key: fixtureRootKey,
          name: 'Fixture server root',
          kind: 'fixture-root',
          capabilities: ['browse'],
        },
      },
    ])

    expect(registry.roots()).toEqual([
      expect.objectContaining({ key: fixtureRootKey, name: 'Fixture server root' }),
    ])
    expect(
      (await registry.browse(fixtureRootKey)!.browse({ location: fixtureRootKey })).items,
    ).toEqual([fixtureItem])
    expect(await registry.inspect(fixtureItem.key)!.inspect(fixtureItem.key)).toEqual(fixtureItem)
    expect(
      registry
        .actions(fixtureItem)!
        .list(fixtureItem)
        .map((action) => action.id),
    ).toEqual(['fixture.open'])
    expect(registry.rendererRegistry.resolve(fixtureItem, 'default')?.id).toBe('fixture.renderer')
    expect(
      await registry.actions(fixtureItem)!.run({
        actionId: 'fixture.open',
        resource: fixtureItem,
      }),
    ).toEqual({ content: fixtureContent })

    expect(registry.playbackItem(fixtureItem)).toEqual(fixturePlaybackItem)
    expect(
      registry.playbackQueue(
        [
          fixtureItem,
          {
            ...fixtureItem,
            key: resourceKey('other-provider', 'foreign-item'),
          },
        ],
        fixturePlaybackItem,
      ),
    ).toEqual([fixturePlaybackItem])
    expect(
      await registry.resolvePlaybackSource({
        item: fixturePlaybackItem,
        mode: 'audio',
        reason: 'load',
        signal: new AbortController().signal,
      }),
    ).toEqual({ kind: 'resolved', url: 'fixture-media:item-1' })
    expect(registry.playbackLifecycles()).toEqual([FixturePlaybackLifecycle])
    expect(
      await registry.resolvePlaybackSource({
        item: {
          ...fixturePlaybackItem,
          resource: resourceKey('unregistered', 'item-1'),
        },
        mode: 'audio',
        reason: 'load',
        signal: new AbortController().signal,
      }),
    ).toEqual({
      kind: 'error',
      message: 'No playback contribution registered for provider: unregistered',
    })

    const search = createSearchCoordinator(() => registry.searches())
    expect((await search.search({ query: 'fixture', limit: 10 })).results).toEqual([
      expect.objectContaining({ resource: fixtureItem, contributorId: 'fixture.search' }),
    ])

    const envelope = registry.encode(fixtureContent)
    expect(envelope.codec).toBe('fixture.codec')
    expect(registry.decode(envelope)).toEqual({ ok: true, instance: fixtureContent })

    const mounted = await runtime.mount(fixtureContent, { replace: () => {} })
    expect(mounted).toMatchObject({
      ok: true,
      instance: fixtureContent,
      renderer: 'fixture.renderer',
    })
    if (!mounted.ok) throw new Error('expected fixture content to mount')
    expect(mounted.render()).toBe('fixture surface:fixture-window')
  })

  test('layout hosts import generic composition, not provider renderer, Explorer, or playback internals', async () => {
    const hostPaths = [
      'src/FileBrowser.tsx',
      'src/WorkspacePage.tsx',
      'src/CanvasPage.tsx',
      'src/workspace/WorkspaceBrowserPane.tsx',
      'src/workspace/workspace-page/WorkspacePageCanvas.tsx',
    ]
    const hosts = await Promise.all(
      hostPaths.map(async (path) => ({ path, source: await Bun.file(path).text() })),
    )
    const forbidden =
      /from\s+['"](?:@\/src\/|\.\/|\.\.\/)*(?:features\/explorer\/ExplorerView|integrations\/filesystem\/(?:FilesystemResourceViewerContent|content|renderers|playback|PlaybackSync))['"]/

    expect(hosts.filter(({ source }) => forbidden.test(source)).map(({ path }) => path)).toEqual([])

    const explorerProjection =
      /\b(?:createApplicationExplorerDataSource|registryExplorerItem|filesystemResourceToExplorerItem)\b/
    expect(
      hosts.filter(({ source }) => explorerProjection.test(source)).map(({ path }) => path),
    ).toEqual([])

    const providers = await Bun.file('src/AppProviders.tsx').text()
    expect(providers).not.toMatch(/integrations\/filesystem\/(?:playback|PlaybackSync)/)
  })
})
