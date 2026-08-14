/// <reference lib="webworker" />

import { apiEndpoints } from '@/lib/api-endpoints'

const INITIAL_DELAY_MS = 5000
const MAX_DELAY_MS = 60000
const BACKOFF_MULTIPLIER = 2

function getDelayMs(retryCount: number): number {
  return Math.min(INITIAL_DELAY_MS * BACKOFF_MULTIPLIER ** retryCount, MAX_DELAY_MS)
}

type PortState = { application: number }
const portStates = new Map<MessagePort, PortState>()

function portState(port: MessagePort): PortState {
  let state = portStates.get(port)
  if (!state) {
    state = { application: 0 }
    portStates.set(port, state)
  }
  return state
}

let applicationReferenceTotal = 0
let applicationSource: EventSource | null = null
let applicationRetry = 0
let applicationReconnectTimer: ReturnType<typeof setTimeout> | null = null

function cancelApplicationReconnect() {
  if (applicationReconnectTimer) {
    clearTimeout(applicationReconnectTimer)
    applicationReconnectTimer = null
  }
}

function broadcastApplication(data: unknown) {
  const message = { type: 'application-sse' as const, data }
  for (const [port, state] of portStates) {
    if (state.application <= 0) continue
    try {
      port.postMessage(message)
    } catch {
      // Ignore closed ports.
    }
  }
}

function openApplicationStream() {
  cancelApplicationReconnect()
  if (applicationSource || applicationReferenceTotal <= 0) return

  applicationSource = new EventSource(apiEndpoints.events.streamUrl)
  applicationSource.onmessage = (event) => {
    applicationRetry = 0
    try {
      broadcastApplication(JSON.parse(event.data))
    } catch {
      // Ignore malformed events.
    }
  }
  applicationSource.onerror = () => {
    applicationSource?.close()
    applicationSource = null
    if (applicationReferenceTotal <= 0) return
    const delay = getDelayMs(applicationRetry++)
    applicationReconnectTimer = setTimeout(() => {
      applicationReconnectTimer = null
      openApplicationStream()
    }, delay)
  }
}

function closeApplicationStreamIfIdle() {
  cancelApplicationReconnect()
  if (applicationReferenceTotal > 0) return
  applicationRetry = 0
  applicationSource?.close()
  applicationSource = null
}

function onPortMessage(port: MessagePort, raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const message = raw as { type?: string }
  if (message.type === 'subscribe-application') {
    const state = portState(port)
    state.application++
    applicationReferenceTotal++
    if (applicationReferenceTotal === 1) openApplicationStream()
    return
  }
  if (message.type === 'unsubscribe-application') {
    const state = portStates.get(port)
    if (!state || state.application <= 0) return
    state.application--
    applicationReferenceTotal = Math.max(0, applicationReferenceTotal - 1)
    if (state.application === 0) portStates.delete(port)
    closeApplicationStreamIfIdle()
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
