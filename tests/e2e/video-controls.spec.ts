import { dragPlaybackPosition } from './playback-seek-helpers'
import { test, expect, type Page } from '@playwright/test'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

let directory: string
let baseUrl: string
const servers: ChildProcess[] = []

async function startServer(playback: Record<string, unknown>): Promise<string> {
  const port = await new Promise<number>((resolve) => {
    const listener = net.createServer().listen(0, '127.0.0.1', () => {
      const port = (listener.address() as net.AddressInfo).port
      listener.close(() => resolve(port))
    })
  })
  const config = path.join(directory, `config-${port}.jsonc`)
  fs.writeFileSync(
    config,
    JSON.stringify({
      port,
      mediaDir: path.join(directory, 'media'),
      dataPath: path.join(directory, `data-${port}`),
      fileSearch: { enabled: false },
      playback,
    }),
  )
  const executable = path.resolve(
    process.env.TEST_SERVER_TARGET_DIR ?? 'target',
    'release',
    'derp-media-server',
  )
  const server = spawn(executable, process.env.E2E_DEV === '1' ? [] : ['--production'], {
    env: {
      ...process.env,
      CONFIG_PATH: config,
      PORT: String(port),
      NO_PROXY: 'localhost,127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  servers.push(server)
  let output = ''
  server.stdout!.on('data', (chunk) => {
    output += String(chunk)
  })
  server.stderr!.on('data', (chunk) => {
    output += String(chunk)
  })
  const url = `http://127.0.0.1:${port}`
  await expect
    .poll(
      async () => {
        if (server.exitCode !== null) throw new Error(output)
        return fetch(url)
          .then((response) => response.ok)
          .catch(() => false)
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return url
}

test.beforeAll(async () => {
  test.setTimeout(60_000)
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-video-controls-'))
  const media = path.join(directory, 'media')
  fs.mkdirSync(media)
  fs.writeFileSync(
    path.join(media, 'hdr.ffmetadata'),
    ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2000\ntitle=Opening\n',
  )
  fs.writeFileSync(
    path.join(media, 'sample.en.srt'),
    '1\n00:00:00,100 --> 00:00:55,000\nHello & welcome\n',
  )
  fs.writeFileSync(
    path.join(media, 'sample.ru.srt'),
    '1\n00:00:00,100 --> 00:00:55,000\nПривет, мир\n',
  )
  fs.writeFileSync(
    path.join(media, 'sample.ja.ass'),
    '[Script Info]\nScriptType: v4.00+\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.10,0:00:55.00,Default,,0,0,0,,{\\b1}こんにちは{\\b0}\n',
  )
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=20:duration=60',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=60',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=880:duration=60',
      '-i',
      path.join(media, 'sample.en.srt'),
      '-i',
      path.join(media, 'sample.ru.srt'),
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-map',
      '3:s',
      '-map',
      '4:s',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '40',
      '-c:a',
      'aac',
      '-c:s',
      'srt',
      '-metadata:s:a:0',
      'language=eng',
      '-metadata:s:a:1',
      'language=rus',
      '-metadata:s:s:0',
      'language=eng',
      '-metadata:s:s:1',
      'language=rus',
      '-t',
      '60',
      path.join(media, 'sample.mkv'),
    ],
    { timeout: 30_000 },
  )
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      path.join(media, 'sample.mkv'),
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
      '-t',
      '12',
      path.join(media, 'fallback.mp4'),
    ],
    { timeout: 30_000 },
  )
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      path.join(media, 'sample.mkv'),
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c',
      'copy',
      '-t',
      '12',
      '-f',
      'mpegts',
      path.join(media, 'transport.mp4'),
    ],
    { timeout: 30_000 },
  )
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=10:duration=2',
      '-f',
      'ffmetadata',
      '-i',
      path.join(media, 'hdr.ffmetadata'),
      '-map',
      '0:v:0',
      '-map_chapters',
      '1',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p10le',
      '-x264-params',
      'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:mastering-display=G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(6000000,1):cll=477,139',
      path.join(media, 'hdr.mkv'),
    ],
    { timeout: 30_000 },
  )
  baseUrl = await startServer({ allowVideoTranscoding: true, maxCacheSize: '20MiB', threads: 2 })
})

