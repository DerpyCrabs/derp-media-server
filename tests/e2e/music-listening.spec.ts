import { expect } from '@playwright/test'
import type { MusicHomeData } from '../../src/features/music/types'
import { test as base } from './media-ai-regression-helpers'
const test = base.extend({ baseURL: async ({ library }, use) => use(library.url) })
test.use({ aiPaused: false })
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const folder = 'MediaContent/ListeningTest'
let local = ''
const paths = Array.from({ length: 6 }, (_, i) => `${folder}/${i + 1}.mp3`)
const created: string[] = []

test.beforeEach(async ({ request, library }) => {
  local = path.join(library.mediaDirectory, folder)
  created.length = 0
  test.setTimeout(90000)
  fs.mkdirSync(local, { recursive: true })
  for (let i = 1; i <= 6; i++) {
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=mono',
        '-t',
        '60',
        '-c:a',
        'libmp3lame',
        '-metadata',
        `title=Listening ${i}`,
        '-metadata',
        `artist=Listener ${i % 3}`,
        '-metadata',
        'album=Listening Sessions',
        '-metadata',
        'album_artist=Test Ensemble',
        '-metadata',
        `track=${i}`,
        '-metadata',
        `genre=${i <= 4 ? 'Jazz' : 'Metal'}`,
        path.join(local, `${i}.mp3`),
      ],
      { stdio: 'pipe' },
    )
  }
  const fixtures = path.resolve(
    process.env.BATCH_ID ? `test-media-${process.env.BATCH_ID}` : 'test-media',
  )
  fs.copyFileSync(path.join(fixtures, 'Music/cover.jpg'), path.join(local, 'cover.jpg'))
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    path.join(local, '1.mp3'),
    '-i',
    path.join(local, 'cover.jpg'),
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c',
    'copy',
    '-id3v2_version',
    '3',
    '-disposition:v',
    'attached_pic',
    path.join(local, 'embedded.mp3'),
  ])
  fs.renameSync(path.join(local, 'embedded.mp3'), path.join(local, '1.mp3'))
  fs.mkdirSync(path.join(library.mediaDirectory, 'MediaContent/Elsewhere'), { recursive: true })
  fs.copyFileSync(
    path.join(local, '6.mp3'),
    path.join(library.mediaDirectory, 'MediaContent/Elsewhere/other.mp3'),
  )
  await request.post('/api/files/search/reindex', { data: { mode: 'reconcile' } })
  await expect
    .poll(
      async () => {
        const found = await request
          .get('/api/files/search?q=ListeningTest&limit=100')
          .then((r) => r.json())
        return found.results?.some((f: { path: string }) => f.path === paths[5])
      },
      { timeout: 60000 },
    )
    .toBe(true)
  await request.post('/api/music/refresh')
  await expect
    .poll(
      async () =>
        (await request.get('/api/music/tracks?q=ListeningTest').then((r) => r.json())).total,
      { timeout: 20000 },
    )
    .toBe(6)
  await expect
    .poll(
      async () => {
        const home: MusicHomeData = await request.get('/api/music/home').then((r) => r.json())
        return ['jazz', 'metal'].every((genre) =>
          home.radio.stations.some((station) => station.genre === genre && station.items.length),
        )
      },
      { timeout: 30000 },
    )
    .toBe(true)
})

test.afterEach(async ({ request }) => {
  for (const id of created) await request.delete(`/api/music/playlists/${id}`)
  for (const track of paths)
    await request.post('/api/media-ai/feedback', { data: { path: track, kind: 'clear' } })
  fs.rmSync(local, { recursive: true, force: true })
})

