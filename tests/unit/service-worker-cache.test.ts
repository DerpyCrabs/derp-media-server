import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { markdownLazyAssetPaths, type ViteManifest } from '@/scripts/service-worker-assets'

test('service worker offline fallback is scoped to the current shell cache', () => {
  const source = fs.readFileSync(path.resolve('public/service-worker.js'), 'utf8')

  expect(source).toContain("const SHELL_CACHE = 'derp-shell-v1'")
  expect(source).not.toContain('caches.match(')
  expect(source).not.toContain('workbox')
  expect(source).toContain('self.skipWaiting()')
  expect(source).toContain('self.clients.claim()')
  expect(source).toContain("key.startsWith('derp-shell-') && key !== SHELL_CACHE")
  expect(source).toContain("cache.put('/index.html', copy)")
  expect(source).toContain("url.pathname.startsWith('/api/media/')")
  expect(source).not.toContain('/api/share/')
})

test('service worker generator identifies only Markdown-exclusive assets from Vite manifest', () => {
  const manifest: ViteManifest = {
    'index.html': {
      file: 'assets/index-main.js',
      isEntry: true,
      imports: ['_shared.js'],
      css: ['assets/index.css'],
    },
    'src/media/MarkdownDocument.tsx': {
      file: 'assets/editor-random-name.js',
      src: 'src/media/MarkdownDocument.tsx',
      imports: ['_shared.js', '_editor-engine.js'],
      css: ['assets/editor.css'],
    },
    '_shared.js': { file: 'assets/shared.js' },
    '_editor-engine.js': { file: 'assets/editor-engine.js' },
  }

  expect(markdownLazyAssetPaths(manifest)).toEqual(
    new Set(['/assets/editor-random-name.js', '/assets/editor.css', '/assets/editor-engine.js']),
  )
})
