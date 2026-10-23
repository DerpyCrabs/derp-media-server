import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
  test(`workspace, settings, and reading progress survive ${signal} and server restart`, async ({
    page,
  }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'derp-recovery-'))
    const media = path.join(directory, 'media')
    fs.mkdirSync(media)
    fs.writeFileSync(path.join(media, 'book.txt'), 'persistent document')
    const listener = net.createServer()
    listener.listen(0, '127.0.0.1')
    await once(listener, 'listening')
    const port = (listener.address() as net.AddressInfo).port
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    const origin = `http://127.0.0.1:${port}`
    const config = path.join(directory, 'config.json')
    fs.writeFileSync(
      config,
      JSON.stringify({
        port,
        mediaDir: media,
        dataPath: path.join(directory, 'data'),
        fileSearch: { enabled: false },
      }),
    )
    let server: ChildProcess | undefined
    let output = ''
    const start = async () => {
      server = spawn(
        path.resolve(
          process.env.TEST_SERVER_TARGET_DIR ?? 'target',
          'release',
          process.platform === 'win32' ? 'derp-media-server.exe' : 'derp-media-server',
        ),
        ['--production'],
        {
          env: {
            ...process.env,
            PORT: String(port),
            CONFIG_PATH: config,
            MEDIA_DIR: media,
            NODE_ENV: 'production',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      server.stdout!.on('data', (chunk) => {
        output += chunk.toString()
      })
      server.stderr!.on('data', (chunk) => {
        output += chunk.toString()
      })
      await expect
        .poll(
          async () => {
            if (server!.exitCode !== null) throw new Error(output)
            return page.request
              .get(`${origin}/api/config`)
              .then((response) => response.ok())
              .catch(() => false)
          },
          { timeout: 10_000, intervals: [50, 100, 250] },
        )
        .toBe(true)
    }
    const stop = async (signal: NodeJS.Signals) => {
      const process = server!
      const exited = once(process, 'exit')
      process.kill(signal)
      const timeout = setTimeout(() => process.kill('SIGKILL'), 5000)
      try {
        const [, actualSignal] = await exited
        if (signal === 'SIGTERM') expect(actualSignal, output).not.toBe('SIGKILL')
      } finally {
        clearTimeout(timeout)
        server = undefined
      }
    }
    try {
      await start()
      const id = `recovery-${crypto.randomUUID()}`
      const url = `${origin}/workspace?ws=${id}`
      await page.goto(url)
      await expect(page.locator('[data-workspace-opened]')).toBeAttached()
      const registry = await page.request
        .get(`${origin}/api/workspaces`)
        .then((response) => response.json())
      const snapshot = registry.records[id].snapshot
      expect(snapshot.windows.length).toBeGreaterThan(0)
      expect(
        (
          await page.request.post(`${origin}/api/settings/viewMode`, {
            data: { path: '', viewMode: 'grid' },
          })
        ).ok(),
      ).toBe(true)
      const reader = await page.request
        .get(`${origin}/api/reader-state?path=book.txt`)
        .then((response) => response.json())
      expect(
        (
          await page.request.post(`${origin}/api/reader-state`, {
            data: {
              path: 'book.txt',
              state: { page: 3 },
              baseRevision: reader.revision,
              fingerprint: reader.fingerprint,
            },
          })
        ).ok(),
      ).toBe(true)
      const settings = await page.request
        .get(`${origin}/api/settings`)
        .then((response) => response.json())
      if (signal === 'SIGTERM') await page.goto('about:blank')
      await stop(signal)
      await page.goto('about:blank')
      await start()
      const restored = await page.request
        .get(`${origin}/api/workspaces`)
        .then((response) => response.json())
      expect(restored.records[id].snapshot).toEqual(snapshot)
      expect(
        await page.request.get(`${origin}/api/settings`).then((response) => response.json()),
      ).toEqual(settings)
      expect(
        await page.request
          .get(`${origin}/api/reader-state?path=book.txt`)
          .then((response) => response.json()),
      ).toMatchObject({
        state: { page: 3 },
        revision: reader.revision + 1,
        fingerprint: reader.fingerprint,
      })
      await page.goto(url)
      await expect(page.locator('[data-workspace-opened]')).toBeAttached()
      await expect(page.getByText('book.txt', { exact: true })).toBeVisible()
    } finally {
      await page.goto('about:blank')
      if (server) await stop('SIGKILL')
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}
