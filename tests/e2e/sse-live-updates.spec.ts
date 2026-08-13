import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import path from 'path'

const sessionFile = process.env.BATCH_ID ? `session-${process.env.BATCH_ID}.json` : 'session.json'
const authStoragePath = path.resolve(__dirname, '../fixtures/.auth', sessionFile)

async function createAdminContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: authStoragePath })
}

async function gotoWithSSE(page: Page, url: string) {
  const streamRequest = page.waitForRequest(
    (request) => request.url().includes('/api/events/stream'),
    { timeout: 10_000 },
  )
  const consoleConnected = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('[Admin SSE] Connected'),
    timeout: 10_000,
  })
  await page.goto(url)
  await Promise.race([streamRequest, consoleConnected])
}

async function deleteFile(page: Page, filePath: string) {
  await page.request.post('/api/files/delete', { data: { path: filePath } })
}

async function createFile(page: Page, filePath: string, content = 'test content') {
  await page.request.post('/api/files/create', {
    data: { type: 'file', path: filePath, content },
  })
}

test.describe('SSE Live Updates', () => {
  test('admin changes are seen by another admin user', async ({ browser }) => {
    const id = randomUUID().slice(0, 10)
    const fileName = `sse-admin-sync-${id}.txt`
    const filePath = `MediaContent/${fileName}`

    const ctx1 = await createAdminContext(browser)
    const admin1 = await ctx1.newPage()
    const ctx2 = await createAdminContext(browser)
    const admin2 = await ctx2.newPage()

    await admin1.goto('/?dir=MediaContent')
    await expect(admin1.locator('table')).toBeVisible()
    await gotoWithSSE(admin2, '/?dir=MediaContent')
    await expect(admin2.locator('table')).toBeVisible()

    await createFile(admin1, filePath, 'synced')
    await expect(admin1.locator('table').getByText(fileName)).toBeVisible()
    await expect(admin2.locator('table').getByText(fileName)).toBeVisible()

    await deleteFile(admin1, filePath)
    await expect(admin2.locator('table').getByText(fileName)).not.toBeVisible()

    await admin1.close()
    await ctx1.close()
    await admin2.close()
    await ctx2.close()
  })
})
