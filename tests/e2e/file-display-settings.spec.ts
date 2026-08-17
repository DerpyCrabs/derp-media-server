import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const batchId = process.env.BATCH_ID
const mediaDir = batchId ? `test-media-${batchId}` : 'test-media'

async function saveSort(
  page: Page,
  folderPath: string,
  field: 'name' | 'createdDate' | 'size',
  direction: 'asc' | 'desc',
) {
  const response = await page.request.post('/api/settings/sortOrder', {
    data: { path: folderPath, field, direction },
  })
  expect(response.ok()).toBe(true)
}

test.describe('File display settings', () => {
  test('hides creation dates by default and persists menu sorting and global columns', async ({
    page,
  }) => {
    const folderName = `SortProbe-${Date.now()}`
    const folderPath = path.resolve(mediaDir, folderName)
    fs.mkdirSync(folderPath, { recursive: true })
    fs.writeFileSync(path.join(folderPath, 'alpha.txt'), 'a')
    fs.writeFileSync(path.join(folderPath, 'beta.txt'), 'bbbb')
    fs.writeFileSync(path.join(folderPath, 'gamma.txt'), 'gg')

    try {
      await page.goto(`/?dir=${encodeURIComponent(folderName)}`)
      await expect(page.getByRole('group', { name: 'View mode' })).toHaveCount(0)
      await page.getByRole('button', { name: 'Display options' }).click()
      await expect(page.getByRole('menuitem', { name: 'List view' })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Grid view' })).toBeVisible()
      await page.getByRole('button', { name: 'Display options' }).click()
      await expect(page.locator('thead')).toHaveCount(0)
      await expect(page.locator('tbody tr[data-file-path] td.tabular-nums')).toHaveCount(0)

      const listing = await page.request.get(`/api/files?dir=${encodeURIComponent(folderName)}`)
      const body = (await listing.json()) as { files: { createdDate?: number }[] }
      expect(body.files.every((file) => typeof file.createdDate === 'number')).toBe(true)

      const sizeResponse = page.waitForResponse(
        (response) => response.url().includes('/api/settings/sortOrder') && response.ok(),
      )
      await page.getByRole('button', { name: 'Display options' }).click()
      await page.getByRole('menuitem', { name: 'Size' }).click()
      await sizeResponse
      await page.getByRole('button', { name: 'Display options' }).click()

      const fileNames = page.locator('tbody tr[data-file-path] td:nth-child(2)')
      await expect(fileNames).toHaveText(['beta.txt', 'gamma.txt', 'alpha.txt'])
      await page.reload()
      await expect(fileNames).toHaveText(['beta.txt', 'gamma.txt', 'alpha.txt'])

      await page.getByRole('button', { name: 'Display options' }).click()
      const menu = page.getByTestId('explorer-display-options')
      const columnsResponse = page.waitForResponse(
        (response) => response.url().includes('/api/settings/fileColumns') && response.ok(),
      )
      await expect(menu.getByRole('checkbox', { name: 'Created' })).not.toBeChecked()
      await menu.getByRole('checkbox', { name: 'Created' }).check()
      await columnsResponse
      await expect(page.locator('tbody tr[data-file-path] td.tabular-nums')).toHaveCount(3)
      await page.reload()
      await expect(page.locator('thead')).toHaveCount(0)
      await expect(page.locator('tbody tr[data-file-path] td.tabular-nums')).toHaveCount(3)
    } finally {
      await page.request.post('/api/settings/fileColumns', {
        data: { createdDate: false, size: true },
      })
      await saveSort(page, folderName, 'name', 'asc')
      fs.rmSync(folderPath, { recursive: true, force: true })
    }
  })

  test('uses active folder sorting for image navigation', async ({ page }) => {
    await saveSort(page, 'Images', 'name', 'desc')
    try {
      await page.goto('/?dir=Images&viewing=Images%2Fphoto.png')
      await expect(page.locator('img[alt="photo.png"]')).toBeVisible()
      await page.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
      )
      await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
    } finally {
      await saveSort(page, 'Images', 'name', 'asc')
    }
  })

  test('uses active folder sorting for audio playback queue', async ({ page }) => {
    const musicPath = path.resolve(mediaDir, 'Music')
    const source = path.join(musicPath, 'track.mp3')
    const first = path.join(musicPath, 'aaa.mp3')
    const last = path.join(musicPath, 'zzz.mp3')
    fs.copyFileSync(source, first)
    fs.copyFileSync(source, last)
    await saveSort(page, 'Music', 'name', 'desc')
    try {
      await page.goto('/?dir=Music')
      await page.locator('table').getByText('zzz.mp3', { exact: true }).click()
      await expect(page).toHaveURL(/playing=Music.*zzz\.mp3/)
      await page.locator('button:has(.lucide-step-forward)').click()
      await expect(page).toHaveURL(/playing=Music.*track\.mp3/)
    } finally {
      await saveSort(page, 'Music', 'name', 'asc')
      fs.rmSync(first, { force: true })
      fs.rmSync(last, { force: true })
    }
  })
})
