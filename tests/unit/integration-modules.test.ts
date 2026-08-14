import { describe, expect, test } from 'bun:test'
import {
  FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID,
  filesystemResourceAddress,
  filesystemResourceKey,
  resourceKey,
  type ResourcePage,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { createContentRegistry } from '@/src/features/content/registry'
import { defineIntegrationModule } from '@/src/features/content/contracts'
import {
  createFilesystemIntegrationModule,
  type FilesystemIntegrationTransport,
} from '@/src/integrations/filesystem/module'
import {
  HERMES_CHAT_RENDERER_ID,
  createHermesIntegrationModule,
  hermesResourceAddress,
  hermesResourceKey,
  type HermesIntegrationTransport,
} from '@/src/integrations/hermes/module'
import { createHermesChatRendererModule } from '@/src/integrations/hermes/renderer'
import type { HermesChatPaneProps } from '@/src/integrations/hermes/HermesChatPane'
import {
  canMoveApplicationResource,
  explorerLocationFromQuery,
  explorerLocationQuery,
} from '@/src/integrations/explorer-adapter'

function filesystemPage(location: ReturnType<typeof filesystemResourceKey>): ResourcePage {
  return {
    schemaVersion: 1,
    location,
    locationSummary: {
      key: location,
      name: 'Docs',
      kind: 'folder',
      capabilities: ['browse', 'filesystem.create'],
      presentation: 'browse',
    },
    breadcrumbs: [],
    items: [
      {
        key: filesystemResourceKey('media', 'Docs/notes.md'),
        name: 'notes.md',
        kind: 'file',
        capabilities: ['read', 'filesystem.rename', 'filesystem.move', 'filesystem.delete'],
        presentation: 'text',
      },
    ],
    total: 1,
  }
}

describe('filesystem integration module', () => {
  test('uses typed resource browse, inspect, and action transport', async () => {
    const calls: unknown[] = []
    const signals: Array<AbortSignal | undefined> = []
    const transport: FilesystemIntegrationTransport = {
      browseResource: async (request) => {
        signals.push(request.signal)
        return filesystemPage(request.location)
      },
      inspectResource: async (key) => filesystemPage(key).locationSummary!,
      runResourceAction: async (key, action, input, signal) => {
        signals.push(signal)
        calls.push({ key, action, input })
        return { success: true, data: { message: 'done' } }
      },
    }
    const registry = createContentRegistry([createFilesystemIntegrationModule(transport)])
    const location = filesystemResourceKey('media', 'Docs')
    const abort = new AbortController()
    const page = await registry.browse(location)!.browse({ location, signal: abort.signal })

    expect(page.items).toHaveLength(1)
    expect(filesystemResourceAddress(page.items[0]!.key)).toEqual({
      rootId: 'media',
      path: 'Docs/notes.md',
    })
    expect(registry.presentation({ id: 'browser', type: 'explorer', location })).toMatchObject({
      title: 'Docs',
      icon: 'folder',
    })

    const file = page.items[0]!
    await registry.actions(file)!.run({
      actionId: 'filesystem.delete',
      resource: file,
      signal: abort.signal,
    })
    expect(calls).toEqual([
      {
        key: filesystemResourceKey('media', 'Docs/notes.md'),
        action: 'filesystem.delete',
        input: undefined,
      },
    ])
    expect(signals).toEqual([abort.signal, abort.signal])
  })

  test('keeps destination identity typed until filesystem transport boundary', async () => {
    const calls: unknown[] = []
    const transport: FilesystemIntegrationTransport = {
      browseResource: async (request) => filesystemPage(request.location),
      inspectResource: async (key) => filesystemPage(key).locationSummary!,
      runResourceAction: async (key, action, input) => {
        calls.push({ key, action, input })
        return { success: true }
      },
    }
    const registry = createContentRegistry([createFilesystemIntegrationModule(transport)])
    const file: ResourceSummary = {
      key: filesystemResourceKey('media', 'Docs/notes.md'),
      name: 'notes.md',
      kind: 'file',
      capabilities: ['filesystem.rename', 'filesystem.move', 'filesystem.copy'],
    }

    await registry.actions(file)!.run({
      actionId: 'filesystem.rename',
      resource: file,
      input: { name: 'renamed.md' },
    })
    await registry.actions(file)!.run({
      actionId: 'filesystem.move',
      resource: file,
      input: { destination: filesystemResourceKey('archive', 'Incoming') },
    })
    await registry.actions(file)!.run({
      actionId: 'filesystem.copy',
      resource: file,
      input: { destination: 'Archive' },
    })
    expect(calls).toEqual([
      {
        key: file.key,
        action: 'filesystem.rename',
        input: { name: 'renamed.md' },
      },
      {
        key: file.key,
        action: 'filesystem.move',
        input: {
          destination: filesystemResourceKey('archive', 'Incoming'),
        },
      },
      {
        key: file.key,
        action: 'filesystem.copy',
        input: {
          destination: filesystemResourceKey('configured-default', 'Archive'),
        },
      },
    ])
  })

  test('rejects virtual and foreign move destinations before transport', async () => {
    const calls: unknown[] = []
    const transport: FilesystemIntegrationTransport = {
      browseResource: async (request) => filesystemPage(request.location),
      inspectResource: async (key) => filesystemPage(key).locationSummary!,
      runResourceAction: async (key, action, input) => {
        calls.push({ key, action, input })
        return { success: true }
      },
    }
    const registry = createContentRegistry([createFilesystemIntegrationModule(transport)])
    const file: ResourceSummary = {
      key: filesystemResourceKey('media', 'Docs/notes.md'),
      name: 'notes.md',
      kind: 'file',
      capabilities: ['filesystem.move'],
    }
    const action = registry.actions(file)!

    const virtual = await action.run({
      actionId: 'filesystem.move',
      resource: file,
      input: {
        destination: filesystemResourceKey(FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID, 'favorites'),
      },
    })
    const foreign = await action.run({
      actionId: 'filesystem.move',
      resource: file,
      input: { destination: resourceKey('fixture', 'folder') },
    })

    expect(virtual).toMatchObject({ schemaVersion: 1, code: 'badRequest' })
    expect(foreign).toMatchObject({ schemaVersion: 1, code: 'badRequest' })
    expect(calls).toEqual([])
  })
})

describe('canonical integration URL identity', () => {
  test('reads and writes only provider/resource query fields', () => {
    const expected = hermesResourceKey('project', 'project-1')
    const canonical = explorerLocationQuery(expected)
    expect(canonical).toEqual({ provider: 'hermes', resource: expected.id })
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(canonical)) {
      if (value !== null) params.set(key, value)
    }
    expect(explorerLocationFromQuery(params).key).toEqual(expected)
  })
})

