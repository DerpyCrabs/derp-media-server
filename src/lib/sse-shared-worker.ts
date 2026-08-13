/// <reference lib="webworker" />

const INITIAL_DELAY_MS = 5000
const MAX_DELAY_MS = 60000
const BACKOFF_MULTIPLIER = 2

function getDelayMs(retryCount: number): number {
  return Math.min(INITIAL_DELAY_MS * BACKOFF_MULTIPLIER ** retryCount, MAX_DELAY_MS)
}

type PortState = { admin: number }
const portStates = new Map<MessagePort, PortState>()

function portState(port: MessagePort): PortState {
  let state = portStates.get(port)
  if (!state) {
    state = { admin: 0 }
    portStates.set(port, state)
  }
  return state
}

let adminRefTotal = 0
let adminSource: EventSource | null = null
let adminRetry = 0
let adminReconnectTimer: ReturnType<typeof setTimeout> | null = null

function cancelAdminReconnect() {
  if (adminReconnectTimer) {
    clearTimeout(adminReconnectTimer)
    adminReconnectTimer = null
  }
}

function broadcastAdmin(data: unknown) {
  const message = { type: 'admin-sse' as const, data }
  for (const [port, state] of portStates) {
    if (state.admin <= 0) continue
    try {
      port.postMessage(message)
    } catch {
      // Ignore closed ports.
    }
  }
}

function openAdminStream() {
  cancelAdminReconnect()
  if (adminSource || adminRefTotal <= 0) return

  adminSource = new EventSource('/api/events/stream')
  adminSource.onmessage = (event) => {
    adminRetry = 0
    try {
      broadcastAdmin(JSON.parse(event.data))
    } catch {
      // Ignore malformed events.
    }
  }
  adminSource.onerror = () => {
    adminSource?.close()
    adminSource = null
    if (adminRefTotal <= 0) return
    const delay = getDelayMs(adminRetry++)
    adminReconnectTimer = setTimeout(() => {
      adminReconnectTimer = null
      openAdminStream()
    }, delay)
  }
}

function closeAdminStreamIfIdle() {
  cancelAdminReconnect()
  if (adminRefTotal > 0) return
  adminRetry = 0
  adminSource?.close()
  adminSource = null
}

function onPortMessage(port: MessagePort, raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const message = raw as { type?: string }
  if (message.type === 'subscribe-admin') {
    const state = portState(port)
    state.admin++
    adminRefTotal++
    if (adminRefTotal === 1) openAdminStream()
    return
  }
  if (message.type === 'unsubscribe-admin') {
    const state = portStates.get(port)
    if (!state || state.admin <= 0) return
    state.admin--
    adminRefTotal = Math.max(0, adminRefTotal - 1)
    if (state.admin === 0) portStates.delete(port)
    closeAdminStreamIfIdle()
  }
}

declare const self: SharedWorkerGlobalScope

self.onconnect = (event: MessageEvent) => {
  const port = event.ports[0]
  port.start()
  port.addEventListener('message', (message: MessageEvent) => {
    onPortMessage(port, message.data)
  })
}

export {}
