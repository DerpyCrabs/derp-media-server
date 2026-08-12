import { describe, expect, test } from 'bun:test'
import {
  RECENT_OWNER_LOCATIONS_KEY,
  readRecentOwnerLocations,
  recentLocationFromUrl,
  recordRecentOwnerLocation,
} from '../../src/lib/recent-owner-locations'

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(RECENT_OWNER_LOCATIONS_KEY, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('recent owner locations', () => {
  test('quarantines corrupt, unsafe, and retired Canvas records', () => {
    const storage = memoryStorage(
      JSON.stringify([
        { kind: 'library', href: '//evil.test', label: 'bad', visitedAt: 3 },
        { kind: 'library', href: '/\\evil.test', label: 'backslash', visitedAt: 4 },
        { kind: 'library', href: '/library\u0000', label: 'control', visitedAt: 5 },
        { kind: 'canvas', href: '/canvas', label: 'Canvas', visitedAt: 2 },
        { kind: 'space', href: '/spaces/id/~desk/tiled', label: 'Desk', visitedAt: 6 },
        null,
      ]),
    )
    expect(readRecentOwnerLocations(storage)).toEqual([
      { kind: 'space', href: '/spaces/id/~desk/tiled', label: 'Desk', visitedAt: 6 },
    ])
  })

  test('keeps saved Workspace recents through their Space transition route', () => {
    const storage = memoryStorage(
      JSON.stringify([
        {
          kind: 'workspace',
          href: '/workspace?ws=saved-desk',
          label: 'Workspace saved-desk',
          visitedAt: 9,
        },
        { kind: 'workspace', href: '/workspace', label: 'Workspace', visitedAt: 8 },
      ]),
    )
    expect(readRecentOwnerLocations(storage)).toEqual([
      {
        kind: 'space',
        href: '/workspace?ws=saved-desk',
        label: 'Space saved-desk',
        visitedAt: 9,
      },
    ])
  })

  test('deduplicates, orders, and caps records', () => {
    const storage = memoryStorage()
    for (let index = 0; index < 14; index += 1) {
      recordRecentOwnerLocation(
        storage,
        { kind: 'library', href: `/library?dir=${index}`, label: String(index) },
        index,
      )
    }
    recordRecentOwnerLocation(
      storage,
      { kind: 'library', href: '/library?dir=7', label: 'Newest' },
      20,
    )
    const records = readRecentOwnerLocations(storage)
    expect(records).toHaveLength(12)
    expect(records[0]?.label).toBe('Newest')
    expect(records.filter((item) => item.href.endsWith('=7'))).toHaveLength(1)
  })

  test('adapts legacy path and strips viewer/player state', () => {
    expect(
      recentLocationFromUrl(
        new URL('https://desk.test/?path=Documents/Books&viewing=Documents/Books/a.pdf'),
      ),
    ).toEqual({
      kind: 'library',
      href: '/library?dir=Documents%2FBooks',
      label: 'Books',
    })
  })

  test('records canonical Space presentations and only saved Workspace transitions', () => {
    expect(
      recentLocationFromUrl(new URL('https://desk.test/spaces/id/~research%20desk/map#history')),
    ).toEqual({
      kind: 'space',
      href: '/spaces/id/~research%20desk/map',
      label: 'research desk',
    })
    expect(recentLocationFromUrl(new URL('https://desk.test/workspace?ws=saved-desk'))).toEqual({
      kind: 'space',
      href: '/workspace?ws=saved-desk',
      label: 'Space saved-desk',
    })
    expect(recentLocationFromUrl(new URL('https://desk.test/workspace'))).toBeNull()
    expect(recentLocationFromUrl(new URL('https://desk.test/canvas'))).toBeNull()
  })
})
