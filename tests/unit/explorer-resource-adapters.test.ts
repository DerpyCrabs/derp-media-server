import { describe, expect, test } from 'bun:test'

import {
  ExplorerAdapterError,
  type ExplorerCommand,
  type ExplorerItem,
  type ExplorerResourceAdapter,
} from '@/lib/explorer-model'
import { MediaType, type FileItem } from '@/lib/types'
import type { DirectoryListing } from '@/lib/virtual-directory'
import { createFallbackResourceAdapter } from '@/src/lib/resource-adapters/fallback'
import { createGrantExplorerAdapter } from '@/src/lib/resource-adapters/grant'
import { createOfflineResourceAdapter } from '@/src/lib/resource-adapters/offline'
import { createOwnerExplorerAdapter } from '@/src/lib/resource-adapters/owner'
import type { ExplorerFetch } from '@/src/lib/resource-adapters/shared'
import type { StoredOfflineEntry } from '@/src/lib/web-offline-storage'

type FetchCall = Readonly<{ url: string; init: RequestInit }>

function file(path: string, directory = false, extra: Partial<FileItem> = {}): FileItem {
  const name = path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path
  return {
    name,
    path,
    type: directory ? MediaType.FOLDER : MediaType.TEXT,
    size: directory ? 0 : 12,
    extension: directory ? '' : (name.split('.').at(-1) ?? ''),
    isDirectory: directory,
    ...extra,
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function recordingFetch(
  listing: DirectoryListing | ((url: string) => DirectoryListing),
): Readonly<{ calls: FetchCall[]; fetch: ExplorerFetch }> {
  const calls: FetchCall[] = []
  return {
    calls,
    fetch: async (input, init = {}) => {
      const url = requestUrl(input)
      calls.push({ url, init })
      if ((init.method ?? 'GET') === 'GET') {
        return response(typeof listing === 'function' ? listing(url) : listing)
      }
      return response({ receipt: { commandId: `command-${calls.length}` } })
    },
  }
}

function jsonBody(call: FetchCall): Record<string, unknown> {
  if (typeof call.init.body !== 'string') throw new Error('Expected JSON request body')
  return JSON.parse(call.init.body) as Record<string, unknown>
}

function signal(): AbortSignal {
  return new AbortController().signal
}

async function adapterError(action: () => Promise<unknown>): Promise<ExplorerAdapterError> {
  try {
    await action()
  } catch (error) {
    if (error instanceof ExplorerAdapterError) return error
    throw error
  }
  throw new Error('Expected ExplorerAdapterError')
}

describe('Explorer resource Adapter conformance', () => {
  test('owner, Grant, and offline expose one readable-item contract', async () => {
    const stored: StoredOfflineEntry = {
      path: 'Vault/song.mp3',
      name: 'song.mp3',
      type: MediaType.AUDIO,
      size: 12,
      extension: 'mp3',
      isDirectory: false,
      blob: new Blob(['audio']),
    }
    const fixtures: ReadonlyArray<{
      kind: 'owner' | 'grant' | 'offline'
      adapter: ExplorerResourceAdapter
      path: string
    }> = [
      {
        kind: 'owner',
        adapter: createOwnerExplorerAdapter({
          editableRoots: ['Vault'],
          fetch: recordingFetch({ files: [file('Vault/song.mp3')] }).fetch,
        }),
        path: 'Vault',
      },
      {
        kind: 'grant',
        adapter: createGrantExplorerAdapter({
          token: 'contract-grant',
          rootPath: 'Vault',
          editable: false,
          fetch: recordingFetch({ files: [file('Vault/song.mp3')] }).fetch,
        }),
        path: '',
      },
      {
        kind: 'offline',
        adapter: createOfflineResourceAdapter({
          catalog: {
            read: async () => [stored],
            remove: async () => undefined,
          },
        }),
        path: 'Vault',
      },
    ]

    for (const fixture of fixtures) {
      const page = await fixture.adapter.browse({ path: fixture.path, pageSize: 50 }, signal())
      expect(fixture.adapter.scope.kind).toBe(fixture.kind)
      expect(page.total).toBe(1)
      expect(page.items[0]?.capabilities).toEqual(
        expect.arrayContaining(['open', 'read', 'download']),
      )
      expect(fixture.adapter.plan?.('download', page.items[0]!)?.kind).toBe('download')
      fixture.adapter.dispose?.()
    }
  })
})

describe('fallback Explorer resource Adapter', () => {
  function fallbackFixture() {
    let online = false
    const primary = createOwnerExplorerAdapter({
      fetch: async () => {
        if (!online) throw new TypeError('owner transport unavailable')
        return response({ files: [file('Cached/online.txt')] })
      },
    })
    const fallback = createOfflineResourceAdapter({
      catalog: {
        read: async () => [
          {
            path: 'Cached/local.txt',
            name: 'local.txt',
            type: MediaType.TEXT,
            size: 5,
            extension: 'txt',
            isDirectory: false,
          },
        ],
        remove: async () => undefined,
      },
    })
    const adapter = createFallbackResourceAdapter(primary, fallback, {
      isFallbackAvailable: (query, page) => page.items.length > 0 || query.path === 'Cached',
    })
    return { adapter, restore: () => (online = true) }
  }

  test('preserves primary network errors for paths absent from the offline catalog', async () => {
    const { adapter } = fallbackFixture()

    const error = await adapterError(() =>
      adapter.browse({ path: 'Unsaved', pageSize: 50 }, signal()),
    )

    expect(error.explorerError).toMatchObject({
      code: 'network',
      message: 'owner transport unavailable',
    })
    expect(adapter.isUsingFallback()).toBe(false)
  })

  test('uses a cached path and switches back after primary transport recovers', async () => {
    const { adapter, restore } = fallbackFixture()

    const cached = await adapter.browse({ path: 'Cached', pageSize: 50 }, signal())
    expect(cached.items.map((item) => item.file.name)).toEqual(['local.txt'])
    expect(adapter.isUsingFallback()).toBe(true)

    restore()
    const recovered = await adapter.browse({ path: 'Cached', pageSize: 50 }, signal())
    expect(recovered.items.map((item) => item.file.name)).toEqual(['online.txt'])
    expect(adapter.isUsingFallback()).toBe(false)
  })
})

describe('online Explorer resource adapters', () => {
  test('owner consumes matching hydrated listing once and refreshes through transport', async () => {
    const network = recordingFetch({ files: [file('Vault/from-network.txt')] })
    const adapter = createOwnerExplorerAdapter({
      editableRoots: ['Vault'],
      initialListing: {
        path: '/Vault/',
        listing: { files: [file('Vault/from-ssr.txt')] },
      },
      fetch: network.fetch,
    })

    const hydrated = await adapter.browse({ path: 'Vault', pageSize: 50 }, signal())
    expect(hydrated.items.map((item) => item.file.name)).toEqual(['from-ssr.txt'])
    expect(network.calls).toHaveLength(0)

    const refreshed = await adapter.browse({ path: 'Vault', pageSize: 50 }, signal())
    expect(refreshed.items.map((item) => item.file.name)).toEqual(['from-network.txt'])
    expect(network.calls).toHaveLength(1)
  })

  test('owner does not consume hydrated listing for another path', async () => {
    const network = recordingFetch({ files: [file('Other/from-network.txt')] })
    const adapter = createOwnerExplorerAdapter({
      editableRoots: ['Vault', 'Other'],
      initialListing: {
        path: 'Vault',
        listing: { files: [file('Vault/from-ssr.txt')] },
      },
      fetch: network.fetch,
    })

    const other = await adapter.browse({ path: 'Other', pageSize: 50 }, signal())
    expect(other.items.map((item) => item.file.name)).toEqual(['from-network.txt'])
    expect(network.calls).toHaveLength(1)

    const hydrated = await adapter.browse({ path: 'Vault', pageSize: 50 }, signal())
    expect(hydrated.items.map((item) => item.file.name)).toEqual(['from-ssr.txt'])
    expect(network.calls).toHaveLength(1)
  })

  test('Grant consumes its matching hydrated listing once', async () => {
    const network = recordingFetch({ files: [file('Vault/from-network.txt')] })
    const adapter = createGrantExplorerAdapter({
      token: 'grant-token',
      rootPath: 'Vault',
      editable: true,
      initialListing: {
        path: '',
        listing: { files: [file('Vault/from-ssr.txt')] },
      },
      fetch: network.fetch,
    })

    const hydrated = await adapter.browse({ path: '', pageSize: 50 }, signal())
    expect(hydrated.items.map((item) => item.file.name)).toEqual(['from-ssr.txt'])
    expect(network.calls).toHaveLength(0)

    const refreshed = await adapter.browse({ path: '', pageSize: 50 }, signal())
    expect(refreshed.items.map((item) => item.file.name)).toEqual(['from-network.txt'])
    expect(network.calls.map((call) => call.url)).toEqual(['/api/share/grant-token/files?dir='])
  })

  test('owner and Grant use one physical-resource command conformance matrix', async () => {
    const cases: ReadonlyArray<{
      name: string
      adapter(fetch: ExplorerFetch): ExplorerResourceAdapter
      routePrefix: string
      browsePath: string
      transported(path: string): string
      expectedRoutes: readonly string[]
      canShare: boolean
    }> = [
      {
        name: 'owner',
        adapter: (fetch) =>
          createOwnerExplorerAdapter({ editableRoots: ['Vault'], fetch, surface: 'library' }),
        routePrefix: '',
        browsePath: 'Vault',
        transported: (path) => path,
        expectedRoutes: [
          '/api/files/create',
          '/api/files/create',
          '/api/files/upload',
          '/api/files/edit',
          '/api/files/rename',
          '/api/files/rename',
          '/api/files/rename',
          '/api/files/copy',
          '/api/files/delete',
          '/api/stats/views',
        ],
        canShare: true,
      },
      {
        name: 'Grant',
        adapter: (fetch) =>
          createGrantExplorerAdapter({
            token: 'grant token',
            rootPath: 'Vault',
            editable: true,
            restrictions: { allowEdit: true, allowUpload: true, allowDelete: true },
            fetch,
          }),
        routePrefix: '/api/share/grant%20token',
        browsePath: 'Vault',
        transported: (path) => path.replace(/^Vault\/?/, ''),
        expectedRoutes: [
          '/api/share/grant%20token/create',
          '/api/share/grant%20token/create',
          '/api/share/grant%20token/upload',
          '/api/share/grant%20token/edit',
          '/api/share/grant%20token/rename',
          '/api/share/grant%20token/rename',
          '/api/share/grant%20token/rename',
          '/api/share/grant%20token/copy',
          '/api/share/grant%20token/delete',
          '/api/share/grant%20token/view',
        ],
        canShare: false,
      },
    ]

    for (const fixture of cases) {
      const transport = recordingFetch({ files: [file('Vault/song.mp3')] })
      const adapter = fixture.adapter(transport.fetch)
      const page = await adapter.browse({ path: fixture.browsePath, pageSize: 50 }, signal())
      const item = page.items[0]
      if (!item) throw new Error(`${fixture.name} fixture item missing`)

      expect(item.file.path).toBe('Vault/song.mp3')
      expect(item.capabilities).toEqual(expect.arrayContaining(['open', 'read', 'download']))
      expect(item.capabilities).toEqual(
        expect.arrayContaining(['replace', 'rename', 'move', 'copy', 'delete']),
      )
      expect(page.capabilities).toEqual(
        expect.arrayContaining(['createFile', 'createFolder', 'upload', 'move']),
      )
      expect(page.total).toBe(1)

      await adapter.prefetch?.({ path: 'Vault/folder', pageSize: 25 }, signal())

      const commands: ExplorerCommand[] = [
        {
          kind: 'createFile',
          parentPath: 'Vault/folder',
          name: 'new.bin',
          base64Content: 'AAEC',
        },
        { kind: 'createFolder', parentPath: 'Vault/folder', name: 'child' },
        {
          kind: 'upload',
          parentPath: 'Vault/folder',
          files: [new File(['upload'], 'upload.txt')],
        },
        { kind: 'replace', item, content: 'replacement', expectedVersion: 7 },
        { kind: 'rename', item, name: 'renamed.mp3' },
        { kind: 'move', item, destinationPath: 'Vault/destination' },
        { kind: 'moveExternal', source: item, destinationPath: 'Vault/external' },
        { kind: 'copy', item, destinationPath: 'Vault/copies' },
        { kind: 'delete', item },
        { kind: 'recordView', item },
      ]
      for (const command of commands) {
        const receipt = await adapter.execute(command, signal())
        expect(receipt.commandId).toStartWith('command-')
      }

      expect(transport.calls.slice(2).map((call) => call.url)).toEqual([...fixture.expectedRoutes])
      expect(jsonBody(transport.calls[2]!)).toEqual({
        type: 'file',
        path: fixture.transported('Vault/folder/new.bin'),
        base64Content: 'AAEC',
      })
      expect(jsonBody(transport.calls[3]!)).toEqual({
        type: 'folder',
        path: fixture.transported('Vault/folder/child'),
      })
      const upload = transport.calls[4]!.init.body
      expect(upload).toBeInstanceOf(FormData)
      expect((upload as FormData).get('targetDir')).toBe(fixture.transported('Vault/folder'))
      expect(jsonBody(transport.calls[5]!)).toEqual({
        path: fixture.transported('Vault/song.mp3'),
        content: 'replacement',
        expectedVersion: 7,
      })
      expect(jsonBody(transport.calls[6]!)).toEqual({
        oldPath: fixture.transported('Vault/song.mp3'),
        newPath: fixture.transported('Vault/renamed.mp3'),
      })
      expect(jsonBody(transport.calls[7]!)).toEqual({
        oldPath: fixture.transported('Vault/song.mp3'),
        newPath: fixture.transported('Vault/destination/song.mp3'),
      })
      expect(jsonBody(transport.calls[8]!)).toEqual({
        oldPath: fixture.transported('Vault/song.mp3'),
        newPath: fixture.transported('Vault/external/song.mp3'),
      })
      expect(jsonBody(transport.calls[9]!)).toEqual({
        sourcePath: fixture.transported('Vault/song.mp3'),
        destinationDir: fixture.transported('Vault/copies'),
      })
      expect(jsonBody(transport.calls[10]!)).toEqual({
        path: fixture.transported('Vault/song.mp3'),
      })
      expect(jsonBody(transport.calls[11]!)).toEqual({
        filePath: fixture.transported('Vault/song.mp3'),
      })

      const download = adapter.plan?.('download', item)
      expect(download?.kind).toBe('download')
      if (download?.kind === 'download') {
        expect(download.fileName).toBe('song.mp3')
        expect(download.href.startsWith(`${fixture.routePrefix}/api/files`)).toBe(
          fixture.name === 'owner',
        )
        if (fixture.name === 'Grant') {
          expect(download.href).toBe(`${fixture.routePrefix}/download?path=song.mp3`)
        }
      }
      if (fixture.canShare) {
        expect(adapter.plan?.('share', item)).toEqual({ kind: 'share', item })
      } else {
        const error = await adapterError(async () => adapter.plan?.('share', item))
        expect(error.explorerError.code).toBe('forbidden')
      }
    }
  })

  test('owner maps virtual pagination, settings, share rows, and explicit capabilities', async () => {
    const virtualPath = 'Hermes Sessions/session/session-1'
    const downloadableVirtualPath = 'Hermes Sessions/session/session-2'
    const transport = recordingFetch((url) => {
      if (url.includes('dir=Hermes%20Sessions')) {
        return {
          files: [
            file(virtualPath, false, { isVirtual: true }),
            file(downloadableVirtualPath, false, { isVirtual: true }),
          ],
          virtualEntries: {
            [virtualPath]: {
              provider: 'hermes',
              kind: 'session',
              id: 'session-1',
              capabilities: ['open', 'archive', 'copyId'],
            },
            [downloadableVirtualPath]: {
              provider: 'hermes',
              kind: 'session',
              id: 'session-2',
              capabilities: ['open', 'download'],
            },
          },
          virtualDirectory: {
            provider: 'hermes',
            kind: 'sessions',
            path: 'Hermes Sessions',
            capabilities: ['createFolder'],
            offset: 2,
            pageSize: 3,
            total: 9,
            nextOffset: 5,
          },
        }
      }
      if (url.includes('dir=Shares')) {
        return { files: [file('Vault/shared', true, { shareToken: 'share-1' })] }
      }
      return { files: [file('Vault/note.md'), file('Vault/Folder', true)] }
    })
    const adapter = createOwnerExplorerAdapter({
      editableRoots: ['Vault'],
      surface: 'workspace',
      fetch: transport.fetch,
      offline: { isKept: () => false, keep: async () => undefined },
    })

    const virtualPage = await adapter.browse(
      { path: 'Hermes Sessions', cursor: 'offset:2', pageSize: 3 },
      signal(),
    )
    expect(transport.calls[0]!.url).toBe(
      '/api/files?surface=workspace&dir=Hermes%20Sessions&offset=2',
    )
    expect(virtualPage.total).toBe(9)
    expect(virtualPage.nextCursor).toBe('offset:5')
    expect(virtualPage.capabilities).toEqual(['createFolder'])
    expect(virtualPage.items[0]?.capabilities).toEqual(
      expect.arrayContaining(['open', 'archive', 'copyId']),
    )
    expect(virtualPage.items[0]?.capabilities).not.toContain('rename')
    expect(virtualPage.items[0]?.capabilities).not.toEqual(
      expect.arrayContaining(['download', 'keepOffline', 'removeOffline']),
    )
    expect(adapter.capabilitiesForPath?.('Hermes Sessions')).toEqual([])
    expect(adapter.provisionalPageCapabilitiesForPath?.('Hermes Sessions')).toEqual([])
    const unavailableDownload = await adapterError(async () =>
      adapter.plan?.('download', virtualPage.items[0]!),
    )
    expect(unavailableDownload.explorerError.code).toBe('forbidden')
    expect(adapter.plan?.('download', virtualPage.items[1]!)).toEqual({
      kind: 'download',
      href: `/api/virtual-directory/export?path=${encodeURIComponent(downloadableVirtualPath)}`,
      fileName: 'session-2.json',
    })

    const physicalPage = await adapter.browse({ path: 'Vault', pageSize: 50 }, signal())
    const note = physicalPage.items[0]!
    const folder = physicalPage.items[1]!
    expect(note.capabilities).toEqual(
      expect.arrayContaining(['open', 'favorite', 'share', 'setAppearance']),
    )
    expect(folder.capabilities).toContain('setKnowledgeBase')
    expect(physicalPage.capabilities).toContain('setAppearance')
    expect(adapter.provisionalPageCapabilitiesForPath?.('Vault')).toEqual(
      expect.arrayContaining(['createFile', 'createFolder', 'upload', 'move', 'setAppearance']),
    )
    expect(adapter.capabilitiesForPath?.('Vault')).toEqual(
      expect.arrayContaining(['open', 'browse', 'download', 'move', 'setAppearance']),
    )
    expect(adapter.capabilitiesForPath?.('')).not.toContain('move')

    const sharesPage = await adapter.browse({ path: 'Shares', pageSize: 50 }, signal())
    const shared = sharesPage.items[0]!
    expect(shared.capabilities).toEqual(
      expect.arrayContaining(['open', 'revokeShare', 'copyShareLink']),
    )
    expect(shared.capabilities).not.toEqual(expect.arrayContaining(['delete', 'share']))

    await adapter.execute(
      { kind: 'providerAction', item: virtualPage.items[0]!, action: 'archive' },
      signal(),
    )
    await adapter.execute(
      {
        kind: 'providerDirectoryAction',
        path: 'Hermes Sessions',
        action: 'createFolder',
        value: { name: 'New project' },
      },
      signal(),
    )
    await adapter.execute({ kind: 'favorite', item: note }, signal())
    await adapter.execute({ kind: 'setKnowledgeBase', item: folder }, signal())
    await adapter.execute({ kind: 'setAppearance', item: note, iconName: 'file-heart' }, signal())
    await adapter.execute({ kind: 'setAppearance', item: note, iconName: null }, signal())
    await adapter.execute(
      { kind: 'setAppearanceExternal', target: note, iconName: 'external-file' },
      signal(),
    )
    await adapter.execute({ kind: 'revokeShare', item: shared }, signal())
    await adapter.persistViewMode?.('Vault', 'grid', signal())

    expect(transport.calls.slice(3).map((call) => call.url)).toEqual([
      '/api/virtual-directory/action',
      '/api/virtual-directory/action',
      '/api/settings/favorite',
      '/api/settings/knowledgeBase',
      '/api/settings/icon',
      '/api/settings/icon/remove',
      '/api/settings/icon',
      '/api/shares/delete',
      '/api/settings/viewMode',
    ])
    expect(jsonBody(transport.calls[3]!)).toEqual({
      action: 'archive',
      path: virtualPath,
    })
    expect(jsonBody(transport.calls[4]!)).toEqual({
      action: 'createFolder',
      path: 'Hermes Sessions',
      name: 'New project',
    })
    expect(jsonBody(transport.calls[9]!)).toEqual({
      path: 'Vault/note.md',
      iconName: 'external-file',
    })
    expect(jsonBody(transport.calls[10]!)).toEqual({ token: 'share-1' })
    expect(jsonBody(transport.calls[11]!)).toEqual({ path: 'Vault', viewMode: 'grid' })
  })

  test('owner validates external mutation targets before transport', async () => {
    const transport = recordingFetch({ files: [file('ReadOnly/source.txt')] })
    const adapter = createOwnerExplorerAdapter({
      editableRoots: ['Vault'],
      fetch: transport.fetch,
      surface: 'library',
    })
    const page = await adapter.browse({ path: 'ReadOnly', pageSize: 50 }, signal())
    const source = page.items[0]!
    transport.calls.length = 0

    const error = await adapterError(() =>
      adapter.execute(
        { kind: 'moveExternal', source, destinationPath: 'Vault/destination' },
        signal(),
      ),
    )

    expect(error.explorerError.code).toBe('forbidden')
    expect(transport.calls).toEqual([])

    const appearanceError = await adapterError(() =>
      adapter.execute(
        { kind: 'setAppearanceExternal', target: source, iconName: 'folder-heart' },
        signal(),
      ),
    )
    expect(appearanceError.explorerError.code).toBe('forbidden')
    expect(transport.calls).toEqual([])
  })

  test('Grant restrictions derive capabilities and reject unsupported commands', async () => {
    const transport = recordingFetch({ files: [file('Vault/note.md')] })
    const adapter = createGrantExplorerAdapter({
      token: 'restricted',
      rootPath: 'Vault',
      editable: true,
      restrictions: { allowEdit: false, allowUpload: true, allowDelete: false },
      fetch: transport.fetch,
    })
    const page = await adapter.browse({ path: 'Vault', pageSize: 50 }, signal())
    expect(adapter.capabilitiesForPath?.('')).toEqual(
      expect.arrayContaining(['open', 'browse', 'download']),
    )
    const item = page.items[0]!

    expect(page.capabilities).toEqual(
      expect.arrayContaining(['createFile', 'createFolder', 'upload']),
    )
    expect(page.capabilities).not.toContain('move')
    expect(adapter.provisionalPageCapabilitiesForPath?.('')).toEqual(
      expect.arrayContaining(['createFile', 'createFolder', 'upload']),
    )
    expect(adapter.provisionalPageCapabilitiesForPath?.('../outside')).toEqual([])
    expect(item.capabilities).toContain('copy')
    expect(item.capabilities).not.toEqual(
      expect.arrayContaining(['replace', 'rename', 'move', 'delete']),
    )
    await adapter.execute({ kind: 'copy', item, destinationPath: 'Vault/copies' }, signal())

    const unsupported: ExplorerCommand[] = [
      { kind: 'replace', item, content: 'nope' },
      { kind: 'delete', item },
      { kind: 'favorite', item },
      { kind: 'share', item },
      { kind: 'setKnowledgeBase', item },
      { kind: 'setAppearance', item, iconName: 'file' },
      { kind: 'setAppearanceExternal', target: item, iconName: 'file' },
      { kind: 'providerAction', item, action: 'archive' },
      { kind: 'providerDirectoryAction', path: 'Vault', action: 'createFolder' },
      { kind: 'revokeShare', item },
    ]
    for (const command of unsupported) {
      const error = await adapterError(() => adapter.execute(command, signal()))
      expect(error.explorerError.code).toBe('forbidden')
    }
    expect(adapter.persistViewMode).toBeUndefined()
    expect(transport.calls).toHaveLength(2)
  })

  test('Grant infers an undisclosed root while keeping full FileItem paths', async () => {
    const transport = recordingFetch((url) => ({
      files: url.endsWith('dir=')
        ? [file('HiddenRoot/subfolder', true)]
        : [file('HiddenRoot/subfolder/nested.txt')],
    }))
    const adapter = createGrantExplorerAdapter({
      token: 'hidden-root',
      rootPath: '',
      editable: true,
      restrictions: { allowEdit: true, allowUpload: true, allowDelete: true },
      fetch: transport.fetch,
    })

    const root = await adapter.browse({ path: '', pageSize: 50 }, signal())
    expect(root.items[0]!.file.path).toBe('HiddenRoot/subfolder')
    const nested = await adapter.browse({ path: 'subfolder', pageSize: 50 }, signal())
    expect(transport.calls[1]!.url).toBe('/api/share/hidden-root/files?dir=subfolder')
    expect(nested.items[0]!.file.path).toBe('HiddenRoot/subfolder/nested.txt')

    await adapter.execute({ kind: 'delete', item: nested.items[0]! }, signal())
    expect(jsonBody(transport.calls[2]!)).toEqual({ path: 'subfolder/nested.txt' })
    expect(adapter.plan?.('download', nested.items[0]!)).toEqual({
      kind: 'download',
      href: '/api/share/hidden-root/download?path=subfolder%2Fnested.txt',
      fileName: 'nested.txt',
    })
  })

  test('crafted Grant state cannot escape token-scoped transport routes', async () => {
    const token = 'token/../../api/files?owner=#yes'
    const encoded = encodeURIComponent(token)
    const prefix = `/api/share/${encoded}/`
    const transport = recordingFetch({ files: [file('/api/settings/viewMode')] })
    const adapter = createGrantExplorerAdapter({
      token,
      rootPath: 'Vault',
      editable: true,
      restrictions: { allowEdit: true, allowUpload: true, allowDelete: true },
      fetch: transport.fetch,
    })

    const page = await adapter.browse({ path: '/api/files/delete', pageSize: 50 }, signal())
    const crafted = page.items[0]!
    await adapter.execute({ kind: 'delete', item: crafted }, signal())
    await adapter.execute(
      {
        kind: 'createFile',
        parentPath: '/api/shares/delete',
        name: 'payload.txt',
        content: 'safe transport',
      },
      signal(),
    )
    await adapter.execute(
      { kind: 'moveExternal', source: crafted, destinationPath: '/api/files' },
      signal(),
    )
    await adapter.execute({ kind: 'recordView', item: crafted }, signal())

    for (const call of transport.calls) {
      expect(call.url.startsWith(prefix)).toBe(true)
      expect(call.url.startsWith('/api/files')).toBe(false)
      expect(call.url.startsWith('/api/settings')).toBe(false)
      expect(call.url.startsWith('/api/shares')).toBe(false)
    }
    expect(adapter.plan?.('download', crafted)).toEqual({
      kind: 'download',
      href: `${prefix}download?path=api%2Fsettings%2FviewMode`,
      fileName: 'viewMode',
    })

    const beforeTraversal = transport.calls.length
    const traversal = await adapterError(() =>
      adapter.execute(
        {
          kind: 'createFile',
          parentPath: 'Vault/../outside',
          name: 'escape.txt',
          content: 'blocked',
        },
        signal(),
      ),
    )
    expect(traversal.explorerError.code).toBe('forbidden')
    expect(transport.calls).toHaveLength(beforeTraversal)
  })

  test('Grant rejects external offline-vault items outside its root', async () => {
    let kept = 0
    let removed = 0
    const transport = recordingFetch({ files: [file('Vault/note.md')] })
    const adapter = createGrantExplorerAdapter({
      token: 'vault-scope',
      rootPath: 'Vault',
      editable: false,
      fetch: transport.fetch,
      offline: {
        isKept: () => false,
        keep: async () => {
          kept += 1
        },
        remove: async () => {
          removed += 1
        },
      },
    })
    const page = await adapter.browse({ path: '', pageSize: 50 }, signal())
    const listed = page.items[0]!
    const outside: ExplorerItem = {
      ...listed,
      file: { ...listed.file, path: 'Other/private.txt' },
      capabilities: [...listed.capabilities, 'keepOffline', 'removeOffline'],
    }

    for (const kind of ['keepOffline', 'removeOffline'] as const) {
      const error = await adapterError(() => adapter.execute({ kind, item: outside }, signal()))
      expect(error.explorerError.code).toBe('forbidden')
    }
    const traversal = { ...outside, file: { ...outside.file, path: 'Vault/../private.txt' } }
    const traversalError = await adapterError(() =>
      adapter.execute({ kind: 'keepOffline', item: traversal }, signal()),
    )
    expect(traversalError.explorerError.code).toBe('forbidden')
    expect({ kept, removed }).toEqual({ kept: 0, removed: 0 })
  })

  test('HTTP, network, and cancellation failures become typed adapter errors', async () => {
    const conflict = createOwnerExplorerAdapter({
      fetch: async () =>
        response({ code: 'versionMismatch', message: 'Changed underneath you' }, 409),
    })
    const conflictError = await adapterError(() =>
      conflict.browse({ path: '', pageSize: 50 }, signal()),
    )
    expect(conflictError.explorerError).toEqual({
      code: 'versionMismatch',
      message: 'Changed underneath you',
      retryable: false,
    })

    const network = createOwnerExplorerAdapter({
      fetch: async () => {
        throw new TypeError('connection lost')
      },
    })
    const networkError = await adapterError(() =>
      network.browse({ path: '', pageSize: 50 }, signal()),
    )
    expect(networkError.explorerError).toEqual({
      code: 'network',
      message: 'connection lost',
      retryable: true,
    })

    const controller = new AbortController()
    controller.abort()
    const cancelledError = await adapterError(() =>
      conflict.browse({ path: '', pageSize: 50 }, controller.signal),
    )
    expect(cancelledError.explorerError.code).toBe('cancelled')
  })

  test('subscription lifecycle and offline callbacks remain injectable', async () => {
    let subscribed: (() => void) | undefined
    let offlineSubscribed: (() => void) | undefined
    let notifications = 0
    let disposed = 0
    let kept = 0
    const transport = recordingFetch({ files: [file('Vault/note.md')] })
    const adapter = createOwnerExplorerAdapter({
      editableRoots: ['Vault'],
      fetch: transport.fetch,
      subscribe(listener) {
        subscribed = listener
        return () => {
          subscribed = undefined
        }
      },
      dispose() {
        disposed += 1
      },
      offline: {
        subscribe(listener) {
          offlineSubscribed = listener
          return () => {
            offlineSubscribed = undefined
          }
        },
        isKept: () => false,
        keep: async () => {
          kept += 1
          return { saved: true }
        },
      },
    })
    const page = await adapter.browse({ path: 'Vault', pageSize: 50 }, signal())
    const item = page.items[0]!
    expect(item.capabilities).toContain('keepOffline')

    const unsubscribe = adapter.subscribe?.(() => {
      notifications += 1
    })
    subscribed?.()
    offlineSubscribed?.()
    expect(notifications).toBe(2)
    unsubscribe?.()
    expect(subscribed).toBeUndefined()
    expect(offlineSubscribed).toBeUndefined()

    const receipt = await adapter.execute({ kind: 'keepOffline', item }, signal())
    expect(receipt.affectedRefs).toEqual([item.resource.ref])
    expect(kept).toBe(1)
    adapter.dispose?.()
    expect(disposed).toBe(1)
  })

  test('owner serializes view-mode writes per path so last choice wins', async () => {
    let releaseFirst!: () => void
    const firstResponse = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const calls: FetchCall[] = []
    const adapter = createOwnerExplorerAdapter({
      fetch: async (input, init = {}) => {
        calls.push({ url: requestUrl(input), init })
        if (calls.length === 1) await firstResponse
        return response({})
      },
    })

    const first = adapter.persistViewMode?.('Vault', 'grid', signal())
    const second = adapter.persistViewMode?.('Vault', 'list', signal())
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    releaseFirst()
    await first
    await second

    expect(calls.map((call) => jsonBody(call))).toEqual([
      { path: 'Vault', viewMode: 'grid' },
      { path: 'Vault', viewMode: 'list' },
    ])
  })
})
