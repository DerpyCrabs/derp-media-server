import { afterEach, expect, spyOn, test } from 'bun:test'
import { Schema } from 'effect'
import { sseEventSchema, workerEventSchema } from '../../src/lib/api/sse-protocol'

const restoreGlobals: Array<() => void> = []
function replaceGlobals(values: Record<string, unknown>) {
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    restoreGlobals.push(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
}
const mocks: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore()
  for (const restore of restoreGlobals.splice(0).reverse()) restore()
})

test('admin event boundaries reject malformed paths and worker envelopes', () => {
  expect(Schema.decodeUnknownExit(sseEventSchema)({ type: 'path-moved', oldPath: 42 })._tag).toBe(
    'Failure',
  )
  expect(Schema.decodeUnknownExit(workerEventSchema)({ type: 'admin-sse', data: null })._tag).toBe(
    'Failure',
  )
  expect(Schema.decodeUnknownExit(sseEventSchema)({ type: 'connected' })._tag).toBe('Success')
})

test('another tab unsubscribing preserves reconnect and disconnect releases all port references', async () => {
  const sources: FakeSource[] = []
  class FakeSource {
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    closed = false
    constructor() {
      sources.push(this)
    }
    close() {
      this.closed = true
    }
  }
  const worker = { onconnect: undefined as unknown as (event: { ports: unknown[] }) => void }
  replaceGlobals({ self: worker, EventSource: FakeSource })
  const scheduled: Array<() => void> = []
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void) => {
    scheduled.push(run)
    return scheduled.length
  }) as typeof setTimeout)
  const clear = spyOn(globalThis, 'clearTimeout').mockImplementation(() => {})
  mocks.push(timeout, clear)
  await import(`../../src/lib/api/sse-shared-worker.ts?worker-test=${Date.now()}`)
  function port() {
    let receive = (_event: { data: unknown }) => {}
    const messages: unknown[] = []
    const value = {
      start() {},
      close() {},
      postMessage(message: unknown) {
        messages.push(message)
      },
      addEventListener(_type: string, listener: typeof receive) {
        receive = listener
      },
    }
    worker.onconnect({ ports: [value] })
    return {
      send(type: string) {
        receive({ data: { type } })
      },
      messages,
    }
  }
  const first = port()
  const second = port()
  first.send('subscribe-admin')
  first.send('subscribe-admin')
  second.send('subscribe-admin')
  expect(sources).toHaveLength(1)
  sources[0]!.onerror!()
  const clears = clear.mock.calls.length
  second.send('unsubscribe-admin')
  expect(clear.mock.calls.length).toBe(clears)
  scheduled[0]!()
  expect(sources).toHaveLength(2)
  sources[1]!.onmessage!({ data: JSON.stringify({ type: 'path-moved', oldPath: 4 }) })
  expect(first.messages).toHaveLength(0)
  sources[1]!.onmessage!({ data: JSON.stringify({ type: 'connected' }) })
  expect(first.messages).toHaveLength(1)
  first.send('disconnect')
  expect(sources[1]!.closed).toBe(true)
  second.send('network-offline')
  second.send('subscribe-admin')
  expect(sources).toHaveLength(2)
  second.send('network-online')
  expect(sources).toHaveLength(3)
  second.send('disconnect')
  expect(sources[2]!.closed).toBe(true)
})

