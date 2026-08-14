import { describe, expect, test } from 'bun:test'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import { createContentRegistry } from '@/src/features/content/registry'
import { createRegistryExplorerDataSource } from '@/src/features/explorer/registry-data-source'

describe('registry Explorer data source', () => {
  test('composes registered provider roots without host branches', async () => {
    const filesystemRoot: ResourceSummary = {
      key: resourceKey('filesystem', 'root'),
      name: 'Library',
      kind: 'root',
      capabilities: ['browse'],
      presentation: 'browse',
    }
    const fixtureRoot: ResourceSummary = {
      key: resourceKey('fixture', 'opaque-root'),
      name: 'Fixture',
      kind: 'root',
      capabilities: ['browse'],
      presentation: 'browse',
    }
    const registry = createContentRegistry([
      {
        id: 'filesystem',
        root: filesystemRoot,
        browse: {
          async browse() {
            return {
              schemaVersion: 1,
              location: filesystemRoot.key,
              locationSummary: filesystemRoot,
              items: [],
              total: 0,
            }
          },
        },
      },
      { id: 'fixture', root: fixtureRoot },
    ])
    const page = await createRegistryExplorerDataSource(registry).browse({
      location: { key: filesystemRoot.key },
      signal: new AbortController().signal,
      reason: 'initialize',
    })

    expect(page.items.map((item) => item.resource)).toEqual([fixtureRoot])
  })

  test('composes server-authoritative roots when static roots differ or are omitted', async () => {
    const staticFilesystemRoot: ResourceSummary = {
      key: resourceKey('filesystem', 'static-root'),
      name: 'Static library',
      kind: 'root',
      capabilities: ['browse'],
    }
    const serverFilesystemRoot: ResourceSummary = {
      ...staticFilesystemRoot,
      key: resourceKey('filesystem', 'server-root'),
      name: 'Server library',
    }
    const serverFixtureRoot: ResourceSummary = {
      key: resourceKey('fixture', 'server-fixture-root'),
      name: 'Server fixture',
      kind: 'root',
      capabilities: ['browse'],
    }
    const roots = new Map([
      ['filesystem', serverFilesystemRoot],
      ['fixture', serverFixtureRoot],
    ])
    const registry = createContentRegistry(
      [
        {
          id: 'filesystem',
          root: staticFilesystemRoot,
          browse: {
            async browse() {
              return {
                schemaVersion: 1,
                location: serverFilesystemRoot.key,
                locationSummary: serverFilesystemRoot,
                items: [],
                total: 0,
              }
            },
          },
        },
        { id: 'fixture' },
      ],
      { root: (id) => roots.get(id) ?? null },
    )

    const page = await createRegistryExplorerDataSource(registry).browse({
      location: { key: serverFilesystemRoot.key },
      signal: new AbortController().signal,
      reason: 'initialize',
    })

    expect(page.items.map((item) => item.resource)).toEqual([serverFixtureRoot])
  })

  test('maps provider browse metadata and arbitrary action descriptors', async () => {
    const root: ResourceSummary = {
      key: resourceKey('fixture', 'root'),
      name: 'Fixture root',
      kind: 'collection',
      capabilities: ['browse', 'fixture.create'],
      presentation: 'browse',
    }
    const child: ResourceSummary = {
      key: resourceKey('fixture', 'opaque/../item:1'),
      name: 'Item one',
      kind: 'fixture-item',
      capabilities: ['read', 'fixture.branch', 'fixture.remove'],
      presentation: 'text',
    }
    const recent: ResourceSummary = {
      ...child,
      key: resourceKey('fixture', 'recent'),
      name: 'Recent item',
      metadata: { modifiedAt: '2026-08-14T12:00:00Z' },
    }
    const calls: unknown[] = []
    const registry = createContentRegistry([
      {
        id: 'fixture',
        browse: {
          async browse(request) {
            calls.push(request)
            return {
              schemaVersion: 1,
              location: root.key,
              locationSummary: root,
              breadcrumbs: [root],
              items: [child],
              recentItems: [recent],
              nextCursor: 'opaque-cursor',
              total: 2,
            }
          },
        },
        actions: {
          list(resource) {
            return resource.capabilities.flatMap((capability) => {
              if (!capability.startsWith('fixture.')) return []
              return [
                {
                  id: capability,
                  operation: capability.slice('fixture.'.length),
                  label: capability.slice('fixture.'.length),
                  capability,
                  interaction: 'immediate' as const,
                  ...(capability === 'fixture.remove' ? { dangerous: true } : {}),
                },
              ]
            })
          },
          async run(request) {
            calls.push(request)
            return { value: { accepted: request.actionId } }
          },
        },
      },
    ])
    const source = createRegistryExplorerDataSource(registry)
    const signal = new AbortController().signal
    const page = await source.browse({
      location: { key: root.key },
      cursor: 'start',
      pageSize: 25,
      signal,
      reason: 'initialize',
    })

    expect(calls[0]).toEqual({
      location: root.key,
      cursor: 'start',
      limit: 25,
      signal,
    })
    expect(page.locationItem?.resource).toEqual(root)
    expect(page.recentItems).toEqual([
      {
        item: expect.objectContaining({ resource: recent }),
        modifiedAt: '2026-08-14T12:00:00Z',
      },
    ])
    expect(page.actions).toEqual([
      {
        id: 'fixture.create',
        operation: 'create',
        label: 'create',
        capability: 'fixture.create',
        scope: 'location',
        interaction: 'immediate',
      },
    ])
    expect(page.items[0]).toMatchObject({
      resource: child,
      actions: [
        {
          id: 'fixture.branch',
          capability: 'fixture.branch',
          scope: 'resource',
        },
        {
          id: 'fixture.remove',
          capability: 'fixture.remove',
          scope: 'resource',
          destructive: true,
        },
      ],
    })
    expect(page.nextCursor).toBe('opaque-cursor')

    const receipt = await source.execute(
      {
        id: 'command-1',
        action: page.items[0]!.actions[0]!,
        item: page.items[0]!,
      },
      signal,
    )
    expect(receipt).toMatchObject({
      commandId: 'command-1',
      outcome: { value: { accepted: 'fixture.branch' } },
    })
  })

  test('core Explorer has no provider paths, raw virtual transport, or workspace imports', async () => {
    const files = [
      'src/features/explorer/types.ts',
      'src/features/explorer/controller.ts',
      'src/features/explorer/registry-data-source.ts',
      'src/features/explorer/ExplorerView.tsx',
    ]
    const source = (await Promise.all(files.map((file) => Bun.file(file).text()))).join('\n')
    expect(source).not.toMatch(
      /Hermes Sessions|hermesSession|\/api\/virtual-directory|@\/src\/workspace|@\/lib\/virtual-directory/,
    )
    expect(source).toContain('createExplorerController')
  })
})
