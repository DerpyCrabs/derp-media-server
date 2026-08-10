import { Window as HappyWindow } from 'happy-dom'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'

const testWindow = new HappyWindow({ url: 'https://localhost/' })
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalFetch = globalThis.fetch

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testWindow.localStorage,
})

const { saveSyncedReaderState } = await import('@/src/reader/reader-state-client')

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
      undefined,
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
})
