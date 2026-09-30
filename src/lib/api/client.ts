import { Data, Effect, Schema } from 'effect'
import { pushForbiddenNotice } from '@/lib/state/forbidden-notify'

export class ApiError extends Error {
  readonly _tag = 'ApiError'
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class ApiTransportError extends Data.TaggedError('ApiTransportError')<{
  readonly url: string
  readonly cause: unknown
}> {
  override get message() {
    return `Request failed: ${this.url}`
  }
}

export class ApiDecodeError extends Data.TaggedError('ApiDecodeError')<{
  readonly url: string
  readonly cause: unknown
}> {
  override get message() {
    return `Invalid response: ${this.url}`
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

function mergeFetchHeaders(base: Record<string, string>, extra?: HeadersInit): Headers {
  const out = new Headers(base)
  if (!extra) return out
  if (extra instanceof Headers) {
    extra.forEach((value, key) => {
      out.set(key, value)
    })
    return out
  }
  if (Array.isArray(extra)) {
    for (const [k, v] of extra) {
      out.set(k, v)
    }
    return out
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined) out.set(k, String(v))
  }
  return out
}

export type ApiRequestOptions = RequestInit & { notifyForbidden?: boolean }

export function apiEffect(
  url: string,
  options?: ApiRequestOptions,
): Effect.Effect<unknown, ApiError | ApiTransportError | ApiDecodeError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const { headers: optsHeaders, notifyForbidden = true, ...rest } = options ?? {}
      const headers = mergeFetchHeaders(
        rest.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
        optsHeaders,
      )
      const res = await fetch(url, {
        ...rest,
        headers,
        signal: rest.signal ? AbortSignal.any([signal, rest.signal]) : signal,
      })
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => undefined)
        const message =
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : body &&
                typeof body === 'object' &&
                'message' in body &&
                typeof body.message === 'string'
              ? body.message
              : res.statusText
        if (res.status === 403 && notifyForbidden) pushForbiddenNotice(message)
        throw new ApiError(res.status, message)
      }
      try {
        return (await res.json()) as unknown
      } catch (cause) {
        throw new ApiDecodeError({ url, cause })
      }
    },
    catch: (cause) =>
      cause instanceof ApiError || cause instanceof ApiDecodeError
        ? cause
        : new ApiTransportError({ url, cause }),
  })
}

export function apiSchemaEffect<S extends Schema.Constraint>(
  schema: S,
  url: string,
  options?: ApiRequestOptions,
): Effect.Effect<S['Type'], ApiError | ApiTransportError | ApiDecodeError, S['DecodingServices']> {
  return apiEffect(url, options).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError((cause) => new ApiDecodeError({ url, cause })),
      ),
    ),
  )
}

export function postEffect(
  url: string,
  body: unknown,
): Effect.Effect<unknown, ApiError | ApiTransportError | ApiDecodeError> {
  return apiEffect(url, { method: 'POST', body: JSON.stringify(body) })
}

export function postSchemaEffect<S extends Schema.Constraint>(
  schema: S,
  url: string,
  body: unknown,
) {
  return apiSchemaEffect(schema, url, { method: 'POST', body: JSON.stringify(body) })
}
