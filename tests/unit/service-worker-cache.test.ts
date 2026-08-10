import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { buildAssetPlan, type ViteManifest } from '@/scripts/service-worker-assets'
import { offlineShellHtml, renderServiceWorker } from '@/scripts/generate-service-worker'

type RouteCase = { url: string; kind: string }

const manifest: ViteManifest = {
  'index.html': {
    file: 'assets/index-AAAAAAAA.js',
    isEntry: true,
    imports: ['_shared.js'],
    css: ['assets/index-BBBBBBBB.css'],
    assets: ['assets/root-font-CCCCCCCC.woff2'],
  },
  '_shared.js': { file: 'assets/shared-DDDDDDDD.js' },
  'src/reader/ReaderDialog.tsx': {
    file: 'assets/ReaderDialog-EEEEEEEE.js',
    src: 'src/reader/ReaderDialog.tsx',
    isDynamicEntry: true,
    imports: ['index.html', '_reader-engine.js'],
    css: ['assets/ReaderDialog-FFFFFFFF.css'],
    assets: ['assets/pdf.worker.min-GGGGGGGG.mjs'],
  },
  '_reader-engine.js': { file: 'assets/reader-engine-HHHHHHHH.js' },
  'src/workspace/WorkspacePage.tsx': {
    file: 'assets/WorkspacePage-IIIIIIII.js',
    src: 'src/workspace/WorkspacePage.tsx',
    isDynamicEntry: true,
  },
  'src/canvas/CanvasPage.tsx': {
    file: 'assets/CanvasPage-JJJJJJJJ.js',
    src: 'src/canvas/CanvasPage.tsx',
    isDynamicEntry: true,
  },
  'src/hermes/HermesPanel.tsx': {
    file: 'assets/HermesPanel-KKKKKKKK.js',
    src: 'src/hermes/HermesPanel.tsx',
    isDynamicEntry: true,
  },
  'src/media/MarkdownDocument.tsx': {
    file: 'assets/MarkdownDocument-LLLLLLLL.js',
    src: 'src/media/MarkdownDocument.tsx',
    isDynamicEntry: true,
  },
  'src/settings/SettingsManager.tsx': {
    file: 'assets/SettingsManager-MMMMMMMM.js',
    src: 'src/settings/SettingsManager.tsx',
    isDynamicEntry: true,
  },
  'src/offline/OfflineManager.tsx': {
    file: 'assets/OfflineManager-NNNNNNNN.js',
    src: 'src/offline/OfflineManager.tsx',
    isDynamicEntry: true,
  },
}

const emitted = [
  '/offline-shell.html',
  '/manifest.webmanifest',
  '/derp-desk-OOOOOOOO.svg',
  '/assets/sse-shared-worker-PPPPPPPP.js',
  '/assets/book-worker-QQQQQQQQ.js',
  ...Object.values(manifest).flatMap((chunk) => [
    `/${chunk.file}`,
    ...(chunk.css ?? []).map((file) => `/${file}`),
    ...(chunk.assets ?? []).map((file) => `/${file}`),
  ]),
]

test('BuildAssetPlan separates eager, offline renderer, and optional closures', () => {
  const plan = buildAssetPlan(manifest, emitted, [
    '/offline-shell.html',
    '/manifest.webmanifest',
    '/derp-desk-OOOOOOOO.svg',
  ])

  expect(plan.eager).toEqual([
    '/assets/index-AAAAAAAA.js',
    '/assets/index-BBBBBBBB.css',
    '/assets/root-font-CCCCCCCC.woff2',
    '/assets/shared-DDDDDDDD.js',
    '/assets/sse-shared-worker-PPPPPPPP.js',
    '/derp-desk-OOOOOOOO.svg',
    '/manifest.webmanifest',
    '/offline-shell.html',
  ])
  expect(plan.offlineRenderers).toEqual([
    '/assets/ReaderDialog-EEEEEEEE.js',
    '/assets/ReaderDialog-FFFFFFFF.css',
    '/assets/book-worker-QQQQQQQQ.js',
    '/assets/pdf.worker.min-GGGGGGGG.mjs',
    '/assets/reader-engine-HHHHHHHH.js',
  ])
  expect(plan.optional).toEqual([
    '/assets/CanvasPage-JJJJJJJJ.js',
    '/assets/HermesPanel-KKKKKKKK.js',
    '/assets/MarkdownDocument-LLLLLLLL.js',
    '/assets/OfflineManager-NNNNNNNN.js',
    '/assets/SettingsManager-MMMMMMMM.js',
    '/assets/WorkspacePage-IIIIIIII.js',
  ])
  expect(plan.buildId).toMatch(/^[a-f0-9]{16}$/)
})

