import { expect, test } from 'bun:test'
import { restoreActivityQueue } from '@/features/media-ai/activity'

test('closing an app lifetime cancels its drain and the next lifetime retries the same activity', async () => {
  const activity = { id: 'retry-lifetime', seq: 1, end: Date.now() }
  const originalFetch = globalThis.fetch
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const requests: RequestInit[] = []
  let saved = JSON.stringify([activity])
  let release: ((response: Response) => void) | undefined
  const response = new Promise<Response>((resolve) => {
    release = resolve
  })
  const stops: (() => void)[] = []
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem() {
          return saved
        },
        setItem(_key: string, value: string) {
          saved = value
        },
      },
    })
    globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
      requests.push(options)
      return response
    }) as typeof fetch
    stops.push(restoreActivityQueue())
    stops.pop()!()
    stops.push(restoreActivityQueue())
    expect(requests).toHaveLength(2)
    expect(requests[0]?.keepalive).toBe(true)
    expect(requests[0]?.signal?.aborted).toBe(true)
    expect(requests[1]?.signal?.aborted).toBe(false)
    expect(requests[1]?.body).toBe(requests[0]?.body)
    release!(new Response(null, { status: 204 }))
    await response
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests).toHaveLength(2)
    expect(JSON.parse(saved)).toEqual([])
    stops.pop()!()
  } finally {
    release?.(new Response(null, { status: 204 }))
    stops.forEach((stop) => stop())
    globalThis.fetch = originalFetch
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})