test('cached mixes show artist examples and preserve their exact queue through browsing and reload', async ({
  page,
  request,
}) => {
  const home: MusicHomeData = await request.get('/api/music/home').then((r) => r.json())
  const mix = home.mixes.find((item) => item.genre === 'jazz')!
  let radioRequests = 0
  await page.route('**/api/music/radio', (route) => {
    radioRequests++
    return route.abort()
  })
  await page.goto('/?view=for-you')
  const mixes = page.getByRole('region', { name: 'Genre mixes', exact: true })
  const play = mixes.getByRole('button', { name: 'Play jazz mix', exact: true })
  const artists = [...new Set(mix.items.map((track) => track.artist))].slice(0, 3).join(', ')
  await expect(play.getByText(artists, { exact: true })).toBeVisible()
  await expect(mixes.getByRole('button', { name: /View tracks/ })).toHaveCount(0)
  await play.click()
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await page.locator('table').getByText('MediaContent', { exact: true }).click()
  await page.locator('table').getByText('Elsewhere', { exact: true }).click()
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  const queue = page.getByRole('dialog', { name: 'Up next' })
  await expect(queue.getByRole('listitem')).toHaveCount(mix.items.length)
  for (let i = 0; i < mix.items.length; i++)
    await expect(queue.getByRole('listitem').nth(i)).toContainText(mix.items[i]!.title)
  await page.reload()
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await expect(queue.getByRole('listitem')).toHaveCount(mix.items.length)
  await expect(queue).toContainText('jazz mix')
  expect(radioRequests).toBe(0)
})

