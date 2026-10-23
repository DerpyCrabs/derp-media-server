import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'

const mediaDir = process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media'

test.describe('File Download', () => {
  test('context menu shows Download for files', async ({ page }) => {
    await page.goto('/?dir=Documents')
    await page.locator('table tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    await expect(
      page.locator('[data-slot="context-menu-item"]').getByText('Download', { exact: true }),
    ).toBeVisible()
  })

  test('downloads a single file via context menu', async ({ page }) => {
    await page.goto('/?dir=Documents')

    const downloadPromise = page.waitForEvent('download')
    await page.locator('table tr').filter({ hasText: 'readme.txt' }).click({ button: 'right' })
    const downloadItem = page
      .locator('[data-slot="context-menu-item"]')
      .getByText('Download', { exact: true })
    await expect(downloadItem).toBeVisible()
    await downloadItem.click({ noWaitAfter: true })
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('readme.txt')
    expect(fs.readFileSync((await download.path())!)).toEqual(
      fs.readFileSync(path.join(mediaDir, 'Documents/readme.txt')),
    )
  })

  test('context menu shows "Download as ZIP" for folders', async ({ page }) => {
    await page.goto('/')
    await page.locator('table tr').filter({ hasText: 'Documents' }).click({ button: 'right' })
    await expect(
      page.locator('[data-slot="context-menu-item"]').getByText('Download as ZIP'),
    ).toBeVisible()
  })

  test('downloads a folder as ZIP via context menu', async ({ page }) => {
    await page.goto('/')

    const downloadPromise = page.waitForEvent('download')
    await page.locator('table tr').filter({ hasText: 'EmptyFolder' }).click({ button: 'right' })
    await page.locator('[data-slot="context-menu-item"]').getByText('Download as ZIP').click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toBe('EmptyFolder.zip')
  })
  test('downloads a populated nested ZIP with exact binary and Unicode content', async ({
    page,
  }) => {
    const name = `archive-${crypto.randomUUID()}`
    const directory = path.join(mediaDir, name)
    const bytes = Buffer.from([0, 255, 128, 10, 13, 42])
    fs.mkdirSync(path.join(directory, 'nested/empty'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'nested/данные.bin'), bytes)
    fs.writeFileSync(path.join(directory, 'note.txt'), 'archive note')
    try {
      await page.goto('/')
      await page.locator('table tr').filter({ hasText: name }).click({ button: 'right' })
      const downloading = page.waitForEvent('download')
      await page.getByText('Download as ZIP', { exact: true }).click()
      const download = await downloading
      expect(download.suggestedFilename()).toBe(`${name}.zip`)
      const archive = unzipSync(fs.readFileSync((await download.path())!))
      expect(Object.keys(archive).sort()).toEqual(
        ['nested/', 'nested/empty/', 'nested/данные.bin', 'note.txt'].sort(),
      )
      expect(Buffer.from(archive['nested/данные.bin']!)).toEqual(bytes)
      expect(Buffer.from(archive['note.txt']!).toString()).toBe('archive note')
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
})
