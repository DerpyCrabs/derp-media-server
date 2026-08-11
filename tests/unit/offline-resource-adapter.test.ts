import { describe, expect, test } from 'bun:test'
import type { ExplorerCommand, ExplorerItem } from '@/lib/explorer-model'
import type { ResourceSummary } from '@/lib/resource'
import { MediaType } from '@/lib/types'
import {
  createOfflineResourceAdapter,
  type OfflineExplorerCatalog,
} from '@/src/lib/resource-adapters/offline'
import type { StoredOfflineEntry } from '@/src/lib/web-offline-storage'

function fakeCatalog(entries: readonly StoredOfflineEntry[]) {
  const audit = {
    reads: 0,
    removes: [] as Array<{ path: string; name: string }>,
  }
  const catalog: OfflineExplorerCatalog = {
    async read() {
      audit.reads += 1
      return entries
    },
    async remove(path, name) {
      audit.removes.push({ path, name })
    },
  }
  return { audit, catalog }
}

async function browse(
  entries: readonly StoredOfflineEntry[],
  path: string,
): Promise<{ item: ExplorerItem; audit: ReturnType<typeof fakeCatalog>['audit'] }> {
  const fixture = fakeCatalog(entries)
  const adapter = createOfflineResourceAdapter({ catalog: fixture.catalog })
  const page = await adapter.browse({ path, pageSize: 100 }, new AbortController().signal)
  expect(page.items).toHaveLength(1)
  return { item: page.items[0]!, audit: fixture.audit }
}

function textEntry(path = 'Documents/readme.txt'): StoredOfflineEntry {
  return {
    path,
    name: path.split('/').at(-1)!,
    type: MediaType.TEXT,
    size: 18,
    extension: 'txt',
    isDirectory: false,
    blob: new Blob(['legacy bytes']),
  }
}

