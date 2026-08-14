import type {
  AssistantCompletionRequest,
  AssistantProvider,
} from '@/src/features/content/contracts'
import { hermesTransportRoutes } from './transport'

let capability: Promise<boolean> | undefined

function eventText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .map((part) =>
      typeof part === 'string'
        ? part
        : part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? String((part as { text: string }).text)
          : '',
    )
    .join('')
}

async function available(): Promise<boolean> {
  capability ??= fetch(hermesTransportRoutes.capabilities)
    .then(async (response) => {
      const capabilities = await response.json().catch(() => null)
      return response.ok && capabilities?.readerAi === true
    })
    .catch(() => false)
  return capability
}

async function complete(request: AssistantCompletionRequest): Promise<string> {
  if (!(await available())) throw new Error('Hermes assistant is unavailable')

  const events = new EventSource(hermesTransportRoutes.events)
  let sessionId = ''
  let streamed = ''
  let settled = false
  let timeout = 0
  const pendingEvents: unknown[] = []

  const completion = new Promise<string>((resolve, reject) => {
    timeout = window.setTimeout(() => {
      settled = true
      events.close()
      reject(new Error('Hermes assistant timed out'))
    }, request.timeoutMs ?? 120_000)

    const consume = (raw: unknown) => {
      const event = raw as {
        params?: {
          durable_session_id?: unknown
          previous_durable_session_id?: unknown
          type?: unknown
          payload?: Record<string, unknown>
        }
      }
      const params = event.params ?? (raw as typeof event.params)
      const durableId = params?.durable_session_id
      const previousDurableId = params?.previous_durable_session_id
      if (!sessionId) {
        pendingEvents.push(raw)
        return
      }
      if (durableId !== sessionId && previousDurableId !== sessionId) return
      if (previousDurableId === sessionId && typeof durableId === 'string') sessionId = durableId
      const payload = params?.payload ?? {}
      if (params?.type === 'message.delta') {
        streamed += eventText(payload.text ?? payload.delta ?? payload.content)
      } else if (params?.type === 'message.complete') {
        settled = true
        window.clearTimeout(timeout)
        events.close()
        resolve(eventText(payload.text ?? payload.rendered) || streamed)
      } else if (params?.type === 'error') {
        settled = true
        window.clearTimeout(timeout)
        events.close()
        reject(new Error(eventText(payload.message ?? payload.error) || 'Hermes assistant failed'))
      }
    }
    events.onmessage = (message) => {
      try {
        consume(JSON.parse(message.data))
      } catch {}
    }
    ;(events as EventSource & { consume?: (raw: unknown) => void }).consume = consume
    events.onerror = () => {
      if (!settled && sessionId) {
        window.clearTimeout(timeout)
        events.close()
        reject(new Error('Hermes gateway disconnected'))
      }
    }
  })

  try {
    const response = await fetch(hermesTransportRoutes.turn, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: request.prompt, attachments: request.attachments ?? [] }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(
        payload?.error ?? payload?.message ?? `Hermes assistant failed (${response.status})`,
      )
    }
    sessionId = String(payload.sessionId)
    const consume = (events as EventSource & { consume?: (raw: unknown) => void }).consume
    pendingEvents.splice(0).forEach((event) => consume?.(event))
    return await completion
  } finally {
    settled = true
    window.clearTimeout(timeout)
    events.close()
    if (sessionId) {
      void fetch(hermesTransportRoutes.archive, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    }
  }
}

export const hermesAssistantProvider: AssistantProvider = { available, complete }
