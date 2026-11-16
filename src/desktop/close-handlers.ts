import { Effect } from 'effect'

export class DesktopCloseCancelled extends Error {}

type Handler = () => Effect.Effect<void, unknown>
const windows = new WeakMap<Window, Set<Handler>>()

export function registerDesktopCloseHandler(handler: Handler, target: Window = window) {
  if (!target.derpDesktop) return undefined
  let handlers = windows.get(target)
  if (!handlers) {
    handlers = new Set()
    windows.set(target, handlers)
  }
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
    if (handlers.size === 0 && windows.get(target) === handlers) windows.delete(target)
  }
}

export function flushDesktopClose(target: Window = window) {
  return Effect.suspend(() =>
    Effect.all(
      [...(windows.get(target) ?? [])].map((handler) => Effect.suspend(handler)),
      { concurrency: 'unbounded', discard: true },
    ),
  )
}
