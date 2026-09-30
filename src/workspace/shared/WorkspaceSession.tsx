import { commandSlot, lifetime } from 'effectweb'
import { Deferred, Effect } from 'effect'
import { applyWorkspacePathMutation } from '@/workspace/model/workspace-path-mutation'
import { subscribeSseAdmin } from '@/lib/api/sse-shared-worker-client'
import { parsePathMutation } from '@/lib/files/path-mutation'
import { createWorkspaceRegistry } from './workspace-registry'

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>

export function createWorkspaceSession(workspaceId: () => string) {
  const blockers = new Set<() => boolean>()
  const owner = lifetime()
  const refreshSlot = commandSlot('workspace-remote-change')
  const waiters = new Set<Deferred.Deferred<void>>()
  const savingBlocked = () => [...blockers].some((blocked) => blocked())
  const registry = createWorkspaceRegistry({
    workspaceId,
    savingBlocked,
    waitUntilSavingUnblocked: () =>
      Effect.suspend(() => {
        if (!savingBlocked()) return Effect.void
        const waiter = Deferred.makeUnsafe<void>()
        waiters.add(waiter)
        return Deferred.await(waiter).pipe(
          Effect.ensuring(Effect.sync(() => waiters.delete(waiter))),
        )
      }),
  })
  const savingBlockChanged = () => {
    registry.savingBlockChanged()
    if (savingBlocked()) return
    for (const waiter of waiters) Deferred.doneUnsafe(waiter, Effect.void)
    waiters.clear()
  }
  const unsubscribe = subscribeSseAdmin((event) => {
    const mutation = parsePathMutation(event)
    if (mutation) {
      const current = registry.document.value()
      if (current) registry.document.replace(applyWorkspacePathMutation(current, mutation))
    }
    if (
      mutation ||
      ['connected', 'resync-required', 'workspaces-changed'].includes(event.type ?? '')
    ) {
      owner.run(refreshSlot, registry.catalog.reconcileRemoteChange(), 'latest-queued')
    }
  })
  registry.start()
  return {
    ...registry,
    savingBlockChanged,
    registerSavingBlocker(blocked: () => boolean) {
      blockers.add(blocked)
      return () => {
        blockers.delete(blocked)
        savingBlockChanged()
      }
    },
    close: () =>
      Effect.sync(() => {
        unsubscribe()
        blockers.clear()
        for (const waiter of waiters) Deferred.doneUnsafe(waiter, Effect.void)
        waiters.clear()
      }).pipe(Effect.andThen(registry.close()), Effect.ensuring(owner.close().pipe(Effect.orDie))),
    dispose() {
      unsubscribe()
      owner.dispose()
      registry.dispose()
      for (const waiter of waiters) Deferred.doneUnsafe(waiter, Effect.void)
      waiters.clear()
    },
  }
}
