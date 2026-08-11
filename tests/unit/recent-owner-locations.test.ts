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
  test('quarantines corrupt and unsafe records', () => {
    const storage = memoryStorage(
      JSON.stringify([
        { kind: 'library', href: '//evil.test', label: 'bad', visitedAt: 3 },
        { kind: 'library', href: '/\\evil.test', label: 'backslash', visitedAt: 4 },
        { kind: 'library', href: '/library\u0000', label: 'control', visitedAt: 5 },
        { kind: 'canvas', href: '/canvas', label: 'Canvas', visitedAt: 2 },
        null,
      ]),
    )
    expect(readRecentOwnerLocations(storage)).toEqual([
      { kind: 'canvas', href: '/canvas', label: 'Canvas', visitedAt: 2 },
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
})
