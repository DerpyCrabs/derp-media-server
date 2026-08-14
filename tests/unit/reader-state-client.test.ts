import { afterEach, describe, expect, test } from 'bun:test'

const originalFetch = globalThis.fetch

const { loadSyncedReaderState, mergeReaderPreferenceChanges, saveSyncedReaderState } =
  await import('@/src/reader/reader-state-client')

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('reader state client', () => {
  test('serializes state save until network request completes', async () => {
    let completeRequest!: () => void
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        completeRequest = () =>
          resolve(
            new Response(JSON.stringify({ revision: 1, fingerprint: 'pdf:1' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          )
      })) as unknown as typeof fetch

    const saving = saveSyncedReaderState(
      'Documents/reader.pdf',
      {
        pageIndex: 2,
        scrollTop: 1_809,
        zoom: 1,
        viewMode: 'continuous',
        fitMode: 'manual',
        selectionMode: 'text',
        defaultAction: 'define',
      },
      0,
      'pdf:1',
    )

    await Promise.resolve()
    completeRequest()
    await saving
  })

  test('waits for an in-flight save before loading the same reader', async () => {
    let completeSave!: () => void
    let loads = 0
    globalThis.fetch = ((_input, init) => {
      if (init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          completeSave = () =>
            resolve(
              new Response(JSON.stringify({ revision: 2, fingerprint: 'pdf:2' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
        })
      }
      loads += 1
      return Promise.resolve(
        new Response(
          JSON.stringify({
            revision: 2,
            fingerprint: 'pdf:2',
            state: {
              pageIndex: 4,
              scrollTop: 2_400,
              zoom: 1,
              viewMode: 'continuous',
              fitMode: 'manual',
              selectionMode: 'text',
              defaultAction: 'define',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as typeof fetch

    const saving = saveSyncedReaderState(
      'Documents/in-flight.pdf',
      {
        pageIndex: 4,
        scrollTop: 2_400,
        zoom: 1,
        viewMode: 'continuous',
        fitMode: 'manual',
        selectionMode: 'text',
        defaultAction: 'define',
      },
      1,
      'pdf:2',
    )
    await Promise.resolve()
    const loading = loadSyncedReaderState('Documents/in-flight.pdf')
    await Promise.resolve()
    expect(loads).toBe(0)

    completeSave()
    await saving
    const loaded = await loading
    expect(loads).toBe(1)
    expect(loaded.state?.scrollTop).toBe(2_400)
  })

  test('merges only locally changed preference fields after a revision conflict', () => {
    const base = {
      bookAppearance: {
        fontFamily: 'publisher' as const,
        fontScale: null,
        lineHeight: null,
        contentWidth: null,
        theme: 'publisher' as const,
      },
      selectionMode: 'text' as const,
      defaultAction: 'define' as const,
      aiDetail: 'compact' as const,
      outlineOpen: true,
    }
    const latest = {
      ...base,
      bookAppearance: { ...base.bookAppearance, theme: 'dark' as const },
    }
    const desired = { ...base, defaultAction: 'translate' as const }

    expect(mergeReaderPreferenceChanges(latest, base, desired)).toEqual({
      ...latest,
      defaultAction: 'translate',
    })
  })
})
