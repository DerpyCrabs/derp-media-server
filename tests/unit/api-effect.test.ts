import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Effect, Fiber, Schema } from 'effect'
import {
  apiEffect,
  apiSchemaEffect,
  ApiError,
  ApiDecodeError,
  ApiTransportError,
  postEffect,
} from '@/lib/api/client'

const http: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> } =
  globalThis
let fetchSpy: ReturnType<typeof spyOn<typeof http, 'fetch'>> | undefined

afterEach(() => fetchSpy?.mockRestore())

describe('Effect API requests', () => {
  test('defers requests until execution and merges headers', async () => {
    fetchSpy = spyOn(http, 'fetch').mockResolvedValue(Response.json({ value: 42 }))
    const request = apiEffect('/api/example', { headers: { Authorization: 'example' } })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await Effect.runPromise(request)).toEqual({ value: 42 })
    const options = fetchSpy.mock.calls[0]?.[1]
    expect(new Headers(options?.headers).get('Authorization')).toBe('example')
    expect(new Headers(options?.headers).get('Content-Type')).toBe('application/json')
  })

  test('preserves typed HTTP errors', async () => {
    fetchSpy = spyOn(http, 'fetch').mockResolvedValue(
      Response.json({ error: 'Version conflict' }, { status: 409 }),
    )
    const error = await Effect.runPromise(Effect.flip(apiEffect('/api/example')))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, message: 'Version conflict' })
  })

  test('interrupting an owned request aborts fetch', async () => {
    let requested!: (signal: AbortSignal) => void
    const started = new Promise<AbortSignal>((resolve) => {
      requested = resolve
    })
    fetchSpy = spyOn(http, 'fetch').mockImplementation((_url, options) => {
      const signal = options!.signal!
      requested(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const fiber = Effect.runFork(apiEffect('/api/example'))
    const signal = await started
    expect(signal.aborted).toBe(false)
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(signal.aborted).toBe(true)
  })

  test('honors an external abort signal', async () => {
    const controller = new AbortController()
    let received: AbortSignal | null | undefined
    fetchSpy = spyOn(http, 'fetch').mockImplementation((_url, options) => {
      received = options?.signal
      return Promise.resolve(Response.json({}))
    })
    await Effect.runPromise(apiEffect('/api/example', { signal: controller.signal }))
    controller.abort()
    expect(received?.aborted).toBe(true)
  })

  test('encodes mutation bodies', async () => {
    fetchSpy = spyOn(http, 'fetch').mockResolvedValue(Response.json({ saved: true }))
    await Effect.runPromise(postEffect('/api/example', { title: 'A' }))
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: '{"title":"A"}' })
  })

  test('decodes responses and rejects mismatched payloads with a typed error', async () => {
    const schema = Schema.Struct({ value: Schema.Number })
    fetchSpy = spyOn(http, 'fetch').mockResolvedValue(Response.json({ value: 'wrong' }))
    const result = await Effect.runPromise(Effect.flip(apiSchemaEffect(schema, '/api/example')))
    expect(result).toBeInstanceOf(ApiDecodeError)
    expect(result).toMatchObject({ url: '/api/example' })
    fetchSpy.mockResolvedValue(Response.json({ value: 42 }))
    expect(await Effect.runPromise(apiSchemaEffect(schema, '/api/example'))).toEqual({ value: 42 })
  })

  test('distinguishes invalid JSON from transport failures', async () => {
    fetchSpy = spyOn(http, 'fetch').mockResolvedValue(new Response('invalid json'))
    expect(await Effect.runPromise(Effect.flip(apiEffect('/api/example')))).toBeInstanceOf(
      ApiDecodeError,
    )
    const cause = new TypeError('Offline')
    fetchSpy.mockRejectedValue(cause)
    const error = await Effect.runPromise(Effect.flip(apiEffect('/api/example')))
    expect(error).toBeInstanceOf(ApiTransportError)
    expect(error).toMatchObject({ url: '/api/example', cause })
  })

  test('preserves HTTP status when an error response is not an object', async () => {
    fetchSpy = spyOn(http, 'fetch').mockResolvedValue(Response.json(null, { status: 409 }))
    expect(await Effect.runPromise(Effect.flip(apiEffect('/api/example')))).toMatchObject({
      _tag: 'ApiError',
      status: 409,
    })
  })
})

test('leaves multipart content type to the browser', async () => {
  fetchSpy = spyOn(http, 'fetch').mockResolvedValue(Response.json({ saved: true }))
  const body = new FormData()
  body.append('file', new Blob(['content']), 'file.txt')
  await Effect.runPromise(apiEffect('/api/upload', { method: 'POST', body }))
  const options = fetchSpy.mock.calls[0]?.[1]
  expect(options?.body).toBe(body)
  expect(new Headers(options?.headers).has('Content-Type')).toBe(false)
})
