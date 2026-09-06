import { test, expect } from '@playwright/test'
import {
  cleanupForYouMedia,
  enableForYou,
  homePage,
  pauseAt,
  readyVideo,
  setupForYouMedia,
  tracks,
  videos,
} from './media-ai-helpers'

test.beforeAll(setupForYouMedia)
test.afterAll(cleanupForYouMedia)
test.beforeEach(async ({ page }) => {
  await enableForYou(page)
})

test('refresh consumes the prepared response without another home request or replacing playback', async ({
  page,
}) => {
  let homeRequests = 0
  await page.route('**/api/media-ai/home*', (route) => {
    homeRequests++
    return route.fulfill({ json: { ...homePage(videos), feedId: 'before' } })
  })
  await page.route('**/api/media-ai/refresh', (route) =>
    route.fulfill({ json: { ...homePage(tracks), feedId: 'after', warming: false } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First clip', exact: true }).click()
  const video = await readyVideo(page)
  await pauseAt(video, 2)
  const before = homeRequests
  await page.getByRole('button', { name: 'Refresh recommendations' }).click()
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh recommendations' })).toBeEnabled()
  expect(homeRequests).toBe(before)
  await expect(video).toHaveAttribute('src', /first.mp4/)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(2, 1)
})

test('new background scores append to an exhausted feed without replacing existing cards', async ({
  page,
}) => {
  const queries: URLSearchParams[] = []
  await page.route('**/api/media-ai/home*', (route) => {
    const query = new URL(route.request().url()).searchParams
    queries.push(query)
    const next = query.get('cursor') === '1'
    return route.fulfill({
      json: {
        ...homePage([tracks[next ? 1 : 0]]),
        feedId: 'stable',
        resumeCursor: next ? 2 : 1,
        warming: !next,
      },
    })
  })
  await page.goto('/')
  const first = page.getByRole('button', { name: 'Play First song', exact: true })
  await expect(first).toBeVisible()
  const element = await first.elementHandle()
  await expect(page.getByRole('button', { name: 'Play Second song', exact: true })).toBeVisible()
  expect(await first.evaluate((node, original) => node === original, element)).toBe(true)
  expect(queries).toHaveLength(2)
  expect(queries[1].get('feedId')).toBe('stable')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('a cold feed appears automatically after background ranking finishes', async ({ page }) => {
  let requests = 0
  await page.route('**/api/media-ai/home*', (route) => {
    requests++
    return route.fulfill({
      json: {
        ...homePage(requests === 1 ? [] : [tracks[0]]),
        feedId: 'cold',
        resumeCursor: requests === 1 ? 0 : 1,
        warming: requests === 1,
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('Loading')
  await expect(page.getByText('Nothing to play yet. Try searching your library.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  expect(requests).toBe(2)
})

test('refresh discards a late response from the previous feed', async ({ page }) => {
  let waiting = false
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/media-ai/home*', async (route) => {
    const next = new URL(route.request().url()).searchParams.get('cursor') === '1'
    if (next) {
      waiting = true
      await gate
    }
    await route
      .fulfill({
        json: {
          ...homePage([tracks[next ? 1 : 0]]),
          feedId: 'old',
          resumeCursor: next ? 2 : 1,
          warming: !next,
        },
      })
      .catch(() => undefined)
  })
  await page.route('**/api/media-ai/refresh', (route) =>
    route.fulfill({ json: { ...homePage(videos), feedId: 'new', warming: false } }),
  )
  await page.goto('/')
  await expect.poll(() => waiting).toBe(true)
  await page.getByRole('button', { name: 'Refresh recommendations' }).click()
  await expect(page.getByRole('button', { name: 'Play First clip', exact: true })).toBeVisible()
  release()
  await expect(page.getByRole('button', { name: 'Play Second song', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toHaveCount(0)
  await expect(page.locator('article')).toHaveCount(2)
})
