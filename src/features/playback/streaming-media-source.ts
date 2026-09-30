import { playbackStatusSchema } from './playback-schemas'
import { Effect, Schema, Option, Cause } from 'effect'
import { commandSlot, lifetime } from 'effectweb'
import type { PlaybackMediaElement } from './media-element-host'
import type { PlaybackSource } from './types'

const streamSlot = commandSlot('media-stream')
class StreamResponseError extends Error {}

function waitForEvent(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  names: readonly string[],
) {
  return Effect.callback<void>((resume) => {
    const cleanup = () => {
      for (const name of names) target.removeEventListener(name, finish)
    }
    const finish = () => {
      cleanup()
      resume(Effect.void)
    }
    for (const name of names) target.addEventListener(name, finish)
    return Effect.sync(cleanup)
  })
}

function updateBuffer(buffer: SourceBuffer, action: () => void) {
  return Effect.callback<void, unknown>((resume) => {
    const cleanup = () => {
      buffer.removeEventListener('updateend', finish)
      buffer.removeEventListener('error', fail)
    }
    const finish = () => {
      cleanup()
      resume(Effect.void)
    }
    const fail = () => {
      cleanup()
      resume(Effect.fail(new Error('The browser could not decode the playback stream.')))
    }
    buffer.addEventListener('updateend', finish, { once: true })
    buffer.addEventListener('error', fail, { once: true })
    try {
      action()
    } catch (error) {
      cleanup()
      resume(Effect.fail(error))
    }
    return Effect.sync(cleanup)
  })
}

export function createStreamingMediaSource(
  element: PlaybackMediaElement,
  source: PlaybackSource,
  onBuffer: () => void,
  onError: (message?: string) => void,
) {
  const media = new MediaSource()
  const owner = lifetime()
  const url = URL.createObjectURL(media)
  let finalDuration: number | undefined
  const closed = () => owner.cancel(streamSlot)
  media.addEventListener('sourceclose', closed, { once: true })
  owner.own(() => {
    media.removeEventListener('sourceclose', closed)
    URL.revokeObjectURL(url)
  })
  const read = Effect.gen(function* () {
    yield* waitForEvent(media, ['sourceopen'])
    const buffer = media.addSourceBuffer(source.mimeType!)
    if (source.duration) media.duration = source.duration
    const response = yield* Effect.tryPromise({
      try: (signal) => fetch(source.url, { signal }),
      catch: (error) => error,
    })
    if (!response.ok) {
      const body = yield* Effect.tryPromise({ try: () => response.json(), catch: () => null }).pipe(
        Effect.catch(() => Effect.succeed(null)),
      )
      const result = Option.getOrUndefined(Schema.decodeUnknownOption(playbackStatusSchema)(body))
      return yield* Effect.fail(
        new StreamResponseError(result?.error ?? `Playback request failed (${response.status}).`),
      )
    }
    if (!response.body) return yield* Effect.fail(new Error('The playback stream is empty.'))
    const reader = yield* Effect.acquireRelease(
      Effect.sync(() => response.body!.getReader()),
      (reader) =>
        Effect.tryPromise({ try: () => reader.cancel(), catch: (error) => error }).pipe(
          Effect.ignore,
          Effect.ensuring(Effect.sync(() => reader.releaseLock())),
        ),
    )
    while (true) {
      const ranges = buffer.buffered
      const position = Math.max(element.currentTime, source.initialPosition ?? 0)
      if (ranges.length && ranges.end(ranges.length - 1) - position > 45) {
        yield* waitForEvent(element, ['timeupdate', 'seeking'])
        continue
      }
      if (ranges.length && position - ranges.start(0) > 30)
        yield* updateBuffer(buffer, () => buffer.remove(ranges.start(0), position - 15))
      const { value, done } = yield* Effect.tryPromise({
        try: () => reader.read(),
        catch: (error) => error,
      })
      if (done) break
      yield* updateBuffer(buffer, () => buffer.appendBuffer(value))
      onBuffer()
    }
    if (media.readyState === 'open') {
      media.endOfStream()
      if (Number.isFinite(media.duration)) finalDuration = media.duration
      onBuffer()
    }
    return undefined
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.void
      const error = Cause.squash(cause)
      return Effect.sync(() =>
        onError(error instanceof StreamResponseError ? error.message : undefined),
      )
    }),
  )
  owner.run(streamSlot, read, 'replace')
  return {
    url,
    get duration() {
      return finalDuration
    },
    dispose: owner.dispose,
    close: owner.close,
  }
}
