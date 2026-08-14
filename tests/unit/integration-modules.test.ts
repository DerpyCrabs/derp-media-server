import { describe, expect, test } from 'bun:test'
import {
  filesystemResourceAddress,
  filesystemResourceKey,
  resourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { createContentRegistry } from '@/src/features/content/registry'
import {
  createFilesystemIntegrationModule,
  filesystemLegacyPathForResourceKey,
  type FilesystemIntegrationTransport,
} from '@/src/integrations/filesystem/module'
import {
  HERMES_CHAT_RENDERER_ID,
  adaptHermesLegacyEntryResource,
  createHermesIntegrationModule,
  hermesLegacyPathForResourceKey,
  hermesResourceAddress,
  hermesResourceKey,
  type HermesIntegrationTransport,
} from '@/src/integrations/hermes/module'
import { createHermesChatRendererModule } from '@/src/integrations/hermes/renderer'
import type { HermesChatPaneProps } from '@/src/integrations/hermes/HermesChatPane'

describe('filesystem integration module', () => {
  test('owns listing adaptation, actions, presentation, and versioned content codec', async () => {
    const calls: unknown[] = []
    const signals: Array<AbortSignal | undefined> = []
    const transport: FilesystemIntegrationTransport = {
      list: async (_path, _offset, signal) => {
        signals.push(signal)
        return {
          files: [
            {
              name: 'notes.md',
              path: 'Docs/notes.md',
              type: 'text',
              size: 8,
              extension: 'md',
              isDirectory: false,
            },
            {
              name: 'Hermes Sessions',
              path: 'Hermes Sessions',
              type: 'folder',
              size: 0,
              extension: '',
              isDirectory: true,
              isVirtual: true,
            },
          ],
        }
      },
      runAction: async (action, path, input, signal) => {
        signals.push(signal)
        calls.push({ action, path, input })
      },
      downloadUrl: (path) => `/download/${encodeURIComponent(path)}`,
    }
    const registry = createContentRegistry([
      createFilesystemIntegrationModule(transport, {
        adaptVirtual: adaptHermesLegacyEntryResource,
      }),
    ])
    const location = filesystemResourceKey('media', 'Docs')
    const abort = new AbortController()
    const page = await registry.browse(location)!.browse({ location, signal: abort.signal })

    expect(page.items).toHaveLength(2)
    expect(page.locationSummary).toMatchObject({ key: location, name: 'Docs', kind: 'folder' })
    expect(page.breadcrumbs?.map((item) => item.name)).toEqual(['Library', 'Docs'])
    expect(
      registry
        .actions(page.locationSummary!)
        ?.list(page.locationSummary!)
        .map((action) => action.id),
    ).toEqual([
      'filesystem.createFile',
      'filesystem.createFolder',
      'filesystem.upload',
      'filesystem.paste',
    ])
    expect(filesystemResourceAddress(page.items[0]!.key)).toEqual({
      rootId: 'media',
      path: 'Docs/notes.md',
    })
    expect(filesystemLegacyPathForResourceKey(page.items[0]!.key)).toBe('Docs/notes.md')
    expect(page.items[1]).toMatchObject({
      name: 'Hermes Sessions',
      kind: 'hermes-root',
      presentation: 'browse',
    })
    expect(page.items[1]!.key.provider).toBe('hermes')
    expect(page.items[1]!.key.id).not.toContain('Hermes Sessions')

    const instance = {
      id: 'browser-1',
      type: 'explorer' as const,
      location,
    }
    expect(registry.presentation(instance)).toMatchObject({ title: 'Docs', icon: 'folder' })
    expect(registry.decode(registry.encode(instance))).toEqual({ ok: true, instance })

    const viewer = {
      id: 'viewer-1',
      type: 'resource' as const,
      resource: filesystemResourceKey('media', 'Docs/notes.md'),
      renderer: 'text-viewer',
      context: location,
    }
    expect(registry.decode(registry.encode(viewer))).toEqual({ ok: true, instance: viewer })

    const file = page.items[0]!
    await registry.actions(file)!.run({
      actionId: 'filesystem.delete',
      resource: file,
      signal: abort.signal,
    })
    expect(calls).toEqual([{ action: 'delete', path: 'Docs/notes.md', input: undefined }])
    expect(signals).toEqual([abort.signal, abort.signal])
  })

  test('maps create file and folder descriptors to fixed legacy transport inputs', async () => {
    const calls: unknown[] = []
    const transport: FilesystemIntegrationTransport = {
      list: async () => ({ files: [] }),
      runAction: async (action, path, input) => calls.push({ action, path, input }),
      downloadUrl: () => '',
    }
    const registry = createContentRegistry([createFilesystemIntegrationModule(transport)])
    const folder: ResourceSummary = {
      key: filesystemResourceKey('media', 'Docs'),
      name: 'Docs',
      kind: 'folder',
      capabilities: ['browse', 'filesystem.create'],
      presentation: 'browse',
    }

    await registry.actions(folder)!.run({
      actionId: 'filesystem.createFile',
      resource: folder,
      input: { name: 'notes.md', type: 'folder' },
    })
    await registry.actions(folder)!.run({
      actionId: 'filesystem.createFolder',
      resource: folder,
      input: { name: 'Archive', type: 'file' },
    })
    const file: ResourceSummary = {
      key: filesystemResourceKey('media', 'Docs/notes.md'),
      name: 'notes.md',
      kind: 'file',
      capabilities: ['read', 'filesystem.rename', 'filesystem.move', 'filesystem.copy'],
    }
    await registry.actions(file)!.run({
      actionId: 'filesystem.rename',
      resource: file,
      input: { name: 'renamed.md' },
    })
    await registry.actions(file)!.run({
      actionId: 'filesystem.move',
      resource: file,
      input: { destination: 'Archive' },
    })
    await registry.actions(file)!.run({
      actionId: 'filesystem.copy',
      resource: file,
      input: { destination: 'Copies' },
    })
    expect(calls).toEqual([
      {
        action: 'create',
        path: 'Docs',
        input: { name: 'notes.md', type: 'file' },
      },
      {
        action: 'create',
        path: 'Docs',
        input: { name: 'Archive', type: 'folder' },
      },
      {
        action: 'rename',
        path: 'Docs/notes.md',
        input: { name: 'renamed.md', newPath: 'Docs/renamed.md' },
      },
      {
        action: 'rename',
        path: 'Docs/notes.md',
        input: {
          destination: 'Archive',
          destinationDir: 'Archive',
          newPath: 'Archive/notes.md',
        },
      },
      {
        action: 'copy',
        path: 'Docs/notes.md',
        input: { destination: 'Copies', destinationDir: 'Copies' },
      },
    ])
  })
})

describe('Hermes integration module', () => {
  test('keeps fake paths inside its legacy transport adapter and exposes opaque keys', async () => {
    const calls: unknown[] = []
    const transport: HermesIntegrationTransport = {
      list: async (path, offset) => {
        calls.push({ type: 'list', path, offset })
        return {
          files: [
            {
              name: 'Session one',
              path: 'Hermes Sessions/session/session-1',
              type: 'other',
              size: 0,
              extension: '',
              isDirectory: false,
              isVirtual: true,
            },
          ],
          virtualEntries: {
            'Hermes Sessions/session/session-1': {
              provider: 'hermes',
              kind: 'session',
              id: 'session-1',
              capabilities: ['open', 'archive', 'branch'],
              openTarget: { type: 'hermesSession', sessionId: 'session-1', readOnly: false },
              metadata: { status: 'idle' },
            },
          },
          virtualDirectory: {
            provider: 'hermes',
            kind: 'root',
            path: 'Hermes Sessions',
            capabilities: ['createFile'],
            offset: 0,
            pageSize: 200,
            total: 1,
          },
        }
      },
      runAction: async (action, path, input) => {
        calls.push({ type: 'action', action, path, input })
        return {}
      },
    }
    const registry = createContentRegistry([createHermesIntegrationModule(transport)])
    const location = hermesResourceKey('root')
    const page = await registry.browse(location)!.browse({ location })
    const session = page.items[0]!

    expect(calls[0]).toEqual({ type: 'list', path: 'Hermes Sessions', offset: 0 })
    expect(page.locationSummary).toMatchObject({ key: location, name: 'Hermes Sessions' })
    expect(page.locationSummary?.capabilities).toEqual(['browse', 'hermes.createFile'])
    expect(page.breadcrumbs?.map((item) => item.name)).toEqual(['Hermes Sessions'])
    expect(session.key.id).not.toContain('Hermes Sessions')
    expect(hermesResourceAddress(session.key)).toEqual({ kind: 'session', id: 'session-1' })
    expect(hermesLegacyPathForResourceKey(session.key)).toBe('Hermes Sessions/session/session-1')
    expect(session).toMatchObject({
      kind: 'hermes-session',
      presentation: 'hermes-session',
      capabilities: ['read', 'hermes.open', 'hermes.archive', 'hermes.branch'],
    })

    await registry.actions(session)!.run({ actionId: 'hermes.archive', resource: session })
    expect(calls[1]).toEqual({
      type: 'action',
      action: 'archive',
      path: 'Hermes Sessions/session/session-1',
      input: undefined,
    })
    await registry.actions(session)!.run({
      actionId: 'hermes.moveToProject',
      resource: { ...session, capabilities: [...session.capabilities, 'hermes.moveToProject'] },
      input: { destination: 'Project Alpha' },
    })
    expect(calls[2]).toEqual({
      type: 'action',
      action: 'moveToProject',
      path: 'Hermes Sessions/session/session-1',
      input: { destination: 'Project Alpha', name: 'Project Alpha' },
    })
  })

  test('round-trips canonical Hermes chat and Explorer content without fake paths or drafts', () => {
    const registry = createContentRegistry([
      createHermesIntegrationModule({
        list: async () => ({ files: [] }),
        runAction: async () => ({}),
      }),
    ])
    const codec = registry.codec('hermes.content')!
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

    const chatEnvelope = registry.encode(chat)
    const explorerEnvelope = registry.encode(explorer)
    expect(registry.decode(chatEnvelope)).toEqual({ ok: true, instance: chat })
    expect(registry.decode(explorerEnvelope)).toEqual({ ok: true, instance: explorer })
    expect(explorerEnvelope).toMatchObject({
      codec: 'hermes.content',
      payload: {
        kind: 'explorer',
        id: 'explorer-window',
        location: { provider: 'hermes' },
      },
    })
    expect(JSON.stringify([chatEnvelope, explorerEnvelope])).not.toContain('Hermes Sessions')

    expect(() =>
      registry.encode({
        id: 'draft-window',
        type: 'integration',
        integration: 'hermes',
        view: 'chat',
        state: { draftId: 'draft-1' },
      }),
    ).toThrow('Hermes drafts are runtime-only')

    expect(codec.decode({ id: 'legacy-window', type: 'hermes', hermes: {} }).ok).toBe(false)
  })

  test('uses one stable draft identity for action-created chat content', async () => {
    let draftIds = 0
    const registry = createContentRegistry([
      createHermesIntegrationModule(
        {
          list: async () => ({ files: [] }),
          runAction: async () => ({
            openTarget: { type: 'hermesDraft', projectPath: '/work', readOnly: false },
          }),
        },
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

  test('adapts chat replacement and branch opening to neutral runtime callbacks', () => {
    let props: HermesChatPaneProps | undefined
    const replacements: unknown[] = []
    const opened: unknown[] = []
    const instance = {
      id: 'chat-window',
      type: 'integration' as const,
      integration: 'hermes',
      view: 'chat',
      state: { draftId: 'draft-1', title: 'New Hermes session' },
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

    props?.onSessionCreated?.('session-1')
    props?.onBranchCreated?.('session-2', 'Branch')

    expect(replacements).toEqual([
      {
        ...instance,
        state: { sessionId: 'session-1', title: 'Hermes session' },
      },
    ])
    expect(opened).toEqual([
      {
        id: 'hermes-session-2',
        type: 'integration',
        integration: 'hermes',
        view: 'chat',
        state: { sessionId: 'session-2', title: 'Branch' },
      },
    ])
  })

  test('registers presentation, actions, and lazy chat renderer without core path inference', async () => {
    let loads = 0
    const module = createHermesIntegrationModule(
      {
        list: async () => ({ files: [] }),
        runAction: async () => ({}),
      },
      {
        loadChat: async () => {
          loads += 1
          return { HermesChatPane: () => null }
        },
      },
    )
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
    expect(registry.presentation(instance)).toMatchObject({
      title: 'Session one',
      icon: 'agent-session',
    })
    expect(loads).toBe(0)
    await registry.rendererRegistry.load(HERMES_CHAT_RENDERER_ID)
    expect(loads).toBe(1)

    const core = await Bun.file('src/features/content/runtime.ts').text()
    expect(core).not.toMatch(/Hermes Sessions|hermesSession|hermesDraft/)
    expect(resourceKey('fixture', 'opaque').provider).toBe('fixture')
  })
})
