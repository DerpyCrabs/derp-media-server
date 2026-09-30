import { describe, expect, test } from 'bun:test'
import { Effect, Fiber } from 'effect'
import { appDialogRequest, settleAppDialog, showAppConfirmEffect } from '@/lib/ui/app-dialog'

describe('app dialog queue', () => {
  test('keeps a dialog enqueued by the previous dialog continuation active', async () => {
    const continuation = Effect.runFork(
      Effect.gen(function* () {
        yield* showAppConfirmEffect({ title: 'First', message: 'First message' })
        return yield* showAppConfirmEffect({ title: 'Second', message: 'Second message' })
      }),
    )
    settleAppDialog(true)
    expect(appDialogRequest()?.title).toBe('Second')
    settleAppDialog(false)
    expect(await Effect.runPromise(Fiber.join(continuation))).toBe(false)
  })
})
