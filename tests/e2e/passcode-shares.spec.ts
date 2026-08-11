import { expect, test, type Page, type Request } from '@playwright/test'

const PASSCODE_TOKEN = 'test-passcode-share-token1'
const CORRECT_PASSCODE = 'secret123'
const WRONG_PASSCODE = 'wrong-passcode'
const EMPTY_STORAGE = { cookies: [], origins: [] }
test.use({ storageState: EMPTY_STORAGE })

function isOwnerApi(request: Request): boolean {
  const pathname = new URL(request.url()).pathname
  return pathname.startsWith('/api/') && !/^\/api\/share\/[^/]+(?:\/|$)/.test(pathname)
}

function collectOwnerApiRequests(page: Page): Request[] {
  const requests: Request[] = []
  page.on('request', (request) => {
    if (isOwnerApi(request)) requests.push(request)
  })
  return requests
}

async function expectSanitizedLocation(page: Page, expected: { search: string; hash: string }) {
  await expect
    .poll(() =>
      page.evaluate(() => ({ search: window.location.search, hash: window.location.hash })),
    )
    .toEqual(expected)
}

async function pickEveryFloatingThemeChoice(page: Page) {
  for (const choice of ['Light', 'Dark', 'System', 'Default', 'Caffeine', 'Cosmic Night']) {
    await page.getByRole('button', { name: 'Open theme settings' }).click()
    const menu = page.getByRole('menu', { name: 'Theme settings' })
    await expect(menu.getByText('Offline files', { exact: true })).toHaveCount(0)
    await expect(menu.getByText('Media directories', { exact: true })).toHaveCount(0)
    await menu.getByRole('menuitem', { name: choice, exact: true }).click()
  }
}

async function expectPasscodeAbsentFromBrowserStorage(page: Page, passcode: string) {
  const storage = await page.evaluate(async () => {
    const local = Object.entries(localStorage)
    const session = Object.entries(sessionStorage)
    const databases: unknown[] = []

    for (const info of await indexedDB.databases()) {
      const databaseName = info.name
      if (!databaseName) continue
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const stores: Record<string, { keys: IDBValidKey[]; values: unknown[] }> = {}
      for (const storeName of database.objectStoreNames) {
        const transaction = database.transaction(storeName, 'readonly')
        const store = transaction.objectStore(storeName)
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const request = store.getAllKeys()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = store.getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        stores[storeName] = { keys, values }
      }
      database.close()
      databases.push({ name: databaseName, version: info.version, stores })
    }

    const cacheKeys: string[] = []
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName)
      cacheKeys.push(...(await cache.keys()).map((request) => request.url))
    }

    return { local, session, databases, cacheKeys }
  })

  expect(JSON.stringify(storage)).not.toContain(passcode)
  const cookies = await page.context().cookies()
  expect(JSON.stringify(cookies)).not.toContain(passcode)
}

