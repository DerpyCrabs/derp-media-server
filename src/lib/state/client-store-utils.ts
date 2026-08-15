/** Zustand persist middleware used `{ state: T, version?: number }` in localStorage. */
export function readPersistedState<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: T }
    return parsed.state ?? null
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

export function createStoreListeners() {
  const listeners = new Set<() => void>()
  return {
    notify() {
      for (const l of [...listeners]) l()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