test.afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          if (server.exitCode !== null) return resolve()
          server.once('exit', () => resolve())
          server.kill('SIGTERM')
        }),
    ),
  )
  if (directory) fs.rmSync(directory, { recursive: true, force: true })
})

test.beforeEach(async ({ request }) => {
  for (const file of ['sample.mkv', 'fallback.mp4']) {
    await request.post(`${baseUrl}/api/playback/preferences`, {
      data: {
        path: file,
        global: { audioLanguage: '', subtitleLanguage: '', secondarySubtitleLanguage: '' },
        video: { speed: 1, audioTrack: null, subtitleTrack: null, secondarySubtitleTrack: null },
      },
    })
  }
})

async function openVideo(page: Page, file = 'sample.mkv', url = baseUrl) {
  await page.goto(`${url}/?playing=${encodeURIComponent(file)}`)
  const video = page.locator('video')
  await expect(video).toBeVisible()
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState))
    .toBeGreaterThanOrEqual(2)
  await video.evaluate((video: HTMLVideoElement) => video.play())
  return video
}

async function settings(page: Page) {
  await page.locator('video').hover()
  await page.getByRole('button', { name: 'Playback settings', exact: true }).click()
}

async function chooseSetting(page: Page, label: string, choice: string | RegExp) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('menuitemradio', { name: choice, exact: typeof choice === 'string' }).click()
}

test('playback choices use app menus with keyboard selection and dismissal', async ({
  page,
}, testInfo) => {
  await openVideo(page)
  await settings(page)
  const dialog = page.getByRole('dialog', { name: 'Playback settings' })
  await expect(dialog.locator('select')).toHaveCount(0)
  await expect(dialog).not.toContainText('saved across your devices')
  const speed = page.getByRole('button', { name: 'Playback speed', exact: true })
  await expect(speed).toHaveText('1× · Normal')
  await speed.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: '1× · Normal', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(speed).toHaveText('1.25×')
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.playbackRate))
    .toBe(1.25)
  await speed.click()
  await page.keyboard.press('Escape')
  await expect(speed).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog).toBeVisible()
  await expect(speed).toBeFocused()
  await speed.click()
  await dialog.getByText('Playback settings', { exact: true }).click()
  await expect(speed).toHaveAttribute('aria-expanded', 'false')
  await speed.click()
  await page.screenshot({ path: testInfo.outputPath('desktop-speed-menu.png') })
  await page.getByRole('menuitemradio', { name: '1× · Normal', exact: true }).click()
})

test('playback choice menus remain usable inside fullscreen', async ({ page }, testInfo) => {
  await openVideo(page)
  await page.locator('video').hover()
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await settings(page)
  await page.getByRole('button', { name: 'Playback speed', exact: true }).click()
  const choice = page
    .locator(':fullscreen')
    .getByRole('menuitemradio', { name: '1.5×', exact: true })
  await expect(choice).toBeVisible()
  await expect(choice).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('fullscreen-speed-menu.png') })
  await choice.click()
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.playbackRate))
    .toBe(1.5)
  await chooseSetting(page, 'Playback speed', '1× · Normal')
})

