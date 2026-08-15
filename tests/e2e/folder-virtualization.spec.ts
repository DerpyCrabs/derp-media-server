import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const folderName = `VirtualLarge-${batchId ?? 'local'}`
const mediaFolderName = `VirtualMedia-${batchId ?? 'local'}`
const fileCount = 500

test.describe('Folder virtualization', () => {
  test.beforeAll(() => {
    const folderPath = path.resolve(mediaDirName, folderName)
    fs.rmSync(folderPath, { recursive: true, force: true })
    fs.mkdirSync(folderPath, { recursive: true })

    for (let i = 0; i < fileCount; i += 1) {
      fs.writeFileSync(path.join(folderPath, `item-${String(i).padStart(4, '0')}.txt`), `${i}`)
    }

    const mediaFolderPath = path.resolve(mediaDirName, mediaFolderName)
    fs.mkdirSync(mediaFolderPath, { recursive: true })
    const sourceImage = path.resolve(mediaDirName, 'Images', 'photo.png')
    for (let i = 0; i < fileCount; i += 1) {
      fs.copyFileSync(
        sourceImage,
        path.join(mediaFolderPath, `image-${String(i).padStart(4, '0')}.png`),
      )
    }
  })

  test('list view only mounts visible rows and scrolls to far files', async ({ page }) => {
    await page.goto(`/?dir=${encodeURIComponent(folderName)}`)
    await page.getByRole('button', { name: 'List view' }).click()
    await expect(page.locator('table').getByText('item-0000.txt')).toBeVisible()

    expect(await page.locator('[data-file-path]').count()).toBeLessThan(80)
    await expect(page.getByText('item-0499.txt')).toHaveCount(0)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.locator('table').getByText('item-0499.txt')).toBeVisible()
  })

  test('grid view only mounts visible cards and scrolls to far files', async ({ page }) => {
    await page.goto(`/?dir=${encodeURIComponent(folderName)}`)
    await page.getByRole('button', { name: 'Grid view' }).click()
    await expect(page.locator('[data-testid=file-browser] .file-browser-grid')).toBeVisible()
    await expect(page.getByText('item-0000.txt')).toBeVisible()

    await expect
      .poll(() =>
        page.locator('[data-testid=file-browser] .file-browser-grid').evaluate((grid) => {
          const rows = Array.from(grid.children) as HTMLElement[]
          if (rows.length < 2) return null
          const first = rows[0]!.getBoundingClientRect()
          const second = rows[1]!.getBoundingClientRect()
          return second.top - first.top - first.height
        }),
      )
      .toBeLessThan(18)

    expect(await page.locator('[data-file-path]').count()).toBeLessThan(80)
    await expect(page.getByText('item-0499.txt')).toHaveCount(0)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByText('item-0499.txt')).toBeVisible()
  })

  test('grid thumbnails load while virtualized cards are remounted', async ({ page }) => {
    await page.goto(`/?dir=${encodeURIComponent(mediaFolderName)}`)
    await page.getByRole('button', { name: 'Grid view' }).click()
    const thumbnails = page.locator(
      '[data-testid=file-browser] img[data-testid=file-browser-image-thumbnail]',
    )

    await expect(page.getByText('image-0000.png')).toBeVisible()
    await expect
      .poll(
        () =>
          thumbnails.evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every((image) => {
                const element = image as HTMLImageElement
                return element.complete && element.naturalWidth > 0
              }),
          ),
        { timeout: 10_000 },
      )
      .toBe(true)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.getByText('image-0499.png')).toBeVisible()
    await expect
      .poll(
        () =>
          thumbnails.evaluateAll(
            (images) =>
              images.length > 0 &&
              images.every((image) => {
                const element = image as HTMLImageElement
                return element.complete && element.naturalWidth > 0
              }),
          ),
        { timeout: 10_000 },
      )
      .toBe(true)
  })
})
