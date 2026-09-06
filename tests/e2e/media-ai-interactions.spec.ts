import { test, expect } from '@playwright/test'
import {
  advancing,
  cleanupForYouMedia,
  setupForYouMedia,
  enableForYou,
  homePage,
  openSearch,
  optionsFor,
  pauseAt,
  playNative,
  readyVideo,
  tracks,
  videoFolder,
  videos,
} from './media-ai-helpers'

test.beforeAll(setupForYouMedia)
test.afterAll(cleanupForYouMedia)
test.beforeEach(async ({ page }) => {
  await enableForYou(page)
})

test('a play search starts its returned video and builds a video queue', async ({ page }) => {
  await page.route('**/api/media-ai/ask', (route) =>
    route.fulfill({ json: { items: videos, intent: 'play', message: '' } }),
  )
  await page.goto('/')
  await (await openSearch(page)).fill('Play a video')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('playing')).toBe(videos[0].path)
  const video = await readyVideo(page)
  await advancing(video)
  await expect(page.getByRole('button', { name: 'Next video', exact: true })).toBeEnabled()
})

test('queue search adds a track without replacing the current audio', async ({ page }) => {
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({ json: homePage([tracks[0]]) }),
  )
  await page.route('**/api/media-ai/ask', (route) =>
    route.fulfill({ json: { items: [tracks[1]], intent: 'queue', message: '' } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First song', exact: true }).click()
  const audio = page.locator('audio')
  await expect(audio).toBeAttached()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const source = await audio.getAttribute('src')
  await (await openSearch(page)).fill('Queue another song')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Added 1 items to queue')
  await expect(audio).toHaveAttribute('src', source!)
  await expect.poll(() => audio.evaluate((v: HTMLAudioElement) => v.paused)).toBe(true)
  await page.getByRole('button', { name: 'Next track', exact: true }).click()
  await expect(page).toHaveURL(/playing=MediaContent%2Ftrack.mp3/)
})

test('show-only search leaves a paused video and its position alone', async ({ page }) => {
  await page.route('**/api/media-ai/ask', (route) =>
    route.fulfill({ json: { items: tracks, intent: 'show', message: '' } }),
  )
  await page.goto(`/?view=for-you&playing=${encodeURIComponent(videos[0].path)}`)
  const video = await readyVideo(page)
  await playNative(video)
  await pauseAt(video, 2)
  await (await openSearch(page)).fill('Show songs')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  await expect
    .poll(() =>
      video.evaluate((v: HTMLVideoElement) => ({ paused: v.paused, time: v.currentTime })),
    )
    .toEqual({ paused: true, time: 2 })
  expect(new URL(page.url()).searchParams.get('playing')).toBe(videos[0].path)
})

test('failed follow-up search preserves its previous results and can be retried', async ({
  page,
}) => {
  let requests = 0
  await page.route('**/api/media-ai/ask', (route) => {
    requests++
    return requests === 2
      ? route.fulfill({ status: 503, json: { error: 'Internal ranking failure' } })
      : route.fulfill({
          json: { items: [tracks[requests === 1 ? 0 : 1]], intent: 'show', message: '' },
        })
  })
  await page.goto('/')
  const input = await openSearch(page)
  await input.fill('Show first song')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play Second song', exact: true })).toHaveCount(0)
  await input.fill('Something else')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Search is unavailable right now')
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  await expect(input).toHaveValue('Something else')
  await expect(page.getByText('Internal ranking failure')).toHaveCount(0)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play Second song', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('follow-up search sends only six previous queries and a new search clears history', async ({
  page,
}) => {
  const requests: { query: string; history: string[] }[] = []
  await page.route('**/api/media-ai/ask', (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: { items: [tracks[0]], intent: 'show', message: '' } })
  })
  await page.goto('/')
  const input = await openSearch(page)
  for (let i = 0; i < 8; i++) {
    await input.fill(`Query ${i}`)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect.poll(() => requests.length).toBe(i + 1)
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeEnabled()
  }
  expect(requests[7].history).toEqual([
    'Query 1',
    'Query 2',
    'Query 3',
    'Query 4',
    'Query 5',
    'Query 6',
  ])
  await page.getByRole('button', { name: 'Start a new search', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Play First clip', exact: true })).toBeVisible()
  await input.fill('Fresh query')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect.poll(() => requests.length).toBe(9)
  expect(requests[8].history).toEqual([])
})

test('For you library matches use the real file search endpoint and open the matched folder', async ({
  page,
  request,
}) => {
  test.setTimeout(45000)
  await expect
    .poll(
      async () => {
        const response = await request.get('/api/files/search?q=Videos&limit=12')
        const result = (await response.json()) as { results: { path: string }[] }
        return result.results.some((item) => item.path === 'Videos')
      },
      { timeout: 30000 },
    )
    .toBe(true)
  await page.goto('/')
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/files/search?q=Videos') && r.status() === 200,
  )
  await (await openSearch(page)).fill('Videos')
  await response
  await expect(page.getByText('Library matches', { exact: true })).toBeVisible()
  await page
    .getByRole('button', { name: /^▸ Videos/ })
    .first()
    .click()
  await expect(page).toHaveURL(/view=library.*dir=Videos/)
  await expect(page.getByTestId('for-you')).toHaveCount(0)
  await expect(page.locator('table').getByText('sample.mp4', { exact: true })).toBeVisible()
})

