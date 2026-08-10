import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

type BuildAssetPlan = {
  buildId: string
  eager: string[]
  offlineRenderers: string[]
  optional: string[]
}

type HydratedQuery = { queryKey?: unknown[] }

const clientRoot = path.resolve('dist/client')

function readAssetPlan(): BuildAssetPlan {
  return JSON.parse(
    fs.readFileSync(path.join(clientRoot, '.vite', 'service-worker-assets.json'), 'utf8'),
  ) as BuildAssetPlan
}

async function ensureControlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready)
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)
}

async function hydratedKeys(page: Page): Promise<readonly (readonly unknown[])[] | null> {
  return page.evaluate(() => {
    const state = (
      window as typeof window & {
        __DEHYDRATED_STATE__?: { queries?: HydratedQuery[] }
      }
    ).__DEHYDRATED_STATE__
    return state ? (state.queries ?? []).map((query) => query.queryKey ?? []) : null
  })
}

function hasQuery(keys: readonly (readonly unknown[])[] | null, name: string): boolean {
  return keys?.some((key) => key[0] === name) ?? false
}

async function chooseListView(page: Page) {
  const button = page.getByRole('button', { name: 'List view' })
  if (await button.isVisible()) await button.click()
  await expect(page.locator('table')).toBeVisible()
}

async function saveFileOffline(page: Page, name: string) {
  const row = page.locator('table tr').filter({ has: page.getByText(name, { exact: true }) })
  await row.click({ button: 'right' })
  await page.getByText('Make available offline', { exact: true }).click()
  await expect(page.getByText(`${name} is available offline`, { exact: true })).toBeVisible({
    timeout: 30_000,
  })
}

function ownerApiLeaks(urls: string[]): string[] {
  const exact = new Set([
    '/api/auth/config',
    '/api/settings',
    '/api/stats',
    '/api/stats/views',
    '/api/shares',
    '/api/files',
    '/api/events/stream',
    '/api/mounts',
    '/api/canvases',
  ])
  return urls.filter((raw) => {
    const pathname = new URL(raw).pathname
    return (
      exact.has(pathname) || /^\/api\/(?:media|thumbnail|audio|kb|hermes)(?:\/|$)/.test(pathname)
    )
  })
}

