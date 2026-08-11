import { expect, test, type Page } from '@playwright/test'

const RECENT_LOCATIONS_KEY = 'derp-desk-recent-owner-locations-v1'
const PLAYBACK_TIMES_KEY = 'video-playback-times'
const UNPROTECTED_SHARE_TOKEN = 'test-unprotected-share-token1'

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0)
}

async function openMoreDestination(page: Page, label: string) {
  const phoneNav = page.getByTestId('owner-phone-nav')
  await phoneNav.getByRole('button', { name: 'More', exact: true }).click()
  const menu = page.getByTestId('owner-more-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('link', { name: label, exact: true }).click()
}

test.describe('Stage 1 owner shell', () => {
  test('desktop rail reaches every current major owner surface', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/library')

    const rail = page.getByTestId('owner-desktop-rail')
    await expect(rail).toBeVisible()

    await rail.getByRole('link', { name: 'Home', exact: true }).click()
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByTestId('home-page')).toBeVisible()

    await rail.getByRole('link', { name: 'Library', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByTestId('file-browser')).toBeVisible()

    await rail.getByRole('link', { name: 'Spaces', exact: true }).click()
    await expect(page).toHaveURL(/\/spaces$/)
    await expect(page.getByTestId('spaces-page')).toBeVisible()

    await rail.getByRole('link', { name: 'Workspace', exact: true }).click()
    await expect(page).toHaveURL(/\/workspace$/)
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect(rail).toBeHidden()
    await page.goBack()
    await expect(rail).toBeVisible()

    await rail.getByRole('link', { name: 'Canvas', exact: true }).click()
    await expect(page).toHaveURL(/\/canvas$/)
    await expect(page.getByTestId('infinite-canvas')).toBeVisible()
    await expect(rail).toBeHidden()
    await page.goBack()
    await expect(rail).toBeVisible()

    await rail.getByRole('link', { name: 'Assistant', exact: true }).click()
    await expect(page).toHaveURL(/\/workspace\?[^#]*dir=Hermes(?:\+|%20)Sessions/)
    expect(new URL(page.url()).searchParams.get('dir')).toBe('Hermes Sessions')
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await page.goBack()
    await expect(rail).toBeVisible()

    await rail.getByRole('link', { name: 'Shared', exact: true }).click()
    await expect(page).toHaveURL(/\/\?dir=Shares$/)
    await expect(page.getByTestId('file-browser')).toBeVisible()

    await rail.getByRole('link', { name: 'Offline', exact: true }).click()
    await expect(page).toHaveURL(/\/offline$/)
    await expect(page.getByTestId('file-browser')).toBeVisible()

    await rail.getByRole('link', { name: 'Settings', exact: true }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('settings-page')).toBeVisible()
  })

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    test(`phone ${viewport.width}x${viewport.height} keeps four usable targets above player`, async ({
      page,
    }) => {
      test.setTimeout(45_000)
      await page.setViewportSize(viewport)
      await page.goto('/library')

      const phoneNav = page.getByTestId('owner-phone-nav')
      await expect(phoneNav).toBeVisible()
      const targets = phoneNav.locator(':scope > *')
      await expect(targets).toHaveCount(4)
      await expect(phoneNav.getByRole('link', { name: 'Library', exact: true })).toBeVisible()
      await expect(phoneNav.getByRole('link', { name: 'Spaces', exact: true })).toBeVisible()
      await expect(phoneNav.getByRole('button', { name: 'Search', exact: true })).toBeVisible()
      await expect(phoneNav.getByRole('button', { name: 'More', exact: true })).toBeVisible()

      for (let index = 0; index < 4; index += 1) {
        const target = targets.nth(index)
        await expect(target).toBeVisible()
        const box = await target.boundingBox()
        expect(box, `phone navigation target ${index + 1} should have geometry`).not.toBeNull()
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.width).toBeGreaterThanOrEqual(44)
      }
      await expectNoHorizontalOverflow(page)

      await phoneNav.getByRole('button', { name: 'More', exact: true }).click()
      const moreMenu = page.getByTestId('owner-more-menu')
      await expect(moreMenu).toBeVisible()
      for (const label of ['Home', 'Shared', 'Offline', 'Settings']) {
        const destination = moreMenu.getByRole('link', { name: label, exact: true })
        await expect(destination).toBeVisible()
        const box = await destination.boundingBox()
        expect(box, `${label} should have touch geometry`).not.toBeNull()
        expect(box!.height).toBeGreaterThanOrEqual(44)
      }
      await phoneNav.getByRole('button', { name: 'More', exact: true }).click()

      await openMoreDestination(page, 'Home')
      await expect(page).toHaveURL(/\/home$/)
      await expect(page.getByTestId('home-page')).toBeVisible()

      await openMoreDestination(page, 'Shared')
      await expect(page).toHaveURL(/\/\?dir=Shares$/)

      await openMoreDestination(page, 'Offline')
      await expect(page).toHaveURL(/\/offline$/)

      await openMoreDestination(page, 'Settings')
      await expect(page).toHaveURL(/\/settings$/)
      await expect(page.getByTestId('settings-page')).toBeVisible()

      await phoneNav.getByRole('link', { name: 'Library', exact: true }).click()
      await expect(page).toHaveURL(/\/$/)
      await page.locator('table').getByText('Music', { exact: true }).click()
      await page.locator('table').getByText('track.mp3', { exact: true }).click()

      const player = page.getByTestId('audio-player-chrome')
      await expect(player).toBeVisible()
      const playerBox = await player.boundingBox()
      const navBox = await phoneNav.boundingBox()
      expect(playerBox).not.toBeNull()
      expect(navBox).not.toBeNull()
      expect(playerBox!.y + playerBox!.height).toBeLessThanOrEqual(navBox!.y + 1)
      await expectNoHorizontalOverflow(page)
    })
  }

  test('login, share, and not-found surfaces remain outside owner shell', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('[data-owner-shell]')).toHaveCount(0)
    await expect(page.locator('input[type="password"]')).toBeVisible()

    await page.goto(`/share/${UNPROTECTED_SHARE_TOKEN}`)
    await expect(page.locator('[data-owner-shell]')).toHaveCount(0)
    await expect(page.getByText('notes.md')).toBeVisible()

    await page.goto('/definitely-not-a-derp-desk-route')
    await expect(page.locator('[data-owner-shell]')).toHaveCount(0)
    await expect(page.getByTestId('not-found')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Library' })).toHaveAttribute('href', '/')
  })

  test('owner navigation disappears during video fullscreen', async ({ page }) => {
    await page.goto('/library?dir=Videos&playing=Videos%2Fsample.mp4')
    const video = page.locator('video').first()
    await expect(video).toBeVisible()
    await video.evaluate(async (element) => element.requestFullscreen())
    await expect(page.getByTestId('owner-desktop-rail')).toBeHidden()
    await expect(page.getByTestId('owner-phone-nav')).toBeHidden()
    await page.evaluate(async () => document.exitFullscreen())
    await expect(page.getByTestId('owner-desktop-rail')).toBeVisible()
  })

  test('phone navigation disappears during video fullscreen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/library?dir=Videos&playing=Videos%2Fsample.mp4')
    const phoneNav = page.getByTestId('owner-phone-nav')
    const video = page.locator('video').first()
    await expect(phoneNav).toBeVisible()
    await expect(video).toBeVisible()

    await video.evaluate(async (element) => element.requestFullscreen())
    await expect(phoneNav).toBeHidden()
    await page.evaluate(async () => document.exitFullscreen())
    await expect(phoneNav).toBeVisible()
  })

  test('new_shell rollback selects only legacy header and route behavior', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, '__DEHYDRATED_STATE__', {
        configurable: true,
        get: () => undefined,
        set: () => undefined,
      })
    })
    await page.route('**/api/auth/config', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          newShell: false,
          editableFolders: [],
          mediaRoots: [],
        }),
      }),
    )

    await page.goto('/home')
    await expect(page.locator('[data-owner-shell]')).toHaveCount(0)
    await expect(page.getByTestId('home-page')).toHaveCount(0)
    await expect(page.getByTestId('file-browser')).toBeVisible()

    await page.goto('/workspace')
    await expect(page.locator('[data-owner-shell]')).toHaveCount(0)
    await expect(page.locator('.workspace-layout')).toBeVisible()
    await expect(page.getByTestId('file-browser')).toHaveCount(0)
  })

  test('offline observer survives routes, scopes jobs, and loads manager on demand', async ({
    page,
  }) => {
    await page.goto('/library')
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('derp-offline-status', {
          detail: {
            state: 'running',
            scope: 'owner',
            name: 'route-job.pdf',
            path: 'Documents/route-job.pdf',
            downloadedBytes: 4,
            totalBytes: 10,
          },
        }),
      ),
    )
    await expect(page.getByText('Saving route-job.pdf…', { exact: true })).toBeVisible()
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /OfflineManager-/.test(entry.name)),
      ),
    ).toBe(false)

    await page.getByTestId('owner-desktop-rail').getByRole('link', { name: 'Home' }).click()
    await expect(page.getByTestId('home-page')).toBeVisible()
    await expect(page.getByText('Saving route-job.pdf…', { exact: true })).toBeVisible()
    await expect(page.getByText('route-job.pdf', { exact: true })).toBeVisible()

    await page.evaluate(
      (token) => window.history.pushState(null, '', `/share/${token}`),
      UNPROTECTED_SHARE_TOKEN,
    )
    await expect(page.getByText('notes.md')).toBeVisible()
    await expect(page.getByText('Saving route-job.pdf…', { exact: true })).toHaveCount(0)

    await page.goBack()
    await expect(page.getByTestId('home-page')).toBeVisible()
    await expect(page.getByText('Saving route-job.pdf…', { exact: true })).toBeVisible()
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent('derp-offline-status', {
          detail: {
            state: 'succeeded',
            scope: 'owner',
            name: 'route-job.pdf',
            path: 'Documents/route-job.pdf',
          },
        }),
      ),
    )
    const status = page.getByRole('button', { name: /route-job\.pdf is available offline/ })
    await expect(status).toBeVisible()
    await status.click()
    await expect(page.getByRole('dialog', { name: 'Offline manager' })).toBeVisible()
    const stacking = await page.evaluate(() => ({
      modal: Number(
        getComputedStyle(document.querySelector<HTMLElement>('[aria-label="Offline manager"]')!)
          .zIndex,
      ),
      navigation: Number(
        getComputedStyle(document.querySelector<HTMLElement>('[data-testid="owner-desktop-rail"]')!)
          .zIndex,
      ),
    }))
    expect(stacking.modal).toBeGreaterThan(stacking.navigation)
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .some((entry) => /OfflineManager-/.test(entry.name)),
        ),
      )
      .toBe(true)
  })

  test('public theme controls never request owner APIs', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL })
    const page = await context.newPage()
    const ownerRequests: string[] = []
    const isOwnerApi = (url: string) => {
      const pathname = new URL(url).pathname
      return pathname.startsWith('/api/') && !/^\/api\/share\/[^/]+(?:\/|$)/.test(pathname)
    }
    page.on('request', (request) => {
      if (isOwnerApi(request.url())) ownerRequests.push(request.url())
    })

    try {
      await page.goto('/login')
      await page.getByRole('button', { name: 'Open theme settings' }).click()
      const loginMenu = page.getByTestId('theme-settings-menu')
      await expect(loginMenu).toBeVisible()
      await expect(loginMenu.getByText('Media directories')).toHaveCount(0)
      await expect(loginMenu.getByText('Offline files')).toHaveCount(0)
      await loginMenu.getByRole('menuitem', { name: 'Dark', exact: true }).click()

      await page.goto(`/share/${UNPROTECTED_SHARE_TOKEN}`)
      await expect(page.getByText('notes.md')).toBeVisible()
      await page.getByRole('button', { name: 'Open theme settings' }).click()
      const shareMenu = page.getByTestId('theme-settings-menu')
      await expect(shareMenu).toBeVisible()
      await expect(shareMenu.getByText('Media directories')).toHaveCount(0)
      await expect(shareMenu.getByText('Offline files')).toHaveCount(0)
      await shareMenu.getByRole('menuitem', { name: 'Light', exact: true }).click()

      expect(ownerRequests).toEqual([])
    } finally {
      await context.close()
    }
  })
})

