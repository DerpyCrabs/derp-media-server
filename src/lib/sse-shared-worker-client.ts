import { createReconnectScheduler } from '@/lib/sse-reconnect'
import { apiEndpoints } from '@/lib/api-endpoints'
import type { AppEvent } from '@/lib/generated/api-contracts'

export type SseEventPayload = AppEvent

const useSharedWorker = typeof SharedWorker !== 'undefined'
let sharedWorker: SharedWorker | null = null
const applicationListeners = new Set<(data: SseEventPayload) => void>()

function dispatchApplication(data: SseEventPayload) {
  for (const fn of applicationListeners) {
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
      if (message?.type === 'application-sse' && message.data !== undefined) {
        dispatchApplication(message.data)
      }
    })
  }
  return sharedWorker.port
}

let fallbackApplicationSource: EventSource | null = null
let fallbackApplicationReferences = 0
let fallbackApplicationReconnectCleanup: (() => void) | null = null

function isTabVisible(): boolean {
  return typeof document !== 'undefined' && !document.hidden
}

function connectFallbackApplication() {
  if (!isTabVisible() || fallbackApplicationSource) return
  fallbackApplicationReconnectCleanup?.()
  const { schedule, cleanup } = createReconnectScheduler(() => {
    if (fallbackApplicationReferences > 0) connectFallbackApplication()
  })
  fallbackApplicationReconnectCleanup = cleanup

  fallbackApplicationSource = new EventSource(apiEndpoints.events.streamUrl)
  fallbackApplicationSource.onmessage = (event) => {
    try {
      dispatchApplication(JSON.parse(event.data) as SseEventPayload)
    } catch {
      // Ignore malformed events.
    }
  }
  fallbackApplicationSource.onerror = () => {
    fallbackApplicationSource?.close()
    fallbackApplicationSource = null
    if (fallbackApplicationReferences > 0) schedule()
  }
}

function disconnectFallbackApplicationIfIdle() {
  if (fallbackApplicationReferences > 0) return
  fallbackApplicationReconnectCleanup?.()
  fallbackApplicationReconnectCleanup = null
  fallbackApplicationSource?.close()
  fallbackApplicationSource = null
}

let fallbackVisibilityAttached = false

function attachFallbackVisibilityHandlers() {
  if (fallbackVisibilityAttached || typeof document === 'undefined') return
  fallbackVisibilityAttached = true
  document.addEventListener('visibilitychange', () => {
    if (!isTabVisible()) {
      fallbackApplicationSource?.close()
      fallbackApplicationSource = null
    } else if (fallbackApplicationReferences > 0) {
      connectFallbackApplication()
    }
  })
}

export function subscribeSseApplication(onData: (data: SseEventPayload) => void): () => void {
  applicationListeners.add(onData)

  if (useSharedWorker) {
    ensureSharedWorkerPort().postMessage({ type: 'subscribe-application' })
    return () => {
      applicationListeners.delete(onData)
      sharedWorker?.port.postMessage({ type: 'unsubscribe-application' })
    }
  }

  fallbackApplicationReferences++
  attachFallbackVisibilityHandlers()
  connectFallbackApplication()
  return () => {
    applicationListeners.delete(onData)
    fallbackApplicationReferences = Math.max(0, fallbackApplicationReferences - 1)
    disconnectFallbackApplicationIfIdle()
  }
}