test('liking then unliking a recommendation persists the intended feedback across reload', async ({
  page,
}) => {
  let liked = false
  const kinds: string[] = []
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({ json: homePage([{ ...tracks[0], liked }]) }),
  )
  await page.route('**/api/media-ai/feedback', (route) => {
    const body = route.request().postDataJSON() as { path: string; kind: string }
    expect(body.path).toBe(tracks[0].path)
    kinds.push(body.kind)
    liked = body.kind === 'more'
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  const like = page.getByRole('button', { name: 'Like First song', exact: true })
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await like.click()
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  await page.reload()
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  expect(kinds).toEqual(['more', 'clear'])
})

test('failed dislike keeps the card and retry hides it without stopping playback', async ({
  page,
}) => {
  let failed = true
  await page.route('**/api/media-ai/feedback', (route) =>
    failed
      ? route.fulfill({ status: 500, json: { error: 'Database unavailable' } })
      : route.fulfill({ json: { ok: true } }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First clip', exact: true }).click()
  const video = await readyVideo(page)
  await pauseAt(video, 1)
  const dislike = page.getByRole('button', { name: 'Dislike First clip', exact: true })
  await dislike.click()
  await expect(page.getByRole('alert')).toContainText('Couldn’t save that change')
  await expect(dislike).toBeVisible()
  failed = false
  await dislike.click()
  await expect(page.getByRole('button', { name: 'Play First clip', exact: true })).toHaveCount(0)
  await expect(video).toBeVisible()
  await expect(video).toHaveAttribute('src', /first.mp4/)
  await playNative(video)
})

test('hiding a folder removes its sibling recommendations without hiding other folders', async ({
  page,
}) => {
  const feedback: { path: string; kind: string }[] = []
  await page.route('**/api/media-ai/feedback', (route) => {
    feedback.push(route.request().postDataJSON())
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  await (
    await optionsFor(page, 'First clip')
  )
    .getByRole('button', { name: 'Hide this folder', exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Play First clip', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play Second clip', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play First song', exact: true })).toBeVisible()
  expect(feedback).toEqual([{ path: 'MediaContent/ForYouTestMedia', kind: 'hide' }])
})

test('Open folder on a collection uses the collection itself and preserves current audio', async ({
  page,
}) => {
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({ json: homePage([tracks[0], videoFolder]) }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First song', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  const audio = page.locator('audio')
  const source = await audio.getAttribute('src')
  await (
    await optionsFor(page, 'Video collection')
  )
    .getByRole('button', { name: 'Open folder', exact: true })
    .click()
  expect(new URL(page.url()).searchParams.get('dir')).toBe(videoFolder.path)
  await expect(page.getByTestId('for-you')).toHaveCount(0)
  await expect(audio).toHaveAttribute('src', source!)
  await expect.poll(() => audio.evaluate((v: HTMLAudioElement) => v.paused)).toBe(true)
})
