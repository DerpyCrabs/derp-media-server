import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const batchId = process.env.BATCH_ID
const mediaDir = batchId ? `test-media-${batchId}` : 'test-media'
const UPLOAD_DIR = 'MediaContent'

test.describe('File Upload', () => {
  test('upload button is visible in editable folders', async ({ page }) => {
    await page.goto(`/?dir=${UPLOAD_DIR}`)
    await expect(page.locator('button[title="Upload"]')).toBeVisible()
  })

  test('upload button is hidden in non-editable folders', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await expect(page.locator('button[title="Upload"]')).not.toBeVisible()
  })

  test('upload menu shows file and folder options', async ({ page }) => {
    await page.goto(`/?dir=${UPLOAD_DIR}`)
    await page.locator('button[title="Upload"]').click()
    await expect(page.getByText('Upload files')).toBeVisible()
    await expect(page.getByText('Upload folder')).toBeVisible()
  })

  test('uploads exact bytes through the picker and keeps them after reload', async ({ page }) => {
    const name = `upload-${crypto.randomUUID()}.bin`
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))
    const destination = path.resolve(mediaDir, UPLOAD_DIR, name)
    try {
      await page.goto(`/?dir=${UPLOAD_DIR}`)
      const chosen = page.waitForEvent('filechooser')
      await page.locator('button[title="Upload"]').click()
      await page.getByText('Upload files', { exact: true }).click()
      await (await chosen).setFiles({ name, mimeType: 'application/octet-stream', buffer: bytes })
      await expect(page.getByText('Upload complete')).toBeVisible()
      await expect(page.locator('table').getByText(name, { exact: true })).toBeVisible()
      expect(fs.readFileSync(destination)).toEqual(bytes)
      await page.reload()
      await expect(page.locator('table').getByText(name, { exact: true })).toBeVisible()
      const downloaded = await page.request.get(
        `/api/files/download?path=${encodeURIComponent(`${UPLOAD_DIR}/${name}`)}`,
      )
      expect(downloaded.ok()).toBe(true)
      expect(await downloaded.body()).toEqual(bytes)
    } finally {
      fs.rmSync(destination, { force: true })
    }
  })

  test('shows uploading progress toast', async ({ page }) => {
    await page.goto(`/?dir=${UPLOAD_DIR}`)

    const tmpFile = path.resolve(mediaDir, 'progress-test.txt')
    fs.writeFileSync(tmpFile, 'testing progress indicator')

    try {
      const fileChooserPromise = page.waitForEvent('filechooser')
      await page.locator('button[title="Upload"]').click()
      await page.getByText('Upload files').click()
      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(tmpFile)

      // Should see either the uploading state or the success state
      await expect(page.getByText('Uploading').or(page.getByText('Upload complete'))).toBeVisible({
        timeout: 15_000,
      })

      await expect(page.locator('table').getByText('progress-test.txt')).toBeVisible({
        timeout: 15_000,
      })

      // Cleanup
      await page
        .locator('table tr')
        .filter({ hasText: 'progress-test.txt' })
        .click({ button: 'right' })
      await page.locator('[data-slot="context-menu-item"]').getByText('Delete').click()
      await page.getByRole('button', { name: /Delete/i }).click()
    } finally {
      fs.rmSync(tmpFile, { force: true })
    }
  })
})