test('client closes its last port and reconnects subscribed tabs after bfcache restoration', async () => {
  const listeners = new Map<string, () => void>()
  const ports: Array<{ sent: string[]; closed: boolean }> = []
  class FakeWorker {
    port = {
      sent: [] as string[],
      closed: false,
      start() {},
      addEventListener() {},
      postMessage(message: { type: string }) {
        this.sent.push(message.type)
      },
      close() {
        this.closed = true
      },
    }
    constructor() {
      ports.push(this.port)
    }
  }
  replaceGlobals({
    SharedWorker: FakeWorker,
    window: {
      addEventListener(type: string, run: () => void) {
        listeners.set(type, run)
      },
      removeEventListener(type: string) {
        listeners.delete(type)
      },
    },
  })
  {
    const { subscribeSseAdmin } = await import(
      `../../src/lib/api/sse-shared-worker-client.ts?client-test=${Date.now()}`
    )
    const first = subscribeSseAdmin(() => {})
    const second = subscribeSseAdmin(() => {})
    expect(ports[0]!.sent).toEqual(['subscribe-admin', 'subscribe-admin'])
    listeners.get('pagehide')!()
    expect(ports[0]!.closed).toBe(true)
    expect(ports[0]!.sent.at(-1)).toBe('disconnect')
    listeners.get('pageshow')!()
    expect(ports[1]!.sent).toEqual(['subscribe-admin', 'subscribe-admin'])
    first()
    expect(ports[1]!.closed).toBe(false)
    second()
    expect(ports[1]!.closed).toBe(true)
    expect(listeners.size).toBe(0)
  }
})

test('stream backoff caps, resets on valid messages, and cancels on disposal', async () => {
  const { createAdminStream } = await import('../../src/lib/api/sse-reconnect')
  const sources: FakeSource[] = []
  class FakeSource {
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    closed = false
    constructor() {
      sources.push(this)
    }
    close() {
      this.closed = true
    }
  }
  replaceGlobals({ EventSource: FakeSource })
  const scheduled = new Map<number, () => void>()
  const delays: number[] = []
  let nextId = 0
  mocks.push(
    spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void, delay: number) => {
      delays.push(delay)
      scheduled.set(++nextId, run)
      return nextId
    }) as typeof setTimeout),
    spyOn(globalThis, 'clearTimeout').mockImplementation(((id: number) => {
      scheduled.delete(id)
    }) as typeof clearTimeout),
  )
  const messages: unknown[] = []
  const stream = createAdminStream((message) => messages.push(message))
  stream.start()
  stream.start()
  expect(sources).toHaveLength(1)
  for (let attempt = 0; attempt < 6; attempt++) {
    const source = sources.at(-1)!
    source.onerror!()
    expect(source.closed).toBe(true)
    expect(source.onmessage).toBeNull()
    const [id, run] = [...scheduled][0]!
    scheduled.delete(id)
    run()
  }
  expect(delays).toEqual([5000, 10000, 20000, 40000, 60000, 60000])
  sources.at(-1)!.onmessage!({ data: JSON.stringify({ type: 'connected' }) })
  expect(stream.connected).toBe(true)
  expect(messages).toHaveLength(1)
  sources.at(-1)!.onerror!()
  expect(stream.connected).toBe(false)
  expect(delays.at(-1)).toBe(5000)
  stream.stop()
  expect(scheduled.size).toBe(0)
  stream.start()
  expect(sources).toHaveLength(8)
  stream.stop()
  expect(sources.at(-1)!.closed).toBe(true)
})

test('fallback suspends hidden tabs and reconnects once on visibility restoration', async () => {
  const sources: FakeSource[] = []
  class FakeSource {
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    closed = false
    constructor() {
      sources.push(this)
    }
    close() {
      this.closed = true
    }
  }
  const listeners = new Set<() => void>()
  const document = {
    hidden: true,
    addEventListener(_type: string, listener: () => void) {
      listeners.add(listener)
    },
    removeEventListener(_type: string, listener: () => void) {
      listeners.delete(listener)
    },
  }
  const visibilityChanged = () => {
    for (const listener of listeners) listener()
  }
  replaceGlobals({ SharedWorker: undefined, EventSource: FakeSource, document })
  const { subscribeSseAdmin } = await import(
    `../../src/lib/api/sse-shared-worker-client.ts?fallback-test=${Date.now()}`
  )
  const unsubscribe = subscribeSseAdmin(() => {})
  expect(sources).toHaveLength(0)
  document.hidden = false
  visibilityChanged()
  expect(sources).toHaveLength(1)
  document.hidden = true
  visibilityChanged()
  expect(sources[0]!.closed).toBe(true)
  document.hidden = false
  visibilityChanged()
  expect(sources).toHaveLength(2)
  unsubscribe()
  visibilityChanged()
  expect(sources).toHaveLength(2)
  expect(sources[1]!.closed).toBe(true)
})
