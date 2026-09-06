import { expect } from '@playwright/test'
import { test, type Home } from './media-ai-regression-helpers'

test.describe('activity over plain HTTP', () => {
  test.use({ aiEnabled: false })

  test('opening audio works without secure-context crypto.randomUUID', async ({
    page,
    library,
  }) => {
    const [song] = library.seed(1)
    const origin = 'http://media-ai-regression.test'
    await page.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/events/stream') {
        await route.abort()
        return
      }
      const response = await route.fetch({ url: `${library.url}${url.pathname}${url.search}` })
      await route.fulfill({ response })
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${origin}/?dir=Songs`)
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
    await page.locator('table').getByText(song.name, { exact: true }).click()
    await expect.soft(page).toHaveURL(new RegExp(`playing=${encodeURIComponent(song.path)}`))
    expect(errors).toEqual([])
    await expect(page.getByTestId('audio-player-chrome')).toBeVisible()
  })
})

test('unplayed search reaches matches after the first 100 played files', async ({
  request,
  library,
}) => {
  const items = library.seed(150)
  const insert = library.database.prepare(
    'INSERT INTO media_totals(path,plays,learned_plays) VALUES(?,1,1)',
  )
  for (const item of items.slice(0, 100)) insert.run(item.path)

  const control = await request.post(`${library.url}/api/media-ai/ask`, {
    data: { query: 'song-101' },
  })
  expect(control.ok()).toBe(true)
  expect((await control.json()).items).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 101 })]),
  )

  const response = await request.post(`${library.url}/api/media-ai/ask`, {
    data: { query: 'show unplayed songs' },
  })
  expect(response.ok()).toBe(true)
  const result = (await response.json()) as { items: { id: number }[] }
  expect(result.items.length).toBeGreaterThan(0)
  expect(result.items.every((item) => item.id > 100)).toBe(true)
})

test('hiding cached picks still allows the next recommendation page to generate', async ({
  request,
  library,
}) => {
  const items = library.seed(48)
  library.cache(items.slice(0, 32))
  for (const item of items.slice(0, 9)) {
    const response = await request.post(`${library.url}/api/media-ai/feedback`, {
      data: { path: item.path, kind: 'hide' },
    })
    expect(response.ok()).toBe(true)
  }
  const firstResponse = await request.get(`${library.url}/api/media-ai/home?cursor=0`)
  expect(firstResponse.ok()).toBe(true)
  const first = (await firstResponse.json()) as Home
  expect(first.rows.flatMap((row) => row.items)).toHaveLength(23)
  expect(first.nextCursor).not.toBeNull()
  const nextResponse = await request.get(
    `${library.url}/api/media-ai/home?cursor=${first.nextCursor}`,
  )
  expect(nextResponse.ok()).toBe(true)
  const next = (await nextResponse.json()) as Home
  const nextItems = next.rows.flatMap((row) => row.items)
  expect(nextItems.length).toBeGreaterThan(0)
  expect(library.providerRequests.length).toBeGreaterThan(0)
  const previousIds = new Set(first.rows.flatMap((row) => row.items.map((item) => item.id)))
  expect(nextItems.some((item) => previousIds.has(item.id))).toBe(false)
})

test('a fresh single-root library can recommend files directly in its root', async ({
  request,
  library,
}) => {
  const items = library.seed(150, '')
  const response = await request.get(`${library.url}/api/media-ai/home`)
  expect(response.ok()).toBe(true)
  const result = (await response.json()) as Home
  const picks = result.rows.flatMap((row) => row.items)
  expect(picks.length).toBeGreaterThan(0)
  const paths = new Set(items.map((item) => item.path))
  expect(picks.every((pick) => paths.has(pick.path))).toBe(true)
})
