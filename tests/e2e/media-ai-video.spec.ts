import { test, expect } from '@playwright/test'
import {
  advancing,
  cleanupForYouMedia,
  setupForYouMedia,
  enableForYou,
  pauseAt,
  playNative,
  readyVideo,
  videos,
} from './media-ai-helpers'

const direct = `/?view=for-you&playing=${encodeURIComponent(videos[0].path)}`
test.beforeAll(setupForYouMedia)
test.afterAll(cleanupForYouMedia)
test.beforeEach(async ({ page }) => {
  await enableForYou(page, videos)
})

test('native Play on a For you deep link recovers from blocked autoplay', async ({ page }) => {
  await page.addInitScript(() => {
    // oxlint-disable-next-line typescript/unbound-method
    const original = HTMLMediaElement.prototype.play
    let blocked = false
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLVideoElement && !blocked) {
        blocked = true
        return Promise.reject(new DOMException('Autoplay was blocked', 'NotAllowedError'))
      }
      return original.call(this)
    }
  })
  await page.goto(direct)
  const video = await readyVideo(page)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await video.focus()
  await video.press('Space')
  await advancing(video)
})

test('native video controls survive three pause and resume cycles', async ({ page }) => {
  await page.goto(direct)
  const video = await readyVideo(page)
  for (let i = 0; i < 3; i++) {
    await playNative(video)
    await video.evaluate((v: HTMLVideoElement) => v.pause())
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  }
  await playNative(video)
})

test('For you video deep links load the previously saved playback position', async ({ page }) => {
  await page.addInitScript((path) => {
    localStorage.setItem(
      'video-playback-times',
      JSON.stringify({ state: { playbackTimes: { [path]: 2 } }, version: 0 }),
    )
  }, videos[0].path)
  await page.goto(direct)
  const video = await readyVideo(page)
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThanOrEqual(1.9)
  await playNative(video)
})

test('seeking a paused recommended video stays paused and can then resume', async ({ page }) => {
  await page.goto(direct)
  const video = await readyVideo(page)
  await playNative(video)
  await pauseAt(video, 2)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await playNative(video)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(2)
})

test('reloading For you preserves the paused video checkpoint', async ({ page }) => {
  await page.goto(direct)
  const video = await readyVideo(page)
  await playNative(video)
  await pauseAt(video, 2)
  await page.reload()
  const restored = await readyVideo(page)
  await expect
    .poll(() => restored.evaluate((v: HTMLMediaElement) => v.currentTime))
    .toBeGreaterThanOrEqual(1.9)
  await playNative(restored)
})

test('closing and reopening a recommended video resumes its saved position', async ({ page }) => {
  await page.goto(direct)
  const video = await readyVideo(page)
  await playNative(video)
  await pauseAt(video, 2)
  await page.getByRole('button', { name: 'Close player', exact: true }).click()
  await expect(page.locator('video')).toHaveCount(0)
  await page.getByRole('button', { name: 'Play First clip', exact: true }).click()
  const reopened = await readyVideo(page)
  await expect
    .poll(() => reopened.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThanOrEqual(1.9)
  await advancing(reopened)
})

test('switching Library and For you preserves the live video element and position', async ({
  page,
}) => {
  await page.goto(direct)
  const video = await readyVideo(page)
  await playNative(video)
  const element = await video.elementHandle()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.getByTestId('for-you')).toHaveCount(0)
  expect(await video.evaluate((v, original) => v === original, element)).toBe(true)
  await advancing(video)
  await page.getByRole('button', { name: 'For you', exact: true }).click()
  expect(await video.evaluate((v, original) => v === original, element)).toBe(true)
  await advancing(video)
})

test('minimizing and maximizing recommended video preserves playback', async ({ page }) => {
  await page.goto(direct)
  const video = await readyVideo(page)
  await playNative(video)
  const element = await video.elementHandle()
  await page.getByRole('button', { name: 'Minimize player', exact: true }).click()
  await advancing(video)
  await page.getByRole('button', { name: 'Maximize player', exact: true }).click()
  expect(await video.evaluate((v, original) => v === original, element)).toBe(true)
  await advancing(video)
})

test('recommended video keeps its position through audio-only mode and back', async ({ page }) => {
  await page.goto(direct)
  const video = await readyVideo(page)
  await playNative(video)
  await pauseAt(video, 1.5)
  await page.getByRole('button', { name: 'Audio only mode', exact: true }).click()
  const audio = page.locator('audio')
  await expect(audio).toBeAttached()
  await expect
    .poll(() => audio.evaluate((v: HTMLAudioElement) => v.currentTime))
    .toBeGreaterThanOrEqual(1.4)
  await page.getByRole('button', { name: 'Show video', exact: true }).click()
  const restored = await readyVideo(page)
  await expect
    .poll(() => restored.evaluate((v: HTMLMediaElement) => v.currentTime))
    .toBeGreaterThanOrEqual(1.4)
  await advancing(restored)
})

test('recommended video queue survives reload and Next switches to its next item', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First clip', exact: true }).click()
  await readyVideo(page)
  await page.reload()
  await readyVideo(page)
  await page.getByRole('button', { name: 'Next video', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('playing')).toBe(videos[1].path)
  const video = await readyVideo(page)
  await expect(video).toHaveAttribute('src', /second.webm/)
  await advancing(video)
})
