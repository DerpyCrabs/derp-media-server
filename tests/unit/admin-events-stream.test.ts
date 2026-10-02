import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { modelOwner } from 'effectweb'
import { groups } from '@/lib/api/cache'
import {
  createAdminEventInvalidationGuard,
  handleAdminEvent,
} from '../../src/lib/api/admin-events-stream'
import { queryCache, observeQuery, query } from '@effectweb/query'

describe('admin event routing', () => {
  test('invalidates shared query state once when several subscribers receive one event', () => {
    const claim = createAdminEventInvalidationGuard()
    const event = { type: 'connected' }

    expect(claim(event)).toBe(true)
    expect(claim(event)).toBe(false)
    expect(claim({ type: 'connected' })).toBe(true)
  })

  test('refreshes workspace registry on workspace changes', () => {
    let refreshes = 0
    handleAdminEvent(
      { type: 'workspaces-changed' },
      {
        invalidate: () => undefined,
        onWorkspacesChanged: () => {
          refreshes += 1
        },
      },
    )

    expect(refreshes).toBe(1)
  })

  test('refreshes workspace registry when the event stream reconnects', () => {
    let refreshes = 0
    let fullInvalidations = 0
    handleAdminEvent(
      { type: 'connected' },
      {
        invalidate: () => undefined,
        onWorkspacesChanged: () => {
          refreshes += 1
        },
        invalidateAll: () => {
          fullInvalidations += 1
        },
      },
    )

    expect(refreshes).toBe(1)
    expect(fullInvalidations).toBe(1)
  })

  test('fully resynchronizes every query domain after server-side event loss', () => {
    let refreshes = 0
    let fullInvalidations = 0
    handleAdminEvent(
      { type: 'resync-required' },
      {
        invalidate: () => undefined,
        invalidateAll: () => {
          fullInvalidations += 1
        },
        onWorkspacesChanged: () => {
          refreshes += 1
        },
      },
    )

    expect(fullInvalidations).toBe(1)
    expect(refreshes).toBe(1)
  })

  test('invalidates files, content, settings, and stats after path mutations', () => {
    const invalidated: string[] = []

    handleAdminEvent(
      { type: 'path-moved', oldPath: 'Old', newPath: 'New' },
      { invalidate: (key) => invalidated.push(key) },
    )

    expect(invalidated).toEqual(['files', 'content', 'playback', 'settings', 'stats'])
  })

  test('invalidates stats on a stats event', () => {
    const invalidated: string[] = []
    handleAdminEvent({ type: 'stats-changed' }, { invalidate: (key) => invalidated.push(key) })
    expect(invalidated).toEqual(['stats'])
  })
})

test('book recommendation events refetch an observed infinitely fresh recommendation query', async () => {
  const cache = queryCache()
  const owner = modelOwner({})
  let loads = 0
  const feed = query({
    name: 'test-book-feed',
    groups: [groups.recommendations],
    staleTime: Infinity,
    load: () => Effect.sync(() => ++loads),
  })
  const observer = observeQuery(owner, cache, feed, () => {})
  try {
    observer.select(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loads).toBe(1)
    handleAdminEvent(
      { type: 'book-recommendations-changed' },
      { invalidate: (domain) => cache.invalidateGroup(groups[domain]) },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(loads).toBe(2)
  } finally {
    await Effect.runPromise(owner.close())
    await Effect.runPromise(cache.close())
  }
})
