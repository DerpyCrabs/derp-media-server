import { test, expect, Page } from '@playwright/test'
import path from 'path'

const authStoragePath = path.resolve(__dirname, '../fixtures/.auth/session.json')

let fileShareUrl: string
let folderShareUrl: string
let editableShareUrl: string

async function createShare(page: Page, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/shares', { data: body })
  const json = await res.json()
  const base = `http://localhost:5973/share/${json.share.token}`
  return json.share.passcode ? `${base}?p=${encodeURIComponent(json.share.passcode)}` : base
}

test.describe('Using Shares', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStoragePath })
    const page = await context.newPage()
    fileShareUrl = await createShare(page, {
      path: 'Documents/readme.txt',
      isDirectory: false,
    })
    folderShareUrl = await createShare(page, {
      path: 'SharedContent',
      isDirectory: true,
    })
    editableShareUrl = await createShare(page, {
      path: 'SharedContent',
      isDirectory: true,
      editable: true,
      restrictions: {
        allowUpload: true,
        allowEdit: true,
        allowDelete: true,
      },
    })
    await page.close()
    await context.close()
  })

  test('views a shared text file page', async ({ page }) => {
    await page.goto(fileShareUrl)
    await expect(page.getByText('readme.txt')).toBeVisible()
    await expect(page.getByText('TXT File')).toBeVisible()
  })

  test('shared file page shows download button', async ({ page }) => {
    await page.goto(fileShareUrl)
    await expect(
      page.getByRole('button', { name: /Download/i }).or(page.locator('a:has-text("Download")')),
    ).toBeVisible()
  })

  test('browses a shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await expect(page.getByText('public-doc.txt')).toBeVisible()
    await expect(page.getByText('subfolder')).toBeVisible()
  })

  test('navigates into subfolder within shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.getByText('subfolder').first().click()
    await page.waitForURL(/dir=subfolder/)
    await expect(page.getByText('nested.txt')).toBeVisible()
  })

  test('uses breadcrumbs to navigate within share', async ({ page }) => {
    const url = new URL(folderShareUrl)
    url.searchParams.set('dir', 'subfolder')
    await page.goto(url.toString())
    await expect(page.getByText('nested.txt')).toBeVisible()
    await page.getByRole('button', { name: 'SharedContent' }).click()
    await expect(page.getByText('public-doc.txt')).toBeVisible()
  })

  test('plays video in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.getByText('public-video.mp4').click()
    await expect(page.locator('video')).toBeVisible()
  })

  test('views text file in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.getByText('public-doc.txt').click()
    await expect(page.getByText('public document for share testing')).toBeVisible()
  })

  test('edits a file in editable share', async ({ page }) => {
    await page.goto(editableShareUrl)
    await page.locator('table').getByText('public-doc.txt').click()
    const textarea = page.locator('textarea')
    await expect(textarea).toBeVisible()

    await textarea.fill('Edited via share.\n')
    await page.locator('button[title="Close"]').focus()
    await page.waitForTimeout(500)

    // Close and reopen to verify persistence
    await page.locator('button[title="Close"]').click()
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()
    await page.locator('table').getByText('public-doc.txt').click()
    await expect(page.locator('textarea')).toBeVisible()
    const content = await page.locator('textarea').inputValue()
    expect(content).toContain('Edited via share')

    // Restore original content
    await page.locator('textarea').fill('This is a public document for share testing.\n')
    await page.locator('button[title="Close"]').focus()
    await page.waitForTimeout(500)
    await page.locator('button[title="Close"]').click()
  })

  test('creates a file in editable share', async ({ page }) => {
    await page.goto(editableShareUrl)
    await page.locator('button[title="Create new file"]').click()
    const nameInput = page.locator('[role="dialog"]').getByRole('textbox')
    await nameInput.clear()
    await nameInput.fill('share-created.txt')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.locator('table').getByText('share-created.txt')).toBeVisible()
  })

  test('creates a folder in editable share', async ({ page }) => {
    await page.goto(editableShareUrl)
    await page.locator('button[title="Create new folder"]').click()
    await page.locator('input[placeholder="Folder name"]').fill('share-folder')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByText('share-folder')).toBeVisible()
  })

  test('deletes a file in editable share', async ({ page }) => {
    await page.goto(editableShareUrl)
    await expect(page.locator('table').getByText('share-created.txt')).toBeVisible()

    await page
      .locator('table tr')
      .filter({ hasText: 'share-created.txt' })
      .click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Delete').click()
    await page.getByRole('button', { name: /Delete/i }).click()

    await expect(page.locator('table').getByText('share-created.txt')).not.toBeVisible()
  })

  test('non-editable share hides edit controls', async ({ page }) => {
    await page.goto(folderShareUrl)
    await expect(page.locator('button[title="Create new file"]')).not.toBeVisible()
    await expect(page.locator('button[title="Create new folder"]')).not.toBeVisible()

    await page.locator('table').getByText('public-doc.txt').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit' })).not.toBeVisible()
  })
})
