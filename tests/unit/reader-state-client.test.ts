import { Window as HappyWindow } from 'happy-dom'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'

const testWindow = new HappyWindow({ url: 'https://localhost/' })
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalFetch = globalThis.fetch

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testWindow.localStorage,
})

const { mergeReaderPreferenceChanges, saveSyncedReaderState } =
  await import('@/src/reader/reader-state-client')

afterEach(() => {
  testWindow.localStorage.clear()
  globalThis.fetch = originalFetch
})

afterAll(() => {
  testWindow.close()
  if (previousLocalStorage) Object.defineProperty(globalThis, 'localStorage', previousLocalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('reader state client', () => {
  test('journals queued state before network save completes', async () => {
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

    const pending = JSON.parse(
      localStorage.getItem('derp.reader.pending.v1:admin:Documents/reader.pdf') ?? 'null',
    ) as { state?: { scrollTop?: number } } | null
    expect(pending?.state?.scrollTop).toBe(1_809)

    await Promise.resolve()
    completeRequest()
    await saving
    expect(localStorage.getItem('derp.reader.pending.v1:admin:Documents/reader.pdf')).toBeNull()
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
