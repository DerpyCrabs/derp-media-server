import { Effect, Schedule, Schema } from 'effect'
import { sseEventSchema, type SseEventPayload } from './sse-protocol'

export function createAdminStream(onData: (data: SseEventPayload) => void) {
  let interrupt: (() => void) | undefined
  let connected = false

  const stream = Effect.suspend(() => {
    let retryCount = 0
    const connection = Effect.acquireUseRelease(
      Effect.sync(() => new EventSource('/api/events/stream')),
      (source) =>
        Effect.callback<never, 'Disconnected'>((resume) => {
          source.onmessage = (event) => {
            try {
              const decoded = Schema.decodeUnknownExit(sseEventSchema)(JSON.parse(event.data))
              if (decoded._tag === 'Failure') return
              retryCount = 0
              if (decoded.value.type === 'connected') connected = true
              onData(decoded.value)
            } catch {
              // Ignore malformed events and listener failures.
            }
          }
          source.onerror = () => resume(Effect.fail('Disconnected'))
        }),
      (source) =>
        Effect.sync(() => {
          connected = false
          source.onmessage = null
          source.onerror = null
          source.close()
        }),
    )
    return Effect.retry(connection, {
      schedule: Schedule.forever.pipe(
        Schedule.modifyDelay(() => Effect.sync(() => Math.min(5000 * 2 ** retryCount++, 60000))),
      ),
    })
  })

  return {
    get connected() {
      return connected
    },
    start() {
      interrupt ??= Effect.runCallback(stream)
    },
    stop() {
      interrupt?.()
      interrupt = undefined
    },
  }
}