test('folder Next and Previous keep all tracks when browsing a different folder', async ({
  page,
}) => {
  await page.goto(`/?dir=${encodeURIComponent(folder)}`)
  await page.locator('table').getByText('1.mp3', { exact: true }).click()
  const player = page.getByTestId('audio-player-chrome')
  await expect(player.getByRole('button', { name: 'Next track', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  const queue = page.getByRole('dialog', { name: 'Up next' })
  await expect(queue.getByRole('listitem')).toHaveCount(6)
  await queue.getByRole('button', { name: 'Close queue' }).click()
  await page.locator('table').getByText('..', { exact: true }).click()
  await page.locator('table').getByText('Elsewhere', { exact: true }).click()
  await player.getByRole('button', { name: 'Next track', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('playing')).toBe(paths[1])
  await player.getByRole('button', { name: 'Previous track', exact: true }).click()
  await expect.poll(() => new URL(page.url()).searchParams.get('playing')).toBe(paths[0])
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await expect(queue.getByRole('listitem')).toHaveCount(6)
  await queue.getByRole('button', { name: 'Remove 1.mp3 from queue', exact: true }).click()
  await expect(queue.getByRole('listitem')).toHaveCount(5)
  await expect(queue.getByRole('listitem').first()).toContainText('2.mp3')
})

test('smart playlists update from likes and genres and radio respects exclusions', async ({
  request,
}) => {
  await request.post('/api/media-ai/feedback', { data: { path: paths[0], kind: 'more' } })
  const response = await request.post('/api/music/playlists', {
    data: { name: 'Listening smart', rules: { genre: 'Jazz', liked: true, limit: 10 } },
  })
  expect(response.ok()).toBe(true)
  const { id } = (await response.json()) as { id: string }
  created.push(id)
  const getPaths = async () =>
    (await request.get(`/api/music/playlists/${id}`).then((r) => r.json())).items.map(
      (t: { path: string }) => t.path,
    )
  expect(await getPaths()).toEqual([paths[0]])
  await request.post('/api/media-ai/feedback', { data: { path: paths[1], kind: 'more' } })
  expect(await getPaths()).toContain(paths[1])
  await request.post('/api/media-ai/feedback', { data: { path: paths[2], kind: 'hide' } })
  const radio = await request
    .post('/api/music/radio', {
      data: {
        genre: 'Jazz',
        strictGenre: true,
        exclude: [paths[0]],
        recent: [paths[1]],
        session: 'test',
      },
    })
    .then((r) => r.json())
  expect(radio.items.length).toBeGreaterThan(0)
  expect(
    radio.items.every(
      (t: { genre: string[]; path: string }) =>
        t.genre.includes('jazz') && !paths.slice(0, 3).includes(t.path),
    ),
  ).toBe(true)
  await request.post('/api/media-ai/feedback', { data: { path: paths[0], kind: 'later' } })
  const snoozed = await request.get('/api/music/tracks?q=ListeningTest').then((r) => r.json())
  expect(snoozed.items.find((t: { path: string }) => t.path === paths[0]).liked).toBe(true)
  expect(await getPaths()).not.toContain(paths[0])
  const afterSnooze = await request
    .post('/api/music/radio', { data: { genre: 'Jazz', strictGenre: true, session: 'snooze' } })
    .then((r) => r.json())
  expect(afterSnooze.items.some((t: { path: string }) => t.path === paths[0])).toBe(false)
  for (const track of paths.slice(0, 3))
    await request.post('/api/media-ai/feedback', { data: { path: track, kind: 'clear' } })
})

test('radio refills and manual music plays before automatic suggestions', async ({ page }) => {
  let calls = 0
  await page.route('**/api/music/radio', (route) => {
    calls++
    return route.abort()
  })
  await page.route('**/api/music/tracks*', (route) => {
    calls++
    return route.abort()
  })
  await page.goto(`/?view=for-you&playing=${encodeURIComponent(paths[5]!)}`)
  const audio = page.locator('audio[data-playback-audio-host]')
  const play = page
    .getByTestId('audio-player-chrome')
    .getByRole('button', { name: 'Play', exact: true })
  if (await play.isVisible()) await play.click()
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  const queue = page.getByRole('dialog', { name: 'Up next' })
  await queue.getByRole('button', { name: 'Continue with radio' }).click()
  await expect(queue).toContainText('Radio is on')
  await expect.poll(() => queue.getByRole('listitem').count()).toBeGreaterThan(1)
  expect(calls).toBe(0)
  await queue.getByRole('button', { name: 'Close queue' }).click()
  await page
    .getByRole('button', { name: 'Music options for Listening 2', exact: true })
    .first()
    .click()
  await page.getByRole('menu').getByRole('button', { name: 'Add to queue', exact: true }).click()
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await expect(queue.getByRole('listitem').nth(1)).toContainText('Listening 2')
  await expect(queue.getByRole('checkbox')).toHaveCount(0)
  await expect(queue.getByRole('slider', { name: 'Radio discovery' })).toHaveCount(0)
  await page
    .locator('audio[data-playback-audio-host]')
    .evaluate((audio: HTMLAudioElement) => audio.pause())
  await page.reload()
  const callsAfterReload = calls
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await expect(queue).toContainText('Radio is on')
  await page.waitForTimeout(1500)
  expect(calls).toBe(callsAfterReload)
  expect(
    await page
      .locator('audio[data-playback-audio-host]')
      .evaluate((audio: HTMLAudioElement) => audio.paused),
  ).toBe(true)
})

test('queue rows and missing artwork stay stable while radio continues without restarting playback', async ({
  page,
  request,
}) => {
  const missing = await request.get(
    `/api/music/artwork/${encodeURIComponent('MediaContent/Elsewhere/other.mp3')}`,
  )
  expect(missing.status()).toBe(204)
  const artwork = new Map<string, number>()
  await page.route('**/api/music/artwork/**', (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname)
    artwork.set(pathname, (artwork.get(pathname) || 0) + 1)
    if (pathname.endsWith('/4.mp3') || pathname.endsWith('/5.mp3'))
      return route.fulfill({ status: 204, headers: { 'Cache-Control': 'no-store' } })
    return route.continue()
  })
  let calls = 0
  await page.route('**/api/music/radio', (route) => {
    calls++
    return route.abort()
  })
  await page.goto(`/?dir=${encodeURIComponent(folder)}&playing=${encodeURIComponent(paths[0]!)}`)
  const audio = page.locator('audio[data-playback-audio-host]')
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.readyState))
    .toBeGreaterThanOrEqual(2)
  await audio.evaluate((el: HTMLAudioElement) => {
    el.pause()
    el.currentTime = 8
  })
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.seeking)).toBe(false)
  await page
    .getByTestId('audio-player-chrome')
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.paused)).toBe(false)
  const source = await audio.evaluate((el: HTMLAudioElement) => el.currentSrc)
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  const queue = page.getByRole('dialog', { name: 'Up next' })
  await expect(queue.getByRole('listitem')).toHaveCount(6)
  await expect.poll(() => artwork.size).toBe(6)
  await queue
    .getByRole('listitem')
    .evaluateAll((rows) => rows.forEach((row) => row.setAttribute('data-continuity', 'kept')))
  await queue.getByRole('button', { name: 'Continue with radio', exact: true }).click()
  await expect(queue.getByText('Radio is on', { exact: true })).toBeVisible({ timeout: 1000 })
  await expect(queue.getByRole('checkbox')).toHaveCount(0)
  await expect(queue.getByRole('slider')).toHaveCount(0)
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(9.5)
  expect(await audio.evaluate((el: HTMLAudioElement) => el.currentSrc)).toBe(source)
  expect(calls).toBe(0)
  await expect(queue.locator('[data-continuity="kept"]')).toHaveCount(6)
  expect([...artwork.values()]).toEqual([1, 1, 1, 1, 1, 1])
  await queue.getByRole('button', { name: 'Close queue' }).click()
  await page.getByRole('button', { name: 'Up next', exact: true }).click()
  await expect(queue.getByRole('listitem')).toHaveCount(6)
  for (const [pathname, count] of artwork) if (/\/[45]\.mp3$/.test(pathname)) expect(count).toBe(1)
  await queue.getByRole('button', { name: 'Play queued 6.mp3', exact: true }).click()
  expect(calls).toBe(0)
  await expect(queue).not.toContainText('Finding the next tracks')
  await queue.getByRole('button', { name: 'Stop radio', exact: true }).click()
  await expect(
    queue.getByRole('button', { name: 'Continue with radio', exact: true }),
  ).toBeVisible()
  expect(new URL(page.url()).searchParams.get('playing')).toBe(paths[5])
})

