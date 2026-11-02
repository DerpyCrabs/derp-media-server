import { createAdminStream } from '@/lib/api/sse-reconnect'

import { Schema } from 'effect'
import { workerEventSchema, type SseEventPayload } from './sse-protocol'
export type { SseEventPayload } from './sse-protocol'

let sharedWorkerAvailable = typeof SharedWorker !== 'undefined'
let sharedWorker: SharedWorker | null = null
let adminRef = 0
const adminListeners = new Set<(data: SseEventPayload) => void>()

function dispatchAdmin(data: SseEventPayload) {
  for (const fn of adminListeners) {
    try {
      fn(data)
    } catch {
      // Ignore listener failures.
    }
  }
}

function ensureSharedWorkerPort(): MessagePort | null {
  if (!sharedWorkerAvailable) return null
  try {
    if (!sharedWorker) {
      sharedWorker = new SharedWorker(new URL('./sse-shared-worker.ts', import.meta.url), {
        type: 'module',
        name: 'derp-sse',
      })
      sharedWorker.port.start()
      sharedWorker.port.addEventListener('message', (event: MessageEvent) => {
        const decoded = Schema.decodeUnknownExit(workerEventSchema)(event.data)
        if (decoded._tag === 'Success') dispatchAdmin(decoded.value.data)
      })
    }
    attachSharedWorkerNetworkHandlers()
    return sharedWorker.port
  } catch {
    sharedWorkerAvailable = false
    try {
      sharedWorker?.port.close()
    } catch {
      // A partially initialized port may already be unusable.
    }
    sharedWorker = null
    detachSharedWorkerNetworkHandlers()
    return null
  }
}

const fallbackStream = createAdminStream(dispatchAdmin)

function isTabVisible(): boolean {
  return (
    typeof document !== 'undefined' &&
    ((typeof window !== 'undefined' && !!window.derpRuntime) || !document.hidden)
  )
}

function connectFallbackAdmin() {
  if (isTabVisible() && adminRef > 0) fallbackStream.start()
}

let fallbackVisibilityAttached = false
let sharedWorkerNetworkEventsAttached = false

function attachSharedWorkerNetworkHandlers() {
  if (sharedWorkerNetworkEventsAttached || typeof window === 'undefined') return
  sharedWorkerNetworkEventsAttached = true
  window.addEventListener('offline', notifyOffline)
  window.addEventListener('online', notifyOnline)
  window.addEventListener('pagehide', disconnectSharedWorker)
  window.addEventListener('pageshow', restoreSharedWorker)
}

function detachSharedWorkerNetworkHandlers() {
  if (!sharedWorkerNetworkEventsAttached) return
  window.removeEventListener('offline', notifyOffline)
  window.removeEventListener('online', notifyOnline)
  window.removeEventListener('pagehide', disconnectSharedWorker)
  window.removeEventListener('pageshow', restoreSharedWorker)
  sharedWorkerNetworkEventsAttached = false
}

function attachFallbackVisibilityHandlers() {
  if (fallbackVisibilityAttached || typeof document === 'undefined') return
  fallbackVisibilityAttached = true
  document.addEventListener('visibilitychange', updateFallbackVisibility)
}

function disconnectSharedWorker() {
  if (!sharedWorker) return
  sharedWorker.port.postMessage({ type: 'disconnect' })
  sharedWorker.port.close()
  sharedWorker = null
}

function restoreSharedWorker() {
  if (sharedWorker || adminRef === 0) return
  const port = ensureSharedWorkerPort()
  if (port) {
    for (let index = 0; index < adminRef; index++) port.postMessage({ type: 'subscribe-admin' })
  } else {
    attachFallbackVisibilityHandlers()
    connectFallbackAdmin()
  }
}

function notifyOffline() {
  sharedWorker?.port.postMessage({ type: 'network-offline' })
}

function notifyOnline() {
  sharedWorker?.port.postMessage({ type: 'network-online' })
}

function updateFallbackVisibility() {
  if (!isTabVisible()) {
    fallbackStream.stop()
  } else if (adminRef > 0) {
    connectFallbackAdmin()
  }
}

export function subscribeSseAdmin(onData: (data: SseEventPayload) => void): () => void {
  adminListeners.add(onData)
  let active = true

  adminRef++
  const port = ensureSharedWorkerPort()
  if (port) {
    port.postMessage({ type: 'subscribe-admin' })
  } else {
    attachFallbackVisibilityHandlers()
    connectFallbackAdmin()
  }
  return () => {
    if (!active) return
    active = false
    adminListeners.delete(onData)
    sharedWorker?.port.postMessage({ type: 'unsubscribe-admin' })
    if (--adminRef === 0) {
      detachSharedWorkerNetworkHandlers()
      disconnectSharedWorker()
      fallbackStream.stop()
      if (fallbackVisibilityAttached) {
        document.removeEventListener('visibilitychange', updateFallbackVisibility)
        fallbackVisibilityAttached = false
      }
    }
  }
}
