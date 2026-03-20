class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
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
  const headers = mergeFetchHeaders({ 'Content-Type': 'application/json' }, optsHeaders)
  const res = await fetch(url, {
    ...rest,
    headers,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.error || res.statusText)
  }
  return res.json()
}

export function post<T>(url: string, body: unknown): Promise<T> {
  return api<T>(url, { method: 'POST', body: JSON.stringify(body) })
}
