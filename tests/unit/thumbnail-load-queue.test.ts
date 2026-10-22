import { expect, test } from 'bun:test'
import { Effect, Fiber } from 'effect'
import { createThumbnailLoadQueue, type ThumbnailPriority } from '@/lib/media/thumbnail-load-queue'

test('visible thumbnails jump ahead of preloads and keep reserved capacity', async () => {
  const queue = createThumbnailLoadQueue()
  const started: string[] = []
  const enqueue = (name: string, priority: () => ThumbnailPriority) =>
    Effect.runFork(
      queue.run(priority, Effect.sync(() => started.push(name)).pipe(Effect.andThen(Effect.never))),
    )
  const fibers = [enqueue('preload', () => 'low'), enqueue('waiting preload', () => 'low')]
  expect(started).toEqual(['preload'])
  fibers.push(
    enqueue('visible 1', () => 'high'),
    enqueue('visible 2', () => 'high'),
    enqueue('visible 3', () => 'high'),
    enqueue('visible 4', () => 'high'),
  )
  expect(started).toEqual(['preload', 'visible 1', 'visible 2', 'visible 3'])
  await Effect.runPromise(Fiber.interrupt(fibers[0]!))
  expect(started.at(-1)).toBe('visible 4')
  await Effect.runPromise(Fiber.interrupt(fibers[2]!))
  expect(started.at(-1)).toBe('waiting preload')
  for (const fiber of fibers) await Effect.runPromise(Fiber.interrupt(fiber))
})

test('pending preloads can be cancelled or promoted when scrolled into view', async () => {
  const queue = createThumbnailLoadQueue()
  const started: string[] = []
  let priority: ThumbnailPriority = 'low'
  const enqueue = (name: string, getPriority: () => ThumbnailPriority) =>
    Effect.runFork(
      queue.run(
        getPriority,
        Effect.sync(() => started.push(name)).pipe(Effect.andThen(Effect.never)),
      ),
    )
  const active = enqueue('active', () => 'low')
  const cancelled = enqueue('cancelled', () => 'low')
  const promoted = enqueue('promoted', () => priority)
  await Effect.runPromise(Fiber.interrupt(cancelled))
  priority = 'high'
  queue.refresh()
  expect(started).toEqual(['active', 'promoted'])
  await Effect.runPromise(Fiber.interrupt(active))
  await Effect.runPromise(Fiber.interrupt(promoted))
  expect(started).not.toContain('cancelled')
})
