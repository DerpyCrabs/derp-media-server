import { pushForbiddenNotice } from './forbidden-notify'
import type { ApiErrorBody, ApiErrorCode, ReconciliationDetails } from './generated/api-contracts'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ApiErrorCode,
    public details?: ReconciliationDetails,
  ) {
    super(message)
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

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const { headers: optsHeaders, ...rest } = options ?? {}
  const headers = mergeFetchHeaders(
    rest.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    optsHeaders,
  )
  const res = await fetch(url, {
    ...rest,
    headers,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiErrorBody> & {
      error?: string
    }
    const message = body.message || body.error || res.statusText
    if (res.status === 403) {
      pushForbiddenNotice(message)
    }
    throw new ApiError(res.status, message, body.code, body.details)
  }
  return res.json()
}

export function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return api<T>(url, { method: 'POST', body: JSON.stringify(body), signal })
}
