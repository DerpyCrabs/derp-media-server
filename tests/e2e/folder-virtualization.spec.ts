import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { libraryUrl } from './canonical-urls'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const folderName = `VirtualLarge-${batchId ?? 'local'}`
const fileCount = 500

async function scrollWindowUntilVisible(page: Page, target: Locator) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await target.isVisible()) return
    const previousHeight = await page.evaluate(() => document.body.scrollHeight)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect
      .poll(
        async () =>
          (await target.isVisible()) ||
          (await page.evaluate(() => document.body.scrollHeight)) > previousHeight,
      )
      .toBe(true)
  }
  await expect(target).toBeVisible()
}

test.describe('Folder virtualization', () => {
  test.beforeAll(() => {
    const folderPath = path.resolve(mediaDirName, folderName)
    fs.rmSync(folderPath, { recursive: true, force: true })
    fs.mkdirSync(folderPath, { recursive: true })

    for (let i = 0; i < fileCount; i += 1) {
      fs.writeFileSync(path.join(folderPath, `item-${String(i).padStart(4, '0')}.txt`), `${i}`)
    }
  })

  test('list view only mounts visible rows and scrolls to far files', async ({ page }) => {
    await page.goto(libraryUrl(folderName))
    await page.getByRole('button', { name: 'List view' }).click()
    await expect(page.locator('table').getByText('item-0000.txt')).toBeVisible()

    expect(await page.locator('[data-file-path]').count()).toBeLessThan(80)
    await expect(page.getByText('item-0499.txt')).toHaveCount(0)

    await scrollWindowUntilVisible(
      page,
      page.locator('table').getByText('item-0499.txt', { exact: true }),
    )
  })

  test('grid view only mounts visible cards and scrolls to far files', async ({ page }) => {
    await page.goto(libraryUrl(folderName))
    await page.getByRole('button', { name: 'Grid view' }).click()
    await expect(page.locator('[data-testid=file-browser] .file-browser-grid')).toBeVisible()
    await expect(page.getByText('item-0000.txt')).toBeVisible()

    expect(await page.locator('[data-file-path]').count()).toBeLessThan(80)
    await expect(page.getByText('item-0499.txt')).toHaveCount(0)

    await scrollWindowUntilVisible(page, page.getByText('item-0499.txt', { exact: true }))
  })
})
