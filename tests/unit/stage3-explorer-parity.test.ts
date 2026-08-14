import { describe, expect, test } from 'bun:test'
import { filesystemResourceKey, type ResourceSummary } from '@/lib/domain/resource'
import { createContentRegistry } from '@/src/features/content/registry'
import {
  createFilesystemIntegrationModule,
  type FilesystemIntegrationTransport,
} from '@/src/integrations/filesystem/module'
import { hermesIntegrationModule, hermesResourceKey } from '@/src/integrations/hermes/module'

const EXPLORER_HOSTS = [
  'src/FileBrowser.tsx',
  'src/workspace/WorkspaceBrowserPane.tsx',
  'src/CanvasPage.tsx',
] as const

describe('Stage 3 Explorer parity', () => {
  test('Library, Workspace, and Canvas mount the same Explorer and application data source', async () => {
    for (const path of EXPLORER_HOSTS) {
      const source = await Bun.file(path).text()
      expect(source, path).toMatch(/features\/explorer\/ExplorerView/)
      expect(source, path).toMatch(/createApplicationExplorerDataSource/)
    }
  })

  test('Library host no longer owns file queries, mutations, or provider actions', async () => {
    const source = await Bun.file('src/FileBrowser.tsx').text()

    expect(source).toMatch(/createLibraryHost/)
    expect(source).not.toMatch(/@tanstack\/solid-query/)
    expect(source).not.toMatch(
      /filesQueryOptions|fileMutationOptions|settingsMutationOptions|apiEndpoints/,
    )
    expect(source).not.toMatch(
      /VIRTUAL_FOLDERS|isVirtualFolderPath|virtualAction|Hermes Sessions|hermesSession/,
    )
  })

  test('Workspace and Canvas Explorer hosts contain no virtual or Hermes provider branch', async () => {
    const sources = await Promise.all(
      ['src/workspace/WorkspaceBrowserPane.tsx', 'src/CanvasPage.tsx'].map((path) =>
        Bun.file(path).text(),
      ),
    )

    for (const source of sources) {
      expect(source).not.toMatch(
        /\bhermes\b|Hermes Sessions|virtualOpenTarget|\/api\/virtual-directory|isVirtualFolderPath|HermesChatPane/,
      )
    }
    expect(sources[0]).not.toMatch(/props\.workspace|initialState\.dir|legacyExplorerLocation/)
  })

  test('filesystem resources retain applicable actions and presentation metadata', async () => {
    const transport: FilesystemIntegrationTransport = {
      browseResource: async ({ location }) => ({
        schemaVersion: 1,
        location,
        locationSummary: {
          key: location,
          name: 'Library',
          kind: 'root',
          capabilities: ['browse'],
          presentation: 'browse',
        },
        breadcrumbs: [],
        items: [
          {
            key: filesystemResourceKey('media', 'Notes'),
            name: 'Notes',
            kind: 'folder',
            capabilities: ['browse', 'filesystem.copy', 'download'],
            presentation: 'browse',
            metadata: { viewCount: 12, thumbnailGenerated: true, version: 4 },
          },
        ],
        total: 1,
      }),
      inspectResource: async (key) => ({
        key,
        name: 'Notes',
        kind: 'folder',
        capabilities: ['browse'],
      }),
      runResourceAction: async () => ({
        success: true,
        data: { url: '/download', filename: 'Notes.zip' },
      }),
    }
    const registry = createContentRegistry([createFilesystemIntegrationModule(transport)])
    const location = filesystemResourceKey('media', '')
    const page = await registry.browse(location)!.browse({ location })
    const folder = page.items[0]!

    expect(folder.metadata).toMatchObject({
      viewCount: 12,
      thumbnailGenerated: true,
      version: 4,
    })
    const folderActions = registry.actions(folder)!.list(folder)
    expect(folderActions.map((action) => action.id)).toContain('filesystem.copy')
    expect(folderActions).toContainEqual(
      expect.objectContaining({ id: 'filesystem.download', label: 'Download as ZIP' }),
    )

    const download = await registry.actions(folder)!.run({
      actionId: 'filesystem.download',
      resource: folder,
    })
    expect(download).toEqual({ value: { url: '/download', filename: 'Notes.zip' } })

    const applicationAdapter = await Bun.file('src/integrations/explorer-adapter.ts').text()
    expect(applicationAdapter).toMatch(/id: 'application\.favorite'/)
    expect(applicationAdapter).toMatch(/id: 'application\.knowledgeBase'/)
    expect(applicationAdapter).toMatch(/id: 'application\.customIcon'/)
    expect(applicationAdapter).toMatch(/metadata:[\s\S]*favorite[\s\S]*knowledgeBase/)
  })

  test('Hermes browse and resource actions are reachable through the Library registry', () => {
    const registry = createContentRegistry([hermesIntegrationModule])
    const root = hermesResourceKey('root')
    const session: ResourceSummary = {
      key: hermesResourceKey('session', 'session-1'),
      name: 'Session one',
      kind: 'hermes-session',
      capabilities: ['read', 'hermes.open', 'hermes.archive', 'hermes.branch'],
      presentation: 'hermes-session',
    }

    expect(registry.browse(root)).not.toBeNull()
    expect(
      registry
        .actions(session)
        ?.list(session)
        .map((action) => action.id),
    ).toEqual(['hermes.open', 'hermes.archive', 'hermes.branch'])
  })
})
