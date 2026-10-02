import { afterEach, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { createStreamingMediaSource } from '@/features/playback/streaming-media-source'
import type { PlaybackMediaElement } from '@/features/playback/media-element-host'

class Target {
  listeners = new Map<string, Set<() => void>>()
  addEventListener(name: string, run: () => void) {
    const group = this.listeners.get(name) ?? new Set()
    group.add(run)
    this.listeners.set(name, group)
  }
  removeEventListener(name: string, run: () => void) {
    this.listeners.get(name)?.delete(run)
  }
  emit(name: string) {
    for (const run of [...(this.listeners.get(name) ?? [])]) run()
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((n, group) => n + group.size, 0)
  }
}
class FakeBuffer extends Target {
  buffered = { length: 0, start: () => 0, end: () => 0 }
  appended = 0
  appendBuffer() {
    this.appended++
  }
  remove() {}
}
class FakeSource extends Target {
  static instances: FakeSource[] = []
  buffer = new FakeBuffer()
  readyState = 'open'
  duration = 12
  constructor() {
    super()
    FakeSource.instances.push(this)
  }
  addSourceBuffer() {
    return this.buffer
  }
  endOfStream() {
    this.readyState = 'ended'
  }
}
const restores: Array<() => void> = []
function replace(object: object, key: string, value: unknown) {
  const old = Object.getOwnPropertyDescriptor(object, key)
  Object.defineProperty(object, key, { configurable: true, writable: true, value })
  restores.push(() => {
    if (old) Object.defineProperty(object, key, old)
    else Reflect.deleteProperty(object, key)
  })
}
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
  FakeSource.instances = []
})
function setup() {
  replace(globalThis, 'MediaSource', FakeSource)
  const revoked: string[] = []
  replace(URL, 'createObjectURL', () => 'blob:test')
  replace(URL, 'revokeObjectURL', (url: string) => revoked.push(url))
  const element = Object.assign(new Target(), { currentTime: 0 })
  const errors: Array<string | undefined> = []
  const source = createStreamingMediaSource(
    element as unknown as PlaybackMediaElement,
    { generation: 1, url: '/stream', mimeType: 'audio/webm', streaming: true },
    () => {},
    (error) => errors.push(error),
  )
  return { source, media: FakeSource.instances.at(-1)!, revoked, errors, element }
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

test('disposing before source open removes listeners and never starts the request', () => {
  let fetches = 0
  replace(globalThis, 'fetch', () => {
    fetches++
    return Promise.resolve(new Response())
  })
  const { source, media, revoked, errors } = setup()
  source.dispose()
  media.emit('sourceopen')
  expect(fetches).toBe(0)
  expect(media.listenerCount).toBe(0)
  expect(revoked).toEqual(['blob:test'])
  expect(errors).toEqual([])
})

test('disposing an outstanding fetch aborts the native request without showing an error', async () => {
  let signal!: AbortSignal
  replace(globalThis, 'fetch', (_url: string, options: RequestInit) => {
    signal = options.signal!
    return new Promise<Response>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason)),
    )
  })
  const { source, media, errors } = setup()
  media.emit('sourceopen')
  expect(signal.aborted).toBe(false)
  await Effect.runPromise(source.close())
  expect(signal.aborted).toBe(true)
  expect(errors).toEqual([])
})

test('closing while SourceBuffer is updating removes listeners and releases the reader', async () => {
  let cancelled = 0
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]))
    },
    cancel() {
      cancelled++
    },
  })
  replace(globalThis, 'fetch', () => Promise.resolve(new Response(body)))
  const { source, media, errors } = setup()
  media.emit('sourceopen')
  await flush()
  expect(media.buffer.appended).toBe(1)
  expect(media.buffer.listenerCount).toBe(2)
  await Effect.runPromise(source.close())
  expect(cancelled).toBe(1)
  expect(body.locked).toBe(false)
  expect(media.buffer.listenerCount).toBe(0)
  expect(errors).toEqual([])
})

test('successful stream completion finalizes its reader and captures media duration', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
  replace(globalThis, 'fetch', () => Promise.resolve(new Response(body)))
  const { source, media, errors } = setup()
  media.emit('sourceopen')
  await flush()
  expect(media.readyState).toBe('ended')
  expect(source.duration).toBe(12)
  expect(body.locked).toBe(false)
  expect(errors).toEqual([])
  await Effect.runPromise(source.close())
})

test('transport failures defer to playback status instead of hiding the server failure', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('network error'))
    },
  })
  replace(globalThis, 'fetch', () => Promise.resolve(new Response(body)))
  const { source, media, errors } = setup()
  media.emit('sourceopen')
  await flush()
  expect(errors).toEqual([undefined])
  expect(body.locked).toBe(false)
  await Effect.runPromise(source.close())
})

test('a decoded HTTP error preserves the exact server message', async () => {
  replace(globalThis, 'fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'Playback cache limit reached' }), { status: 503 }),
    ),
  )
  const { source, media, errors } = setup()
  media.emit('sourceopen')
  await flush()
  expect(errors).toEqual(['Playback cache limit reached'])
  await Effect.runPromise(source.close())
})
