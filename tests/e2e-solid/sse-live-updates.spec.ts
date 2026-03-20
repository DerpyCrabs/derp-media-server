import { test, expect, Page, BrowserContext } from '@playwright/test'
import path from 'path'

const sessionFile = process.env.BATCH_ID ? `session-${process.env.BATCH_ID}.json` : 'session.json'
const authStoragePath = path.resolve(__dirname, '../fixtures/.auth', sessionFile)

async function createAdminContext(
  browser: import('@playwright/test').Browser,
): Promise<BrowserContext> {
  return browser.newContext({ storageState: authStoragePath })
}

async function createShare(
  page: Page,
  body: Record<string, unknown>,
): Promise<{ url: string; token: string }> {
  const res = await page.request.post('/api/shares', { data: body })
  const json = await res.json()
  const base = `/share/${json.share.token}`
  const url = json.share.passcode ? `${base}?p=${encodeURIComponent(json.share.passcode)}` : base
  return { url, token: json.share.token }
}

async function gotoWithSSE(page: Page, url: string) {
  // SSE responses stay open; waitForRequest matches once the stream is opened (unlike waitForResponse).
  const expectShareStream = url.includes('/share/')
  const streamRequest = page.waitForRequest(
    (r) => {
      const u = r.url()
      if (expectShareStream) return u.includes('/api/share/') && u.includes('/stream')
      return u.includes('/api/events/stream')
    },
    { timeout: 10000 },
  )
  const consoleConnected = page.waitForEvent('console', {
    predicate: (msg) => {
      const text = msg.text()
      return (
        text.includes('[Admin SSE] Connected') ||
        text.includes('[Share SSE] Connected to share stream')
      )
    },
    timeout: 10000,
  })
  await page.goto(url)
  await Promise.race([streamRequest, consoleConnected])
}

async function deleteShare(page: Page, token: string) {
  await page.request.post('/api/shares/delete', { data: { token } })
}

async function deleteFile(page: Page, filePath: string) {
  await page.request.post('/api/files/delete', { data: { path: filePath } })
}

async function createFile(page: Page, filePath: string, content = 'test content') {
  await page.request.post('/api/files/create', {
    data: { type: 'file', path: filePath, content },
  })
}

async function renameFile(page: Page, oldPath: string, newPath: string) {
  await page.request.post('/api/files/rename', {
    data: { oldPath, newPath },
  })
}

