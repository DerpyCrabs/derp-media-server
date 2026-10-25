import { test, expect } from '@playwright/test'
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
  }) => {
    test.setTimeout(60000)
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'derp-desktop-mode-'))
    const home = path.join(directory, 'home')
    await fs.mkdir(path.join(home, 'Downloads'), { recursive: true })
    await fs.writeFile(path.join(home, 'note.txt'), 'test')
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
      await page.goto(origin)
      if (desktopMode) {
        expect((await places.json()).places).toEqual(
          expect.arrayContaining([
            { name: 'Home', path: '', kind: 'home' },
            { name: 'Downloads', path: 'Downloads', kind: 'folder' },
          ]),
        )
        await page.getByRole('button', { name: 'Places', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Downloads', exact: true }).click()
        await expect(page).toHaveURL(/dir=Downloads/)
        await page.getByRole('button', { name: 'Files', exact: true }).click()
        await page.getByRole('button', { name: 'Go to location', exact: true }).click()
        await page.getByRole('textbox', { name: 'Location', exact: true }).fill('~')
        await page.getByRole('button', { name: 'Go', exact: true }).click()
        await expect(page.locator('table').getByText('note.txt', { exact: true })).toBeVisible()
      } else {
        await expect(page.getByRole('button', { name: 'Places', exact: true })).toHaveCount(0)
      }
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
    const resolved = await request.post(`${origin}/api/desktop/resolve`, {
      data: { path: directory, absolute: true },
    })
    expect(resolved.ok()).toBe(true)
    const logical = (await resolved.json()).path
    expect(logical).toBe(directory.slice(1))
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
