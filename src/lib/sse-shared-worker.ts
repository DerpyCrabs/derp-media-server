/// <reference lib="webworker" />

const INITIAL_DELAY_MS = 5000
const MAX_DELAY_MS = 60000
const BACKOFF_MULTIPLIER = 2

function getDelayMs(retryCount: number): number {
  const delay = INITIAL_DELAY_MS * BACKOFF_MULTIPLIER ** retryCount
  return Math.min(delay, MAX_DELAY_MS)
}

type PortState = { admin: number; shares: Map<string, number> }

const portStates = new Map<MessagePort, PortState>()

function portState(port: MessagePort): PortState {
  let s = portStates.get(port)
  if (!s) {
    s = { admin: 0, shares: new Map() }
    portStates.set(port, s)
  }
  return s
}

let adminRefTotal = 0
let adminSource: EventSource | null = null
let adminRetry = 0
let adminReconnectTimer: ReturnType<typeof setTimeout> | null = null

const shareRefTotal = new Map<string, number>()
const shareSources = new Map<string, EventSource>()
const shareRetry = new Map<string, number>()
const shareReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

function cancelAdminReconnect() {
  if (adminReconnectTimer) {
    clearTimeout(adminReconnectTimer)
    adminReconnectTimer = null
  }
}

function cancelShareReconnect(token: string) {
  const t = shareReconnectTimers.get(token)
  if (t) {
    clearTimeout(t)
    shareReconnectTimers.delete(token)
  }
}

function broadcastAdmin(data: unknown) {
  const msg = { type: 'admin-sse' as const, data }
  for (const [port, st] of portStates) {
    if (st.admin > 0) {
      try {
        port.postMessage(msg)
      } catch {
        // ignore
      }
    }
  }
}

function broadcastShare(token: string, data: unknown) {
  const msg = { type: 'share-sse' as const, token, data }
  for (const [port, st] of portStates) {
    if ((st.shares.get(token) ?? 0) > 0) {
      try {
        port.postMessage(msg)
      } catch {
        // ignore
      }
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
      // ignore malformed
    }
  }
  adminSource.onerror = () => {
    if (adminSource) {
      adminSource.close()
      adminSource = null
    }
    if (adminRefTotal <= 0) return
    const delay = getDelayMs(adminRetry)
    adminRetry++
    cancelAdminReconnect()
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
  if (adminSource) {
    adminSource.close()
    adminSource = null
  }
}

function openShareStream(token: string) {
  cancelShareReconnect(token)
  if (shareSources.has(token) || (shareRefTotal.get(token) ?? 0) <= 0) return

  const url = `/api/share/${encodeURIComponent(token)}/stream`
  const es = new EventSource(url)
  shareSources.set(token, es)

  es.onmessage = (event) => {
    shareRetry.set(token, 0)
    try {
      broadcastShare(token, JSON.parse(event.data))
    } catch {
      // ignore malformed
    }
  }

  es.onerror = () => {
    const cur = shareSources.get(token)
    if (cur) {
      cur.close()
      shareSources.delete(token)
    }
    if ((shareRefTotal.get(token) ?? 0) <= 0) return
    const r = shareRetry.get(token) ?? 0
    const delay = getDelayMs(r)
    shareRetry.set(token, r + 1)
    cancelShareReconnect(token)
    shareReconnectTimers.set(
      token,
      setTimeout(() => {
        shareReconnectTimers.delete(token)
        openShareStream(token)
      }, delay),
    )
  }
}

function closeShareStreamIfIdle(token: string) {
  cancelShareReconnect(token)
  if ((shareRefTotal.get(token) ?? 0) > 0) return
  shareRetry.delete(token)
  const es = shareSources.get(token)
  if (es) {
    es.close()
    shareSources.delete(token)
  }
}

function onPortMessage(port: MessagePort, raw: unknown) {
  if (!raw || typeof raw !== 'object') return
  const msg = raw as { type?: string; token?: string }

  if (msg.type === 'subscribe-admin') {
    const st = portState(port)
    st.admin++
    adminRefTotal++
    if (adminRefTotal === 1) openAdminStream()
    return
  }

  if (msg.type === 'unsubscribe-admin') {
    const st = portStates.get(port)
    if (!st || st.admin <= 0) return
    st.admin--
    adminRefTotal = Math.max(0, adminRefTotal - 1)
    if (st.admin === 0 && st.shares.size === 0) portStates.delete(port)
    closeAdminStreamIfIdle()
    return
  }

  if (msg.type === 'subscribe-share' && typeof msg.token === 'string' && msg.token) {
    const token = msg.token
    const st = portState(port)
    st.shares.set(token, (st.shares.get(token) ?? 0) + 1)
    const next = (shareRefTotal.get(token) ?? 0) + 1
    shareRefTotal.set(token, next)
    if (next === 1) openShareStream(token)
    return
  }

  if (msg.type === 'unsubscribe-share' && typeof msg.token === 'string') {
    const token = msg.token
    const st = portStates.get(port)
    if (!st) return
    const cur = st.shares.get(token) ?? 0
    if (cur <= 0) return
    if (cur <= 1) st.shares.delete(token)
    else st.shares.set(token, cur - 1)
    const total = Math.max(0, (shareRefTotal.get(token) ?? 0) - 1)
    if (total === 0) shareRefTotal.delete(token)
    else shareRefTotal.set(token, total)
    if (st.admin === 0 && st.shares.size === 0) portStates.delete(port)
    closeShareStreamIfIdle(token)
  }
}

declare const self: SharedWorkerGlobalScope

self.onconnect = (e: MessageEvent) => {
  const port = e.ports[0]
  port.start()
  port.addEventListener('message', (ev: MessageEvent) => {
    onPortMessage(port, ev.data)
  })
}

export {}
