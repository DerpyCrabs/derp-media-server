import { randomUUID } from 'node:crypto'
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

async function createAdminContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext()
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

  test('reconnect catches up files and settings missed while offline', async ({ browser }) => {
    const id = randomUUID().slice(0, 10)
    const fileName = `sse-reconnect-${id}.txt`
    const filePath = `MediaContent/${fileName}`
    const pin = {
      id: `sse-reconnect-pin-${id}`,
      path: filePath,
      isDirectory: false,
      title: fileName,
      source: { kind: 'local' },
    }
    const onlineContext = await createAdminContext(browser)
    const online = await onlineContext.newPage()
    const offlineContext = await createAdminContext(browser)
    const filesPage = await offlineContext.newPage()
    const workspacePage = await offlineContext.newPage()
    try {
      await Promise.all([
        gotoWithSSE(filesPage, '/?dir=MediaContent'),
        gotoWithSSE(workspacePage, `/workspace?ws=sse-reconnect-${id}`),
      ])
      await expect(filesPage.locator('table')).toBeVisible()
      await expect(workspacePage.locator('[data-window-group]').first()).toBeVisible()
      await expect(filesPage.locator('table').getByText(fileName)).not.toBeVisible()
      await expect(workspacePage.locator(`[title="File: ${filePath}"]`)).not.toBeVisible()

      await offlineContext.setOffline(true)
      await createFile(online, filePath, 'created while peer was offline')
      const pinUpdate = await online.request.post('/api/settings/workspaceTaskbarPins/add', {
        data: { pin },
      })
      expect(pinUpdate.ok()).toBe(true)
      await expect(filesPage.locator('table').getByText(fileName)).not.toBeVisible()
      await expect(workspacePage.locator(`[title="File: ${filePath}"]`)).not.toBeVisible()

      const reconnected = Promise.race([
        filesPage.waitForEvent('console', {
          predicate: (message) => message.text().includes('[Admin SSE] Connected'),
        }),
        workspacePage.waitForEvent('console', {
          predicate: (message) => message.text().includes('[Admin SSE] Connected'),
        }),
      ])
      await offlineContext.setOffline(false)
      await reconnected

      await expect(filesPage.locator('table').getByText(fileName)).toBeVisible()
      await expect(workspacePage.locator(`[title="File: ${filePath}"]`)).toBeVisible()
    } finally {
      await offlineContext.setOffline(false)
      await deleteFile(online, filePath).catch(() => {})
      await online.request.post('/api/settings/workspaceTaskbarPins/remove', {
        data: { id: pin.id },
      })
      await Promise.all([filesPage.close(), workspacePage.close(), online.close()])
      await Promise.all([offlineContext.close(), onlineContext.close()])
    }
  })
})
