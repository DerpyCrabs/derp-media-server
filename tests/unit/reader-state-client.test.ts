import { afterEach, describe, expect, test } from 'bun:test'

const originalFetch = globalThis.fetch

const { loadReaderPreferences, mergeReaderPreferenceChanges, saveSyncedReaderState } =
  await import('@/features/reader/reader-state-client')

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('reader state client', () => {
  test('uses full page width by default for old book preferences', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          preferences: {
            bookAppearance: {
              fontFamily: 'publisher',
              fontScale: null,
              lineHeight: null,
              contentWidth: null,
              theme: 'publisher',
            },
          },
          revision: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown as typeof fetch

    const result = await loadReaderPreferences()

    expect(result.preferences.bookAppearance.contentWidth).toBe('full')
  })

  test('migrates old numeric book widths to named options', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          preferences: {
            bookAppearance: {
              fontFamily: 'publisher',
              fontScale: null,
              lineHeight: null,
              contentWidth: 64,
              theme: 'publisher',
            },
          },
          revision: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as unknown as typeof fetch

    const result = await loadReaderPreferences()

    expect(result.preferences.bookAppearance.contentWidth).toBe('wide')
  })

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

  test('merges only locally changed preference fields after a revision conflict', () => {
    const base = {
      bookAppearance: {
        fontFamily: 'publisher' as const,
        fontScale: null,
        lineHeight: null,
        contentWidth: 'full' as const,
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
