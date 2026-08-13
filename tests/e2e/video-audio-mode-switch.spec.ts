import { test, expect, type Page } from '@playwright/test'

const VIDEO_DIR = 'Videos'
const VIDEO_FILE = 'Videos/sample.mp4'

const audioChrome = (page: Page) => page.getByTestId('audio-player-chrome')

test.describe('Video vs audio-only chrome — classic', () => {
  test('video mode: video visible, bottom audio chrome hidden', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await expect(page.locator('video')).toBeVisible()
    await expect(audioChrome(page)).not.toBeVisible()
  })

  test('video mode: main layout does not reserve audio bar padding', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await expect(page.getByTestId('media-chrome-pad-root')).not.toHaveClass(/pb-12/)
  })

  test('audio-only deep link: chrome visible, video hidden', async ({ page }) => {
    await page.goto(`/?playing=${encodeURIComponent(VIDEO_FILE)}&audioOnly=true`)
    await expect(page.locator('video')).not.toBeVisible()
    await expect(audioChrome(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show video' })).toBeVisible()
  })

  test('toggle audio-only from video then show video: chrome tracks mode', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await expect(audioChrome(page)).not.toBeVisible()

    await page.getByRole('button', { name: 'Audio only mode' }).click()
    await page.waitForURL(/audioOnly=true/)
    await expect(page.locator('video')).not.toBeVisible()
    await expect(audioChrome(page)).toBeVisible()

    await page.getByRole('button', { name: 'Show video' }).click()
    await expect(page).not.toHaveURL(/audioOnly/)
    await expect(page.locator('video')).toBeVisible()
    await expect(audioChrome(page)).not.toBeVisible()
  })

  test('toggle audio-only: hidden audio element actually plays', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await page.getByRole('button', { name: 'Audio only mode' }).click()
    await page.waitForURL(/audioOnly=true/)
    const audio = page.locator('audio').first()
    await expect(audio).toBeAttached()
    await expect.poll(async () => audio.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true)
  })

  test('double round-trip video ↔ audio-only', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    const audio = page.locator('audio').first()
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Audio only mode' }).click()
      await page.waitForURL(/audioOnly=true/)
      await expect(audioChrome(page)).toBeVisible()
      await expect(page.locator('video')).not.toBeVisible()
      await expect.poll(async () => audio.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true)

      await page.getByRole('button', { name: 'Show video' }).click()
      await expect(page).not.toHaveURL(/audioOnly/)
      await expect(page.locator('video')).toBeVisible()
      await expect(audioChrome(page)).not.toBeVisible()
    }
  })

  test('second entry to audio-only: element plays and is decoded (stale src shortcut)', async ({
    page,
  }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    const audio = page.locator('audio').first()

    await page.getByRole('button', { name: 'Audio only mode' }).click()
    await page.waitForURL(/audioOnly=true/)
    await expect.poll(async () => audio.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true)

    await page.getByRole('button', { name: 'Show video' }).click()
    await expect(page).not.toHaveURL(/audioOnly/)
    await expect(page.locator('video')).toBeVisible()

    await page.getByRole('button', { name: 'Audio only mode' }).click()
    await page.waitForURL(/audioOnly=true/)
    await expect.poll(async () => audio.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true)
    await expect
      .poll(async () => audio.evaluate((el: HTMLAudioElement) => el.readyState >= 2))
      .toBe(true)
    await expect
      .poll(async () => audio.evaluate((el: HTMLAudioElement) => el.error == null))
      .toBe(true)
  })

  test('open mp4 from list: video visible, chrome hidden', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.locator('table').getByText('sample.mp4').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('video')).toBeVisible()
    await expect(audioChrome(page)).not.toBeVisible()
  })

  test('full video → audio → video: no duplicate chrome with video', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await page.getByRole('button', { name: 'Audio only mode' }).click()
    await page.waitForURL(/audioOnly=true/)
    await expect(audioChrome(page)).toBeVisible()
    await page.getByRole('button', { name: 'Show video' }).click()
    await expect(page.locator('video')).toBeVisible()
    await expect(audioChrome(page)).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Show video' })).not.toBeVisible()
  })
})
