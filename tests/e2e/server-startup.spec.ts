import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serverOrigin } from '../fixtures/server-ready'

for (const development of [false, true]) {
  test(`concurrent ${development ? 'development' : 'production'} servers own their assigned ports`, async ({
    request,
  }) => {
    test.setTimeout(60000)
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'derp-port-startup-'))
    const children: ChildProcess[] = []
    try {
      const results = await Promise.allSettled(
        Array.from({ length: development ? 2 : 8 }, async (_, index) => {
          const root = path.join(directory, String(index))
          const media = path.join(root, 'media')
          await fs.mkdir(media, { recursive: true })
          await fs.writeFile(path.join(media, 'identity.txt'), String(index))
          const config = path.join(root, 'config.json')
          await fs.writeFile(
            config,
            JSON.stringify({
              port: 0,
              mediaDir: media,
              dataPath: path.join(root, 'data'),
              fileSearch: { enabled: false },
            }),
          )
          const child = spawn(
            path.resolve(
              process.env.TEST_SERVER_TARGET_DIR ?? 'target',
              'release',
              'derp-media-server',
            ),
            development ? [] : ['--production'],
            {
              env: {
                ...process.env,
                PORT: '0',
                CONFIG_PATH: config,
                MEDIA_DIR: media,
                NODE_ENV: development ? 'development' : 'production',
              },
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          )
          children.push(child)
          const origin = await serverOrigin(child)
          const response = await request.get(`${origin}/api/media/identity.txt`)
          expect(await response.text()).toBe(String(index))
          if (development) {
            const client = await request.get(`${origin}/@vite/client`)
            expect(client.ok()).toBe(true)
            expect(await client.text()).toContain('WebSocket')
          }
          return origin
        }),
      )
      const origins = results.map((result) => {
        if (result.status === 'rejected') throw result.reason
        return result.value
      })
      expect(new Set(origins).size).toBe(origins.length)
      expect(origins.every((origin) => !origin.endsWith(':0'))).toBe(true)
    } finally {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode !== null || child.signalCode !== null) return
          const exited = once(child, 'exit')
          child.kill('SIGTERM')
          const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
          try {
            await exited
          } finally {
            clearTimeout(timeout)
          }
        }),
      )
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
}
