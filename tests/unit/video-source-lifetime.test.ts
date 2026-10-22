import { Effect, Fiber } from 'effect'
import { expect, test } from 'bun:test'
import { queryCache } from '@/lib/api/cache'
import { modelOwner } from 'effectweb'
import { resolveVideoSource, videoInfoQuery } from '@/features/playback/video-source'
import { observeQuery } from '@effectweb/query'

test('canceling playback source resolution interrupts both metadata requests', async () => {
  const originalFetch = globalThis.fetch
  const signals: AbortSignal[] = []
  globalThis.fetch = ((_: unknown, options: RequestInit) => {
    const signal = options.signal!
    signals.push(signal)
    return new Promise<Response>((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    )
  }) as typeof fetch
  try {
    const loading = Effect.runFork(
      resolveVideoSource({
        item: { locator: 'cancel-source.mp4', name: 'cancel-source.mp4', media: 'video' },
        mode: 'video',
        reason: 'load',
      }),
    )
    await Promise.resolve()
    expect(signals).toHaveLength(2)
    await Effect.runPromise(Fiber.interrupt(loading))
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('canceling a resolver preserves metadata still observed by video controls', async () => {
  const originalFetch = globalThis.fetch
  const owner = modelOwner({})
  const signals: AbortSignal[] = []
  globalThis.fetch = ((_: unknown, options: RequestInit) => {
    const signal = options.signal!
    signals.push(signal)
    return new Promise<Response>((_, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    )
  }) as typeof fetch
  try {
    const observer = observeQuery(owner, queryCache, videoInfoQuery, () => {})
    observer.select('shared-source.mp4')
    const loading = Effect.runFork(
      resolveVideoSource({
        item: { locator: 'shared-source.mp4', name: 'shared-source.mp4', media: 'video' },
        mode: 'video',
        reason: 'load',
      }),
    )
    await Promise.resolve()
    expect(signals).toHaveLength(2)
    await Effect.runPromise(Fiber.interrupt(loading))
    expect(signals[0]!.aborted).toBe(false)
    expect(signals[1]!.aborted).toBe(true)
    owner.dispose()
    expect(signals[0]!.aborted).toBe(true)
  } finally {
    owner.dispose()
    globalThis.fetch = originalFetch
  }
})