test('BuildAssetPlan identity is deterministic and changes with emitted build assets', () => {
  const first = buildAssetPlan(manifest, emitted, ['/offline-shell.html'])
  const reordered = buildAssetPlan(manifest, [...emitted].reverse(), ['/offline-shell.html'])
  const changed = buildAssetPlan(
    {
      ...manifest,
      'src/workspace/WorkspacePage.tsx': {
        ...manifest['src/workspace/WorkspacePage.tsx'],
        file: 'assets/WorkspacePage-RRRRRRRR.js',
      },
    },
    emitted.map((value) =>
      value === '/assets/WorkspacePage-IIIIIIII.js' ? '/assets/WorkspacePage-RRRRRRRR.js' : value,
    ),
    ['/offline-shell.html'],
  )

  expect(reordered).toEqual(first)
  expect(changed.buildId).not.toBe(first.buildId)
  expect(
    buildAssetPlan(manifest, emitted, ['/offline-shell.html'], 'changed-content').buildId,
  ).not.toBe(first.buildId)
})

test('BuildAssetPlan fails closed when offline Reader dependency is absent', () => {
  const withoutReader = Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== 'src/reader/ReaderDialog.tsx'),
  )
  expect(() => buildAssetPlan(withoutReader, emitted, [])).toThrow(
    'ReaderDialog dynamic entry missing from Vite manifest',
  )
})

test('offline shell strips dehydration seam and rejects personalized state', () => {
  expect(offlineShellHtml('<main></main><!--DEHYDRATED-->')).toContain(
    'intentionally contains no personalized dehydrated state',
  )
  expect(offlineShellHtml('<main></main><!--DEHYDRATED-->')).not.toContain('<!--DEHYDRATED-->')
  expect(() => offlineShellHtml('<script>window.__DEHYDRATED_STATE__={}</script>')).toThrow(
    'Static index contains personalized dehydrated state',
  )
})

test('service worker renderer injects versioned, disjoint asset policy', () => {
  const plan = buildAssetPlan(manifest, emitted, ['/offline-shell.html'])
  const rendered = renderServiceWorker(
    "const BUILD_ID = /* __BUILD_ID__ */ 'development'\nconst PRECACHE = /* __PRECACHE__ */ []\nconst OPTIONAL = /* __OPTIONAL__ */ []",
    plan,
  )

  expect(rendered).toContain(`const BUILD_ID = "${plan.buildId}"`)
  expect(rendered).toContain('/assets/ReaderDialog-EEEEEEEE.js')
  expect(rendered).toContain('/assets/WorkspacePage-IIIIIIII.js')
  expect(rendered).not.toContain('__PRECACHE__')
  expect(rendered).not.toContain('__OPTIONAL__')
})

test('service worker keeps old controlled clients on old build until normal activation', () => {
  const source = fs.readFileSync(path.resolve('public/service-worker.js'), 'utf8')
  const install = source.slice(
    source.indexOf("self.addEventListener('install'"),
    source.indexOf("self.addEventListener('activate'"),
  )

  expect(source).toContain("const BUILD_ID = /* __BUILD_ID__ */ 'development'")
  expect(source).toContain('const SHELL_CACHE = `derp-shell-${BUILD_ID}`')
  expect(install).not.toContain('skipWaiting')
  expect(source).not.toContain('skipWaiting')
  expect(source).toContain('self.clients.claim()')
  expect(source).toContain("key.startsWith('derp-shell-') && key !== SHELL_CACHE")
})

test('service worker never runtime-caches navigation HTML or arbitrary responses', () => {
  const source = fs.readFileSync(path.resolve('public/service-worker.js'), 'utf8')
  const navigation = source.slice(
    source.indexOf("if (event.request.mode === 'navigate')"),
    source.indexOf('if (PRECACHE.includes(url.pathname))'),
  )

  expect(navigation).toContain("shellMatch('/offline-shell.html')")
  expect(navigation).not.toContain('cache.put')
  expect(source).not.toContain("cache.put('/index.html'")
  expect(source).not.toContain("if (!url.pathname.startsWith('/api/'))")
  expect(source).toContain('if (OPTIONAL.includes(url.pathname))')
  expect(source).not.toContain('caches.match(')
})

test('service worker preserves offline database and Grant media compatibility identifiers', () => {
  const source = fs.readFileSync(path.resolve('public/service-worker.js'), 'utf8')

  expect(source).toContain("const DB_NAME = 'derp-offline-v1'")
  expect(source).toContain("const STORE = 'entries'")
  expect(source).toContain("request.result.createObjectStore(STORE, { keyPath: 'path' })")
  expect(source).toContain('(?:media|knowledge-base-image)')
})

test('manifest and generic offline navigation share the checked route fixture', () => {
  const routes = JSON.parse(
    fs.readFileSync(path.resolve('tests/fixtures/route-cases.json'), 'utf8'),
  ) as RouteCase[]
  const webManifest = JSON.parse(
    fs.readFileSync(path.resolve('public/manifest.webmanifest'), 'utf8'),
  ) as { start_url: string }
  const worker = fs.readFileSync(path.resolve('public/service-worker.js'), 'utf8')

  expect(routes.find((route) => route.url === webManifest.start_url)?.kind).toBe('library')
  expect(routes.some((route) => route.kind === 'share')).toBe(true)
  expect(routes.some((route) => route.kind === 'notFound')).toBe(true)
  expect(worker.match(/event\.request\.mode === 'navigate'/g)).toHaveLength(1)
  expect(worker).toContain("shellMatch('/offline-shell.html')")
  expect(worker).not.toMatch(/url\.pathname\s*===\s*['"]\/(?:share|workspace|canvas)/)
})
