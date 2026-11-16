import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import type { DesktopBridge } from '@/desktop/bridge'

for (const result of [undefined, true, false, new Error('Save failed')]) {
  test(`Qt close bridge preserves ${String(result)}`, async () => {
    let emit!: (name: string) => void
    let reply!: (id: string, response: { value?: unknown }) => void
    const calls: unknown[][] = []
    const window = {} as { derpDesktop: DesktopBridge }
    const native = {
      reply: {
        connect(callback: typeof reply) {
          reply = callback
        },
      },
      event: {
        connect(callback: typeof emit) {
          emit = callback
        },
      },
      call(id: string, method: string, args: unknown[]) {
        calls.push([method, ...args])
        reply(id, {})
      },
    }
    runInNewContext(readFileSync('desktop/qt/bridge.js', 'utf8'), {
      window,
      qt: { webChannelTransport: {} },
      QWebChannel: class {
        constructor(_transport: unknown, ready: (channel: unknown) => void) {
          ready({ objects: { desktop: native } })
        }
      },
    })
    window.derpDesktop.onBeforeClose(async () => {
      if (result instanceof Error) throw result
      return result
    })
    emit('before-close')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([
      [
        'close-ready',
        result instanceof Error ? 'Error: Save failed' : result === false ? false : '',
      ],
    ])
  })
}