test.describe('Stage 1 Home projection', () => {
  test('quick actions and Most viewed generate canonical media-aware routes', async ({ page }) => {
    const viewedFiles = [
      ['Videos/sample.mp4', 9],
      ['Music/track.mp3', 8],
      ['Documents/readme.txt', 7],
    ] as const
    for (const [filePath, count] of viewedFiles) {
      for (let view = 0; view < count; view += 1) {
        const response = await page.request.post('/api/stats/views', { data: { filePath } })
        expect(response.ok()).toBe(true)
      }
    }

    await page.goto('/home')
    const quickActions = page.locator('section[aria-labelledby="home-quick-heading"]')
    await expect(quickActions.getByRole('link', { name: 'Library' })).toHaveAttribute('href', '/')
    await expect(quickActions.getByRole('link', { name: 'Spaces' })).toHaveAttribute(
      'href',
      '/spaces',
    )
    await expect(quickActions.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
      'href',
      '/workspace',
    )
    await expect(quickActions.getByRole('link', { name: 'Offline' })).toHaveAttribute(
      'href',
      '/offline',
    )

    const mostViewed = page.locator('section[aria-labelledby="home-popular-heading"]')
    const videoLink = mostViewed.getByRole('link').filter({ hasText: 'sample.mp4' })
    await expect(videoLink).toHaveAttribute('href', '/?playing=Videos%2Fsample.mp4')
    await expect(mostViewed.getByRole('link').filter({ hasText: 'track.mp3' })).toHaveAttribute(
      'href',
      '/?playing=Music%2Ftrack.mp3',
    )
    await expect(mostViewed.getByRole('link').filter({ hasText: 'readme.txt' })).toHaveAttribute(
      'href',
      '/?viewing=Documents%2Freadme.txt',
    )

    await videoLink.click()
    await expect(page).toHaveURL(/\?playing=Videos%2Fsample\.mp4$/)
    await expect(page.locator('video').first()).toBeVisible()
  })

  test('seeded Continue and recent locations survive reload and history navigation', async ({
    page,
  }) => {
    await page.addInitScript(
      ({ playbackKey, recentKey }) => {
        localStorage.setItem(
          playbackKey,
          JSON.stringify({
            state: { playbackTimes: { 'Videos/sample.mp4': 12.5 } },
            version: 0,
          }),
        )
        localStorage.setItem(
          recentKey,
          JSON.stringify([
            {
              kind: 'library',
              href: '/library?dir=Notes',
              label: 'Notes',
              visitedAt: 1_900_000_000_000,
            },
          ]),
        )
      },
      { playbackKey: PLAYBACK_TIMES_KEY, recentKey: RECENT_LOCATIONS_KEY },
    )

    await page.goto('/home')
    const continueSection = page.locator('section[aria-labelledby="home-continue-heading"]')
    await expect(page.getByRole('heading', { name: 'Continue', exact: true })).toBeVisible()
    await expect(continueSection.getByText('sample.mp4', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent locations' })).toBeVisible()
    const recentNotes = page.getByRole('link', { name: /Notes library/i })
    await expect(recentNotes).toBeVisible()

    await page.reload()
    await expect(continueSection.getByText('sample.mp4', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Notes library/i })).toBeVisible()

    await page.getByRole('link', { name: /Notes library/i }).click()
    await expect(page).toHaveURL(/\/library\?dir=Notes$/)
    await expect(page.locator('table').getByText('welcome.md')).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/\/home$/)
    await expect(continueSection.getByText('sample.mp4', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Notes library/i })).toBeVisible()

    await page.goForward()
    await expect(page).toHaveURL(/\/library\?dir=Notes$/)
    await page.goBack()
    await expect(continueSection.getByText('sample.mp4', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Notes library/i })).toBeVisible()
  })

  test('empty local projections stay hidden and root performs no Space query', async ({ page }) => {
    await page.addInitScript(
      ({ playbackKey, recentKey }) => {
        localStorage.removeItem(playbackKey)
        localStorage.removeItem(recentKey)
        indexedDB.deleteDatabase('derp-offline-v1')
      },
      { playbackKey: PLAYBACK_TIMES_KEY, recentKey: RECENT_LOCATIONS_KEY },
    )

    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Continue', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Recent locations' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Active offline work' })).toHaveCount(0)

    const spaceQueries: string[] = []
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname
      if (
        pathname.startsWith('/api/canvases') ||
        pathname.startsWith('/api/spaces') ||
        pathname.startsWith('/api/hermes/')
      ) {
        spaceQueries.push(request.url())
      }
    })
    await page.goto('/')
    await expect(page.getByTestId('file-browser')).toBeVisible()
    await expect(page.locator('table').getByText('Videos', { exact: true })).toBeVisible()
    expect(spaceQueries).toEqual([])
  })
})
