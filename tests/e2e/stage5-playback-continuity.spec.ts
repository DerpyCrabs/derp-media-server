import { expect, test, type Locator, type Page } from '@playwright/test'

const OWNER_PLAYBACK_KEY = 'derp-playback-session-owner-v1'
const MUSIC_DIR = 'Music'
const FIRST_TRACK = 'track.flac'
const SECOND_TRACK = 'track.mp3'

function audioHost(page: Page) {
  return page.locator('audio[data-playback-audio-host]')
}

function audioChrome(page: Page) {
  return page.locator('[data-playback-audio-chrome]')
}

async function mediaPath(audio: Locator): Promise<string> {
  return audio.evaluate((element: HTMLAudioElement) => {
    const source = element.currentSrc || element.src
    return source ? new URL(source).pathname : ''
  })
}

async function pausePlayback(chrome: Locator, audio: Locator) {
  await audio.evaluate((element: HTMLAudioElement) => {
    element.playbackRate = 0.1
  })
  const pause = chrome.getByRole('button', { name: 'Pause', exact: true })
  await expect(pause).toBeVisible()
  await pause.click()
  await expect(chrome.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
}

async function expectOneAudioOwner(page: Page) {
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(audioHost(page)).toHaveCount(1)
  await expect(audioChrome(page)).toHaveCount(1)
  await expect(audioChrome(page)).toBeVisible()
}

async function controlLabels(chrome: Locator): Promise<string[]> {
  return chrome.locator('button[aria-label]').evaluateAll((buttons) =>
    buttons
      .map((button) => button.getAttribute('aria-label') ?? '')
      .filter(Boolean)
      .sort(),
  )
}

async function expectCompleteAudioControls(chrome: Locator) {
  for (const name of [
    'Previous track',
    'Play',
    'Next track',
    'Repeat',
    'Open audio controls',
    'Mute',
    'Stop playback',
  ]) {
    await expect(chrome.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await expect(chrome.getByRole('slider', { name: 'Playback position' })).toBeVisible()
  await expect(chrome.getByRole('slider', { name: 'Volume' })).toBeVisible()
}

test.describe('Stage 5 owner playback continuity', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((key) => localStorage.removeItem(key), OWNER_PLAYBACK_KEY)
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('next and previous switch the actual owner audio source', async ({ page }) => {
    await page.goto(`/?dir=${MUSIC_DIR}`)
    await page.locator('table').getByText(FIRST_TRACK, { exact: true }).click()

    const host = audioHost(page)
    const chrome = audioChrome(page)
    await expectOneAudioOwner(page)
    await expect.poll(() => mediaPath(host)).toContain(`/api/media/${MUSIC_DIR}/${FIRST_TRACK}`)
    await pausePlayback(chrome, host)

    const next = chrome.getByRole('button', { name: 'Next track', exact: true })
    await expect(next).toBeEnabled()
    await next.click()
    await expect.poll(() => mediaPath(host)).toContain(`/api/media/${MUSIC_DIR}/${SECOND_TRACK}`)
    await pausePlayback(chrome, host)

    const previous = chrome.getByRole('button', { name: 'Previous track', exact: true })
    await expect(previous).toBeEnabled()
    await previous.click()
    await expect.poll(() => mediaPath(host)).toContain(`/api/media/${MUSIC_DIR}/${FIRST_TRACK}`)
  })

  test('keeps one host, chrome, controls, and currentTime through folders, Workspace, and Canvas', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto(`/?dir=${MUSIC_DIR}`)
    await page.locator('table').getByText(FIRST_TRACK, { exact: true }).click()

    const host = audioHost(page)
    const chrome = audioChrome(page)
    await expectOneAudioOwner(page)
    await expect.poll(() => mediaPath(host)).toContain(`/api/media/${MUSIC_DIR}/${FIRST_TRACK}`)
    await pausePlayback(chrome, host)
    await expect
      .poll(() =>
        host.evaluate(
          (element: HTMLAudioElement) =>
            element.readyState >= HTMLMediaElement.HAVE_METADATA &&
            Number.isFinite(element.duration) &&
            element.duration > 0,
        ),
      )
      .toBe(true)

    const expectedPosition = await host.evaluate((element: HTMLAudioElement) => {
      const position = Math.min(0.75, element.duration / 2)
      element.currentTime = position
      element.dispatchEvent(new Event('timeupdate'))
      element.dataset.stage5ContinuityProbe = 'owner-audio'
      return position
    })
    await chrome.evaluate((element: HTMLElement) => {
      element.dataset.stage5ContinuityProbe = 'owner-chrome'
    })
    await expect
      .poll(async () =>
        Number(await chrome.getByRole('slider', { name: 'Playback position' }).inputValue()),
      )
      .toBeGreaterThan(expectedPosition - 0.2)

    const libraryControls = await controlLabels(chrome)
    await expectCompleteAudioControls(chrome)

    await page.getByTestId('breadcrumb-bar').getByRole('button', { name: 'Home' }).click()
    await expect(page.locator('table').getByText('Documents', { exact: true })).toBeVisible()
    await page.locator('table').getByText('Documents', { exact: true }).click()
    await expect(page).toHaveURL(/dir=Documents/)
    await expect(page.locator('table').getByText('readme.txt', { exact: true })).toBeVisible()

    await expectOneAudioOwner(page)
    await expect(host).toHaveAttribute('data-stage5-continuity-probe', 'owner-audio')
    await expect(chrome).toHaveAttribute('data-stage5-continuity-probe', 'owner-chrome')
    await expect
      .poll(async () =>
        Math.abs(
          (await host.evaluate((element) => (element as HTMLAudioElement).currentTime)) -
            expectedPosition,
        ),
      )
      .toBeLessThan(0.25)

    await page
      .getByTestId('owner-desktop-rail')
      .getByRole('link', { name: 'Workspace', exact: true })
      .click()
    await expect(page).toHaveURL(/\/workspace$/)
    await expect(page.locator('.workspace-layout')).toBeVisible()

    await expectOneAudioOwner(page)
    await expect(host).toHaveAttribute('data-stage5-continuity-probe', 'owner-audio')
    await expect(chrome).toHaveAttribute('data-stage5-continuity-probe', 'owner-chrome')
    await expectCompleteAudioControls(chrome)
    expect(await controlLabels(chrome)).toEqual(libraryControls)
    await expect
      .poll(async () =>
        Math.abs(
          (await host.evaluate((element) => (element as HTMLAudioElement).currentTime)) -
            expectedPosition,
        ),
      )
      .toBeLessThan(0.25)

    await page.goBack()
    await expect(page).toHaveURL(/dir=Documents/)
    await expect(page.getByTestId('file-browser')).toBeVisible()
    await expectOneAudioOwner(page)
    await expect(host).toHaveAttribute('data-stage5-continuity-probe', 'owner-audio')
    await expect(chrome).toHaveAttribute('data-stage5-continuity-probe', 'owner-chrome')
    await expect
      .poll(async () =>
        Math.abs(
          (await host.evaluate((element) => (element as HTMLAudioElement).currentTime)) -
            expectedPosition,
        ),
      )
      .toBeLessThan(0.25)

    await page
      .getByTestId('owner-desktop-rail')
      .getByRole('link', { name: 'Canvas', exact: true })
      .click()
    await expect(page).toHaveURL(/\/canvas$/)
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()

    await expectOneAudioOwner(page)
    await expect(host).toHaveAttribute('data-stage5-continuity-probe', 'owner-audio')
    await expect(chrome).toHaveAttribute('data-stage5-continuity-probe', 'owner-chrome')
    await expectCompleteAudioControls(chrome)
    expect(await controlLabels(chrome)).toEqual(libraryControls)
    await expect
      .poll(async () =>
        Math.abs(
          (await host.evaluate((element) => (element as HTMLAudioElement).currentTime)) -
            expectedPosition,
        ),
      )
      .toBeLessThan(0.25)

    await page.goBack()
    await expect(page).toHaveURL(/dir=Documents/)
    await expect(page.getByTestId('file-browser')).toBeVisible()
    await expectOneAudioOwner(page)
    await expect(host).toHaveAttribute('data-stage5-continuity-probe', 'owner-audio')
    await expect(chrome).toHaveAttribute('data-stage5-continuity-probe', 'owner-chrome')
    await expect
      .poll(async () =>
        Math.abs(
          (await host.evaluate((element) => (element as HTMLAudioElement).currentTime)) -
            expectedPosition,
        ),
      )
      .toBeLessThan(0.25)
  })
})