describe('application resource drag scope', () => {
  test('allows typed physical cross-root moves and rejects virtual or foreign destinations', () => {
    const source = filesystemResourceKey('media', 'Docs/notes.md')

    expect(canMoveApplicationResource(source, filesystemResourceKey('archive', 'Incoming'))).toBe(
      true,
    )
    expect(
      canMoveApplicationResource(
        source,
        filesystemResourceKey(FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID, 'favorites'),
      ),
    ).toBe(false)
    expect(canMoveApplicationResource(source, resourceKey('fixture', 'folder'))).toBe(false)
  })
})

describe('integration authoring seam', () => {
  test('one fixture module contributes browse, inspect, actions, search, and content', async () => {
    const rootKey = resourceKey('fixture', 'root')
    const item: ResourceSummary = {
      key: resourceKey('fixture', 'item-1'),
      name: 'Fixture item',
      kind: 'fixture-item',
      capabilities: ['read', 'fixture.open'],
    }
    const module = defineIntegrationModule({
      id: 'fixture',
      root: {
        key: rootKey,
        name: 'Fixture',
        kind: 'fixture-root',
        capabilities: ['browse'],
      },
      browse: {
        browse: async ({ location }) => ({
          schemaVersion: 1 as const,
          location,
          breadcrumbs: [],
          items: [item],
          total: 1,
        }),
      },
      inspect: { inspect: async () => item },
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
        run: async () => ({
          content: {
            id: 'fixture-window',
            type: 'resource' as const,
            resource: item.key,
            renderer: 'fixture-renderer',
          },
        }),
      },
      search: [
        {
          id: 'fixture.search',
          label: 'Fixture',
          search: async () => ({
            results: [{ id: 'fixture:item-1', title: item.name, resource: item }],
          }),
        },
      ],
      content: [
        {
          id: 'fixture-renderer',
          rules: [{ type: 'kind' as const, value: 'fixture-item' }],
          load: async () => ({ kind: 'content' as const, mount: () => null }),
        },
      ],
    })
    const registry = createContentRegistry([module])

    expect((await registry.browse(rootKey)!.browse({ location: rootKey })).items).toEqual([item])
    expect(await registry.inspect(item.key)!.inspect(item.key)).toEqual(item)
    expect(
      registry
        .actions(item)!
        .list(item)
        .map((action) => action.id),
    ).toEqual(['fixture.open'])
    expect(await registry.actions(item)!.run({ actionId: 'fixture.open', resource: item })).toEqual(
      {
        content: {
          id: 'fixture-window',
          type: 'resource',
          resource: item.key,
          renderer: 'fixture-renderer',
        },
      },
    )
    expect(
      (await registry.searches()[0]!.search({ query: 'fix', limit: 10 })).results[0]?.resource,
    ).toEqual(item)
    expect(registry.rendererRegistry.resolve(item, 'default')?.id).toBe('fixture-renderer')
  })
})

