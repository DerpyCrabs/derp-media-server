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
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'List view' }).click()
    await expect(page.locator('table').getByText('item-0000.txt')).toBeVisible()

    expect(await page.locator('[data-file-path]').count()).toBeLessThan(80)
    await expect(page.getByText('item-0499.txt')).toHaveCount(0)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.locator('table').getByText('item-0499.txt')).toBeVisible()
  })

  test('grid view only mounts visible cards and scrolls to far files', async ({ page }) => {
    await page.goto(`/?dir=${encodeURIComponent(folderName)}`)
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'Grid view' }).click()
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
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'Grid view' }).click()
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

  test('preloads mounted thumbnails three rows above and below the viewport', async ({ page }) => {
    await page.route('**/api/thumbnail/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: fs.readFileSync(path.resolve(mediaDirName, 'Images/photo.png')),
      }),
    )
    await page.goto(`/?dir=${encodeURIComponent(mediaFolderName)}`)
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'Grid view' }).click()
    await expect(page.getByText('image-0000.png')).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 3000))
    await expect
      .poll(() =>
        page.locator('[data-testid=file-browser] [data-file-path]').evaluateAll((cards) => {
          let above = 0
          let below = 0
          let beyond = 0
          for (const card of cards) {
            const hero = card.querySelector('.aspect-video')
            if (!hero) continue
            const rect = hero.getBoundingClientRect()
            const margin = Math.ceil((card.getBoundingClientRect().height + 16) * 3)
            const image = hero.querySelector('img')
            const loaded = image?.complete && image.naturalWidth > 0
            if (rect.bottom > -margin && rect.bottom < 0) {
              if (!loaded || image.getAttribute('fetchpriority') !== 'low')
                return {
                  path: card.getAttribute('data-file-path'),
                  loaded,
                  priority: image?.getAttribute('fetchpriority'),
                  top: rect.top,
                  bottom: rect.bottom,
                  margin,
                }
              above++
            } else if (rect.top > innerHeight && rect.top < innerHeight + margin) {
              if (!loaded || image.getAttribute('fetchpriority') !== 'low')
                return {
                  path: card.getAttribute('data-file-path'),
                  loaded,
                  priority: image?.getAttribute('fetchpriority'),
                  top: rect.top,
                  bottom: rect.bottom,
                  margin,
                }
              below++
            } else if (rect.top > innerHeight + margin || rect.bottom < -margin) {
              if (image)
                return {
                  unexpected: card.getAttribute('data-file-path'),
                  top: rect.top,
                  bottom: rect.bottom,
                  margin,
                }
              beyond++
            }
          }
          return above > 0 && below > 0 && beyond > 0 ? true : { above, below, beyond }
        }),
      )
      .toBe(true)
  })

  test('scrolls the grid while thumbnail requests are queued', async ({ page }) => {
    const queuedFolderName = `VirtualQueued-${crypto.randomUUID()}`
    fs.cpSync(
      path.resolve(mediaDirName, mediaFolderName),
      path.resolve(mediaDirName, queuedFolderName),
      { recursive: true },
    )
    let started = 0
    let releaseThumbnails!: () => void
    const thumbnailsReady = new Promise<void>((resolve) => {
      releaseThumbnails = resolve
    })
    await page.route('**/api/thumbnail/**', async (route) => {
      started += 1
      await thumbnailsReady
      await route.continue()
    })
    await page.goto(`/?dir=${encodeURIComponent(queuedFolderName)}`, {
      waitUntil: 'domcontentloaded',
    })
    const trigger = page.getByRole('button', { name: 'Display options' })
    await trigger.click()
    await page.getByRole('menuitem', { name: 'Grid view' }).click()
    try {
      await expect.poll(() => started).toBe(4)
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await expect(page.getByText('image-0499.png')).toBeVisible()
    } finally {
      releaseThumbnails()
    }
  })

  test.describe('on mobile', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

    test('can reopen display options while a view preference is saving', async ({ page }) => {
      let releaseSave!: () => void
      const saveReady = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      await page.route('**/api/settings/viewMode', async (route) => {
        await saveReady
        await route.continue()
      })
      await page.goto(`/?dir=${encodeURIComponent(mediaFolderName)}`)
      const trigger = page.getByRole('button', { name: 'Display options' })
      await trigger.click()
      try {
        await page.getByRole('menuitem', { name: 'List view' }).click()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
        await trigger.click()
        const grid = page.getByRole('menuitem', { name: 'Grid view' })
        await expect(grid).toBeVisible()
        await grid.click()
        await expect(trigger).toHaveAttribute('aria-expanded', 'false')
      } finally {
        releaseSave()
      }
      await expect(page.locator('[data-testid=file-browser] .file-browser-grid')).toBeVisible()
    })

    test('shows a large image folder after switching from list to grid view', async ({ page }) => {
      await page.goto(`/?dir=${encodeURIComponent(mediaFolderName)}`)
      await page.getByRole('button', { name: 'Display options' }).click()
      await page.getByRole('menuitem', { name: 'List view' }).click()
      await expect(page.getByText('image-0000.png')).toBeVisible()

      await page.getByRole('button', { name: 'Display options' }).click()
      await page.getByRole('menuitem', { name: 'Grid view' }).click()

      await expect(page.locator('[data-testid=file-browser] .file-browser-grid')).toBeVisible()
      await expect(page.getByText('image-0000.png')).toBeVisible()
    })
  })
})