test.describe('SSE Live Updates', () => {
  test('admin renames file in shared folder -> share view updates', async ({ browser }) => {
    const adminCtx = await createAdminContext(browser)
    const adminPage = await adminCtx.newPage()

    const { url: shareUrl, token } = await createShare(adminPage, {
      path: 'SharedContent',
      isDirectory: true,
    })

    await createFile(adminPage, 'SharedContent/sse-rename-target.txt')

    const shareCtx = await browser.newContext()
    const sharePage = await shareCtx.newPage()
    await gotoWithSSE(sharePage, shareUrl)
    await expect(sharePage.getByText('sse-rename-target.txt')).toBeVisible()

    await renameFile(
      adminPage,
      'SharedContent/sse-rename-target.txt',
      'SharedContent/sse-renamed-result.txt',
    )

    await expect(sharePage.getByText('sse-renamed-result.txt')).toBeVisible()
    await expect(sharePage.getByText('sse-rename-target.txt')).not.toBeVisible()

    await deleteFile(adminPage, 'SharedContent/sse-renamed-result.txt')
    await deleteShare(adminPage, token)
    await sharePage.close()
    await shareCtx.close()
    await adminPage.close()
    await adminCtx.close()
  })

  test('admin changes are seen by another admin user', async ({ browser }) => {
    const ctx1 = await createAdminContext(browser)
    const admin1 = await ctx1.newPage()
    const ctx2 = await createAdminContext(browser)
    const admin2 = await ctx2.newPage()

    await admin1.goto('/?dir=SharedContent')
    await expect(admin1.locator('table')).toBeVisible()
    await gotoWithSSE(admin2, '/?dir=SharedContent')
    await expect(admin2.locator('table')).toBeVisible()

    await createFile(admin1, 'SharedContent/sse-admin-sync.txt', 'synced')
    await expect(admin1.locator('table').getByText('sse-admin-sync.txt')).toBeVisible()

    await expect(admin2.locator('table').getByText('sse-admin-sync.txt')).toBeVisible()

    await deleteFile(admin1, 'SharedContent/sse-admin-sync.txt')
    await expect(admin2.locator('table').getByText('sse-admin-sync.txt')).not.toBeVisible()

    await admin1.close()
    await ctx1.close()
    await admin2.close()
    await ctx2.close()
  })

  test('editable share changes are seen by admin user', async ({ browser }) => {
    const adminCtx = await createAdminContext(browser)
    const adminPage = await adminCtx.newPage()

    const { url: shareUrl, token } = await createShare(adminPage, {
      path: 'SharedContent',
      isDirectory: true,
      editable: true,
      restrictions: { allowUpload: true, allowEdit: true, allowDelete: true },
    })

    await gotoWithSSE(adminPage, '/?dir=SharedContent')
    await expect(adminPage.locator('table')).toBeVisible()

    const shareCtx = await browser.newContext()
    const sharePage = await shareCtx.newPage()
    await sharePage.goto(shareUrl)
    await expect(sharePage.locator('table')).toBeVisible()

    await sharePage.locator('button[title="Create new file"]').click()
    const nameInput = sharePage.locator('[role="dialog"]').getByRole('textbox')
    await nameInput.clear()
    await nameInput.fill('sse-share-to-admin.txt')
    await sharePage.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(sharePage.locator('table').getByText('sse-share-to-admin.txt')).toBeVisible()

    await expect(adminPage.locator('table').getByText('sse-share-to-admin.txt')).toBeVisible()

    await deleteFile(adminPage, 'SharedContent/sse-share-to-admin.txt')
    await deleteShare(adminPage, token)
    await sharePage.close()
    await shareCtx.close()
    await adminPage.close()
    await adminCtx.close()
  })

  test('editable share changes are seen by another share user', async ({ browser }) => {
    const adminCtx = await createAdminContext(browser)
    const adminPage = await adminCtx.newPage()

    const { url: shareUrl, token } = await createShare(adminPage, {
      path: 'SharedContent',
      isDirectory: true,
      editable: true,
      restrictions: { allowUpload: true, allowEdit: true, allowDelete: true },
    })

    const shareCtx1 = await browser.newContext()
    const share1 = await shareCtx1.newPage()
    await share1.goto(shareUrl)
    await expect(share1.locator('table')).toBeVisible()

    const shareCtx2 = await browser.newContext()
    const share2 = await shareCtx2.newPage()
    await gotoWithSSE(share2, shareUrl)
    await expect(share2.locator('table')).toBeVisible()

    await share1.locator('button[title="Create new file"]').click()
    const nameInput = share1.locator('[role="dialog"]').getByRole('textbox')
    await nameInput.clear()
    await nameInput.fill('sse-share-to-share.txt')
    await share1.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(share1.locator('table').getByText('sse-share-to-share.txt')).toBeVisible()
    await expect(share1.locator('[role="dialog"]')).not.toBeVisible()

    await expect(share2.locator('table').getByText('sse-share-to-share.txt')).toBeVisible()

    await share1
      .locator('table tr')
      .filter({ hasText: 'sse-share-to-share.txt' })
      .click({ button: 'right' })
    await share1.locator('[data-slot="context-menu-item"]').getByText('Delete').click()
    await share1.getByRole('button', { name: /Delete/i }).click()

    await expect(share2.locator('table').getByText('sse-share-to-share.txt')).not.toBeVisible()

    await deleteShare(adminPage, token)
    await share1.close()
    await shareCtx1.close()
    await share2.close()
    await shareCtx2.close()
    await adminPage.close()
    await adminCtx.close()
  })
})
