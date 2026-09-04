import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const batchId = process.env.BATCH_ID
const mediaDirName = batchId ? `test-media-${batchId}` : 'test-media'
const folderName = `LandscapeFiles-${batchId ?? 'local'}`
const fileCount = 300
const pixel10ProLandscape = {
  viewport: { width: 912, height: 410 },
  screen: { width: 912, height: 410 },
  deviceScaleFactor: 3.125,
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 16; Google Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
}

async function useListView(page: Page) {
  await page.getByRole('button', { name: 'Display options' }).click()
  await page.getByRole('menuitem', { name: 'List view' }).click()
}

test.describe('Pixel 10 Pro landscape media browser regressions', () => {
  test.use(pixel10ProLandscape)

  test.beforeAll(() => {
    const folderPath = path.resolve(mediaDirName, folderName)
    fs.rmSync(folderPath, { recursive: true, force: true })
    fs.mkdirSync(folderPath, { recursive: true })

    for (let index = 0; index < fileCount; index += 1) {
      fs.writeFileSync(
        path.join(folderPath, `file-${String(index).padStart(4, '0')}.txt`),
        `${index}`,
      )
    }
    fs.copyFileSync(
      path.resolve(mediaDirName, 'Music', 'track.mp3'),
      path.join(folderPath, 'track.mp3'),
    )
  })

  test('music player does not cover the last file', async ({ page }) => {
    const playingPath = `${folderName}/track.mp3`
    await page.goto(
      `/?dir=${encodeURIComponent(folderName)}&playing=${encodeURIComponent(playingPath)}`,
    )
    await useListView(page)
    await expect(page.getByTestId('audio-player-chrome')).toBeVisible()

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    const lastFile = page.locator(`[data-file-path="${folderName}/track.mp3"]`)
    await expect(lastFile).toBeVisible()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            window.scrollTo(0, document.documentElement.scrollHeight)
            requestAnimationFrame(() => resolve())
          })
        }),
    )

    const [lastFileBox, playerBox] = await Promise.all([
      lastFile.boundingBox(),
      page.getByTestId('audio-player-chrome').boundingBox(),
    ])
    expect(lastFileBox).not.toBeNull()
    expect(playerBox).not.toBeNull()
    expect(lastFileBox!.y + lastFileBox!.height).toBeLessThanOrEqual(playerBox!.y)
  })

  test('keeps the file-list scroll extent stable during a touch gesture', async ({ page }) => {
    await page.goto(`/?dir=${encodeURIComponent(folderName)}`)
    await useListView(page)
    await expect(page.locator(`[data-file-path="${folderName}/file-0000.txt"]`)).toBeVisible()

    const initialScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.evaluate(() => {
      const samples: number[] = [window.scrollY]
      ;(window as typeof window & { __scrollSamples?: number[] }).__scrollSamples = samples
      window.addEventListener('scroll', () => samples.push(window.scrollY), { passive: true })
    })
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 456, y: 350 }],
    })
    for (const y of [250, 150, 50]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 456, y }],
      })
      await page.waitForTimeout(8)
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(1_000)
    const finalPositions = await page.evaluate(
      () => (window as typeof window & { __scrollSamples?: number[] }).__scrollSamples ?? [],
    )

    const finalScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(finalPositions.length).toBeGreaterThan(1)
    for (let index = 1; index < finalPositions.length; index += 1) {
      expect(finalPositions[index]).toBeGreaterThanOrEqual(finalPositions[index - 1]!)
    }
    expect(finalScrollHeight).toBe(initialScrollHeight)
  })
})
