import { createReconnectScheduler } from '@/lib/sse-reconnect'
import { apiEndpoints } from '@/lib/api-endpoints'
import type { AppEvent } from '@/lib/generated/api-contracts'

export type SseEventPayload = AppEvent

const useSharedWorker = typeof SharedWorker !== 'undefined'
let sharedWorker: SharedWorker | null = null
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
      const message = event.data as { type?: string; data?: SseEventPayload }
      if (message?.type === 'admin-sse' && message.data !== undefined) {
        dispatchAdmin(message.data)
      }
    })
  }
  return sharedWorker.port
}

let fallbackAdminEs: EventSource | null = null
let fallbackAdminRef = 0
let fallbackAdminReconnectCleanup: (() => void) | null = null

function isTabVisible(): boolean {
  return typeof document !== 'undefined' && !document.hidden
}

function connectFallbackAdmin() {
  if (!isTabVisible() || fallbackAdminEs) return
  fallbackAdminReconnectCleanup?.()
  const { schedule, cleanup } = createReconnectScheduler(() => {
    if (fallbackAdminRef > 0) connectFallbackAdmin()
  })
  fallbackAdminReconnectCleanup = cleanup

  fallbackAdminEs = new EventSource(apiEndpoints.events.streamUrl)
  fallbackAdminEs.onmessage = (event) => {
    try {
      dispatchAdmin(JSON.parse(event.data) as SseEventPayload)
    } catch {
      // Ignore malformed events.
    }
  }
  fallbackAdminEs.onerror = () => {
    fallbackAdminEs?.close()
    fallbackAdminEs = null
    if (fallbackAdminRef > 0) schedule()
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

function attachFallbackVisibilityHandlers() {
  if (fallbackVisibilityAttached || typeof document === 'undefined') return
  fallbackVisibilityAttached = true
  document.addEventListener('visibilitychange', () => {
    if (!isTabVisible()) {
      fallbackAdminEs?.close()
      fallbackAdminEs = null
    } else if (fallbackAdminRef > 0) {
      connectFallbackAdmin()
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