test.describe('Passcode-Protected Shares', () => {
  test('shows passcode gate for protected share', async ({ page }) => {
    await page.goto(`/share/${PASSCODE_TOKEN}`)
    await expect(page.getByText('Protected Share')).toBeVisible()
    await expect(page.locator('input[placeholder="Enter passcode"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Access Share' })).toBeVisible()
  })

  test('rejects wrong passcode', async ({ page }) => {
    await page.goto(`/share/${PASSCODE_TOKEN}`)
    await page.locator('input[placeholder="Enter passcode"]').fill('wrong')
    await page.getByRole('button', { name: 'Access Share' }).click()
    await expect(page.locator('.text-destructive')).toBeVisible()
  })

  test('accepts correct passcode and shows content', async ({ page }) => {
    await page.goto(`/share/${PASSCODE_TOKEN}`)
    await page.locator('input[placeholder="Enter passcode"]').fill(CORRECT_PASSCODE)
    await page.getByRole('button', { name: 'Access Share' }).click()

    await expect(page.getByText('public-doc.txt')).toBeVisible()
  })

  test('legacy query passcode auto-authenticates, scrubs immediately, and never leaks in Referer', async ({
    page,
  }) => {
    const requests: Request[] = []
    page.on('request', (request) => requests.push(request))

    await page.goto(
      `/share/${PASSCODE_TOKEN}?keep=legacy&p=${encodeURIComponent(CORRECT_PASSCODE)}#panel=classic`,
    )
    await expectSanitizedLocation(page, { search: '?keep=legacy', hash: '#panel=classic' })
    await expect(page.getByText('public-doc.txt')).toBeVisible()

    const shareRequests = requests.filter((request) => request.url().includes('/api/share/'))
    expect(shareRequests.length).toBeGreaterThan(0)
    for (const request of requests) {
      const referer = request.headers().referer
      expect(referer ?? '').not.toContain(CORRECT_PASSCODE)
      if (referer) expect(new URL(referer).searchParams.has('p')).toBe(false)
    }
  })

  test('classic fragment passcode auto-authenticates and preserves non-secret URL state', async ({
    page,
  }) => {
    await page.goto(
      `/share/${PASSCODE_TOKEN}?keep=classic#p=${encodeURIComponent(CORRECT_PASSCODE)}&panel=theme`,
    )
    await expectSanitizedLocation(page, { search: '?keep=classic', hash: '#panel=theme' })
    await expect(page.getByText('public-doc.txt')).toBeVisible()
  })

  test('workspace fragment passcode auto-authenticates and preserves non-secret URL state', async ({
    page,
  }) => {
    await page.goto(
      `/share/${PASSCODE_TOKEN}/workspace?keep=workspace#p=${encodeURIComponent(CORRECT_PASSCODE)}&panel=desk`,
    )
    await expect
      .poll(() =>
        page.evaluate(() => {
          const params = new URLSearchParams(window.location.search)
          return {
            keep: params.get('keep'),
            hasPasscode: params.has('p'),
            hash: window.location.hash,
          }
        }),
      )
      .toEqual({ keep: 'workspace', hasPasscode: false, hash: '#panel=desk' })
    await expect(page.locator('.workspace-layout')).toBeVisible()
  })

  test('fragment passcode takes precedence over legacy query passcode', async ({ page }) => {
    await page.goto(
      `/share/${PASSCODE_TOKEN}?p=${encodeURIComponent(WRONG_PASSCODE)}&keep=query#p=${encodeURIComponent(CORRECT_PASSCODE)}&panel=precedence`,
    )
    await expectSanitizedLocation(page, { search: '?keep=query', hash: '#panel=precedence' })
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await expect(page.getByText('Invalid passcode')).toHaveCount(0)
  })

  test('invalid fragment passcode is scrubbed before the error is shown', async ({ page }) => {
    await page.goto(
      `/share/${PASSCODE_TOKEN}?keep=invalid#p=${encodeURIComponent(WRONG_PASSCODE)}&panel=gate`,
    )
    await expectSanitizedLocation(page, { search: '?keep=invalid', hash: '#panel=gate' })
    await expect(page.getByText('Invalid passcode')).toBeVisible()
    await expect(page.locator('input[placeholder="Enter passcode"]')).toBeVisible()
  })

  test('back and forward history never resurrect captured credentials', async ({ page }) => {
    await page.goto(`/share/${PASSCODE_TOKEN}`)
    await expect(page.getByText('Protected Share')).toBeVisible()
    await page.goto(
      `/share/${PASSCODE_TOKEN}#p=${encodeURIComponent(CORRECT_PASSCODE)}&panel=history`,
    )
    await expectSanitizedLocation(page, { search: '', hash: '#panel=history' })
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await page.goto('/share/test-unprotected-share-token1?keep=forward#panel=next')

    await page.goBack()
    await expectSanitizedLocation(page, { search: '', hash: '#panel=history' })
    await page.goBack()
    await expectSanitizedLocation(page, { search: '', hash: '' })
    await expect.poll(() => new URL(page.url()).searchParams.has('p')).toBe(false)
    await expect.poll(() => new URL(page.url()).hash.includes('p=')).toBe(false)
    await page.goForward()
    await expectSanitizedLocation(page, { search: '', hash: '#panel=history' })
    await page.goForward()
    await expectSanitizedLocation(page, { search: '?keep=forward', hash: '#panel=next' })
  })

  test('captured passcode is absent from browser persistence', async ({ page }) => {
    await page.goto(`/share/${PASSCODE_TOKEN}#p=${encodeURIComponent(CORRECT_PASSCODE)}`)
    await expectSanitizedLocation(page, { search: '', hash: '' })
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await expectPasscodeAbsentFromBrowserStorage(page, CORRECT_PASSCODE)
  })
})

test.describe('Public surface owner isolation', () => {
  test('public theme controls and crafted reader state make no owner API requests', async ({
    page,
  }) => {
    test.setTimeout(45_000)
    const ownerRequests = collectOwnerApiRequests(page)

    await page.goto('/login')
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await pickEveryFloatingThemeChoice(page)

    await page.goto(`/share/${PASSCODE_TOKEN}`)
    await expect(page.getByText('Protected Share')).toBeVisible()
    await pickEveryFloatingThemeChoice(page)

    await page.goto(`/share/${PASSCODE_TOKEN}#p=${encodeURIComponent(CORRECT_PASSCODE)}`)
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await page.getByRole('button', { name: 'Open share settings' }).click()
    await expect(page.getByText('Offline files', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Media directories', { exact: true })).toHaveCount(0)
    for (const choice of ['Light', 'Dark', 'System', 'Default', 'Caffeine', 'Cosmic Night']) {
      await page.getByRole('menuitem', { name: choice, exact: true }).click()
    }

    await page.goto(`/share/${PASSCODE_TOKEN}/workspace`)
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await page.getByRole('button', { name: 'Open settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings.getByText('Media directories', { exact: true })).toHaveCount(0)
    for (const choice of ['Light', 'Dark', 'System', 'Default', 'Caffeine', 'Cosmic Night']) {
      await settings.getByRole('button', { name: choice, exact: true }).click()
    }

    await page.goto(
      `/share/${PASSCODE_TOKEN}?reader=${encodeURIComponent('Documents/sample.pdf')}&readerKind=pdf`,
    )
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await expect(page.getByTestId('pdf-canvas')).toHaveCount(0)

    await page.waitForTimeout(250)
    expect(
      ownerRequests.map((request) => `${request.method()} ${new URL(request.url()).pathname}`),
    ).toEqual([])
  })
})
