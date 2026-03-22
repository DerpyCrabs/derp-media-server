import { createReconnectScheduler } from '@/lib/sse-reconnect'

export type SseEventPayload = { type?: string }

const useSharedWorker = typeof SharedWorker !== 'undefined'

let sharedWorker: SharedWorker | null = null

const adminListeners = new Set<(data: SseEventPayload) => void>()
const shareListeners = new Map<string, Set<(data: SseEventPayload) => void>>()

function dispatchAdmin(data: SseEventPayload) {
  for (const fn of adminListeners) {
    try {
      fn(data)
    } catch {
      // ignore
    }
  }
}

function dispatchShare(token: string, data: SseEventPayload) {
  const set = shareListeners.get(token)
  if (!set) return
  for (const fn of set) {
    try {
      fn(data)
    } catch {
      // ignore
    }
  }
}

function ensureSharedWorkerPort(): MessagePort {
  if (!sharedWorker) {
    sharedWorker = new SharedWorker(new URL('./sse-shared-worker.ts', import.meta.url), {
      type: 'module',
      name: 'derp-sse',
    })
    sharedWorker.port.start()
    sharedWorker.port.addEventListener('message', (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: SseEventPayload; token?: string }
      if (msg?.type === 'admin-sse' && msg.data !== undefined) {
        dispatchAdmin(msg.data)
      } else if (
        msg?.type === 'share-sse' &&
        typeof msg.token === 'string' &&
        msg.data !== undefined
      ) {
        dispatchShare(msg.token, msg.data)
      }
    })
  }
  return sharedWorker.port
}

let fallbackAdminEs: EventSource | null = null
let fallbackAdminRef = 0
let fallbackAdminReconnectCleanup: (() => void) | null = null

function connectFallbackAdmin() {
  if (!isTabVisible() || fallbackAdminEs) return
  fallbackAdminReconnectCleanup?.()
  const { schedule, cleanup } = createReconnectScheduler(() => {
    if (fallbackAdminRef > 0) connectFallbackAdmin()
  })
  fallbackAdminReconnectCleanup = cleanup

  fallbackAdminEs = new EventSource('/api/events/stream')
  fallbackAdminEs.onmessage = (event) => {
    try {
      dispatchAdmin(JSON.parse(event.data) as SseEventPayload)
    } catch {
      // ignore
    }
  }
  fallbackAdminEs.onerror = () => {
    if (fallbackAdminEs) {
      fallbackAdminEs.close()
      fallbackAdminEs = null
    }
    if (fallbackAdminRef > 0) schedule()
  }
}

function disconnectFallbackAdminIfIdle() {
  if (fallbackAdminRef > 0) return
  fallbackAdminReconnectCleanup?.()
  fallbackAdminReconnectCleanup = null
  if (fallbackAdminEs) {
    fallbackAdminEs.close()
    fallbackAdminEs = null
  }
}

function isTabVisible(): boolean {
  return typeof document !== 'undefined' && !document.hidden
}

type FallbackShareEntry = {
  es: EventSource | null
  ref: number
  reconnectCleanup: (() => void) | null
}

const fallbackShare = new Map<string, FallbackShareEntry>()

function getFallbackShareEntry(token: string): FallbackShareEntry {
  let e = fallbackShare.get(token)
  if (!e) {
    e = { es: null, ref: 0, reconnectCleanup: null }
    fallbackShare.set(token, e)
  }
  return e
}

function connectFallbackShare(token: string) {
  const entry = getFallbackShareEntry(token)
  if (!isTabVisible() || entry.es) return
  entry.reconnectCleanup?.()
  const { schedule, cleanup } = createReconnectScheduler(() => {
    const cur = fallbackShare.get(token)
    if (cur && cur.ref > 0) connectFallbackShare(token)
  })
  entry.reconnectCleanup = cleanup

  const url = `/api/share/${encodeURIComponent(token)}/stream`
  entry.es = new EventSource(url)
  entry.es.onmessage = (event) => {
    try {
      dispatchShare(token, JSON.parse(event.data) as SseEventPayload)
    } catch {
      // ignore
    }
  }
  entry.es.onerror = () => {
    if (entry.es) {
      entry.es.close()
      entry.es = null
    }
    if (entry.ref > 0) schedule()
  }
}

function disconnectFallbackShareIfIdle(token: string) {
  const entry = fallbackShare.get(token)
  if (!entry || entry.ref > 0) return
  entry.reconnectCleanup?.()
  entry.reconnectCleanup = null
  if (entry.es) {
    entry.es.close()
    entry.es = null
  }
  fallbackShare.delete(token)
}

let fallbackVisibilityAttached = false

function attachFallbackVisibilityHandlers() {
  if (fallbackVisibilityAttached || typeof document === 'undefined') return
  fallbackVisibilityAttached = true
  document.addEventListener('visibilitychange', () => {
    if (!isTabVisible()) {
      if (fallbackAdminEs) {
        fallbackAdminEs.close()
        fallbackAdminEs = null
      }
      for (const [, entry] of fallbackShare) {
        if (entry.es) {
          entry.es.close()
          entry.es = null
        }
      }
    } else {
      if (fallbackAdminRef > 0) connectFallbackAdmin()
      for (const [t, entry] of fallbackShare) {
        if (entry.ref > 0) connectFallbackShare(t)
      }
    }
  })
}

export function subscribeSseAdmin(onData: (data: SseEventPayload) => void): () => void {
  adminListeners.add(onData)

  if (useSharedWorker) {
    ensureSharedWorkerPort().postMessage({ type: 'subscribe-admin' })
    return () => {
      adminListeners.delete(onData)
      sharedWorker?.port.postMessage({ type: 'unsubscribe-admin' })
    }
  }

  fallbackAdminRef++
  attachFallbackVisibilityHandlers()
  connectFallbackAdmin()
  return () => {
    adminListeners.delete(onData)
    fallbackAdminRef = Math.max(0, fallbackAdminRef - 1)
    disconnectFallbackAdminIfIdle()
  }
}

export function subscribeSseShare(
  token: string,
  onData: (data: SseEventPayload) => void,
): () => void {
  let set = shareListeners.get(token)
  if (!set) {
    set = new Set()
    shareListeners.set(token, set)
  }
  set.add(onData)

  if (useSharedWorker) {
    ensureSharedWorkerPort().postMessage({ type: 'subscribe-share', token })
    return () => {
      const s = shareListeners.get(token)
      if (s) {
        s.delete(onData)
        if (s.size === 0) shareListeners.delete(token)
      }
      sharedWorker?.port.postMessage({ type: 'unsubscribe-share', token })
    }
  }

  const entry = getFallbackShareEntry(token)
  entry.ref++
  attachFallbackVisibilityHandlers()
  connectFallbackShare(token)
  return () => {
    const s = shareListeners.get(token)
    if (s) {
      s.delete(onData)
      if (s.size === 0) shareListeners.delete(token)
    }
    const cur = fallbackShare.get(token)
    if (cur) {
      cur.ref = Math.max(0, cur.ref - 1)
      disconnectFallbackShareIfIdle(token)
    }
  }
}
