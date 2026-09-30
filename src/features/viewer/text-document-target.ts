import { Effect, Semaphore } from 'effect'

export type TextDocumentTarget = { kind: 'admin'; viewingPath: string }
const saves = new Map<string, { gate: Semaphore.Semaphore; users: number }>()
export function createTextDocumentTarget(viewingPath: string): TextDocumentTarget {
  return { kind: 'admin', viewingPath }
}
export function textDocumentTargetKey(target: TextDocumentTarget): string {
  return JSON.stringify(['admin', target.viewingPath])
}
export function enqueueTextDocumentSave<A, E, R>(
  target: TextDocumentTarget,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const key = textDocumentTargetKey(target)
    const entry = saves.get(key) ?? { gate: Semaphore.makeUnsafe(1), users: 0 }
    saves.set(key, entry)
    entry.users++
    return entry.gate
      .withPermits(1)(work)
      .pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (--entry.users === 0) saves.delete(key)
          }),
        ),
      )
  })
}
