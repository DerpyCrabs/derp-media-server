import { test, expect } from '@playwright/test'
import {
  cleanupForYouMedia,
  enableForYou,
  homePage,
  openSearch,
  optionsFor,
  pauseAt,
  readyVideo,
  setupForYouMedia,
  tracks,
  videoFolder,
  videos,
} from './media-ai-helpers'

test.beforeAll(setupForYouMedia)
test.afterAll(cleanupForYouMedia)
test.beforeEach(async ({ page }) => {
  await enableForYou(page)
})

test('pagination preserves server order and deduplicates paths with different IDs', async ({
  page,
}) => {
  await page.route('**/api/media-ai/home*', (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor'))
    return route.fulfill({
      json:
        cursor === 0
          ? homePage([tracks[0]], 1)
          : homePage([{ ...tracks[0], id: 999, name: 'Duplicate path' }, tracks[1]]),
    })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play Second song', exact: true })).toBeVisible()
  const names = await page
    .locator('article > button')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')))
  expect(names).toEqual(['Play First song', 'Play Second song'])
})

test('failed home refresh preserves cards and the active video', async ({ page }) => {
  let fail = false
  await page.route('**/api/media-ai/home*', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: 'Provider unavailable' } })
      : route.fulfill({ json: homePage(videos) }),
  )
  await page.route('**/api/media-ai/feedback', (route) => {
    fail = true
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First clip', exact: true }).click()
  const video = await readyVideo(page)
  await pauseAt(video, 2)
  await page.getByRole('button', { name: 'Like First clip', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Couldn’t load more right now.')
  await expect(page.getByRole('button', { name: 'Play First clip', exact: true })).toBeVisible()
  await expect(video).toHaveAttribute('src', /first.mp4/)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
})

test('manual refresh stays in place, preserves playback, and can retry a failed request', async ({
  page,
}) => {
  let fail = true
  let refreshed = false
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({ json: homePage(refreshed ? tracks : videos) }),
  )
  await page.route('**/api/media-ai/refresh', async (route) => {
    expect(route.request().method()).toBe('POST')
    if (fail) return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
    await gate
    refreshed = true
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First clip', exact: true }).click()
  const video = await readyVideo(page)
  await pauseAt(video, 2)
  const header = page.getByTestId('media-navigation-header')
  const refresh = header.getByRole('button', { name: 'Refresh recommendations', exact: true })
  const search = header.getByRole('button', { name: 'Search library', exact: true })
  const position = await refresh.boundingBox()
  const searchPosition = await search.boundingBox()
  await refresh.click()
  await expect(page.getByRole('alert')).toContainText('Couldn’t refresh recommendations')
  await expect(page.getByRole('button', { name: 'Play First clip', exact: true })).toBeVisible()
  fail = false
  await refresh.click()
  await expect(refresh).toBeDisabled()
  await expect(refresh).toHaveAttribute('aria-busy', 'true')
  expect(await refresh.boundingBox()).toEqual(position)
  expect(await search.boundingBox()).toEqual(searchPosition)
  release()
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  await expect(refresh).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(video).toHaveAttribute('src', /first.mp4/)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 1)
  await page.setViewportSize({ width: 390, height: 844 })
  const mobile = await refresh.boundingBox()
  expect(mobile!.x + mobile!.width).toBeLessThanOrEqual(390)
  await refresh.scrollIntoViewIfNeeded()
  await expect(refresh).toBeVisible()
})

test('one broken thumbnail does not discard recommendations with healthy previews', async ({
  page,
}) => {
  await page.route('**/api/thumbnail/Music/track.mp3*', (route) => route.fulfill({ status: 404 }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play Second song', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Play Second song', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('playing')).toBe(tracks[1].path)
})

test('a slow preview is decoded before its recommendation card appears', async ({ page }) => {
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({ json: homePage([tracks[0]]) }),
  )
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  await page.route('**/api/thumbnail/Music/track.mp3*', async (route) => {
    requested = true
    await gate
    await route.continue()
  })
  await page.goto('/')
  await expect.poll(() => requested).toBe(true)
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Loading')
  release()
  const card = page.getByRole('button', { name: 'Play First song', exact: true })
  await expect(card).toBeVisible()
  expect(
    await card
      .locator('img')
      .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 1),
  ).toBe(true)
})

test('an empty feed still permits search and Library navigation', async ({ page }) => {
  await page.route('**/api/media-ai/home*', (route) => route.fulfill({ json: homePage([]) }))
  await page.route('**/api/media-ai/ask', (route) =>
    route.fulfill({ json: { items: [tracks[0]], message: '', intent: 'show' } }),
  )
  await page.goto('/')
  await expect(page.getByText('Nothing to play yet. Try searching your library.')).toBeVisible()
  await (await openSearch(page)).fill('Find a song')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.locator('table')).toBeVisible()
})

test('scrolling repeatedly while the next page is pending requests it only once', async ({
  page,
}) => {
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/media-ai/home*', async (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor'))
    if (cursor === 0) return route.fulfill({ json: homePage([tracks[0]], 1) })
    calls++
    await gate
    return route.fulfill({ json: homePage([tracks[1]]) })
  })
  await page.goto('/')
  await expect.poll(() => calls).toBe(1)
  for (const y of [2000, 0, 2000]) await page.evaluate((top) => window.scrollTo(0, top), y)
  expect(calls).toBe(1)
  release()
  await expect(page.getByRole('button', { name: 'Play Second song', exact: true })).toBeVisible()
  expect(calls).toBe(1)
})

