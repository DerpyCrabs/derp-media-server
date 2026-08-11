import type {
  ExplorerHistoryAdapter,
  ExplorerOnlineAdapter,
  ExplorerStorageAdapter,
} from '@/lib/explorer-model'

export function browserExplorerStorage(
  storage: Storage = window.localStorage,
): ExplorerStorageAdapter {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: (key) => storage.removeItem(key),
  }
}

export function createBrowserOnlineAdapter(forceOffline = false): ExplorerOnlineAdapter {
  return {
    getSnapshot: () => !forceOffline && navigator.onLine,
    subscribe(listener) {
      if (forceOffline) return () => undefined
      window.addEventListener('online', listener)
      window.addEventListener('offline', listener)
      return () => {
        window.removeEventListener('online', listener)
        window.removeEventListener('offline', listener)
      }
    },
  }
}

type UrlHistoryOptions = Readonly<{
  currentPath(): string
  navigate(path: string, replace: boolean): void
}>

export function createUrlExplorerHistory(options: UrlHistoryOptions): ExplorerHistoryAdapter {
  const listeners = new Set<(path: string) => void>()
  const notify = () => {
    const path = options.currentPath()
    for (const listener of [...listeners]) listener(path)
  }
  return {
    current: options.currentPath,
    push: (path) => options.navigate(path, false),
    replace: (path) => options.navigate(path, true),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    subscribe(listener) {
      if (listeners.size === 0) {
        window.addEventListener('popstate', notify)
        window.addEventListener('derp:navigation', notify)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          window.removeEventListener('popstate', notify)
          window.removeEventListener('derp:navigation', notify)
        }
      }
    },
  }
}

type PaneHistoryState = { entries: string[]; index: number }

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

function readPaneHistory(key: string, initialPath: string): PaneHistoryState {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key) ?? '') as PaneHistoryState
    if (
      Array.isArray(parsed.entries) &&
      parsed.entries.every((entry) => typeof entry === 'string') &&
      Number.isInteger(parsed.index) &&
      parsed.index >= 0 &&
      parsed.index < parsed.entries.length
    ) {
      const initial = normalizePath(initialPath)
      if (parsed.entries[parsed.index] !== initial) {
        parsed.entries.splice(parsed.index + 1, parsed.entries.length, initial)
        parsed.index = parsed.entries.length - 1
      }
      return parsed
    }
  } catch {
    // Ignore corrupt device-local navigation state.
  }
  return { entries: [normalizePath(initialPath)], index: 0 }
}

export function createPaneExplorerHistory(
  id: string,
  initialPath: string,
  onNavigate: (path: string) => void,
): ExplorerHistoryAdapter {
  const storageKey = `derp-explorer-history:${id}`
  const state = readPaneHistory(storageKey, initialPath)
  const listeners = new Set<(path: string) => void>()
  const persist = () => window.sessionStorage.setItem(storageKey, JSON.stringify(state))
  const notify = () => {
    const path = state.entries[state.index] ?? ''
    persist()
    onNavigate(path)
    for (const listener of [...listeners]) listener(path)
  }
  persist()
  return {
    current: () => state.entries[state.index] ?? '',
    push(path) {
      state.entries.splice(state.index + 1, state.entries.length, normalizePath(path))
      state.index = state.entries.length - 1
      notify()
    },
    replace(path) {
      state.entries[state.index] = normalizePath(path)
      notify()
    },
    back() {
      if (state.index === 0) return
      state.index -= 1
      notify()
    },
    forward() {
      if (state.index >= state.entries.length - 1) return
      state.index += 1
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
