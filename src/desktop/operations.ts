import { Effect } from 'effect'
import { modelOwner } from 'effectweb'

type Operation = () => Promise<unknown>
function createDesktopOperations(target: Window) {
  const owner = modelOwner({})
  let pending = 0
  let error: string | undefined
  let disposed = false
  const publish = () => {
    if (disposed) return
    const event = target.document.createEvent('CustomEvent')
    event.initCustomEvent('desktop-operation', false, false, { pending: pending > 0, error })
    target.dispatchEvent(event)
  }
  return {
    run(this: void, operation: Operation) {
      if (disposed) return
      void owner.run(
        'desktop-operation',
        Effect.gen(function* () {
          pending++
          error = undefined
          publish()
          yield* Effect.tryPromise({ try: operation, catch: (cause) => cause }).pipe(
            Effect.catch((cause) =>
              Effect.sync(() => {
                error = cause instanceof Error ? cause.message : String(cause)
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                pending--
                publish()
              }),
            ),
          )
        }),
        'parallel',
      )
    },
    awaitIdle: () => owner.awaitIdle(),
    dispose() {
      if (disposed) return
      disposed = true
      owner.dispose()
    },
  }
}

const windows = new WeakMap<
  Window,
  { operations: ReturnType<typeof createDesktopOperations>; references: number }
>()

export function acquireDesktopOperations(target: Window) {
  let entry = windows.get(target)
  if (!entry) {
    entry = { operations: createDesktopOperations(target), references: 0 }
    windows.set(target, entry)
  }
  entry.references++
  const owned = entry
  let released = false
  return {
    run(this: void, operation: Operation) {
      if (!released) owned.operations.run(operation)
    },
    awaitIdle: entry.operations.awaitIdle,
    dispose() {
      if (released) return
      released = true
      if (--owned.references === 0) {
        windows.delete(target)
        owned.operations.dispose()
      }
    },
  }
}

export function createDesktopOperationsLifetime() {
  return acquireDesktopOperations(window)
}

export function runDesktopOperation(operation: Operation, target: Window = window) {
  const entry = windows.get(target)
  if (!entry) throw new Error('Desktop operations require an active window lifetime')
  entry.operations.run(operation)
}
