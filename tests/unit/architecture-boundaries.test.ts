import { describe, expect, test } from 'bun:test'

const ROOTS = ['lib', 'src'] as const

async function productionTypeScript(): Promise<Array<{ path: string; source: string }>> {
  const files: Array<{ path: string; source: string }> = []
  for (const root of ROOTS) {
    for await (const relative of new Bun.Glob('**/*.{ts,tsx}').scan(root)) {
      const path = `${root}/${relative}`
      files.push({ path, source: await Bun.file(path).text() })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function countDefinitions(files: Array<{ path: string; source: string }>, pattern: RegExp): number {
  return files.reduce((total, file) => total + (file.source.match(pattern)?.length ?? 0), 0)
}

describe('architecture boundaries', () => {
  test('direct API routes live only in typed API or integration transport modules', async () => {
    const allowed = new Set([
      'lib/api-canvases.ts',
      'lib/api-endpoints.ts',
      'lib/api-media-urls.ts',
      'lib/generated/api-contracts.ts',
    ])
    const violations = (await productionTypeScript())
      .filter(({ source }) => source.includes('/api/'))
      .filter(
        ({ path }) =>
          !allowed.has(path) && !/^src\/integrations\/(?:[^/]+\/)*transport\.ts$/.test(path),
      )
      .map(({ path }) => path)

    expect(violations).toEqual([])
  })

  test('server integration route literals stay in provider route owners', async () => {
    const violations: string[] = []
    for await (const relative of new Bun.Glob('**/*.rs').scan('server/integrations')) {
      if (relative.endsWith('routes.rs')) continue
      const path = `server/integrations/${relative}`
      const source = await Bun.file(path).text()
      if (source.startsWith('#[cfg(test)]')) continue
      if (source.includes('"/api/')) violations.push(path)
    }

    expect(violations.sort()).toEqual([])
  })

  test('retired file, knowledge, and virtual API routes stay deleted', async () => {
    const files = await productionTypeScript()
    for await (const relative of new Bun.Glob('**/*.rs').scan('server')) {
      files.push({
        path: `server/${relative}`,
        source: await Bun.file(`server/${relative}`).text(),
      })
    }
    const retiredRoute =
      /\/api\/(?:files(?:[/?'"`]|$)|kb(?:[/?'"`]|$)|virtual-directory(?:[/?'"`]|$))/

    expect(files.filter(({ source }) => retiredRoute.test(source)).map(({ path }) => path)).toEqual(
      [],
    )
  })

  test('retired dir URL state stays deleted from production and browser tests', async () => {
    const files = await productionTypeScript()
    for await (const relative of new Bun.Glob('**/*.{ts,tsx}').scan('tests/e2e')) {
      const path = `tests/e2e/${relative}`
      files.push({ path, source: await Bun.file(path).text() })
    }
    const retiredDirUrl =
      /[?&]dir=|(?:get|has|set|delete)\(\s*['"]dir['"]\s*\)|\b(?:query|searchParams|urlSearchParams)\.dir\b/

    expect(
      files.filter(({ source }) => retiredDirUrl.test(source)).map(({ path }) => path),
    ).toEqual([])
  })

  test('shared features, file routes, and layout hosts contain no Hermes branch', async () => {
    const paths = ['server/app.rs']
    for (const root of ROOTS) {
      for await (const relative of new Bun.Glob('**/*.{ts,tsx,css}').scan(root)) {
        const path = `${root}/${relative}`
        if (
          path === 'src/integrations/registry.ts' ||
          path.startsWith('src/integrations/hermes/')
        ) {
          continue
        }
        paths.push(path)
      }
    }
    const violations: string[] = []
    for (const path of paths) {
      const source = await Bun.file(path).text()
      if (/\bhermes\b|Hermes Sessions|hermesSession|hermesDraft|hermes:\/\//i.test(source)) {
        violations.push(path)
      }
    }

    expect(violations.sort()).toEqual([])
  })

  test('removed feature plumbing and replaced surface owners stay absent', async () => {
    const files = await productionTypeScript()
    for await (const relative of new Bun.Glob('**/*.rs').scan('server')) {
      const path = `server/${relative}`
      files.push({ path, source: await Bun.file(path).text() })
    }
    const fileNames = files.map(({ path }) => path).sort()
    const obsoleteFilePattern =
      /(?:^|\/|[-_.])(auth|sharing?|offline|grant|access[-_]?policy|runtime[-_]?mount|service[-_]?worker)(?:[-_.]|$)/i
    const obsoleteSymbols =
      /\b(?:Grant|AccessPolicy|RuntimeMount|OfflineQueue|OfflineJournal|AuthState|ShareState|ServiceWorker)\b/

    expect(fileNames.filter((path) => obsoleteFilePattern.test(path))).toEqual([])
    expect(
      files.filter(({ source }) => obsoleteSymbols.test(source)).map(({ path }) => path),
    ).toEqual([])
    for (const path of [
      'server/routes/files.rs',
      'server/routes/search.rs',
      'server/virtual_directory.rs',
      'src/workspace/WorkspaceViewerPane.tsx',
      'src/reader/ReaderDialog.tsx',
      'src/workspace/HermesChatPane.tsx',
      'src/lib/build-media-url.ts',
      'lib/hermes-session-store.ts',
      'lib/virtual-directory.ts',
    ]) {
      expect(await Bun.file(path).exists()).toBe(false)
    }
  })

  test('compatibility decoders and obsolete state importers stay deleted', async () => {
    for (const path of [
      'lib/domain/file-item-resource.ts',
      'src/integrations/filesystem/legacy-content.ts',
      'src/integrations/hermes/legacy.ts',
    ]) {
      expect(await Bun.file(path).exists()).toBe(false)
    }

    const files = await productionTypeScript()
    for await (const relative of new Bun.Glob('**/*.rs').scan('server')) {
      files.push({
        path: `server/${relative}`,
        source: await Bun.file(`server/${relative}`).text(),
      })
    }
    const obsolete =
      /\bLEGACY_[A-Z0-9_]+\b|\b(?:LegacyPathCapability|HermesLegacyPaths|inspectLegacyCanvasCollection|legacyTextEditorDraftKey|readAndMigrateTextEditorDraft|restoreLegacy|upgrade_v1|legacy_is_newer|hermesSession|hermesDraft)\b|legacy_paths|theme-palette|theme-mode|video-playback-times|assist-custom/
    const currentMasterUpgrade =
      files.find(({ path }) => path === 'server/state_db.rs')?.source ?? ''

    expect(files.filter(({ source }) => obsolete.test(source)).map(({ path }) => path)).toEqual([])
    expect(
      files
        .filter(({ path }) => path !== 'server/state_db.rs')
        .filter(({ source }) => source.includes('legacy_state_import'))
        .map(({ path }) => path),
    ).toEqual([])
    expect(currentMasterUpgrade).toContain('const MASTER_SCHEMA_VERSION: i64 = 3')
    expect(currentMasterUpgrade).toContain('VACUUM INTO ?1')
    expect(currentMasterUpgrade).toContain('fn migrate_master_canvas_document')
    expect(currentMasterUpgrade).toContain('legacy_state_import')
  })

  test('Hermes export URL has one provider-owned route contract', async () => {
    const browser = await Bun.file('server/integrations/hermes/browser.rs').text()
    const routes = await Bun.file('server/integrations/hermes/routes.rs').text()
    const transport = await Bun.file('src/integrations/hermes/transport.ts').text()
    const sessionStore = await Bun.file('src/integrations/hermes/session-store.ts').text()

    expect(browser).not.toMatch(/["']openTarget["']|\/api\/hermes\/sessions\//)
    expect(routes).toContain(
      'const SESSION_EXPORT_ROUTE: &str = "/api/hermes/sessions/{id}/export"',
    )
    expect(transport).not.toMatch(/\/export\b/)
    expect(sessionStore).not.toContain('hermesSessionExportUrl')
  })

  test('retired Canvas collection and sync machinery stays deleted', async () => {
    const canvasFiles = [
      'src/CanvasPage.tsx',
      'lib/canvas-persistence.ts',
      'lib/infinite-canvas.ts',
      'server/canvas_persistence.rs',
      'server/routes/canvases.rs',
    ]
    const retiredCanvas =
      /\/api\/canvases\/sync|infinite-canvases-v1|\bwriterId\b|\blastTimestamp\b|\bsyncQueued\b|\bupgrade_v1\b|\btombstone\b/

    expect(
      (
        await Promise.all(
          canvasFiles.map(async (path) => ({ path, source: await Bun.file(path).text() })),
        )
      )
        .filter(({ source }) => retiredCanvas.test(source))
        .map(({ path }) => path),
    ).toEqual([])
  })

  test('search, playback, viewer, and Explorer behavior each have one owner', async () => {
    const files = await productionTypeScript()

    expect(countDefinitions(files, /export function createSearchCoordinator\b/g)).toBe(1)
    expect(countDefinitions(files, /export (?:async )?function executeSearchHit\b/g)).toBe(1)
    expect(countDefinitions(files, /export function createPlaybackSession\b/g)).toBe(1)
    expect(countDefinitions(files, /export function ResourceViewerContent\b/g)).toBe(1)
    expect(countDefinitions(files, /export function ExplorerView\b/g)).toBe(1)
  })

  test('retired frontend owner names do not return', async () => {
    const source = (await productionTypeScript()).map(({ source }) => source).join('\n')

    expect(source).not.toMatch(
      /useAdminEventsStream|subscribeSseAdmin|admin-sse|subscribe-admin|unsubscribe-admin|adminContent|buildAdmin(?:Media|Image)Url/,
    )
  })

  test('settings mutations expose no retired response branches', async () => {
    const generated = await Bun.file('lib/generated/api-contracts.ts').text()
    const response = generated.match(
      /export type SettingsMutationResponse = ([\s\S]*?)\nexport type AppEvent/,
    )?.[1]

    expect(response).toBe('{ success: boolean }')
  })
})