test('unsupported file types cannot appear alongside playable recommendations', async ({
  page,
}) => {
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({
      json: homePage([
        ...tracks,
        { id: 301, name: 'Project notes', path: 'Notes/readme.md', type: 'text' },
        { id: 302, name: 'Photo', path: 'Images/photo.jpg', type: 'image' },
        videoFolder,
      ]),
    }),
  )
  await page.goto('/')
  await expect(page.locator('article')).toHaveCount(3)
  await expect(
    page.getByRole('button', { name: 'Open Video collection', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Project notes', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Photo', { exact: true })).toHaveCount(0)
})

test('card controls keep their positions through title wrapping, hover and like updates', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({
      json: homePage([
        { ...tracks[0], displayTitle: 'Short title' },
        {
          ...tracks[1],
          displayTitle: 'A longer title that wraps across two lines in a recommendation card',
        },
      ]),
    }),
  )
  await page.route('**/api/media-ai/feedback', (route) => route.fulfill({ json: { ok: true } }))
  await page.goto('/')
  const first = page.getByRole('button', { name: 'Like First song', exact: true })
  const second = page.getByRole('button', { name: 'Like Second song', exact: true })
  await expect(first).toBeVisible()
  const initial = await first.boundingBox()
  expect((await second.boundingBox())!.y).toBe(initial!.y)
  await first.hover()
  await first.click()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  expect(await first.boundingBox()).toEqual(initial)
  expect((await second.boundingBox())!.y).toBe(initial!.y)
})

test('mobile Library search opens and dismisses without disturbing a paused video', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/?view=for-you&playing=${encodeURIComponent(videos[0].path)}`)
  const video = await readyVideo(page)
  await pauseAt(video, 2)
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  const search = page
    .getByTestId('media-navigation-header')
    .getByRole('button', { name: 'Search library', exact: true })
  await search.click()
  const modal = page.getByTestId('file-search-palette')
  await expect(modal.getByRole('combobox')).toBeFocused()
  await modal.getByRole('button', { name: 'Close search', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(search).toBeFocused()
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('Back from a recommendation folder returns to the feed without replacing playback', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First song', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const audio = page.locator('audio')
  const source = await audio.getAttribute('src')
  await (
    await optionsFor(page, 'First clip')
  )
    .getByRole('button', { name: 'Open folder', exact: true })
    .click()
  await expect(page.getByTestId('for-you')).toHaveCount(0)
  await page.goBack()
  await expect(page.getByTestId('for-you')).toBeVisible()
  await expect(audio).toHaveAttribute('src', source!)
  await expect.poll(() => audio.evaluate((v: HTMLAudioElement) => v.paused)).toBe(true)
})
