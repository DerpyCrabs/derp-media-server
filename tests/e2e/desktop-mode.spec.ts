import { test, expect } from '@playwright/test'
import { nativeSidebar } from '../fixtures/native-sidebar'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serverOrigin } from '../fixtures/server-ready'

for (const desktopMode of [false, true]) {
  test(`desktop mode ${desktopMode ? 'enabled' : 'disabled'} keeps configured root boundaries`, async ({
    request,
    page,
  }, testInfo) => {
    test.setTimeout(60000)
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'derp-desktop-mode-'))
    const home = path.join(directory, 'home')
    await fs.mkdir(path.join(home, 'Downloads'), { recursive: true })
    await fs.writeFile(path.join(home, 'note.txt'), 'test')
    await fs.mkdir(path.join(home, 'Projects'))
    const config = path.join(directory, 'config.json')
    await fs.writeFile(
      config,
      JSON.stringify({
        desktopMode,
        mediaDir: home,
        dataPath: path.join(directory, 'data'),
        fileSearch: { enabled: false },
      }),
    )
    const child = spawn(
      path.resolve(process.env.TEST_SERVER_TARGET_DIR ?? 'target', 'release', 'derp-media-server'),
      ['--production'],
      {
        env: {
          ...process.env,
          PORT: '0',
          CONFIG_PATH: config,
          MEDIA_DIR: '',
          HOME: home,
          XDG_CONFIG_HOME: path.join(home, '.config'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    try {
      const origin = await serverOrigin(child)
      expect((await (await request.get(`${origin}/api/config`)).json()).desktopMode).toBe(
        desktopMode,
      )
      const outside = await request.post(`${origin}/api/desktop/resolve`, {
        data: { path: directory, absolute: true },
      })
      expect(outside.status()).toBe(403)
      const places = await request.get(`${origin}/api/desktop/places`)
      expect(places.status()).toBe(desktopMode ? 200 : 404)
      if (!desktopMode) {
        expect((await request.get(`${origin}/api/desktop/trash`)).status()).toBe(404)
        expect(
          (
            await request.post(`${origin}/api/desktop/trash/restore`, { data: { id: 'any' } })
          ).status(),
        ).toBe(404)
      }
      expect(
        (
          await request.post(`${origin}/api/desktop/sidebar`, { data: { path: 'note.txt' } })
        ).status(),
      ).toBe(desktopMode ? 400 : 404)
      await nativeSidebar(page.context())
      await page.goto(desktopMode ? origin + '/desktop?mode=browser' : origin)
      if (desktopMode) {
        expect((await places.json()).places).toEqual(
          expect.arrayContaining([
            { name: 'Home', path: '', kind: 'home' },
            { name: 'Downloads', path: 'Downloads', kind: 'folder' },
          ]),
        )
        await expect(page.getByRole('navigation', { name: 'Places' })).toBeVisible()
        await page.evaluate(() => {
          const frames: { path: string; sidebarWidth: number; toggleVisible: boolean }[] = []
          let active = true
          const sample = () => {
            if (!active) return
            const sidebar = document.querySelector('[data-testid="places-sidebar"]')
            const toggle = document.querySelector('[aria-label="Show sidebar"]')
            frames.push({
              path: location.search,
              sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
              toggleVisible: !!toggle?.getBoundingClientRect().width,
            })
            requestAnimationFrame(sample)
          }
          Object.assign(window, {
            stopSidebarFrames: () => {
              active = false
              return frames
            },
          })
          requestAnimationFrame(sample)
        })
        await page
          .getByRole('navigation', { name: 'Places' })
          .getByRole('button', { name: 'Downloads', exact: true })
          .click()
        await expect(page).toHaveURL(/dir=Downloads/)
        await page.getByRole('button', { name: 'File actions', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Edit location', exact: true }).click()
        await page.getByRole('textbox', { name: 'Location', exact: true }).fill('~')
        await page.getByRole('textbox', { name: 'Location', exact: true }).press('Enter')
        await expect(page.locator('table').getByText('note.txt', { exact: true })).toBeVisible()
        const frames = await page.evaluate(() =>
          (
            window as unknown as {
              stopSidebarFrames: () => {
                path: string
                sidebarWidth: number
                toggleVisible: boolean
              }[]
            }
          ).stopSidebarFrames(),
        )
        expect(frames.length).toBeGreaterThan(0)
        expect(
          frames.filter((frame) => frame.sidebarWidth === 0 || frame.toggleVisible),
          'Wide sidebar must remain visible on every frame of directory navigation',
        ).toEqual([])
        await page.locator('table tr').filter({ hasText: 'Projects' }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Add to sidebar', exact: true }).click()
        const sidebar = page.getByRole('navigation', { name: 'Places' })
        await expect(sidebar.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
        await page.reload()
        await expect(sidebar.getByRole('button', { name: 'Projects', exact: true })).toBeVisible()
        await page.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath('sidebar-desktop.png'),
        })
        const another = await page.context().newPage()
        await another.goto(origin + '/desktop?mode=browser')
        await expect(
          another
            .getByRole('navigation', { name: 'Places' })
            .getByRole('button', { name: 'Projects', exact: true }),
        ).toBeVisible()
        await sidebar
          .getByRole('button', { name: 'Projects', exact: true })
          .click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Remove from sidebar', exact: true }).click()
        await expect(
          another
            .getByRole('navigation', { name: 'Places' })
            .getByRole('button', { name: 'Projects', exact: true }),
        ).toHaveCount(0)
        await another.close()
        await page.locator('[data-places-layout]').evaluate((element) => {
          Object.assign((element as HTMLElement).style, {
            width: '740px',
            marginLeft: '180px',
            flex: 'none',
          })
        })
        await expect(page.getByTestId('places-sidebar')).toBeHidden()
        await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
        const drawer = page.getByRole('dialog', { name: 'Places', exact: true })
        await expect(drawer).toBeVisible()
        await expect.poll(async () => (await drawer.boundingBox())?.x).toBe(180)
        await page
          .locator('[data-places-layout]')
          .evaluate((element) => element.removeAttribute('style'))
        await expect(page.getByTestId('places-sidebar')).toBeVisible()
        await expect(drawer).toHaveCount(0)
        await page.setViewportSize({ width: 390, height: 844 })
        await page.route('**/api/desktop/places', (route) =>
          route.fulfill({
            json: {
              places: [
                { name: 'Home', path: '', kind: 'home' },
                { name: 'Downloads', path: 'Downloads', kind: 'mount' },
              ],
            },
          }),
        )
        await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
        const device = page
          .getByRole('navigation', { name: 'Places' })
          .getByRole('button', { name: 'Downloads', exact: true })
        await expect(device).toBeVisible()
        await expect(drawer).toBeVisible()
        await drawer.evaluate((element) =>
          Promise.all(element.getAnimations().map((animation) => animation.finished)),
        )
        const fits = await device.evaluate((element) => {
          const menu = element.closest('dialog, [role="dialog"]')!.getBoundingClientRect()
          return (
            menu.left >= 0 &&
            menu.right <= document.documentElement.clientWidth &&
            menu.bottom <= innerHeight
          )
        })
        expect(fits).toBe(true)
        await page.screenshot({
          animations: 'disabled',
          path: testInfo.outputPath('sidebar-phone.png'),
        })
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeFocused()
        await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
        await device.click()
        await expect(page).toHaveURL(/dir=Downloads/)
      } else {
        await page.locator('table tr').filter({ hasText: 'Projects' }).click({ button: 'right' })
        await expect(
          page.getByRole('menuitem', { name: 'Add to sidebar', exact: true }),
        ).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toHaveCount(0)
      }
      await page.goto(`${origin}/?viewing=note.txt`)
      await page.getByRole('button', { name: 'Document actions', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await page.addInitScript(() => Object.assign(window, { derpDesktop: {} }))
      await page.reload()
      await page.getByRole('button', { name: 'Document actions', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Download', exact: true })).toHaveCount(0)
    } finally {
      await page.goto('about:blank')
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGTERM')
        const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
        try {
          await exited
        } finally {
          clearTimeout(timeout)
        }
      }
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
}

test('desktop mode without a media root browses the filesystem without indexing it by default', async ({
  request,
}) => {
  test.skip(process.platform === 'win32')
  test.setTimeout(60000)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'derp-computer-mode-'))
  const config = path.join(directory, 'config.json')
  await fs.writeFile(
    config,
    JSON.stringify({ desktopMode: true, dataPath: path.join(directory, 'data') }),
  )
  const child = spawn(
    path.resolve(process.env.TEST_SERVER_TARGET_DIR ?? 'target', 'release', 'derp-media-server'),
    ['--production'],
    {
      env: { ...process.env, PORT: '0', CONFIG_PATH: config, MEDIA_DIR: '', HOME: directory },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  try {
    const origin = await serverOrigin(child)
    expect((await (await request.get(`${origin}/api/config`)).json()).filesystemRoot).toBe(true)
    const resolved = await request.post(`${origin}/api/desktop/resolve`, {
      data: { path: directory, absolute: true },
    })
    expect(resolved.ok()).toBe(true)
    const logical = (await resolved.json()).path
    expect(logical).toBe(`Files${directory}`)
    const root = await (await request.get(`${origin}/api/files?surface=workspace`)).json()
    const names = root.files.map((file: { name: string }) => file.name)
    expect(names).toContain('Files')
    expect(names).toContain('Favorites')
    expect(names).not.toContain('etc')
    const filesystem = await (await request.get(`${origin}/api/files?dir=Files`)).json()
    expect(filesystem.files.map((file: { name: string }) => file.name)).toContain('etc')
    expect(filesystem.files.map((file: { name: string }) => file.name)).not.toContain('Favorites')
    const home = await (await request.get(`${origin}/api/desktop/places`)).json()
    expect(home.places).toContainEqual({ name: 'Home', path: logical, kind: 'home' })
    const listing = await (
      await request.get(`${origin}/api/files?dir=${encodeURIComponent(logical)}`)
    ).json()
    expect(listing.files.map((file: { name: string }) => file.name)).toContain('config.json')
    const status = await (await request.get(`${origin}/api/files/search/status`)).json()
    expect(status.state).toBe('disabled')
    const write = await request.post(`${origin}/api/files/create`, {
      data: { path: `${logical}/not-authorized.txt`, type: 'file', content: 'no' },
    })
    expect(write.status()).toBe(403)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
      try {
        await exited
      } finally {
        clearTimeout(timeout)
      }
    }
    await fs.rm(directory, { recursive: true, force: true })
  }
})
