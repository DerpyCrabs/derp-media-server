import { test, expect, type Page } from '@playwright/test'

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } })
const audio = Buffer.alloc(44 + 16000 * 60 * 2)
audio.write('RIFF', 0)
audio.writeUInt32LE(audio.length - 8, 4)
audio.write('WAVEfmt ', 8)
audio.writeUInt32LE(16, 16)
audio.writeUInt16LE(1, 20)
audio.writeUInt16LE(1, 22)
audio.writeUInt32LE(16000, 24)
audio.writeUInt32LE(32000, 28)
audio.writeUInt16LE(2, 32)
audio.writeUInt16LE(16, 34)
audio.write('data', 36)
audio.writeUInt32LE(audio.length - 44, 40)
async function nativeAudio(page: Page, path = 'Music/track.flac') {
  await page.addInitScript(() =>
    Object.assign(window, {
      derpDesktop: {
        ready: async () => {},
        onOpen: () => () => {},
        onBeforeClose: () => () => {},
        close: () => {},
      },
    }),
  )
  await page.route('**/api/media/Music/*', (route) => {
    if (!/\.(mp3|flac)(\?|$)/.test(route.request().url())) return route.continue()
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()['range'] ?? '')
    const start = Number(range?.[1] ?? 0)
    const end = Math.min(audio.length - 1, Number(range?.[2] || audio.length - 1))
    return route.fulfill({
      status: range ? 206 : 200,
      body: audio.subarray(start, end + 1),
      contentType: 'audio/wav',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${audio.length}` } : {}),
      },
    })
  })
  await page.goto(`/desktop?mode=viewer&dir=Music&viewing=${encodeURIComponent(path)}`)
  await expect(page.getByTestId('canvas-audio-player-ui')).toBeVisible()
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => !el.paused))
    .toBe(true)
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.duration))
    .toBe(60)
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(0.05)
}

test('native audio opens, keeps playing when changing tracks, and follows the next track at the end', async ({
  page,
}) => {
  await nativeAudio(page)
  await page.getByRole('button', { name: 'Next track', exact: true }).click()
  await expect(page).toHaveURL(/viewing=Music%2Ftrack.mp3/)
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => !el.paused))
    .toBe(true)
  await page.getByRole('button', { name: 'Previous track', exact: true }).click()
  await expect(page).toHaveURL(/viewing=Music%2Ftrack.flac/)
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.duration))
    .toBe(60)
  await page.getByRole('slider', { name: 'Playback position', exact: true }).press('End')
  await expect(page).toHaveURL(/viewing=Music%2Ftrack.mp3/)
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Audio playback speed', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '1.5×', exact: true }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.playbackRate))
    .toBe(1.5)
})

test('playing in another native window pauses the previous window without losing its position', async ({
  page,
  context,
}) => {
  await nativeAudio(page)
  await page.getByRole('slider', { name: 'Playback position', exact: true }).press('PageUp')
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(5)
  const position = await page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime)
  const other = await context.newPage()
  await nativeAudio(other, 'Music/track.mp3')
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(true)
  expect(
    await page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime),
  ).toBeGreaterThanOrEqual(position - 0.2)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect
    .poll(() => other.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(true)
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => !el.paused))
    .toBe(true)
  await other.close()
})

test('native audio plays a saved playlist in its own order and keeps the viewer in sync', async ({
  page,
  request,
}) => {
  const response = await request.post('/api/music/playlists', {
    data: { name: 'Native listening order', paths: ['Music/track.mp3', 'Music/track.flac'] },
  })
  expect(response.ok()).toBe(true)
  const { id } = await response.json()
  try {
    await nativeAudio(page)
    await page.getByRole('button', { name: 'Up next', exact: true }).click()
    await page.getByRole('button', { name: 'Playlists', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Playlists', exact: true })
    await dialog.getByRole('button', { name: /Native listening order/ }).click()
    await dialog.getByRole('button', { name: 'Play all', exact: true }).click()
    await expect(page).toHaveURL(/viewing=Music%2Ftrack.mp3/)
    await dialog.getByRole('button', { name: 'Close playlists' }).click()
    await expect(page.getByRole('button', { name: 'Previous track', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Next track', exact: true }).click()
    await expect(page).toHaveURL(/viewing=Music%2Ftrack.flac/)
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Up next', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Up next' })).toContainText(
      'Native listening order',
    )
  } finally {
    await request.delete(`/api/music/playlists/${id}`)
  }
})
