import { test, expect, type Page } from '@playwright/test'
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } })
async function audio(page: Page, native = false) {
  if (native)
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
  const data = Buffer.alloc(44 + 8000 * 120 * 2)
  data.write('RIFF')
  data.writeUInt32LE(data.length - 8, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(8000, 24)
  data.writeUInt32LE(16000, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(data.length - 44, 40)
  await page.route('**/api/media/Music/track.*', (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()['range'] ?? '')
    const start = Number(range?.[1] ?? 0),
      end = Math.min(data.length - 1, Number(range?.[2] || data.length - 1))
    return route.fulfill({
      status: range ? 206 : 200,
      body: data.subarray(start, end + 1),
      contentType: 'audio/wav',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${data.length}` } : {}),
      },
    })
  })
  await page.goto(
    native
      ? '/desktop?mode=viewer&dir=Music&viewing=Music%2Ftrack.flac'
      : '/?dir=Music&playing=Music%2Ftrack.mp3',
  )
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.duration))
    .toBe(120)
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
}
async function timer(page: Page, mobile = false) {
  await page
    .getByRole('button', { name: mobile ? 'Up next' : 'Playback options', exact: true })
    .click()
  await page.getByRole(mobile ? 'button' : 'menuitem', { name: /^Sleep timer/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Sleep timer', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
test('mobile queue timer counts down while paused, expires, and allows explicit resume', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await audio(page)
  await page.clock.install()
  let dialog = await timer(page, true)
  await dialog.getByRole('spinbutton', { name: 'Timer minutes' }).fill('1')
  await dialog.getByRole('button', { name: 'Set timer', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.clock.fastForward(30000)
  dialog = await timer(page, true)
  await expect(dialog.getByRole('status')).toContainText('Pauses in 0:30')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.clock.fastForward(31000)
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(true)
  dialog = await timer(page, true)
  await expect(dialog.getByRole('status')).toContainText('Playback paused by the sleep timer')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false)
})
test('native viewer ends the current track without starting the next queued item', async ({
  page,
}) => {
  await audio(page, true)
  const dialog = await timer(page)
  await dialog.getByRole('button', { name: 'End of this item', exact: true }).click()
  await page.getByRole('slider', { name: 'Playback position', exact: true }).press('End')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/viewing=Music%2Ftrack.flac/)
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.ended))
    .toBe(true)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false)
})
test('cancel timer preserves playback and reload does not restore the timer', async ({ page }) => {
  await audio(page)
  await page.clock.install()
  let dialog = await timer(page)
  await dialog.getByRole('button', { name: '5 min', exact: true }).click()
  dialog = await timer(page)
  await dialog.getByRole('button', { name: 'Cancel timer', exact: true }).click()
  await page.clock.fastForward(301000)
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  dialog = await timer(page)
  await dialog.getByRole('button', { name: '30 min', exact: true }).click()
  await page.reload()
  dialog = await timer(page)
  await expect(dialog.getByRole('status')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Cancel timer', exact: true })).toHaveCount(0)
})
test('fullscreen video keeps the sleep dialog visible and usable', async ({ page }) => {
  await page.goto('/?dir=Videos&playing=Videos%2Fsample.mp4')
  await expect
    .poll(() => page.locator('video').evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: 'Enter fullscreen', exact: true }).click()
  await page.getByRole('button', { name: 'Playback settings', exact: true }).click()
  await page.getByRole('button', { name: /^Sleep timer/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Sleep timer', exact: true })
  await expect(dialog).toBeVisible()
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true)
  await expect(dialog).toBeInViewport()
  await dialog.getByRole('button', { name: '10 min', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.evaluate(() => document.exitFullscreen())
  await page.getByRole('button', { name: 'Playback settings', exact: true }).click()
  await expect(page.getByRole('button', { name: /Sleep timer · until/ })).toBeVisible()
})
test('sleep at track end overrides repeat on the actual audio element', async ({ page }) => {
  await audio(page)
  await page.getByRole('button', { name: 'Enable repeat', exact: true }).click()
  const dialog = await timer(page)
  await dialog.getByRole('button', { name: 'End of this item', exact: true }).click()
  await page.getByRole('slider', { name: 'Playback position', exact: true }).press('End')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.ended && el.paused))
    .toBe(true)
  await expect(page.getByRole('button', { name: 'Disable repeat', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeLessThan(10)
})
test('timer remains available across Library and Workspace without reloading playback', async ({
  page,
}) => {
  await audio(page)
  await page.clock.install()
  let dialog = await timer(page)
  await dialog.getByRole('button', { name: '5 min', exact: true }).click()
  await page.locator('audio').evaluate((el) => el.setAttribute('data-timer-host', 'original'))
  await page.evaluate(() => window.history.pushState(null, '', '/workspace?dir=Music'))
  await expect(page.locator('.workspace-layout')).toBeVisible()
  await page.getByRole('button', { name: 'Open audio controls', exact: true }).click()
  dialog = await timer(page)
  await expect(dialog.getByRole('status')).toContainText('Pauses in 5:00')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await page.clock.fastForward(301000)
  await expect(page.locator('audio')).toHaveAttribute('data-timer-host', 'original')
  await expect
    .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(true)
  await page.evaluate(() => window.history.pushState(null, '', '/?dir=Music'))
  dialog = await timer(page)
  await expect(dialog.getByRole('status')).toContainText('Playback paused by the sleep timer')
})
