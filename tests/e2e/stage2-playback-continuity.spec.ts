import { expect, test, type Locator, type Page } from '@playwright/test'

const AUDIO_HOST = '[data-playback-media-host="audio"]'
const AUDIO_FILE = 'Music/track.mp3'

async function clientNavigate(page: Page, href: string) {
  await page.evaluate((nextHref) => window.history.pushState(null, '', nextHref), href)
}

async function hostSource(host: Locator) {
  return host.evaluate((element: HTMLAudioElement) => element.currentSrc || element.src)
}

async function expectSameHost(page: Page, host: Locator, source: string) {
  await expect(host).toHaveCount(1)
  await expect(page.locator('audio')).toHaveCount(1)
  await expect(host).toHaveAttribute('data-stage2-continuity-host', 'same-node')
  await expect.poll(() => hostSource(host)).toBe(source)
}

test('keeps one playback host and session through Library, Workspace, Canvas, and back', async ({
  page,
  request,
}) => {
  const canvasWorkspaceId = `stage2-canvas-${Date.now()}`
  const clientId = 'stage2-playback-client'
  const opened = await request.post('/api/workspaces/open', {
    data: {
      id: canvasWorkspaceId,
      clientId,
      snapshot: {
        workspaceType: 'canvas',
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 1,
        canvas: {
          camera: { x: 0, y: 0, zoom: 1 },
          maximizedWindowId: null,
          windowSizeByType: {},
          nextZIndex: 1,
        },
      },
    },
  })
  expect(opened.ok()).toBe(true)
  await page.addInitScript((id) => {
    const loads = Number(sessionStorage.getItem('stage2-playback-document-loads') ?? '0') + 1
    sessionStorage.setItem('stage2-playback-document-loads', String(loads))
    sessionStorage.setItem('workspace-client-id', id)
    localStorage.removeItem('video-playback-times')
    localStorage.removeItem('derp-playback-session-owner-v1')
  }, clientId)

  await page.goto('/?dir=Music')
  await page.locator('table').getByText('track.mp3', { exact: true }).click()

  const host = page.locator(AUDIO_HOST)
  await expect(host).toHaveCount(1)
  await expect(page.locator('audio')).toHaveCount(1)
  await expect
    .poll(async () => {
      const source = await hostSource(host)
      return source ? decodeURIComponent(new URL(source).pathname) : ''
    })
    .toBe(`/api/media/${AUDIO_FILE}`)
  await expect
    .poll(() => host.evaluate((element: HTMLAudioElement) => element.readyState))
    .toBeGreaterThanOrEqual(2)

  const initial = await host.evaluate((element: HTMLAudioElement) => {
    element.setAttribute('data-stage2-continuity-host', 'same-node')
    element.pause()
    const duration =
      Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 4
    const position = Math.min(Math.max(0.5, duration * 0.25), Math.max(0.5, duration - 0.5))
    element.currentTime = position
    element.dispatchEvent(new Event('timeupdate'))
    return { position, source: element.currentSrc || element.src }
  })
  await expect.poll(() => host.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)

  await clientNavigate(page, '/workspace?dir=Music')
  await expect(page.locator('.workspace-layout')).toBeVisible()
  await expectSameHost(page, host, initial.source)
  await expect
    .poll(() => host.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(initial.position - 0.25)

  const openWorkspaceControls = page.getByRole('button', { name: 'Open audio controls' })
  await expect(openWorkspaceControls).toBeVisible()
  await openWorkspaceControls.click()
  const workspaceControls = page.locator('[data-workspace-taskbar-audio-root]')
  await expect(workspaceControls).toContainText('track.mp3')
  await expect
    .poll(async () =>
      Number(
        await workspaceControls.getByRole('slider', { name: 'Playback position' }).inputValue(),
      ),
    )
    .toBeGreaterThan(initial.position - 0.25)

  await workspaceControls.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => host.evaluate((element: HTMLAudioElement) => !element.paused)).toBe(true)
  await expect(workspaceControls.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await expect
    .poll(() => host.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(initial.position)

  await workspaceControls.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => host.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
  const workspacePosition = await host.evaluate((element: HTMLAudioElement) => element.currentTime)

  await clientNavigate(page, `/workspace?ws=${encodeURIComponent(canvasWorkspaceId)}`)
  await expect(page.locator('.canvas-layout')).toBeVisible()
  await expectSameHost(page, host, initial.source)
  await expect
    .poll(async () =>
      Math.abs(
        (await host.evaluate((element: HTMLAudioElement) => element.currentTime)) -
          workspacePosition,
      ),
    )
    .toBeLessThan(0.5)

  await clientNavigate(page, '/?dir=Music')
  await expect(page.getByTestId('file-browser')).toBeVisible()
  await expectSameHost(page, host, initial.source)
  await expect
    .poll(async () =>
      Math.abs(
        (await host.evaluate((element: HTMLAudioElement) => element.currentTime)) -
          workspacePosition,
      ),
    )
    .toBeLessThan(0.5)
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('stage2-playback-document-loads')))
    .toBe('1')
})
