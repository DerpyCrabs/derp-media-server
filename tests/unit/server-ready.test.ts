import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { serverOrigin } from '../fixtures/server-ready'

async function child(script: string, check: (ready: Promise<string>) => Promise<void>) {
  const process = spawn(globalThis.process.execPath, ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(process, 'exit')
  try {
    await check(serverOrigin(process, 1000))
  } finally {
    if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL')
    await exited
  }
}

test('readiness accepts only a complete message from the child, across output chunks', async () => {
  await child(
    `process.stdout.write('startup log\\nDERP_SERVER_'); setTimeout(() => console.log('READY=' + JSON.stringify({pid:process.pid,port:12345})), 10)`,
    async (ready) => {
      expect(await ready).toBe('http://127.0.0.1:12345')
    },
  )
})

test('readiness rejects another process identity', async () => {
  await child(
    `console.log('DERP_SERVER_READY=' + JSON.stringify({pid:process.pid+1,port:12345}))`,
    async (ready) => {
      expect(
        await ready.then(
          () => '',
          (error: unknown) => String(error),
        ),
      ).toContain('Invalid server readiness identity or port')
    },
  )
})

test('startup failure reports stderr instead of probing an unrelated listener', async () => {
  await child(
    `console.error('Failed to bind HTTP server: Address already in use'); process.exit(1)`,
    async (ready) => {
      expect(
        await ready.then(
          () => '',
          (error: unknown) => String(error),
        ),
      ).toContain('Failed to bind HTTP server: Address already in use')
    },
  )
})