test('controls use a flush app toolbar and styled sliders at desktop and phone widths', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openVideo(page)
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause())
  for (const width of [1440, 800, 393]) {
    await page.setViewportSize({ width, height: 900 })
    await page.locator('video').hover()
    const surface = await page.locator('.video-surface').boundingBox()
    const bar = page.getByTestId('video-controls').locator(':scope > div').last()
    const box = await bar.boundingBox()
    expect(box!.x).toBeCloseTo(surface!.x, 1)
    expect(box!.width).toBeCloseTo(surface!.width, 1)
    expect(box!.y + box!.height).toBeCloseTo(surface!.y + surface!.height, 1)
    await expect(bar).toHaveCSS('border-radius', '0px')
    await expect(bar).toHaveCSS('backdrop-filter', 'none')
    await expect(bar).toHaveCSS('box-shadow', 'none')
    await expect(page.getByRole('slider', { name: 'Seek video' })).toHaveCSS('appearance', 'none')
    await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath(`controls-${width}.png`) })
  }
  expect(errors).toEqual([])
})

test('controls resume hiding after keyboard focus leaves the video', async ({ page }) => {
  await openVideo(page)
  await page.locator('video').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Close player' })).toBeFocused()
  await expect(page.getByTestId('video-controls')).toHaveAttribute('aria-hidden', 'true', {
    timeout: 5000,
  })
})

test('custom controls disappear in fullscreen and return for keyboard focus and pause', async ({
  page,
}) => {
  await openVideo(page)
  await page.locator('video').hover()
  await page.getByRole('button', { name: 'Enter fullscreen' }).click()
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.classList.contains('video-surface')),
    )
    .toBe(true)
  await page.mouse.move(600, 200)
  await expect(page.getByTestId('video-controls')).toHaveAttribute('aria-hidden', 'true', {
    timeout: 5000,
  })
  await expect
    .poll(() =>
      page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => getComputedStyle(video.parentElement!).cursor),
    )
    .toBe('none')
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('video-controls')).toHaveAttribute('aria-hidden', 'false')
  await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause())
  await page.waitForTimeout(2800)
  await expect(page.getByTestId('video-controls')).toHaveAttribute('aria-hidden', 'false')
})

test('renders two subtitles, extracts ASS text and synchronizes speed across browsers', async ({
  page,
  browser,
}) => {
  await openVideo(page)
  await settings(page)
  await chooseSetting(page, 'Subtitles', /^ENG.*SUBRIP/)
  await chooseSetting(page, 'Second subtitles', /^RUS.*SUBRIP/)
  await expect(page.getByTestId('video-subtitle-primary')).toHaveText('Hello & welcome')
  await expect(page.getByTestId('video-subtitle-secondary')).toHaveText('Привет, мир')
  await chooseSetting(page, 'Subtitles', /^JA.*ASS/)
  await expect(page.getByTestId('video-subtitle-primary')).toHaveText('こんにちは')
  const other = await browser.newContext()
  try {
    const second = await other.newPage()
    await openVideo(second)
    await chooseSetting(page, 'Playback speed', '1.75×')
    await expect
      .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.playbackRate))
      .toBe(1.75)
    await expect
      .poll(() => second.locator('video').evaluate((video: HTMLVideoElement) => video.playbackRate))
      .toBe(1.75)
    await expect(second.getByTestId('video-subtitle-primary')).toHaveText('こんにちは')
  } finally {
    await other.close()
  }
})

test('audio-track changes preserve timestamps, subtitles and listen-only language', async ({
  page,
}) => {
  const video = await openVideo(page)
  await video.evaluate((video: HTMLVideoElement) => {
    video.currentTime = 20.5
  })
  await settings(page)
  await chooseSetting(page, 'Subtitles', /^ENG.*SUBRIP/)
  await chooseSetting(page, 'Audio track', /^RUS.*AAC/)
  await expect(video).toHaveAttribute('data-playback-source', /audio=2/)
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThanOrEqual(20.5)
  await expect
    .poll(() =>
      video.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0)
  await expect(page.getByTestId('video-subtitle-primary')).toHaveText('Hello & welcome')
  await page.getByRole('button', { name: 'Audio only mode', exact: true }).click()
  const audio = page.locator('audio').first()
  await expect(audio).toHaveAttribute('data-playback-source', /audio=2/)
  await expect
    .poll(() => audio.evaluate((audio: HTMLAudioElement) => audio.currentTime))
    .toBeGreaterThanOrEqual(20.5)
  await expect.poll(() => audio.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false)
})

