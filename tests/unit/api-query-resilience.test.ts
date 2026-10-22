import { afterEach, expect, test } from 'bun:test'
import { Effect, Fiber, Schema } from 'effect'
import { apiEffect, apiSchemaEffect, postEffect } from '@/lib/api/client'
import { invalidateAllQueries, queryCache } from '@/lib/api/cache'
import { configQuery } from '@/lib/api/queries'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  queryCache.resetResources()
})

function mockFetch(respond: () => Response | Promise<Response>) {
  globalThis.fetch = respond as unknown as typeof fetch
}

test('retries transient reads and returns recovered data', async () => {
  let attempts = 0
  mockFetch(() => {
    attempts++
    if (attempts === 1) throw new TypeError('offline')
    if (attempts === 2) return new Response('{}', { status: 503 })
    return Response.json({ ok: true })
  })
  expect(await Effect.runPromise(apiEffect('/test'))).toEqual({ ok: true })
  expect(attempts).toBe(3)
})

test('bounds retries to three after the initial attempt', async () => {
  let attempts = 0
  mockFetch(() => {
    attempts++
    return new Response('{}', { status: 503 })
  })
  expect((await Effect.runPromiseExit(apiEffect('/test')))._tag).toBe('Failure')
  expect(attempts).toBe(4)
})

test('does not retry permanent errors, decoding failures, or writes', async () => {
  for (const status of [400, 401, 403, 404, 409]) {
    let attempts = 0
    mockFetch(() => {
      attempts++
      return new Response('{}', { status })
    })
    expect((await Effect.runPromiseExit(apiEffect('/test')))._tag).toBe('Failure')
    expect(attempts).toBe(1)
  }
  let attempts = 0
  mockFetch(() => {
    attempts++
    return Response.json({ wrong: true })
  })
  expect((await Effect.runPromiseExit(apiSchemaEffect(Schema.String, '/test')))._tag).toBe(
    'Failure',
  )
  expect(attempts).toBe(1)
  attempts = 0
  mockFetch(() => {
    attempts++
    return new Response('{}', { status: 503 })
  })
  expect((await Effect.runPromiseExit(postEffect('/test', {})))._tag).toBe('Failure')
  expect(attempts).toBe(1)
})

test('cancellation interrupts retry backoff', async () => {
  let attempts = 0
  mockFetch(() => {
    attempts++
    return new Response('{}', { status: 503 })
  })
  const fiber = Effect.runFork(apiEffect('/test'))
  await new Promise((resolve) => setTimeout(resolve, 20))
  await Effect.runPromise(Fiber.interrupt(fiber))
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(attempts).toBe(1)
})

test('reconnect and full resync invalidate server configuration', async () => {
  let attempts = 0
  mockFetch(() => {
    attempts++
    return Response.json({ editableFolders: ['/new'], mediaRoots: [] })
  })
  for (const preserveRecommendations of [true, false]) {
    queryCache.setQueryData(configQuery, true, { editableFolders: ['/old'], mediaRoots: [] })
    invalidateAllQueries({ preserveRecommendations })
    const result = await Effect.runPromise(queryCache.prefetch(configQuery, true))
    expect(result.editableFolders).toEqual(['/new'])
  }
  expect(attempts).toBe(2)
})
