import { test, expect, type Page } from '@playwright/test'
const picks = [
  {
    id: 1,
    path: 'Music/track.mp3',
    name: 'First track',
    type: 'audio',
    reason: 'From your music collection',
  },
  {
    id: 2,
    path: 'MediaContent/track.mp3',
    name: 'Second track',
    type: 'audio',
    reason: 'Something to listen to',
  },
]
async function enable(page: Page) {
  await page.route('**/api/media-ai/status', (route) =>
    route.fulfill({
      json: { enabled: true, total: 20000, analyzed: 84, job: { phase: 'paused' } },
    }),
  )
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        generatedAt: Date.now(),
        rows: [{ title: 'Try something different', items: picks }],
      },
    }),
  )
}
test('configured home plays music and library navigation still works', async ({ page }) => {
  await enable(page)
  await page.goto('/')
  await expect(page.getByTestId('for-you')).toBeVisible()
  await page.getByRole('button', { name: 'Play First track', exact: true }).click()
  await expect(page).toHaveURL(/playing=Music%2Ftrack.mp3/)
  await expect(page.locator('audio')).toBeAttached()
  await page.goto('/?dir=Images')
  await expect(page.getByTestId('for-you')).toHaveCount(0)
  await expect(page.locator('table').getByText('photo.jpg')).toBeVisible()
})
test('AI query follow-ups and feedback preserve the selection', async ({ page }) => {
  await enable(page)
  const queries: unknown[] = []
  await page.route('**/api/media-ai/ask', (route) => {
    queries.push(route.request().postDataJSON())
    return route.fulfill({
      json: { items: picks, message: 'Here is music from your library.', intent: 'show' },
    })
  })
  await page.route('**/api/media-ai/feedback', (route) => route.fulfill({ json: { ok: true } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Search library', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search your library' }).fill('Show music')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play First track', exact: true })).toHaveCount(1)
  await expect(page.getByText('Here is music from your library.')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Search your library' }).fill('Something different')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect.poll(() => queries.length).toBe(2)
  expect(queries[1]).toMatchObject({ query: 'Something different', history: ['Show music'] })
  await page.getByRole('button', { name: 'Like First track', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Like First track', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Dislike First track', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play First track', exact: true })).toHaveCount(0)
})
test('configuration controls are absent from the media center', async ({ page }) => {
  await enable(page)
  await page.goto('/')
  await expect(page.getByTestId('for-you')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Media AI settings' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask AI|Refresh picks/ })).toHaveCount(0)
  await expect(page.locator('summary')).toHaveCount(0)
})

test('recommendation audio queue survives reload and gallery browsing', async ({ page }) => {
  await enable(page)
  const audio = [
    { id: 10, path: 'Music/track.mp3', name: 'First track', type: 'audio' },
    { id: 11, path: 'MediaContent/track.mp3', name: 'Second track', type: 'audio' },
  ]
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        generatedAt: Date.now(),
        rows: [{ title: 'For you', items: audio }],
      },
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Play First track', exact: true }).click()
  await expect(page.locator('audio')).toBeAttached()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.locator('table').getByText('Images', { exact: true }).click()
  await page.locator('table').getByText('photo.jpg', { exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Next track' }).click()
  await expect(page).toHaveURL(/playing=MediaContent%2Ftrack.mp3/)
  await page.reload()
  await expect(page.locator('audio')).toBeAttached()
  await expect(page.getByTestId('audio-player-chrome')).toContainText('Second track')
})

test('feed appends pages without duplicates and excludes image recommendations', async ({
  page,
}) => {
  await enable(page)
  const cursors: number[] = []
  await page.route('**/api/media-ai/home*', (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor'))
    cursors.push(cursor)
    return route.fulfill({
      json: {
        generatedAt: 1,
        nextCursor: cursor === 0 ? 1 : null,
        rows: [
          {
            title: 'For you',
            items:
              cursor === 0
                ? [
                    picks[0],
                    { id: 3, path: 'Images/photo.jpg', name: 'Excluded image', type: 'image' },
                  ]
                : [picks[0], picks[1]],
          },
        ],
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play Second track', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play First track', exact: true })).toHaveCount(1)
  await expect(page.getByText('Excluded image')).toHaveCount(0)
  expect(cursors).toContain(1)
})

test('collection cards open their folder and use three icon menu actions', async ({ page }) => {
  await enable(page)
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({
      json: {
        generatedAt: 1,
        rows: [
          {
            title: 'For you',
            items: [
              {
                id: -1,
                path: 'Music',
                name: 'Music',
                type: 'folder',
                isDirectory: true,
                itemCount: 2,
                previewPath: 'Music/track.mp3',
                members: picks,
              },
            ],
          },
        ],
      },
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: 'Options for Music', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('button')).toHaveCount(3)
  await expect(menu.locator('svg')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Open Music', exact: true }).click()
  await expect(page).toHaveURL(/dir=Music/)
  await expect(page.locator('table').getByText('track.mp3', { exact: true })).toBeVisible()
  await page.goto('/')
  await page.getByRole('button', { name: 'Options for Music', exact: true }).click()
  await page.getByRole('button', { name: 'Play collection', exact: true }).click()
  await expect(page).toHaveURL(/dir=Music/)
  await expect(page).toHaveURL(/playing=Music%2Ftrack.mp3/)
  await expect(page.locator('audio')).toBeAttached()
})

test('navigation and search icon share one toolbar at desktop and mobile widths', async ({
  page,
}) => {
  await enable(page)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Media center' })
  const input = page.getByRole('button', { name: 'Search library', exact: true })
  await expect(input).toBeVisible()
  for (const width of [1920, 390]) {
    await page.setViewportSize({ width, height: 1080 })
    const a = await nav.boundingBox()
    const b = await input.boundingBox()
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(Math.abs(a!.y + a!.height / 2 - b!.y - b!.height / 2)).toBeLessThan(4)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
})

test('mobile touch targets, menu dismissal and playback fit the viewport', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  await enable(page)
  await page.route('**/api/media-ai/feedback', (route) => route.fulfill({ json: { ok: true } }))
  await page.goto('/')
  const like = page.getByRole('button', { name: 'Like First track', exact: true })
  await expect(like).toBeVisible()
  await page.getByRole('button', { name: 'Search library', exact: true }).tap()
  for (const control of [
    like,
    page.getByRole('button', { name: 'Dislike First track', exact: true }),
    page.getByRole('button', { name: 'Options for First track', exact: true }),
    page.getByRole('button', { name: 'For you', exact: true }),
    page.getByRole('button', { name: 'Library', exact: true }),
    page.getByRole('button', { name: 'Search', exact: true }),
  ]) {
    const box = await control.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await like.tap()
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Options for First track', exact: true }).tap()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  await page.getByRole('textbox', { name: 'Search your library' }).tap()
  await expect(menu).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 500 })
  await expect(page.getByRole('textbox', { name: 'Search your library' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Play First track', exact: true }).tap()
  await expect(page.getByTestId('audio-player-chrome')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await context.close()
})

test('recommendation errors use plain copy and recover on retry', async ({ page }) => {
  await enable(page)
  let unavailable = true
  await page.route('**/api/media-ai/home*', (route) =>
    unavailable
      ? route.fulfill({
          status: 500,
          json: { error: 'AI selected an item outside its candidates' },
        })
      : route.fulfill({ json: { generatedAt: 1, rows: [{ title: 'For you', items: picks }] } }),
  )
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Recommendations are unavailable right now.')
  await expect(page.getByText('AI selected an item outside its candidates')).toHaveCount(0)
  unavailable = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play First track', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('failed next page keeps existing cards and retries only the missing page', async ({
  page,
}) => {
  await enable(page)
  let unavailable = true
  const cursors: number[] = []
  await page.route('**/api/media-ai/home*', (route) => {
    const cursor = Number(new URL(route.request().url()).searchParams.get('cursor'))
    cursors.push(cursor)
    if (cursor > 0 && unavailable) {
      return route.fulfill({
        status: 500,
        json: { error: 'AI approved an unknown recommendation' },
      })
    }
    return route.fulfill({
      json: {
        generatedAt: 1,
        nextCursor: cursor === 0 ? 1 : null,
        rows: [{ title: 'For you', items: [picks[cursor === 0 ? 0 : 1]] }],
      },
    })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Couldn’t load more right now.')
  await expect(page.getByRole('button', { name: 'Play First track', exact: true })).toBeVisible()
  await expect(page.getByText('AI approved an unknown recommendation')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More to play', exact: true })).toHaveCount(0)
  const firstPageRequests = cursors.filter((cursor) => cursor === 0).length
  unavailable = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Play Second track', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play First track', exact: true })).toHaveCount(1)
  expect(cursors.filter((cursor) => cursor === 0)).toHaveLength(firstPageRequests)
})

test('shared tabs stay centered and search opens from an icon in both views', async ({ page }) => {
  await enable(page)
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    for (const view of ['Library', 'For you']) {
      await page.getByRole('button', { name: view, exact: true }).click()
      const nav = await page.getByRole('navigation', { name: 'Media center' }).boundingBox()
      const header = await page.getByTestId('media-navigation-header').boundingBox()
      expect(nav!.x + nav!.width / 2).toBeCloseTo(width / 2, 0)
      expect(nav!.y + nav!.height / 2).toBe(header!.y + header!.height / 2)
      expect(header!.height).toBe(56)
      await expect(page.getByRole('textbox', { name: 'Search your library' })).toHaveCount(0)
      const search = page.getByRole('button', { name: 'Search library', exact: true })
      const icon = await search.boundingBox()
      expect(icon!.x).toBeGreaterThan(nav!.x + nav!.width)
      const url = page.url()
      await search.click()
      if (view === 'Library') {
        const modal = page.getByTestId('file-search-palette')
        await expect(modal).toBeVisible()
        await expect(modal.getByRole('combobox')).toBeFocused()
        await expect(page.getByTestId('for-you')).toHaveCount(0)
        expect(page.url()).toBe(url)
        await page.keyboard.press('Escape')
        await expect(modal).toHaveCount(0)
        await expect(search).toBeFocused()
      } else {
        await expect(page.getByRole('textbox', { name: 'Search your library' })).toBeFocused()
        await search.click()
        await expect(page.getByRole('textbox', { name: 'Search your library' })).toHaveCount(0)
      }
      const beforeScroll = await page
        .getByRole('navigation', { name: 'Media center' })
        .boundingBox()
      await page.evaluate(() => {
        document.body.style.minHeight = '2000px'
      })
      expect(await page.getByRole('navigation', { name: 'Media center' }).boundingBox()).toEqual(
        beforeScroll,
      )
      await page.evaluate(() => {
        document.body.style.minHeight = ''
      })
    }
  }
})

test('audio waveforms and collection previews remain images', async ({ page }) => {
  await enable(page)
  await page.route('**/api/media-ai/home*', (route) =>
    route.fulfill({
      json: {
        generatedAt: 1,
        rows: [
          {
            title: 'For you',
            items: [
              { ...picks[0], previewKind: 'waveform' },
              { ...picks[1], previewKind: 'cover' },
              {
                id: -1,
                name: 'Collection',
                path: 'Music',
                type: 'folder',
                previewKind: 'collection',
                itemCount: 2,
                previewPath: picks[0].path,
              },
            ],
          },
        ],
      },
    }),
  )
  await page.goto('/')
  await expect(page.getByTestId('text-media-cover')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Play First track', exact: true }).locator('img'),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Play Second track', exact: true }).locator('img'),
  ).toBeVisible()
})

test('Library header search selects results through the existing modal', async ({ page }) => {
  await enable(page)
  await page.route('**/api/files/search?*', (route) =>
    route.fulfill({
      json: {
        results: [
          {
            name: 'Videos',
            path: 'Videos',
            parentPath: '',
            rootId: 'media',
            rootName: 'Library',
            isDirectory: true,
            extension: '',
            type: 'folder',
          },
        ],
        truncated: false,
      },
    }),
  )
  await page.goto('/?view=library')
  await page
    .getByTestId('media-navigation-header')
    .getByRole('button', { name: 'Search library', exact: true })
    .click()
  const modal = page.getByTestId('file-search-palette')
  await modal.getByRole('combobox').fill('Videos')
  await modal.getByRole('option').filter({ hasText: 'Videos' }).first().click()
  await expect(page).toHaveURL(/dir=Videos/)
  await expect(modal).toHaveCount(0)
  await expect(page.locator('table').getByText('sample.mp4', { exact: true })).toBeVisible()
  await expect(page.getByTestId('for-you')).toHaveCount(0)
})
