import { createReconnectScheduler } from '@/lib/api/sse-reconnect'

import { Schema } from 'effect'
import { sseEventSchema, workerEventSchema, type SseEventPayload } from './sse-protocol'
export type { SseEventPayload } from './sse-protocol'

const sharedWorkerAvailable = typeof SharedWorker !== 'undefined'
let sharedWorker: SharedWorker | null = null
let sharedAdminRef = 0
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

function ensureSharedWorkerPort(): MessagePort {
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
}

let fallbackAdminEs: EventSource | null = null
let fallbackAdminRef = 0
let fallbackAdminSchedule = () => {}
let fallbackAdminReset = () => {}
let fallbackAdminReconnectCleanup: (() => void) | null = null

function isTabVisible(): boolean {
  return typeof document !== 'undefined' && !document.hidden
}

function connectFallbackAdmin() {
  if (!isTabVisible() || fallbackAdminEs) return
  if (!fallbackAdminReconnectCleanup) {
    const reconnect = createReconnectScheduler(() => {
      if (fallbackAdminRef > 0) connectFallbackAdmin()
    })
    fallbackAdminReconnectCleanup = reconnect.cleanup
    fallbackAdminSchedule = reconnect.schedule
    fallbackAdminReset = reconnect.reset
  }

  fallbackAdminEs = new EventSource('/api/events/stream')
  fallbackAdminEs.onmessage = (event) => {
    try {
      const decoded = Schema.decodeUnknownExit(sseEventSchema)(JSON.parse(event.data))
      if (decoded._tag === 'Success') {
        fallbackAdminReset()
        dispatchAdmin(decoded.value)
      }
    } catch {
      // Ignore malformed events.
    }
  }
  fallbackAdminEs.onerror = () => {
    fallbackAdminEs?.close()
    fallbackAdminEs = null
    if (fallbackAdminRef > 0) fallbackAdminSchedule()
  }
}

function disconnectFallbackAdminIfIdle() {
  if (fallbackAdminRef > 0) return
  fallbackAdminReconnectCleanup?.()
  fallbackAdminReconnectCleanup = null
  fallbackAdminEs?.close()
  fallbackAdminEs = null
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
  if (sharedWorker || sharedAdminRef === 0) return
  const port = ensureSharedWorkerPort()
  for (let index = 0; index < sharedAdminRef; index++) port.postMessage({ type: 'subscribe-admin' })
}

function notifyOffline() {
  sharedWorker?.port.postMessage({ type: 'network-offline' })
}

function notifyOnline() {
  sharedWorker?.port.postMessage({ type: 'network-online' })
}

function updateFallbackVisibility() {
  if (!isTabVisible()) {
    fallbackAdminReconnectCleanup?.()
    fallbackAdminReconnectCleanup = null
    fallbackAdminEs?.close()
    fallbackAdminEs = null
  } else if (fallbackAdminRef > 0) {
    connectFallbackAdmin()
  }
}

export function subscribeSseAdmin(onData: (data: SseEventPayload) => void): () => void {
  adminListeners.add(onData)
  let active = true

  if (sharedWorkerAvailable) {
    sharedAdminRef++
    ensureSharedWorkerPort().postMessage({ type: 'subscribe-admin' })
    return () => {
      if (!active) return
      active = false
      adminListeners.delete(onData)
      sharedWorker?.port.postMessage({ type: 'unsubscribe-admin' })
      if (--sharedAdminRef === 0) {
        window.removeEventListener('offline', notifyOffline)
        window.removeEventListener('online', notifyOnline)
        window.removeEventListener('pagehide', disconnectSharedWorker)
        window.removeEventListener('pageshow', restoreSharedWorker)
        disconnectSharedWorker()
        sharedWorkerNetworkEventsAttached = false
      }
    }
  }

  fallbackAdminRef++
  attachFallbackVisibilityHandlers()
  connectFallbackAdmin()
  return () => {
    if (!active) return
    active = false
    adminListeners.delete(onData)
    fallbackAdminRef = Math.max(0, fallbackAdminRef - 1)
    disconnectFallbackAdminIfIdle()
    if (fallbackAdminRef === 0) {
      document.removeEventListener('visibilitychange', updateFallbackVisibility)
      fallbackVisibilityAttached = false
    }
  }
}
