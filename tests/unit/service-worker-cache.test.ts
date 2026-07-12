import { expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

test('service worker offline fallback is scoped to the current shell cache', () => {
  const source = fs.readFileSync(path.resolve('public/service-worker.js'), 'utf8')

  expect(source).toContain("const SHELL_CACHE = 'derp-shell-v1'")
  expect(source).not.toContain('caches.match(')
  expect(source).not.toContain('workbox')
  expect(source).toContain('self.skipWaiting()')
  expect(source).toContain('self.clients.claim()')
  expect(source).toContain("key.startsWith('derp-shell-') && key !== SHELL_CACHE")
  expect(source).toContain("cache.put('/index.html', copy)")
})
