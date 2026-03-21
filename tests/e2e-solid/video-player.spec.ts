import { test, expect } from '@playwright/test'

const VIDEO_DIR = 'Videos'
const VIDEO_FILE = 'Videos/sample.mp4'

test.describe('Video Player', () => {
  test('opens video player when clicking a video file', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.locator('table').getByText('sample.mp4').click()
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
    await page.locator('table').getByText('sample.mp4').click()
    await expect(page).toHaveURL(/playing=/)
  })

  test('video loads with a valid source', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    const video = page.locator('video')
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute('src', /\/api\/media\//)
  })

  test('video thumbnails appear in grid view', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}`)
    await page.locator('button:has(.lucide-layout-grid)').click()
    const cards = page.locator('.grid').getByText('sample.mp4').locator('..')
    await expect(cards).toBeVisible()
  })

  test('maximize restores from minimized state', async ({ page }) => {
    await page.goto(`/?dir=${VIDEO_DIR}&playing=${encodeURIComponent(VIDEO_FILE)}`)
    await page.getByRole('button', { name: 'Minimize player' }).click()
    await page.getByRole('button', { name: 'Maximize player' }).click()
    await expect(page.locator('video')).toBeVisible()
  })
})
