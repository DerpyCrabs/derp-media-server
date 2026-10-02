import { expect, test } from 'bun:test'
import { Effect, Fiber } from 'effect'
import { createAppDialogs } from '@/lib/ui/app-dialog'

test('interrupting a queued dialog removes it without disturbing the active request', async () => {
  const dialogs = createAppDialogs()
  const first = Effect.runFork(dialogs.confirm({ title: 'First', message: 'one' }))
  const second = Effect.runFork(dialogs.confirm({ title: 'Second', message: 'two' }))
  await Effect.runPromise(Fiber.interrupt(second))
  expect(dialogs.read()?.title).toBe('First')
  dialogs.settle(true)
  expect(await Effect.runPromise(Fiber.join(first))).toBe(true)
  expect(dialogs.read()).toBeNull()
  dialogs.dispose()
})

test('interrupting the active dialog advances the queue', async () => {
  const dialogs = createAppDialogs()
  const first = Effect.runFork(dialogs.alert('one', 'First'))
  const second = Effect.runFork(dialogs.confirm({ title: 'Second', message: 'two' }))
  await Effect.runPromise(Fiber.interrupt(first))
  expect(dialogs.read()?.title).toBe('Second')
  dialogs.settle(false)
  expect(await Effect.runPromise(Fiber.join(second))).toBe(false)
  dialogs.dispose()
})

test('disposing the application settles pending confirmations without approving them', async () => {
  const dialogs = createAppDialogs()
  const first = Effect.runFork(dialogs.confirm({ title: 'First', message: 'one' }))
  const second = Effect.runFork(dialogs.confirm({ title: 'Second', message: 'two' }))
  dialogs.dispose()
  expect(await Effect.runPromise(Fiber.join(first))).toBe(false)
  expect(await Effect.runPromise(Fiber.join(second))).toBe(false)
  expect(await Effect.runPromise(dialogs.confirm({ title: 'Late', message: 'three' }))).toBe(false)
})
