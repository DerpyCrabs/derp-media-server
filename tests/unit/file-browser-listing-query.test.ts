import { afterEach, describe, expect, test } from 'bun:test'
import {
  fetchFileBrowserListing,
  fileBrowserListingQueryKey,
  nextFileBrowserListingPage,
} from '@/features/explorer/file-browser-listing-query'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('file browser listing query', () => {
  test('uses the cache key nested under file invalidation', () => {
    expect(fileBrowserListingQueryKey('Hermes Sessions')).toEqual([
      'files',
      'Hermes Sessions',
      'file-browser',
    ])
  })

  test('requests virtual listings with the requested page offset', async () => {
    let requested = ''
    globalThis.fetch = (async (input) => {
      requested = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return new Response(JSON.stringify({ files: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    await fetchFileBrowserListing('Hermes Sessions/project/a b', 200)

    expect(requested).toBe(
      '/api/files?virtual_browser=true&dir=Hermes%20Sessions%2Fproject%2Fa%20b&offset=200',
    )
  })

  test('continues from virtual directory pagination metadata', () => {
    expect(
      nextFileBrowserListingPage({
        files: [],
        virtualDirectory: {
          provider: 'hermes',
          kind: 'project',
          path: 'Hermes Sessions/project/a',
          capabilities: [],
          offset: 0,
          pageSize: 200,
          total: 201,
          nextOffset: 200,
        },
      }),
    ).toBe(200)
    expect(nextFileBrowserListingPage({ files: [] })).toBeUndefined()
  })
})
