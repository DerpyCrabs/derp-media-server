import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const name = 'snapshot-source.mp4'
const source = `Notes/${name}`
const outputs: string[] = []
test.beforeAll(() => {
  const root = path.resolve(
    process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media',
  )
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=10:duration=4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    path.join(root, source),
  ])
})
test.afterAll(() => {
  const root = path.resolve(
    process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media',
  )
  for (const logical of [source, ...outputs]) fs.rmSync(path.join(root, logical), { force: true })
})
async function open(page: Page) {
  await page.goto(`/?dir=Notes&playing=${encodeURIComponent(source)}`)
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  const pause = page.getByRole('button', { name: 'Pause video', exact: true })
  if (await pause.isVisible()) await pause.click()
  await page.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 1.2
  })
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => !video.seeking && video.currentTime === 1.2),
    )
    .toBe(true)
}
async function capture(page: Page) {
  await page.getByRole('button', { name: 'Playback settings', exact: true }).click()
  await page.getByRole('button', { name: /Save video frame/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Save video frame', exact: true })
  await expect(dialog.getByRole('img')).toBeVisible()
  return dialog
}
async function frameHash(page: Page, selector: string) {
  return page.locator(selector).evaluate(async (element: HTMLVideoElement | HTMLImageElement) => {
    if (element instanceof HTMLImageElement) await element.decode()
    const canvas = document.createElement('canvas')
    canvas.width = element instanceof HTMLVideoElement ? element.videoWidth : element.naturalWidth
    canvas.height =
      element instanceof HTMLVideoElement ? element.videoHeight : element.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(element, 0, 0)
    let hash = 2166136261
    for (const byte of context.getImageData(0, 0, canvas.width, canvas.height).data)
      hash = Math.imul(hash ^ byte, 16777619)
    return { width: canvas.width, height: canvas.height, hash: hash >>> 0 }
  })
}
test('captures native frame pixels once, saves a separate PNG and leaves the video paused', async ({
  page,
  request,
}) => {
  await open(page)
  const original = await frameHash(page, 'video')
  const dialog = await capture(page)
  expect(await frameHash(page, '[role="dialog"][aria-label="Save video frame"] img')).toEqual(
    original,
  )
  await expect(dialog.getByRole('textbox', { name: 'File name' })).toHaveValue(
    /snapshot-source-00-00-01\.\d{3}\.png/,
  )
  await page.locator('video').evaluate((video: HTMLVideoElement) => {
    video.currentTime = 2.4
  })
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => !video.seeking))
    .toBe(true)
  expect((await frameHash(page, 'video')).hash).not.toBe(original.hash)
  expect(await frameHash(page, '[role="dialog"][aria-label="Save video frame"] img')).toEqual(
    original,
  )
  const output = `snapshot-result-${Date.now()}.png`
  outputs.push(`Notes/${output}`)
  await dialog.getByRole('textbox', { name: 'File name' }).fill(output)
  await dialog.getByRole('button', { name: 'Save copy', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.paused))
    .toBe(true)
  const saved = await request.get(
    `/api/files/download?path=${encodeURIComponent(`Notes/${output}`)}`,
  )
  expect(saved.ok()).toBe(true)
  const png = await saved.body()
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(640)
  expect(png.readUInt32BE(20)).toBe(360)
  await page.evaluate(
    (url) => {
      const img = document.createElement('img')
      img.id = 'saved-frame'
      img.src = url
      document.body.append(img)
    },
    `/api/files/download?path=${encodeURIComponent(`Notes/${output}`)}`,
  )
  expect(await frameHash(page, '#saved-frame')).toEqual(original)
})
test('Shift+S supports readonly downloads and the browser can consume the image after the dialog closes', async ({
  page,
}) => {
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch()
    return route.fulfill({ response, json: { ...(await response.json()), editableFolders: [] } })
  })
  await open(page)
  await page.locator('video').evaluate((video) => {
    video.parentElement!.tabIndex = 0
    video.parentElement!.focus()
  })
  await page.keyboard.press('Shift+s')
  const dialog = page.getByRole('dialog', { name: 'Save video frame', exact: true })
  await expect(dialog.getByRole('img')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Save copy', exact: true })).toHaveCount(0)
  const downloaded = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  const download = await downloaded
  await expect(dialog).toBeHidden()
  expect(await download.failure()).toBe(null)
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  const buffer = fs.readFileSync((await download.path())!)
  expect(buffer.readUInt32BE(16)).toBe(640)
  expect(buffer.readUInt32BE(20)).toBe(360)
})
test('native cancellation keeps the captured frame for retry and snapshot names cannot overwrite files', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.assign(window, {
      derpDesktop: {
        ready: async () => {},
        onOpen: () => () => {},
        onBeforeClose: () => () => {},
        downloadBlob: async () => {
          const w = window as typeof window & { attempts?: number }
          w.attempts = (w.attempts ?? 0) + 1
          return w.attempts > 1
        },
        cancelDownload: async () => {},
      },
    }),
  )
  await open(page)
  const dialog = await capture(page)
  await dialog.getByRole('textbox', { name: 'File name' }).fill(name)
  await expect(dialog).toContainText('already exists')
  await expect(dialog.getByRole('button', { name: 'Save copy', exact: true })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'File name' }).fill('native-frame.png')
  await dialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Download copy', exact: true })).toBeEnabled()
  await expect(dialog.getByRole('img')).toBeVisible()
  await dialog.getByRole('button', { name: 'Download copy', exact: true }).click()
  await expect(dialog).toBeHidden()
})

test('capturing in fullscreen keeps playback running and cancelling keeps fullscreen open', async ({
  page,
}) => {
  await open(page)
  await page.getByRole('button', { name: 'Play video', exact: true }).click()
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click()
  const dialog = await capture(page)
  expect(await dialog.evaluate((element) => document.fullscreenElement?.contains(element))).toBe(
    true,
  )
  const preview = await frameHash(page, '[role="dialog"][aria-label="Save video frame"] img')
  const before = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.currentTime)
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(before + 0.2)
  expect(await frameHash(page, '[role="dialog"][aria-label="Save video frame"] img')).toEqual(
    preview,
  )
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click()
})
