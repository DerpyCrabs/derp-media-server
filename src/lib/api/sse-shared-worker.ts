/// <reference lib="webworker" />

import { Schema } from 'effect'
import { sseEventSchema, workerCommandSchema } from './sse-protocol'

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
let adminConnected = false
let adminRetry = 0
let adminReconnectTimer: ReturnType<typeof setTimeout> | null = null

function cancelAdminReconnect() {
  if (adminReconnectTimer) {
    clearTimeout(adminReconnectTimer)
    adminReconnectTimer = null
  }
}

function broadcastAdmin(data: unknown) {
  for (const [port, state] of portStates) {
    if (state.admin <= 0) continue
    sendAdmin(port, data)
  }
}

function sendAdmin(port: MessagePort, data: unknown) {
  try {
    port.postMessage({ type: 'admin-sse' as const, data })
  } catch {
    // Ignore closed ports.
  }
}

function openAdminStream() {
  cancelAdminReconnect()
  if (adminSource || adminRefTotal <= 0) return

  adminConnected = false
  adminSource = new EventSource('/api/events/stream')
  adminSource.onmessage = (event) => {
    try {
      const decoded = Schema.decodeUnknownExit(sseEventSchema)(JSON.parse(event.data))
      if (decoded._tag === 'Failure') return
      const data = decoded.value
      if (data.type === 'connected') adminConnected = true
      adminRetry = 0
      broadcastAdmin(data)
    } catch {
      // Ignore malformed events.
    }
  }
  adminSource.onerror = () => {
    adminConnected = false
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
  if (adminRefTotal > 0) return
  cancelAdminReconnect()
  adminRetry = 0
  adminConnected = false
  adminSource?.close()
  adminSource = null
}

function onPortMessage(port: MessagePort, raw: unknown) {
  const decoded = Schema.decodeUnknownExit(workerCommandSchema)(raw)
  if (decoded._tag === 'Failure') return
  const message = decoded.value
  if (message.type === 'disconnect') {
    adminRefTotal -= portStates.get(port)?.admin ?? 0
    portStates.delete(port)
    port.close()
    closeAdminStreamIfIdle()
    return
  }
  if (message.type === 'network-offline') {
    cancelAdminReconnect()
    adminConnected = false
    adminSource?.close()
    adminSource = null
    return
  }
  if (message.type === 'network-online') {
    adminRetry = 0
    openAdminStream()
    return
  }
  if (message.type === 'subscribe-admin') {
    const state = portState(port)
    state.admin++
    adminRefTotal++
    if (adminRefTotal === 1) openAdminStream()
    else if (adminConnected) sendAdmin(port, { type: 'connected' })
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