test('click seeking in a partial stream keeps the requested timestamp throughout loading', async ({
  page,
  request,
}) => {
  await request.post(`${baseUrl}/api/playback/preferences`, {
    data: { path: 'sample.mkv', video: { audioTrack: 'embedded:2' } },
  })
  await page.addInitScript(() =>
    localStorage.setItem(
      'video-playback-times',
      JSON.stringify({ state: { playbackTimes: { 'sample.mkv': 21.3 } }, version: 0 }),
    ),
  )
  const video = await openVideo(page)
  await expect(video).toHaveAttribute('src', /^blob:/)
  await video.evaluate((video: HTMLVideoElement) => video.pause())
  await video.hover()
  const seek = page.getByRole('slider', { name: 'Seek video' })
  const box = (await seek.boundingBox())!
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>('input[aria-label="Seek video"]')!
    let watching = false
    const values: number[] = []
    slider.addEventListener(
      'input',
      () => {
        watching = true
      },
      { once: true },
    )
    ;(window as any).seekFrames = values
    const frame = () => {
      if (watching) values.push(Number(slider.value))
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await seek.click({ position: { x: box.width * 0.1, y: box.height / 2 } })
  const target = Number(await seek.inputValue())
  expect(target).toBeGreaterThan(5)
  await expect(video).toHaveAttribute('data-playback-source', /start=5\./)
  await expect
    .poll(
      () =>
        video.evaluate(
          (video: HTMLVideoElement, target) => Math.abs(video.currentTime - target),
          target,
        ),
      {
        timeout: 10000,
      },
    )
    .toBeLessThan(0.25)
  await page.waitForTimeout(250)
  const values = await page.evaluate(() => (window as any).seekFrames as number[])
  expect(values.length).toBeGreaterThan(0)
  expect(Math.min(...values)).toBeGreaterThanOrEqual(target - 0.25)
  expect(Math.max(...values)).toBeLessThanOrEqual(target + 0.25)
  await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
})

for (const file of ['sample.mkv', 'fallback.mp4']) {
  test(`drag seeking previews one position and commits once on release in ${file}`, async ({
    page,
  }) => {
    const video = await openVideo(page, file)
    await video.evaluate((video: HTMLVideoElement) => video.pause())
    await video.hover()
    const seek = page.getByRole('slider', { name: 'Seek video' })
    const box = (await seek.boundingBox())!
    const duration = Number(await seek.getAttribute('max'))
    await video.evaluate((video: HTMLVideoElement) => {
      ;(window as any).seekEvents = []
      for (const event of ['seeking', 'emptied'])
        video.addEventListener(event, () => (window as any).seekEvents.push(event))
    })
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
    await page.mouse.down()
    for (const ratio of [0.3, 0.5, 0.7, 0.6]) {
      await page.mouse.move(box.x + box.width * ratio, box.y + box.height / 2, { steps: 5 })
      await page.waitForTimeout(80)
      expect(Math.abs(Number(await seek.inputValue()) - duration * ratio)).toBeLessThan(0.5)
    }
    expect(await page.evaluate(() => (window as any).seekEvents)).toEqual([])
    const target = Number(await seek.inputValue())
    await page.mouse.up()
    await expect
      .poll(() =>
        video.evaluate(
          (video: HTMLVideoElement, target) => Math.abs(video.currentTime - target),
          target,
        ),
      )
      .toBeLessThan(0.25)
    await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.paused)).toBe(true)
    const events = await page.evaluate(() => (window as any).seekEvents as string[])
    expect(events.filter((event) => event === 'emptied').length).toBeLessThanOrEqual(1)
  })
}

