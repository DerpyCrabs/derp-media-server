/// <reference lib="webworker" />

import { Schema } from 'effect'
import { workerCommandSchema } from './sse-protocol'
import { createAdminStream } from './sse-reconnect'

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
const adminStream = createAdminStream(broadcastAdmin)
let online = true

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
  if (online && adminRefTotal > 0) adminStream.start()
}

function closeAdminStreamIfIdle() {
  if (adminRefTotal <= 0) adminStream.stop()
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
    online = false
    adminStream.stop()
    return
  }
  if (message.type === 'network-online') {
    online = true
    openAdminStream()
    return
  }
  if (message.type === 'subscribe-admin') {
    const state = portState(port)
    state.admin++
    adminRefTotal++
    if (adminRefTotal === 1) openAdminStream()
    else if (adminStream.connected) sendAdmin(port, { type: 'connected' })
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