test('starting and exhausting prepared radio makes no recommendation requests', async ({
  page,
  library,
}) => {
  let requests = 0
  await page.route('**/api/music/radio', (route) => {
    requests++
    return route.abort()
  })
  await page.route('**/api/music/home*', (route) => {
    requests++
    return route.abort()
  })
  await page.route('**/api/music/tracks*', (route) => {
    requests++
    return route.abort()
  })
  const release = library.pauseProvider()
  try {
    await page.goto('/?view=for-you')
    const initial = await page.evaluate(
      () =>
        window.__DEHYDRATED_STATE__?.queries.find((query) => query.queryKey[0] === 'music')?.state
          .data as MusicHomeData,
    )
    expect(initial.radio.stations.length).toBeGreaterThan(0)
    await page
      .getByRole('button', { name: 'Music options for Listening 1', exact: true })
      .first()
      .click()
    await page.getByRole('menu').getByRole('button', { name: 'Start radio', exact: true }).click()
    await expect
      .poll(() => new URL(page.url()).searchParams.get('playing'), { timeout: 1000 })
      .toBe(paths[0])
    await expect(page.getByText('Preparing radio…', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Up next', exact: true }).click()
    const queue = page.getByRole('dialog', { name: 'Up next' })
    await expect(queue).toContainText('Radio is on')
    await expect.poll(() => queue.getByRole('listitem').count()).toBeGreaterThan(1)
    const sourceTracks = initial.radio.tracks.map((track) => track.path)
    const audio = page.locator('audio[data-playback-audio-host]')
    for (let i = 0; i < sourceTracks.length + 1; i++) {
      await audio.evaluate((el: HTMLAudioElement) => el.dispatchEvent(new Event('ended')))
      await page.waitForTimeout(80)
    }
    await expect(queue.getByRole('status')).toHaveText('No more prepared songs for this station.')
    expect(requests).toBe(0)
  } finally {
    release()
  }
})

test('cached radio and cache misses return without waiting for the provider', async ({
  request,
  library,
}) => {
  const release = library.pauseProvider()
  try {
    const body = { genre: 'jazz', strictGenre: true }
    const first = await request.post('/api/music/radio', {
      data: { ...body, session: 'first' },
      timeout: 1000,
    })
    expect(first.ok()).toBe(true)
    const items = (await first.json()).items
    expect(items.length).toBeGreaterThan(0)
    const second = await request.post('/api/music/radio', {
      data: { ...body, session: 'second' },
      timeout: 1000,
    })
    expect((await second.json()).items).toEqual(items)
    const missing = await request.post('/api/music/radio', {
      data: { genre: 'Unprepared genre' },
      timeout: 1000,
    })
    expect(missing.ok()).toBe(true)
    expect((await missing.json()).items).toEqual([])
  } finally {
    release()
  }
})

test('AI classification excludes tagged sample assets and cleans genres before home or radio', async ({
  request,
  library,
}) => {
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      '0.2',
      '-c:a',
      'libmp3lame',
      '-metadata',
      'title=Snare',
      '-metadata',
      'artist=Sample Maker',
      '-metadata',
      'album=Studio Pack',
      '-metadata',
      'genre=Piano Key Sound',
      path.join(local, 'sample.mp3'),
    ],
    { stdio: 'pipe' },
  )
  await request.post('/api/files/search/reindex', { data: { mode: 'reconcile' } })
  await request.post('/api/music/refresh')
  await expect
    .poll(
      () =>
        library.database
          .prepare(
            "SELECT count(*) AS n FROM music_reviews WHERE path LIKE '%/sample.mp3' AND json_extract(decision,'$.kind')='effect'",
          )
          .get()?.n,
      { timeout: 30000 },
    )
    .toBe(1)
  const home = await request.get('/api/music/home').then((r) => r.json())
  expect(home.genres).toEqual(['jazz', 'metal'])
  expect(JSON.stringify(home)).not.toContain('sample.mp3')
  expect(JSON.stringify(home)).not.toContain('Studio Pack')
  const radio = await request
    .post('/api/music/radio', { data: { genre: 'Jazz' } })
    .then((r) => r.json())
  expect(radio.items.length).toBeGreaterThan(0)
  expect(JSON.stringify(radio)).not.toContain('sample.mp3')
  expect(
    library.providerRequests.some(
      (request) => request.response_format.json_schema.schema.properties?.musicReviews,
    ),
  ).toBe(true)
  expect(
    library.providerRequests.some(
      (request) => request.response_format.json_schema.schema.properties?.radioStations,
    ),
  ).toBe(true)
})

