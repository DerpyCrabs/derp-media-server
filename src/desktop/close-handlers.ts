import { Effect } from 'effect'

const handlers = new Set<() => Effect.Effect<void, unknown>>()

export function registerDesktopCloseHandler(handler: () => Effect.Effect<void, unknown>) {
  if (!window.derpDesktop) return undefined
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function flushDesktopClose() {
  return Effect.suspend(() =>
    Effect.all(
      [...handlers].map((handler) => Effect.suspend(handler)),
      { concurrency: 'unbounded', discard: true },
    ),
  )
}
