import { test, expect } from '@playwright/test'

const VIDEO_DIR = 'Videos'
const VIDEO_FILE = 'Videos/sample.mp4'

test.describe('Video Player', () => {
  test('opens video player when clicking a video file', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.locator(`[data-file-path="${VIDEO_FILE}"]`).click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('video')).toBeVisible()
  })

  test('video element has native controls', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    const video = page.locator('video')
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute('controls', '')
  })

  test('shows audio-only mode toggle', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await expect(page.locator('button[aria-label="Audio only mode"]')).toBeVisible()
  })

  test('switches to audio-only mode', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await page.locator('button[aria-label="Audio only mode"]').click()
    await page.waitForURL(/audioOnly=true/)
    await expect(page.locator('video')).not.toBeVisible()
  })

  test('plays audio when switching to audio-only mode', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await page.locator('button[aria-label="Audio only mode"]').click()
    await page.waitForURL(/audioOnly=true/)
    const audio = page.locator('audio').first()
    await expect(audio).toBeAttached()
    await expect.poll(async () => audio.evaluate((el: HTMLAudioElement) => !el.paused)).toBe(true)
  })

  test('closes video player', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await expect(page.locator('video')).toBeVisible()
    await page.getByRole('button', { name: 'Close player' }).click()
    await expect(page.locator('video')).not.toBeVisible()
    await expect(page).not.toHaveURL(/playing=/)
  })

  test('minimizes video player', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await expect(page.locator('video')).toBeVisible()
    await page.getByRole('button', { name: 'Minimize player' }).click()
    await expect(page.locator('video')).toBeVisible()
  })

  test('reflects playing file in URL', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.locator(`[data-file-path="${VIDEO_FILE}"]`).click()
    await expect(page).toHaveURL(/playing=/)
  })

  test('video loads with a valid source', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    const video = page.locator('video')
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute('src', /\/api\/media\//)
  })

  test('seeking a playing video does not pause it', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.locator(`[data-file-path="${VIDEO_FILE}"]`).click()
    await page.waitForURL(/playing=/)
    const video = page.locator('video')
    await expect(video).toBeVisible()
    await page.waitForFunction(
      () => {
        const element = document.querySelector('video')
        return !!element && !element.paused && element.currentTime > 0.2
      },
      { timeout: 15_000 },
    )
    const targetTime = 0.5
    await video.evaluate(
      (element: HTMLVideoElement, time) =>
        new Promise<void>((resolve) => {
          element.addEventListener(
            'pause',
            () => {
              element.currentTime = time
              element.dispatchEvent(new Event('seeked'))
              resolve()
            },
            { once: true },
          )
          element.dispatchEvent(new Event('seeking'))
          element.pause()
        }),
      targetTime,
    )
    await expect
      .poll(
        async () =>
          video.evaluate(
            (element: HTMLVideoElement, time) => element.currentTime >= time - 0.1,
            targetTime,
          ),
        { timeout: 10_000 },
      )
      .toBe(true)
    await page.waitForTimeout(100)
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  })

  test('native video playback can resume after pausing', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.locator(`[data-file-path="${VIDEO_FILE}"]`).click()
    await page.waitForURL(/playing=/)
    const video = page.locator('video')
    await expect(video).toBeVisible()
    await page.waitForFunction(
      () => {
        const element = document.querySelector('video')
        return !!element && !element.paused && element.currentTime > 0.2
      },
      { timeout: 15_000 },
    )
    await video.evaluate((element) => {
      const events: string[] = []
      for (const type of ['play', 'pause']) {
        element.addEventListener(type, () => events.push(type))
      }
      ;(element as HTMLVideoElement & { observedEvents?: string[] }).observedEvents = events
    })

    await video.evaluate((element: HTMLVideoElement) => element.pause())
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
      .toBe(true)

    await video.evaluate((element: HTMLVideoElement) => element.play())
    await expect
      .poll(
        () =>
          video.evaluate((element: HTMLVideoElement & { observedEvents?: string[] }) => ({
            paused: element.paused,
            observedEvents: element.observedEvents,
          })),
        { timeout: 5_000 },
      )
      .toEqual({ paused: false, observedEvents: ['pause', 'play'] })
  })

  test('video thumbnails appear in grid view', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.getByRole('button', { name: 'Display options' }).click()
    await page.getByRole('menuitem', { name: 'Grid view' }).click()
    const card = page
      .locator('[data-testid=file-browser] .file-browser-grid [role=button]')
      .filter({
        hasText: 'sample.mp4',
      })
    const thumb = card.locator('[data-testid=file-browser-video-thumbnail]')
    await expect(thumb).toBeVisible()
    await expect(thumb).toHaveAttribute('src', /\/api\/thumbnail\//)
    await expect
      .poll(async () => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0)
  })

  test('maximize restores from minimized state', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await page.getByRole('button', { name: 'Minimize player' }).click()
    await page.getByRole('button', { name: 'Maximize player' }).click()
    await expect(page.locator('video')).toBeVisible()
  })
})