test('music is hydrated without genre filters and cached results stay stable on mobile', async ({
  page,
  library,
}, testInfo) => {
  library.database.exec(
    "UPDATE music_tracks SET metadata=json_remove(metadata,'$.hasArtwork'); UPDATE music_reviews SET metadata=(SELECT metadata FROM music_tracks WHERE music_tracks.path=music_reviews.path)",
  )
  let homeRequests = 0
  await page.route('**/api/music/home*', (route) => {
    homeRequests++
    return route.abort()
  })
  await page.clock.install()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?view=for-you')
  const music = page.getByTestId('music-home')
  await expect(music).toBeVisible()
  const initial = await page.evaluate(
    () =>
      window.__DEHYDRATED_STATE__?.queries.find(
        (query) => query.queryKey[0] === 'music' && query.queryKey[1] === 'home',
      )?.state.data as MusicHomeData,
  )
  expect(initial.rows.length).toBeGreaterThan(0)
  await page
    .getByRole('group', { name: 'For you categories' })
    .getByRole('button', { name: 'Music', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Refresh recommendations', exact: true }),
  ).toHaveCount(1)
  await expect(page.locator('select')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: /New playlist|Music settings|Refresh music/ }),
  ).toHaveCount(0)
  await expect(music.getByRole('group', { name: 'Music genres' })).toHaveCount(0)
  await expect(
    music.getByRole('button', { name: /All genres|More genres|View tracks/ }),
  ).toHaveCount(0)
  await expect(music.getByRole('button', { name: 'Play jazz mix', exact: true })).toBeVisible()
  await expect(
    music.getByRole('button', { name: 'Play music Listening 1', exact: true }).first(),
  ).toBeVisible()
  const imgs = music.locator('img')
  await expect
    .poll(() =>
      imgs.evaluateAll(
        (elements) => elements.filter((el) => (el as HTMLImageElement).naturalWidth > 0).length,
      ),
    )
    .toBeGreaterThan(0)
  const before = await music.innerText()
  await page.clock.fastForward(35000)
  expect(await music.innerText()).toBe(before)
  expect(homeRequests).toBe(0)
  await music
    .getByRole('button', { name: 'Music options for Listening 1', exact: true })
    .first()
    .click()
  const menu = page.getByRole('menu')
  await expect(
    menu.getByRole('button', { name: /Edit music info|Not now|Save playlist/ }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: testInfo.outputPath('music-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.screenshot({ path: testInfo.outputPath('music-desktop.png'), fullPage: true })
})