test('converts incompatible video without changing resolution and supports seeking', async ({
  page,
}) => {
  const video = await openVideo(page, 'fallback.mp4')
  await expect(video).toHaveAttribute('data-playback-source', /video=true/)
  await expect
    .poll(() =>
      video.evaluate((video: HTMLVideoElement) => ({
        width: video.videoWidth,
        height: video.videoHeight,
      })),
    )
    .toEqual({ width: 320, height: 180 })
  await video.hover()
  const seek = page.getByRole('slider', { name: 'Seek video' })
  const box = (await seek.boundingBox())!
  await seek.click({ position: { x: box.width * 0.62, y: box.height / 2 } })
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThanOrEqual(7)
  await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false)
})

test('remuxes transport streams with AAC without enabling video conversion', async ({ page }) => {
  const url = await startServer({ maxCacheSize: '20MiB', threads: 2 })
  const video = await openVideo(page, 'transport.mp4', url)
  await expect(video).toHaveAttribute('data-playback-source', /video=false/)
  await expect(video).toHaveAttribute('data-playback-source', /copyAudio=true/)
  await expect
    .poll(() => video.evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(0.5)
  await expect
    .poll(() =>
      video.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      video.evaluate(
        (video: HTMLVideoElement & { webkitAudioDecodedByteCount: number }) =>
          video.webkitAudioDecodedByteCount,
      ),
    )
    .toBeGreaterThan(0)
})

test('compatibility playback works over ordinary HTTP on a local network', async ({ page }) => {
  const origin = 'http://video-controls.test'
  // This fixture mocks its HTTP origin; mock the Vite HMR connection too.
  await page.routeWebSocket(
    (url) => url.searchParams.has('token'),
    (socket) => {
      socket.send(JSON.stringify({ type: 'connected' }))
    },
  )
  await page.route(`${origin}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/events/stream') return route.abort()
    const response = await route.fetch({ url: `${baseUrl}${url.pathname}${url.search}` })
    await route.fulfill({ response })
  })
  const video = await openVideo(page, 'fallback.mp4', origin)
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false)
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')
  await expect(video).toHaveAttribute('data-playback-source', /video=true/)
  await expect
    .poll(() =>
      video.evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames),
    )
    .toBeGreaterThan(0)
})

test('reports conversion disabled and a full cache explicitly', async ({ page }) => {
  test.setTimeout(45_000)
  const disabled = await startServer({ maxCacheSize: '20MiB' })
  await page.goto(`${disabled}/?playing=fallback.mp4`)
  await expect(page.getByRole('alert')).toContainText('playback.allowVideoTranscoding')
  const limited = await startServer({
    allowVideoTranscoding: true,
    maxCacheSize: '1KiB',
    threads: 1,
  })
  await page.goto(`${limited}/?playing=fallback.mp4`)
  await expect(page.getByRole('alert')).toContainText('Playback cache limit reached', {
    timeout: 20_000,
  })
})

test('tone-maps HDR to SDR at the original dimensions and reuses ranged cached output', async ({
  request,
}) => {
  const url = `${baseUrl}/api/playback/stream?path=hdr.mkv&video=true`
  const response = await request.get(url)
  expect(response.ok()).toBe(true)
  const output = path.join(directory, 'hdr-output.mp4')
  const bytes = await response.body()
  fs.writeFileSync(output, bytes)
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,width,height,pix_fmt,color_transfer,color_primaries,color_space:frame_side_data=side_data_type:chapter=start_time',
        '-read_intervals',
        '%+#5',
        '-show_frames',
        '-of',
        'json',
        output,
      ],
      { encoding: 'utf8' },
    ),
  )
  expect(probe.streams[0]).toMatchObject({
    codec_name: 'h264',
    width: 320,
    height: 180,
    pix_fmt: 'yuv420p',
    color_transfer: 'bt709',
    color_primaries: 'bt709',
    color_space: 'bt709',
  })
  expect(probe.chapters).toEqual([])
  expect(probe.frames.length).toBeGreaterThan(0)
  expect(JSON.stringify(probe.frames)).not.toContain('Mastering display metadata')
  expect(JSON.stringify(probe.frames)).not.toContain('Content light level metadata')
  const ranged = await request.get(url, { headers: { Range: 'bytes=0-63' } })
  expect(ranged.status()).toBe(206)
  expect(await ranged.body()).toEqual(bytes.subarray(0, 64))
})

test('phone layout keeps settings usable and touch reveals controls', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 393, height: 851 },
    isMobile: true,
    hasTouch: true,
  })
  try {
    const page = await context.newPage()
    await openVideo(page)
    await page.locator('video').tap()
    if ((await page.getByTestId('video-controls').getAttribute('aria-hidden')) === 'true')
      await page.locator('video').tap()
    await page.getByRole('button', { name: 'Playback settings', exact: true }).tap()
    await expect(page.getByLabel('Playback speed')).toBeVisible()
    await expect(page.getByLabel('Second subtitles', { exact: true })).toBeVisible()
    const box = await page.getByRole('dialog', { name: 'Playback settings' }).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(393)
    await page.getByRole('button', { name: 'Audio track', exact: true }).tap()
    const menu = page.getByRole('menu')
    const menuBox = await menu.boundingBox()
    expect(menuBox!.x).toBeGreaterThanOrEqual(0)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(393)
    await expect(page.getByRole('menuitemradio', { name: /^RUS.*AAC/ })).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('phone-audio-menu.png') })
    await page.getByRole('menuitemradio', { name: /^RUS.*AAC/ }).tap()
    await expect(page.locator('video')).toHaveAttribute('data-playback-source', /audio=2/)
  } finally {
    await context.close()
  }
})

test('listen-only compatibility audio commits a drag once and preserves the requested time', async ({
  page,
}) => {
  const video = await openVideo(page)
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = 40
  })
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.seeking))
    .toBe(false)
  await video.hover()
  await page.getByRole('button', { name: 'Audio only mode', exact: true }).click()
  const audio = page.locator('audio').first()
  await expect(audio).toHaveAttribute('data-playback-source', /audioOnly=true/)
  await page
    .getByTestId('audio-player-chrome')
    .getByRole('button', { name: 'Pause', exact: true })
    .click()
  const target = await dragPlaybackPosition(
    page,
    audio,
    page
      .getByTestId('audio-player-chrome')
      .locator('input[aria-label="Playback position"]:visible'),
  )
  await page
    .getByTestId('audio-player-chrome')
    .getByRole('button', { name: 'Play', exact: true })
    .click()
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(target + 0.3)
})

test('seeking to the end of a compatibility stream settles and can seek back', async ({ page }) => {
  await page.route('**/api/playback/info?*', async (route) => {
    const response = await route.fetch()
    const info = await response.json()
    await route.fulfill({ response, json: { ...info, duration: info.duration + 1 } })
  })
  const video = await openVideo(page, 'fallback.mp4')
  await video.hover()
  await page.getByRole('button', { name: 'Pause video' }).click()
  const slider = page.getByRole('slider', { name: 'Seek video' })
  await slider.focus()
  await page.keyboard.press('End')
  await expect
    .poll(async () =>
      video.evaluate((element: HTMLVideoElement) => ({
        atEnd: Math.abs(element.duration - element.currentTime) < 0.15,
        seeking: element.seeking,
      })),
    )
    .toEqual({ atEnd: true, seeking: false })
  await page.getByRole('button', { name: 'Play video' }).click()
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(2)
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.2)
  await page.getByRole('button', { name: 'Pause video' }).click()
  await slider.focus()
  await page.keyboard.press('Home')
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(0.15)
  await page.getByRole('button', { name: 'Play video' }).click()
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0.2)
})
