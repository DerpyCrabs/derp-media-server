import { test, expect } from '@playwright/test'
import { libraryUrl } from './canonical-urls'

const AUDIO_FILE = 'Music/track.mp3'
const VIDEO_FILE = 'Videos/sample.mp4'
const TEXT_FILE = 'Documents/readme.txt'

test.describe('URL State – Main Page', () => {
  test('viewing a file preserves playing param', async ({ page }) => {
    await page.goto(libraryUrl('Documents', { playing: AUDIO_FILE }))
    await page.locator('table').getByText('readme.txt').click()
    await expect(page).toHaveURL(/viewing=/)
    await expect(page).toHaveURL(/playing=/)
    await expect(page.getByTestId('surface-switcher')).toBeHidden()
  })

  test('navigating to a folder preserves playing param', async ({ page }) => {
    await page.goto(libraryUrl('', { playing: AUDIO_FILE }))
    await page.locator('table').getByText('Documents', { exact: true }).click()
    await expect(page).toHaveURL(libraryUrl('Documents', { playing: AUDIO_FILE }))
    await expect(page).toHaveURL(/playing=/)
  })

  test('closing viewer preserves playing param', async ({ page }) => {
    await page.goto(libraryUrl('Documents', { viewing: TEXT_FILE, playing: AUDIO_FILE }))
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await page.locator('[role="dialog"] button[title="Close"]').click()
    await expect(page).not.toHaveURL(/viewing=/)
    await expect(page).toHaveURL(/playing=/)
  })

  test('closing player preserves viewing param', async ({ page }) => {
    await page.goto(libraryUrl('Videos', { viewing: TEXT_FILE, playing: VIDEO_FILE }))
    await expect(page.locator('video')).toBeVisible()
    // The viewer dialog overlays the video player close button; dispatch click via JS
    await page
      .locator('video')
      .locator('..')
      .locator('button:has(.lucide-x)')
      .dispatchEvent('click')
    await expect(page).not.toHaveURL(/playing=/)
    await expect(page).toHaveURL(/viewing=/)
  })
})
