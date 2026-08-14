import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createFilesystemFile, deleteFilesystemResource } from './filesystem-actions'
import { libraryUrl } from './canonical-urls'

async function createApplicationContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext()
}

async function gotoWithSSE(page: Page, url: string) {
  const streamRequest = page.waitForRequest(
    (request) => request.url().includes('/api/events/stream'),
    { timeout: 10_000 },
  )
  const consoleConnected = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('[Application SSE] Connected'),
    timeout: 10_000,
  })
  await page.goto(url)
  await Promise.race([streamRequest, consoleConnected])
}

async function deleteFile(page: Page, filePath: string) {
  await deleteFilesystemResource(page.request, filePath)
}

async function createFile(page: Page, filePath: string, content = 'test content') {
  await createFilesystemFile(page.request, filePath, content)
}

test.describe('SSE Live Updates', () => {
  test('application changes are seen by another browser context', async ({ browser }) => {
    const id = randomUUID().slice(0, 10)
    const fileName = `sse-application-sync-${id}.txt`
    const filePath = `MediaContent/${fileName}`

    const ctx1 = await createApplicationContext(browser)
    const admin1 = await ctx1.newPage()
    const ctx2 = await createApplicationContext(browser)
    const admin2 = await ctx2.newPage()

    await admin1.goto(libraryUrl('MediaContent'))
    await expect(admin1.locator('table')).toBeVisible()
    await gotoWithSSE(admin2, libraryUrl('MediaContent'))
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
