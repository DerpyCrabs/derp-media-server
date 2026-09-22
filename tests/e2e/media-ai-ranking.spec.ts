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

test('Books stops polling and does not automatically traverse unrelated pages', async ({
  page,
}) => {
  let requests = 0
  await page.route('**/api/media-ai/home*', (route) => {
    requests++
    return route.fulfill({
      json: { ...homePage(videos), feedId: 'books-idle', resumeCursor: 24, warming: true },
    })
  })
  await page.route('**/api/media-ai/refresh', (route) =>
    route.fulfill({
      json: {
        ...homePage(videos, 24),
        feedId: 'books-refreshed',
        resumeCursor: 24,
        warming: true,
      },
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Books', exact: true }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  const before = requests
  await page.waitForTimeout(2000)
  expect(requests).toBe(before)
  await page.getByRole('button', { name: 'Refresh recommendations' }).click()
  await expect(page.getByRole('button', { name: 'Load more recommendations' })).toBeVisible()
  await page.waitForTimeout(2000)
  expect(requests).toBe(before)
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('background warming stops polling after a bounded number of attempts', async ({ page }) => {
  await page.clock.install()
  let requests = 0
  await page.route('**/api/media-ai/home*', (route) => {
    requests++
    return route.fulfill({
      json: { ...homePage([]), feedId: 'always-warming', resumeCursor: 0, warming: true },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('Loading')
  for (const [index, delay] of [1500, 3000, 6000, 12000].entries()) {
    await page.clock.fastForward(delay)
    await expect.poll(() => requests).toBe(index + 2)
  }
  await expect(page.getByRole('status')).toHaveCount(0)
  await page.clock.fastForward(60000)
  expect(requests).toBe(5)
})

test('All keeps book recommendations in one compact row and opens the full selection', async ({
  page,
}) => {
  const books = Array.from({ length: 12 }, (_, index) => ({
    id: 800 + index,
    path: `Books/book-${index}.epub`,
    name: `Book ${index}`,
    type: 'book',
    reason: 'A recommendation based on your library',
    readingProgress: index === 0 ? 0.67 : 0,
    lastRead: index === 0 ? Date.now() : 0,
  }))
  await page.route('**/api/media-ai/books', (route) => route.fulfill({ json: { items: books } }))
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({ json: homePage([...videos, ...tracks, ...books]) }),
  )
  await page.goto('/')
  const shelf = page.getByRole('region', { name: 'Books', exact: true })
  const more = page.getByRole('region', { name: 'Recommended media', exact: true })
  await expect(more.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  await expect(more.getByRole('button', { name: /^Read / })).toHaveCount(0)
  await expect(shelf.locator('article')).toHaveCount(3)
  await expect(shelf.getByText('67%')).toBeVisible()
  await expect(shelf.getByText('Read book', { exact: true })).toHaveCount(0)
  await expect(shelf.getByText(books[0].reason)).toHaveCount(0)
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    const bounds = await shelf.boundingBox()
    expect(bounds!.height).toBeLessThan(180)
    const tops = await shelf
      .locator('article')
      .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top))
    expect(new Set(tops).size).toBe(1)
  }
  await shelf.getByRole('button', { name: 'See all' }).click()
  await expect(shelf.locator('article')).toHaveCount(12)
  await expect(shelf.getByText('Read book', { exact: true })).toHaveCount(0)
  await expect(shelf.getByText(books[0].reason).first()).toBeVisible()
})

test('progress distinguishes discovery and keeps a fixed queue across background tasks', async ({
  page,
}) => {
  test.setTimeout(50000)
  let phase = 'ranking'
  let progress: { phase: string; found?: number; completed?: number; total?: number } = {
    phase: 'discovering',
    found: 38,
    completed: 3,
  }
  await page.route('**/api/media-ai/status', (route) =>
    route.fulfill({
      json: { enabled: true, progress, job: { phase }, analyzed: 0, total: 99999 },
    }),
  )
  await page.goto('/')
  const indicator = page.getByTestId('indexing-progress')
  await expect(indicator).toHaveText('AI analysis · 3 processed · finding files (38 found)')
  await expect(indicator).not.toContainText('%')
  progress = { phase: 'processing', completed: 39, total: 100 }
  await expect(indicator).toHaveText('AI analysis · 39 / 100 · 39%', { timeout: 15000 })
  phase = 'reviewing-music'
  progress = { phase: 'processing', completed: 40, total: 100 }
  await expect(indicator).toHaveText('AI analysis · 40 / 100 · 40%', { timeout: 15000 })
  progress = { phase: 'complete', completed: 100, total: 100 }
  phase = 'idle'
  await expect(indicator).toHaveCount(0, { timeout: 15000 })
})
