import { Exit, Schema } from 'effect'

export function readPersistedState<A>(key: string, schema: Schema.Decoder<A>): A | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const decoded = Schema.decodeUnknownExit(Schema.Struct({ state: schema }))(JSON.parse(raw))
    return Exit.isSuccess(decoded) ? decoded.value.state : null
  } catch {
    return null
  }
}

export function writePersistedState<T>(key: string, state: T): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify({ state, version: 0 }))
  } catch {}
}