describe('offline Explorer resource Adapter', () => {
  test('lists legacy path-keyed rows with deterministic ResourceRefs without rewriting data', async () => {
    const entry = textEntry()
    const fixture = fakeCatalog([entry])
    const adapter = createOfflineResourceAdapter({ catalog: fixture.catalog })
    const root = await adapter.browse({ path: '', pageSize: 100 }, new AbortController().signal)
    expect(adapter.capabilitiesForPath?.('Documents')).toEqual(
      expect.arrayContaining(['open', 'browse', 'removeOffline']),
    )

    expect(root.capabilities).toEqual([])
    expect(root.items[0]).toMatchObject({
      file: { name: 'Documents', path: 'Documents', isDirectory: true },
      resource: {
        ref: { libraryId: 'legacy-library', resourceId: 'legacy-path-Documents' },
      },
      capabilities: ['open', 'browse', 'removeOffline'],
    })

    const directory = await adapter.browse(
      { path: 'Documents', pageSize: 100 },
      new AbortController().signal,
    )
    expect(directory.items[0]).toMatchObject({
      file: { name: 'readme.txt', path: 'Documents/readme.txt', type: MediaType.TEXT },
      resource: {
        ref: {
          libraryId: 'legacy-library',
          resourceId: 'legacy-path-Documents%2Freadme.txt',
        },
      },
      capabilities: ['open', 'read', 'download', 'removeOffline'],
    })
    expect(entry.blob && (await entry.blob.text())).toBe('legacy bytes')
    expect(fixture.audit).toEqual({ reads: 2, removes: [] })
  })

  test('retains stored stable identity and grants local stream/download capabilities', async () => {
    const resource: ResourceSummary = {
      ref: { libraryId: 'library-1', resourceId: 'resource-1' },
      locator: { sourceId: 'source-1', providerLocator: 'opaque-locator' },
      legacyLocator: 'Music/track.mp3',
      name: 'track.mp3',
      kind: 'file',
      presentation: 'audio',
      mimeType: 'audio/mpeg',
      size: 5,
      providerOperations: ['read'],
      availability: 'present',
    }
    const { item } = await browse(
      [
        {
          path: 'Music/track.mp3',
          name: 'track.mp3',
          type: MediaType.AUDIO,
          size: 5,
          extension: 'mp3',
          isDirectory: false,
          resource,
        },
      ],
      'Music',
    )

    expect(item.resource.ref).toEqual(resource.ref)
    expect(item.resource.locator).toEqual(resource.locator)
    expect(item.resource.providerOperations).toEqual(['read', 'stream', 'download'])
    expect(item.capabilities).toEqual(['open', 'read', 'stream', 'download', 'removeOffline'])
  })

  test('paginates local rows and plans encoded media downloads through existing cache keys', async () => {
    const fixture = fakeCatalog([
      textEntry('Documents/a.txt'),
      textEntry('Documents/résumé 日本.txt'),
    ])
    const adapter = createOfflineResourceAdapter({ catalog: fixture.catalog })
    const first = await adapter.browse(
      { path: 'Documents', pageSize: 1 },
      new AbortController().signal,
    )
    const second = await adapter.browse(
      { path: 'Documents', cursor: first.nextCursor, pageSize: 1 },
      new AbortController().signal,
    )

    expect(first).toMatchObject({ total: 2, nextCursor: '1' })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeUndefined()
    expect(adapter.plan?.('download', second.items[0]!)).toEqual({
      kind: 'download',
      href: '/api/media/Documents/r%C3%A9sum%C3%A9%20%E6%97%A5%E6%9C%AC.txt',
      fileName: 'résumé 日本.txt',
    })

    const root = await adapter.browse({ path: '', pageSize: 100 }, new AbortController().signal)
    try {
      adapter.plan?.('download', root.items[0]!)
      throw new Error('Expected offline folder download planning to fail')
    } catch (error) {
      expect(error).toMatchObject({
        explorerError: { code: 'offlineUnavailable', retryable: false },
      })
    }
  })

  test('denies every non-local command with typed offlineUnavailable and no catalog write', async () => {
    const fixture = fakeCatalog([textEntry()])
    const adapter = createOfflineResourceAdapter({ catalog: fixture.catalog })
    const page = await adapter.browse(
      { path: 'Documents', pageSize: 100 },
      new AbortController().signal,
    )
    const item = page.items[0]!
    const commands: ExplorerCommand[] = [
      { kind: 'createFile', parentPath: 'Documents', name: 'new.txt' },
      { kind: 'createFolder', parentPath: 'Documents', name: 'new' },
      { kind: 'upload', parentPath: 'Documents', files: [] },
      { kind: 'replace', item, content: 'changed' },
      { kind: 'rename', item, name: 'changed.txt' },
      { kind: 'move', item, destinationPath: 'Elsewhere' },
      { kind: 'moveExternal', source: item, destinationPath: 'Elsewhere' },
      { kind: 'copy', item, destinationPath: 'Elsewhere' },
      { kind: 'delete', item },
      { kind: 'favorite', item },
      { kind: 'share', item },
      { kind: 'setKnowledgeBase', item },
      { kind: 'setAppearance', item, iconName: 'File' },
      { kind: 'setAppearanceExternal', target: item, iconName: 'File' },
      { kind: 'keepOffline', item },
      { kind: 'providerAction', item, action: 'archive' },
      { kind: 'providerDirectoryAction', path: 'Documents', action: 'createFolder' },
      { kind: 'recordView', item },
      { kind: 'revokeShare', item },
    ]

    for (const command of commands) {
      await expect(adapter.execute(command, new AbortController().signal)).rejects.toMatchObject({
        explorerError: { code: 'offlineUnavailable', retryable: false },
      })
    }
    expect(fixture.audit).toEqual({ reads: 1, removes: [] })
  })

  test('removes local vault content and reports affected ResourceRef', async () => {
    const fixture = fakeCatalog([textEntry()])
    const adapter = createOfflineResourceAdapter({ catalog: fixture.catalog })
    const page = await adapter.browse(
      { path: 'Documents', pageSize: 100 },
      new AbortController().signal,
    )
    const item = page.items[0]!

    await expect(
      adapter.execute({ kind: 'removeOffline', item }, new AbortController().signal),
    ).resolves.toEqual({ affectedRefs: [item.resource.ref] })
    expect(fixture.audit.removes).toEqual([{ path: 'Documents/readme.txt', name: 'readme.txt' }])
  })
})
