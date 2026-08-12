import { Window as HappyWindow } from 'happy-dom'
import { afterAll, afterEach, describe, expect, test } from 'bun:test'

const testWindow = new HappyWindow({ url: 'https://localhost/' })
const previousLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalFetch = globalThis.fetch

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: testWindow.localStorage,
})

const { loadSyncedReaderState, saveSyncedReaderState } =
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
      undefined,
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
    const loading = loadSyncedReaderState('Documents/in-flight.pdf', undefined)
    await Promise.resolve()
    expect(loads).toBe(0)

    completeSave()
    await saving
    const loaded = await loading
    expect(loads).toBe(1)
    expect(loaded.state?.scrollTop).toBe(2_400)
  })
})
