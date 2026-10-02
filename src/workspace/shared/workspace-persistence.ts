import { Deferred, Effect, Exit, Semaphore } from 'effect'
import { modelOwner } from 'effectweb'

export type PendingWorkspaceSave<T> = { id: string; state: T; revision: number }
export type WorkspaceSaveResult = { revision?: number }
export type WorkspaceSaveCoordinator<T> = {
  enqueue: (pending: PendingWorkspaceSave<T>) => void
  flush: (pendingOrId: PendingWorkspaceSave<T> | string) => Effect.Effect<void, unknown>
  retry: (id: string) => Effect.Effect<void, unknown>
  pending: (id: string) => PendingWorkspaceSave<T> | null
  clear: (id: string) => void
  close: () => Effect.Effect<void, unknown>
  dispose: () => void
}
export type WorkspaceOperationCoordinator = {
  run: <A, E>(
    ids: string | readonly string[],
    operation: () => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>
}

export function createWorkspaceOperationCoordinator(): WorkspaceOperationCoordinator {
  const locks = new Map<string, { gate: Semaphore.Semaphore; users: number }>()
  return {
    run: (ids, operation) =>
      Effect.suspend(() => {
        const keys = [...new Set(typeof ids === 'string' ? [ids] : ids)].filter(Boolean).sort()
        const entries = keys.map((id) => {
          const entry = locks.get(id) ?? { gate: Semaphore.makeUnsafe(1), users: 0 }
          entry.users++
          locks.set(id, entry)
          return { id, entry }
        })
        const locked = entries.reduceRight(
          (work, { entry }) => entry.gate.withPermits(1)(work),
          Effect.suspend(operation),
        )
        return locked.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              for (const { id, entry } of entries) if (--entry.users === 0) locks.delete(id)
            }),
          ),
        )
      }),
  }
}

type Queue<T> = {
  pending: PendingWorkspaceSave<T> | null
  active: PendingWorkspaceSave<T> | null
  completion: Deferred.Deferred<void, unknown> | null
  failure: Exit.Exit<void, unknown> | null
}

export function createWorkspaceSaveCoordinator<T>(options: {
  save: (pending: PendingWorkspaceSave<T>) => Effect.Effect<WorkspaceSaveResult, unknown>
}): WorkspaceSaveCoordinator<T> {
  const scope = modelOwner({})
  const queues = new Map<string, Queue<T>>()
  function queueFor(id: string) {
    let queue = queues.get(id)
    if (!queue) {
      queue = { pending: null, active: null, completion: null, failure: null }
      queues.set(id, queue)
    }
    return queue
  }
  function start(id: string) {
    const queue = queues.get(id)
    if (!queue || queue.completion || queue.failure || !queue.pending) return
    const completion = Deferred.makeUnsafe<void, unknown>()
    queue.completion = completion
    void scope.run(
      ['workspace-save', id],
      Effect.gen(function* () {
        yield* Effect.yieldNow
        while (queue.pending) {
          const pending = queue.pending
          queue.pending = null
          queue.active = pending
          const result = yield* Effect.exit(Effect.suspend(() => options.save(pending)))
          queue.active = null
          if (Exit.isFailure(result)) {
            if (!queue.pending) queue.pending = pending
            queue.failure = result
            queue.completion = null
            yield* Deferred.done(completion, result)
            return
          }
          const next = queues.get(id)?.pending
          if (next && result.value.revision != null) {
            queue.pending = { ...next, revision: result.value.revision }
          }
        }
        queue.completion = null
        queues.delete(id)
        yield* Deferred.succeed(completion, undefined)
      }),
      'drop',
    )
  }
  function enqueue(pending: PendingWorkspaceSave<T>) {
    queueFor(pending.id).pending = pending
    start(pending.id)
  }
  const waitForIdle = (id: string): Effect.Effect<void, unknown> =>
    Effect.suspend(() => {
      const queue = queues.get(id)
      if (!queue) return Effect.void
      if (queue.failure && Exit.isFailure(queue.failure))
        return Effect.failCause(queue.failure.cause)
      start(id)
      return queue.completion
        ? Deferred.await(queue.completion).pipe(Effect.andThen(waitForIdle(id)))
        : Effect.void
    })
  return {
    enqueue,
    flush: (pendingOrId) =>
      Effect.suspend(() => {
        if (typeof pendingOrId !== 'string') enqueue(pendingOrId)
        return waitForIdle(typeof pendingOrId === 'string' ? pendingOrId : pendingOrId.id)
      }),
    retry: (id) =>
      Effect.suspend(() => {
        const queue = queues.get(id)
        if (queue) queue.failure = null
        return waitForIdle(id)
      }),
    pending: (id) => queues.get(id)?.pending ?? queues.get(id)?.active ?? null,
    clear: (id) => {
      const queue = queues.get(id)
      if (queue?.completion) queue.pending = null
      else queues.delete(id)
    },
    dispose: scope.dispose,
    close: () =>
      Effect.suspend(() =>
        Effect.forEach([...queues.keys()], waitForIdle, {
          concurrency: 'unbounded',
          discard: true,
        }),
      ).pipe(Effect.ensuring(scope.close().pipe(Effect.orDie)), Effect.uninterruptible),
  }
}