test.describe('Stage 1 PWA and offline cutover', () => {
  test('install cache contains only shell and offline Reader closure', async ({ page }) => {
    const plan = readAssetPlan()
    await page.goto('/library')
    await ensureControlled(page)

    const audit = await page.evaluate(async () => {
      const shellNames = (await caches.keys()).filter((name) => name.startsWith('derp-shell-'))
      const cache = await caches.open(shellNames.at(-1)!)
      const paths = (await cache.keys()).map((request) => new URL(request.url).pathname).sort()
      const offlineShell = await (await cache.match('/offline-shell.html'))?.text()
      return { shellNames, paths, offlineShell }
    })

    expect(audit.shellNames).toEqual([`derp-shell-${plan.buildId}`])
    expect(audit.paths).toEqual([...plan.eager, ...plan.offlineRenderers].sort())
    expect(plan.offlineRenderers.some((asset) => /ReaderDialog-[^/]+\.js$/.test(asset))).toBe(true)
    expect(plan.offlineRenderers.some((asset) => /ReaderDialog-[^/]+\.css$/.test(asset))).toBe(true)
    expect(
      plan.offlineRenderers.some((asset) => /pdf\.worker(?:\.min)?-[^/]+\.mjs$/.test(asset)),
    ).toBe(true)
    expect(plan.offlineRenderers.some((asset) => /book-worker-[^/]+\.js$/.test(asset))).toBe(true)
    expect(plan.optional.some((asset) => /WorkspacePage-/.test(asset))).toBe(true)
    expect(plan.optional.some((asset) => /CanvasPage-/.test(asset))).toBe(true)
    expect(plan.optional.some((asset) => /MarkdownDocument-/.test(asset))).toBe(true)
    expect(plan.optional.some((asset) => /SettingsPage-/.test(asset))).toBe(true)
    expect(plan.optional.some((asset) => /OfflineManager-/.test(asset))).toBe(true)
    expect(audit.paths.some((asset) => plan.optional.includes(asset))).toBe(false)
    expect(audit.paths).not.toContain('/')
    expect(audit.paths).not.toContain('/index.html')
    expect(audit.paths).not.toContain('/library')
    expect(audit.offlineShell).toContain(
      'Offline shell intentionally contains no personalized dehydrated state.',
    )
    expect(audit.offlineShell).not.toContain('__DEHYDRATED_STATE__')
  })

  test('owner and Grant navigation stay isolated in both online/offline orders', async ({
    page,
    context,
  }) => {
    await page.goto('/library')
    await ensureControlled(page)
    const ownerFirst = await hydratedKeys(page)
    expect(hasQuery(ownerFirst, 'auth-config')).toBe(true)
    expect(hasQuery(ownerFirst, 'share-info')).toBe(false)

    const created = await page.request.post('/api/shares', {
      data: { path: 'SharedContent', isDirectory: true },
    })
    expect(created.ok()).toBe(true)
    const { share } = (await created.json()) as {
      share: { token: string; passcode?: string }
    }
    const shareUrl = `/share/${share.token}${
      share.passcode ? `?p=${encodeURIComponent(share.passcode)}` : ''
    }`
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))

    await page.goto(shareUrl)
    await expect(page.getByText('public-doc.txt', { exact: true })).toBeVisible()
    const shareAfterOwner = await hydratedKeys(page)
    expect(hasQuery(shareAfterOwner, 'share-info')).toBe(true)
    expect(hasQuery(shareAfterOwner, 'auth-config')).toBe(false)
    expect(hasQuery(shareAfterOwner, 'settings')).toBe(false)
    expect(hasQuery(shareAfterOwner, 'stats')).toBe(false)
    expect(ownerApiLeaks(requests)).toEqual([])

    await context.setOffline(true)
    await page.goto('/library', { waitUntil: 'domcontentloaded' })
    expect(await hydratedKeys(page)).toBeNull()
    expect(page.url()).toMatch(/\/library$/)

    await context.setOffline(false)
    requests.length = 0
    await page.goto(shareUrl)
    await expect(page.getByText('public-doc.txt', { exact: true })).toBeVisible()
    const shareAfterOffline = await hydratedKeys(page)
    expect(hasQuery(shareAfterOffline, 'share-info')).toBe(true)
    expect(hasQuery(shareAfterOffline, 'auth-config')).toBe(false)
    expect(ownerApiLeaks(requests)).toEqual([])

    await page.goto('/library')
    const ownerAfterShare = await hydratedKeys(page)
    expect(hasQuery(ownerAfterShare, 'auth-config')).toBe(true)
    expect(hasQuery(ownerAfterShare, 'share-info')).toBe(false)
    expect(hasQuery(ownerAfterShare, 'share-files')).toBe(false)

    const cachedNavigationPaths = await page.evaluate(async () => {
      const paths: string[] = []
      for (const name of await caches.keys()) {
        if (!name.startsWith('derp-shell-')) continue
        const cache = await caches.open(name)
        paths.push(...(await cache.keys()).map((request) => new URL(request.url).pathname))
      }
      return paths.filter((value) =>
        ['/', '/library', '/index.html', location.pathname].includes(value),
      )
    })
    expect(cachedNavigationPaths).toEqual([])
  })

  test('fresh unopened PDF and EPUB save, reload, and render offline', async ({
    page,
    context,
  }) => {
    test.setTimeout(75_000)
    await page.goto('/library?dir=Documents')
    await ensureControlled(page)
    await chooseListView(page)
    await expect(page.getByTestId('reader-dialog')).toHaveCount(0)
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /(?:ReaderDialog|pdf\.worker|book-worker)-/.test(entry.name)),
      ),
    ).toBe(false)

    await saveFileOffline(page, 'sample.pdf')
    await saveFileOffline(page, 'reader.epub')
    const savedKeys = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('derp-offline-v1', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return new Promise<string[]>((resolve, reject) => {
        const request = database.transaction('entries').objectStore('entries').getAllKeys()
        request.onsuccess = () => resolve(request.result.map(String))
        request.onerror = () => reject(request.error)
      })
    })
    expect(savedKeys).toContain('Documents/sample.pdf')
    expect(savedKeys).toContain('Documents/reader.epub')

    await context.setOffline(true)
    await page.goto('/?offline=1&dir=Documents&reader=Documents%2Fsample.pdf&readerKind=pdf', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.getByTestId('pdf-canvas').first()).toBeVisible()
    await page.getByLabel('Close reader').click()

    await page.goto('/?offline=1&dir=Documents&reader=Documents%2Freader.epub&readerKind=book', {
      waitUntil: 'domcontentloaded',
    })
    await expect(page.getByTestId('reader-book')).toContainText('Selectable EPUB text begins here.')
  })

  test('waiting build preserves old lazy chunks, then activation removes old shell', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000)
    const plan = readAssetPlan()
    const readerEntry = plan.offlineRenderers.find((asset) => /ReaderDialog-[^/]+\.js$/.test(asset))
    expect(readerEntry).toBeTruthy()
    const source = fs.readFileSync(path.join(clientRoot, 'service-worker.js'), 'utf8')
    const nextBuildId = `stage1-upgrade-${Date.now()}`
    const nextSource = source.replace(
      /^const BUILD_ID = [^\n]+/,
      `const BUILD_ID = ${JSON.stringify(nextBuildId)}`,
    )
    const upgradePath = path.join(clientRoot, 'stage1-upgrade-worker.js')
    expect(nextSource).not.toBe(source)
    fs.writeFileSync(upgradePath, nextSource)

    try {
      await page.goto('/library')
      await ensureControlled(page)
      const lifecycle = await page.evaluate(async () => {
        const activeBefore = navigator.serviceWorker.controller?.scriptURL ?? ''
        const registration = await navigator.serviceWorker.register('/stage1-upgrade-worker.js', {
          scope: '/',
          updateViaCache: 'none',
        })
        await new Promise<void>((resolve, reject) => {
          const started = Date.now()
          const poll = () => {
            if (registration.waiting) return resolve()
            if (Date.now() - started > 15_000) {
              return reject(new Error('Upgrade worker did not reach waiting state'))
            }
            setTimeout(poll, 50)
          }
          poll()
        })
        return {
          activeBefore,
          activeDuring: registration.active?.scriptURL ?? '',
          waiting: registration.waiting?.scriptURL ?? '',
          caches: (await caches.keys()).filter((name) => name.startsWith('derp-shell-')),
        }
      })

      expect(lifecycle.activeBefore).toMatch(/\/service-worker\.js$/)
      expect(lifecycle.activeDuring).toMatch(/\/service-worker\.js$/)
      expect(lifecycle.waiting).toMatch(/\/stage1-upgrade-worker\.js$/)
      expect(lifecycle.caches).toContain(`derp-shell-${plan.buildId}`)
      expect(lifecycle.caches).toContain(`derp-shell-${nextBuildId}`)

      await context.setOffline(true)
      expect(
        await page.evaluate(async (entry) => {
          await import(entry)
          return true
        }, readerEntry!),
      ).toBe(true)
      expect(
        await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''),
      ).toMatch(/\/service-worker\.js$/)

      await context.setOffline(false)
      await page.close()
      await expect
        .poll(() =>
          context
            .serviceWorkers()
            .map((worker) => new URL(worker.url()).pathname)
            .sort(),
        )
        .toEqual(['/stage1-upgrade-worker.js'])
      const activatedPage = await context.newPage()
      await activatedPage.goto('/stage1-upgrade-worker.js')
      await expect
        .poll(() =>
          activatedPage.evaluate(async () => {
            const registration = await navigator.serviceWorker.ready
            return registration.active?.scriptURL ?? ''
          }),
        )
        .toMatch(/\/stage1-upgrade-worker\.js$/)
      await expect
        .poll(() =>
          activatedPage.evaluate(async () =>
            (await caches.keys()).filter((name) => name.startsWith('derp-shell-')),
          ),
        )
        .toEqual([`derp-shell-${nextBuildId}`])
    } finally {
      fs.rmSync(upgradePath, { force: true })
    }
  })
})
