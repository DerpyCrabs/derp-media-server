import { test, expect, Page } from '@playwright/test'
import path from 'path'

const sessionFile = process.env.BATCH_ID ? `session-${process.env.BATCH_ID}.json` : 'session.json'
const authStoragePath = path.resolve(__dirname, '../fixtures/.auth', sessionFile)

let folderShareUrl: string
let fileShareUrl: string

async function createShare(page: Page, body: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/api/shares', { data: body })
  const json = await res.json()
  const base = `/share/${json.share.token}`
  return json.share.passcode ? `${base}?p=${encodeURIComponent(json.share.passcode)}` : base
}

test.describe('Share Viewers & Players', () => {
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: authStoragePath })
    const page = await context.newPage()
    folderShareUrl = await createShare(page, {
      path: 'SharedContent',
      isDirectory: true,
    })
    fileShareUrl = await createShare(page, {
      path: 'Documents/readme.txt',
      isDirectory: false,
    })
    await page.close()
    await context.close()
  })

  // ── Video Player in Share ───────────────────────────────────────────

  test('opens video player when clicking a video file in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('public-video.mp4').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('video')).toBeVisible()
  })

  test('video player has controls and valid share source URL', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('public-video.mp4').click()
    await page.waitForURL(/playing=/)
    const video = page.locator('video')
    await expect(video).toBeVisible()
    await expect(video).toHaveAttribute('controls', '')
    await expect(video).toHaveAttribute('src', /\/api\/share\/.*\/media\//)
  })

  test('video player minimize and maximize works in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('public-video.mp4').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('video')).toBeVisible()
    await page.getByRole('button', { name: 'Minimize player' }).click()
    await expect(page.locator('video')).toBeVisible()
    await page.getByRole('button', { name: 'Maximize player' }).click()
    await expect(page.locator('video')).toBeVisible()
  })

  test('video player audio-only mode works in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('public-video.mp4').click()
    await page.waitForURL(/playing=/)
    await page.locator('button[aria-label="Audio only mode"]').click()
    await page.waitForURL(/audioOnly=true/)
    await expect(page.locator('video')).not.toBeVisible()
  })

  test('closing video player works in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('public-video.mp4').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('video')).toBeVisible()
    await page.getByRole('button', { name: 'Close player' }).click()
    await expect(page.locator('video')).not.toBeVisible()
    await expect(page).not.toHaveURL(/playing=/)
  })

  // ── Audio Player in Share ───────────────────────────────────────────

  test('opens audio player bar when clicking an audio file in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('track.mp3').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('audio')).toBeAttached()
  })

  test('audio player shows play/pause controls in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('track.mp3').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('audio')).toBeAttached()
    const playPause = page.locator('button:has(.lucide-play), button:has(.lucide-pause)')
    await expect(playPause.first()).toBeVisible()
  })

  test('audio player shows next/previous buttons in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('track.mp3').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('button:has(.lucide-step-back)')).toBeVisible()
    await expect(page.locator('button:has(.lucide-step-forward)')).toBeVisible()
  })

  test('audio player shows volume control in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('track.mp3').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('audio')).toBeAttached()
    await expect(page.locator('button:has(.lucide-volume-2)')).toBeVisible()
  })

  test('audio player displays cover art in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('track.mp3').click()
    await page.waitForURL(/playing=/)
    await expect(page.locator('img[alt="Album art"]')).toBeVisible()
  })

  test('repeat button toggles in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('track.mp3').click()
    await page.waitForURL(/playing=/)
    const repeatBtn = page.locator('button:has(.lucide-repeat)')
    await expect(repeatBtn).toBeVisible()
    await repeatBtn.click()
    await expect(repeatBtn).toBeVisible()
  })

  test('audio-only from video works in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('public-video.mp4').click()
    await page.waitForURL(/playing=/)
    await page.locator('button[aria-label="Audio only mode"]').click()
    await page.waitForURL(/audioOnly=true/)
    await expect(page.locator('button[aria-label="Show video"]')).toBeVisible()
  })

  test('audio player displays video thumbnail when playing video in audio-only mode in share', async ({
    page,
  }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('public-video.mp4').click()
    await page.waitForURL(/playing=/)
    await page.locator('button[aria-label="Audio only mode"]').click()
    await page.waitForURL(/audioOnly=true/)
    const albumArt = page.locator('img[alt="Album art"]')
    await expect(albumArt).toBeVisible()
    await expect(albumArt).toHaveAttribute('src', /\/api\/share\/.*\/thumbnail\//)
  })

  // ── Image Viewer in Share ───────────────────────────────────────────

  test('opens image viewer when clicking an image in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
  })

  test('image viewer shows zoom controls in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()
    await expect(page.locator('button:has(.lucide-zoom-in)')).toBeVisible()
    await expect(page.locator('button:has(.lucide-zoom-out)')).toBeVisible()
    await expect(page.getByText('Fit')).toBeVisible()
  })

  test('zoom in and out works in share image viewer', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page.getByText('Fit')).toBeVisible()
    await page.locator('button:has(.lucide-zoom-in)').click()
    await expect(page.getByText('125%')).toBeVisible()
    await page.locator('button:has(.lucide-zoom-out)').click()
    await expect(page.getByText('Fit').or(page.getByText('100%'))).toBeVisible()
  })

  test('rotate button works in share image viewer', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('photo.jpg').click()
    const img = page.locator('img[alt="photo.jpg"]')
    await expect(img).toBeVisible()
    await page.locator('button:has(.lucide-rotate-cw)').click()
    const transform = await img.evaluate((el) => el.style.transform)
    expect(transform).toContain('rotate(90deg)')
  })

  test('image navigation works between share images', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()

    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    )
    await expect(page.locator('img[alt="photo.png"]')).toBeVisible()
  })

  test('closing image viewer returns to file list in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('photo.jpg').click()
    await expect(page.locator('img[alt="photo.jpg"]')).toBeVisible()

    await page.locator('button:has(.lucide-x)').click()
    await expect(page.locator('img[alt="photo.jpg"]')).not.toBeVisible()
    await expect(page.locator('table').getByText('photo.jpg')).toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
  })

  // ── PDF Viewer in Share ─────────────────────────────────────────────

  test('opens PDF viewer when clicking a PDF file in shared folder', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('sample.pdf').click()
    await expect(page.locator('embed[type="application/pdf"]')).toBeVisible()
  })

  test('PDF viewer shows filename in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('sample.pdf').click()
    await expect(page.locator('embed[type="application/pdf"]')).toBeVisible()
    await expect(page.getByText('sample.pdf').first()).toBeVisible()
  })

  test('closing PDF viewer returns to file list in share', async ({ page }) => {
    await page.goto(folderShareUrl)
    await page.locator('table').getByText('sample.pdf').click()
    await expect(page.locator('embed[type="application/pdf"]')).toBeVisible()

    await page.locator('button[title="Close"]').click()
    await expect(page.locator('embed[type="application/pdf"]')).not.toBeVisible()
    await expect(page.locator('table').getByText('sample.pdf')).toBeVisible()
    await expect(page).not.toHaveURL(/viewing=/)
  })

  test('single-file share page shows theme switcher', async ({ page }) => {
    await page.goto(fileShareUrl)
    await expect(page.getByRole('button', { name: 'Open theme settings' })).toBeVisible()
  })
})
