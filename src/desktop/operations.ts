import { Effect } from 'effect'
import { commandSlot, lifetime } from 'effectweb'

export const desktopOperations = lifetime()
const operationSlot = commandSlot('desktop-operation')

export function runDesktopOperation(operation: () => Promise<unknown>) {
  const publish = (detail: { pending: boolean; error?: string }) =>
    Effect.sync(() => window.dispatchEvent(new CustomEvent('desktop-operation', { detail })))
  desktopOperations.run(
    operationSlot,
    Effect.gen(function* () {
      yield* publish({ pending: true })
      yield* Effect.tryPromise({ try: operation, catch: (cause) => cause }).pipe(
        Effect.matchEffect({
          onSuccess: () => publish({ pending: false }),
          onFailure: (error) =>
            publish({
              pending: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        }),
      )
    }),
    'parallel',
  )
}
