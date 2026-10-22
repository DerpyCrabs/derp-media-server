import { Effect } from 'effect'

export type ThumbnailPriority = 'high' | 'low'

export function createThumbnailLoadQueue() {
  type Job = { priority: () => ThumbnailPriority; start: () => void }
  const pending = new Set<Job>()
  const active = new Set<Job>()
  const refresh = () => {
    while (active.size < 4) {
      const next =
        [...pending].find((job) => job.priority() === 'high') ??
        (![...active].some((job) => job.priority() === 'low')
          ? pending.values().next().value
          : undefined)
      if (!next) break
      pending.delete(next)
      active.add(next)
      next.start()
    }
  }
  const run = <A, E, R>(priority: () => ThumbnailPriority, effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.callback<() => void>((resume) => {
        const release = () => {
          pending.delete(job)
          active.delete(job)
          refresh()
        }
        const job: Job = { priority, start: () => resume(Effect.succeed(release)) }
        pending.add(job)
        refresh()
        return Effect.sync(release)
      }).pipe(Effect.interruptible),
      () => effect,
      (release) => Effect.sync(release),
    )
  return { run, refresh }
}

export const thumbnailLoadQueue = createThumbnailLoadQueue()
