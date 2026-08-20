import { describe, expect, test } from 'bun:test'
import { handleAdminEvent } from '../../src/lib/api/use-admin-events-stream'

describe('admin event routing', () => {
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
    const invalidated: unknown[][] = []

    handleAdminEvent(
      { type: 'path-moved', oldPath: 'Old', newPath: 'New' },
      { invalidate: (key) => invalidated.push([...key]) },
    )

    expect(invalidated).toEqual([['files'], ['content', 'admin'], ['settings'], ['stats']])
  })

  test('invalidates stats on a stats event', () => {
    const invalidated: unknown[][] = []
    handleAdminEvent({ type: 'stats-changed' }, { invalidate: (key) => invalidated.push([...key]) })
    expect(invalidated).toEqual([['stats']])
  })
})
