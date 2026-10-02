import { Effect, Schema } from 'effect'
import { apiSchemaEffect } from '@/lib/api/client'

export function speakHermesText(text: string) {
  return Effect.scoped(
    Effect.gen(function* () {
      const payload = yield* apiSchemaEffect(
        Schema.Struct({ data_url: Schema.String }),
        '/api/hermes/speak',
        { method: 'POST', body: JSON.stringify({ text }) },
      )
      const audio = yield* Effect.acquireRelease(
        Effect.sync(() => new Audio(payload.data_url)),
        (audio) =>
          Effect.sync(() => {
            audio.onended = null
            audio.onerror = null
            audio.pause()
            audio.removeAttribute('src')
            audio.load()
          }),
      )
      yield* Effect.callback<void, Error>((resume) => {
        audio.onended = () => resume(Effect.void)
        audio.onerror = () =>
          resume(Effect.fail(new Error(audio.error?.message || 'Reply audio failed')))
        void audio
          .play()
          .catch((error: unknown) =>
            resume(Effect.fail(error instanceof Error ? error : new Error(String(error)))),
          )
      })
    }),
  )
}