function hermesTransport(
  overrides: Partial<HermesIntegrationTransport> = {},
): HermesIntegrationTransport {
  const root = hermesResourceKey('root')
  const session: ResourceSummary = {
    key: hermesResourceKey('session', 'session-1'),
    name: 'Session one',
    kind: 'hermes-session',
    capabilities: ['read', 'hermes.open', 'hermes.archive', 'hermes.branch'],
    presentation: 'hermes-session',
  }
  return {
    browseResource: async (request) => ({
      schemaVersion: 1,
      location: request.location,
      locationSummary: {
        key: root,
        name: 'Hermes Sessions',
        kind: 'hermes-root',
        capabilities: ['browse', 'hermes.createFile'],
        presentation: 'browse',
      },
      breadcrumbs: [],
      items: [session],
      total: 1,
    }),
    inspectResource: async () => session,
    runResourceAction: async () => ({ success: true }),
    ...overrides,
  }
}

describe('Hermes integration module', () => {
  test('uses opaque ResourceKey browse and action transport', async () => {
    const calls: unknown[] = []
    const transport = hermesTransport({
      runResourceAction: async (key, action, input) => {
        calls.push({ key, action, input })
        return { success: true }
      },
    })
    const registry = createContentRegistry([createHermesIntegrationModule(transport)])
    const location = hermesResourceKey('root')
    const page = await registry.browse(location)!.browse({ location })
    const session = page.items[0]!

    expect(hermesResourceAddress(session.key)).toEqual({ kind: 'session', id: 'session-1' })
    expect(session.key.id).not.toContain('/')
    await registry.actions(session)!.run({ actionId: 'hermes.archive', resource: session })
    expect(calls).toEqual([
      {
        key: hermesResourceKey('session', 'session-1'),
        action: 'hermes.archive',
        input: undefined,
      },
    ])
    expect(JSON.stringify(calls)).not.toContain('/session/')
  })

  test('round-trips canonical chat, Explorer, and searched session content', () => {
    const registry = createContentRegistry([createHermesIntegrationModule(hermesTransport())])
    const chat = {
      id: 'chat-window',
      type: 'integration' as const,
      integration: 'hermes',
      view: 'chat',
      state: { sessionId: 'session-1', cwd: '/work', readOnly: true, title: 'Session one' },
    }
    const explorer = {
      id: 'explorer-window',
      type: 'explorer' as const,
      location: hermesResourceKey('project', 'project-1'),
    }
    const searchedSession = {
      id: 'searched-session',
      type: 'resource' as const,
      resource: hermesResourceKey('session', 'session-2'),
      renderer: HERMES_CHAT_RENDERER_ID,
    }

    for (const instance of [chat, explorer, searchedSession]) {
      const envelope = registry.encode(instance)
      expect(registry.decode(envelope)).toEqual({ ok: true, instance })
      expect(JSON.stringify(envelope)).not.toContain('/session/')
    }
    expect(() =>
      registry.encode({
        id: 'draft-window',
        type: 'integration',
        integration: 'hermes',
        view: 'chat',
        state: { draftId: 'draft-1' },
      }),
    ).toThrow('Hermes drafts are runtime-only')
  })

  test('creates one stable draft identity from typed action outcome', async () => {
    let draftIds = 0
    const registry = createContentRegistry([
      createHermesIntegrationModule(
        hermesTransport({
          runResourceAction: async () => ({
            success: true,
            openTarget: {
              kind: 'hermes-draft',
              readOnly: false,
              payload: { projectPath: '/work' },
            },
          }),
        }),
        {
          createDraftId: () => {
            draftIds += 1
            return 'draft-1'
          },
        },
      ),
    ])
    const root: ResourceSummary = {
      key: hermesResourceKey('root'),
      name: 'Hermes Sessions',
      kind: 'hermes-root',
      capabilities: ['browse', 'hermes.createFile'],
      presentation: 'browse',
    }

    expect(
      await registry.actions(root)!.run({ actionId: 'hermes.createFile', resource: root }),
    ).toEqual({
      content: {
        id: 'hermes-draft-draft-1',
        type: 'integration',
        integration: 'hermes',
        view: 'chat',
        state: { draftId: 'draft-1', cwd: '/work', readOnly: false },
      },
    })
    expect(draftIds).toBe(1)
  })

  test('adapts chat callbacks and searched ResourceKey without fake locators', () => {
    let props: HermesChatPaneProps | undefined
    const replacements: unknown[] = []
    const opened: unknown[] = []
    const instance = {
      id: 'search-session',
      type: 'resource' as const,
      resource: hermesResourceKey('session', 'session-7'),
      renderer: HERMES_CHAT_RENDERER_ID,
    }
    const renderer = createHermesChatRendererModule({
      HermesChatPane: (value: HermesChatPaneProps) => {
        props = value
        return null
      },
    })
    if (renderer.kind !== 'content') throw new Error('expected content renderer')
    renderer.mount({
      instance: () => instance,
      active: () => true,
      replace: (next) => replacements.push(next),
      open: (next) => opened.push(next),
    })

    expect(props?.content()).toEqual({ sessionId: 'session-7' })
    props?.onTitleChanged?.('Found session')
    props?.onBranchCreated?.('session-8', 'Branch')
    expect(JSON.stringify([replacements, opened])).not.toContain('/session/')
  })

  test('registers presentation and lazy renderer without core branches', async () => {
    let loads = 0
    const module = createHermesIntegrationModule(hermesTransport(), {
      loadChat: async () => {
        loads += 1
        return { HermesChatPane: () => null }
      },
    })
    const registry = createContentRegistry([module])
    const resource: ResourceSummary = {
      key: hermesResourceKey('session', 'session-1'),
      name: 'Session one',
      kind: 'hermes-session',
      capabilities: ['read'],
      presentation: 'hermes-session',
    }
    const instance = {
      id: 'chat-1',
      type: 'integration' as const,
      integration: 'hermes',
      view: 'chat',
      state: { sessionId: 'session-1', title: 'Session one' },
    }

    expect(registry.renderer(instance)?.id).toBe(HERMES_CHAT_RENDERER_ID)
    expect(registry.rendererRegistry.resolve(resource, 'default')?.id).toBe(HERMES_CHAT_RENDERER_ID)
    expect(registry.presentation(instance)).toMatchObject({ title: 'Session one' })
    expect(loads).toBe(0)
    await registry.rendererRegistry.load(HERMES_CHAT_RENDERER_ID)
    expect(loads).toBe(1)
    const core = await Bun.file('src/features/content/runtime.ts').text()
    expect(core).not.toMatch(/hermesSession|hermesDraft/)
    expect(resourceKey('fixture', 'opaque').provider).toBe('fixture')
  })
})
