import { Effect, Exit } from 'effect'
import { expect, test } from 'bun:test'
import { createWorkspaceSaveCoordinator } from '@/workspace/shared/workspace-persistence'

test('reentrant save publication queues the latest document behind the active revision', async () => {
  const requests: { state: string; revision: number }[] = []
  const coordinator = createWorkspaceSaveCoordinator<string>({
    save: (pending) =>
      Effect.sync(() => {
        requests.push({ state: pending.state, revision: pending.revision })
        if (pending.state === 'first') {
          coordinator.enqueue({ id: pending.id, state: 'latest', revision: pending.revision })
        }
        return { revision: pending.revision + 1 }
      }),
  })
  coordinator.enqueue({ id: 'workspace', state: 'first', revision: 1 })
  await Effect.runPromise(coordinator.flush('workspace'))
  expect(requests).toEqual([
    { state: 'first', revision: 1 },
    { state: 'latest', revision: 2 },
  ])
})

test('canceling a flush observer preserves accepted saves and drains the latest revision', async () => {
  const { Deferred, Fiber } = await import('effect')
  const release = Deferred.makeUnsafe<void>()
  const started = Deferred.makeUnsafe<void>()
  const requests: string[] = []
  const coordinator = createWorkspaceSaveCoordinator<string>({
    save: (pending) =>
      Effect.gen(function* () {
        requests.push(pending.state)
        if (pending.state === 'first') {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
        }
        return { revision: pending.revision + 1 }
      }),
  })
  coordinator.enqueue({ id: 'a', state: 'first', revision: 0 })
  const observer = Effect.runFork(coordinator.flush('a'))
  await Effect.runPromise(Deferred.await(started))
  await Effect.runPromise(Fiber.interrupt(observer))
  coordinator.enqueue({ id: 'a', state: 'latest', revision: 0 })
  Deferred.doneUnsafe(release, Effect.void)
  await Effect.runPromise(coordinator.close())
  expect(requests).toEqual(['first', 'latest'])
})

test('failed writes keep pending state available for explicit retry', async () => {
  let attempts = 0
  const coordinator = createWorkspaceSaveCoordinator<string>({
    save: () =>
      Effect.suspend(() =>
        ++attempts === 1 ? Effect.fail(new Error('offline')) : Effect.succeed({ revision: 2 }),
      ),
  })
  coordinator.enqueue({ id: 'a', state: 'kept', revision: 1 })
  const failure = await Effect.runPromise(Effect.exit(coordinator.flush('a')))
  expect(Exit.isFailure(failure)).toBe(true)
  expect(coordinator.pending('a')?.state).toBe('kept')
  await Effect.runPromise(coordinator.retry('a'))
  expect(coordinator.pending('a')).toBeNull()
  await Effect.runPromise(coordinator.close())
})

test('workspace operations serialize overlapping ids without blocking unrelated documents', async () => {
  const { Deferred } = await import('effect')
  const { createWorkspaceOperationCoordinator } =
    await import('@/workspace/shared/workspace-persistence')
  const operations = createWorkspaceOperationCoordinator()
  const entered = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const order: string[] = []
  const first = Effect.runPromise(
    operations.run(['b', 'a'], () =>
      Effect.gen(function* () {
        order.push('first')
        yield* Deferred.succeed(entered, undefined)
        yield* Deferred.await(release)
        order.push('first-complete')
      }),
    ),
  )
  await Effect.runPromise(Deferred.await(entered))
  const overlapping = Effect.runPromise(
    operations.run(['a', 'b'], () => Effect.sync(() => order.push('overlapping'))),
  )
  await Effect.runPromise(operations.run('c', () => Effect.sync(() => order.push('independent'))))
  expect(order).toEqual(['first', 'independent'])
  Deferred.doneUnsafe(release, Effect.void)
  await Promise.all([first, overlapping])
  expect(order).toEqual(['first', 'independent', 'first-complete', 'overlapping'])
})
