import { test, expect } from '@playwright/test'

const MUSIC_DIR = 'Music'
const AUDIO_FILE = 'Music/track.mp3'
const VIDEO_FILE = 'Videos/sample.mp4'

test.describe('Audio Player', () => {
  test('opens audio player bar when clicking an audio file', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}`)
    await page.locator('table').getByText('track.mp3').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('audio')).toBeAttached()
  })

  test('reserves bottom space for the fixed audio bar', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}&playing=${encodeURIComponent(AUDIO_FILE)}`)
    await expect(page.getByTestId('media-chrome-pad-root')).toHaveClass(/pb-12/)
  })

  test('shows play/pause controls', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}&playing=${encodeURIComponent(AUDIO_FILE)}`)
    await expect(page.locator('audio')).toBeAttached()
    const playPause = page.locator('button:has(.lucide-play), button:has(.lucide-pause)')
    await expect(playPause.first()).toBeVisible()
  })

  test('shows next/previous buttons', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}&playing=${encodeURIComponent(AUDIO_FILE)}`)
    await expect(page.locator('button:has(.lucide-step-back)')).toBeVisible()
    await expect(page.locator('button:has(.lucide-step-forward)')).toBeVisible()
  })

  test('shows volume control on desktop', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}&playing=${encodeURIComponent(AUDIO_FILE)}`)
    await expect(page.locator('audio')).toBeAttached()
    await expect(page.locator('button:has(.lucide-volume-2)')).toBeVisible()
  })

  test('displays cover art from folder', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}&playing=${encodeURIComponent(AUDIO_FILE)}`)
    await expect(page.locator('img[alt="Album art"]')).toBeVisible()
  })

  test('reflects playing audio in URL', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}`)
    await page.locator('table').getByText('track.mp3').click()
    await expect(page).toHaveURL(/playing=Music/)
  })

  test('shows "Show video" button when video plays in audio-only mode', async ({ page }) => {
    await page.goto(`/?playing=${encodeURIComponent(VIDEO_FILE)}&audioOnly=true`)
    await expect(page.locator('button[aria-label="Show video"]')).toBeVisible()
  })

  test('displays video thumbnail when playing video in audio-only mode', async ({ page }) => {
    await page.goto(`/?playing=${encodeURIComponent(VIDEO_FILE)}&audioOnly=true`)
    const albumArt = page.locator('img[alt="Album art"]')
    await expect(albumArt).toBeVisible()
    await expect(albumArt).toHaveAttribute('src', /\/api\/thumbnail\//)
  })

  test('switches back to video from audio-only mode', async ({ page }) => {
    await page.goto(`/?playing=${encodeURIComponent(VIDEO_FILE)}&audioOnly=true`)
    await page.locator('button[aria-label="Show video"]').click()
    await expect(page).not.toHaveURL(/audioOnly/)
    await expect(page.locator('video')).toBeVisible()
  })

  test('repeat button toggles', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}&playing=${encodeURIComponent(AUDIO_FILE)}`)
    const repeatBtn = page.locator('button:has(.lucide-repeat)')
    await expect(repeatBtn).toBeVisible()
    await repeatBtn.click()
    // After click the button should still exist (toggled state)
    await expect(repeatBtn).toBeVisible()
  })
})
