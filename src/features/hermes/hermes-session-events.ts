import { randomId } from '@/lib/random-id'
import { Effect, Schema } from 'effect'
import { eventFrameSchema } from './hermes-api'

import { type HermesToolCall } from './hermes-session-types'
import {
  registry,
  sessions,
  updateHermesState,
  patchHermesState,
  updateHermesMessage,
  stableKeyForSessionId,
  bindHermesSessionId,
} from './hermes-session-registry'
import { messageText, displayValue, scalarString } from './hermes-messages'
import {
  startHermesOperation,
  refreshHermesChat,
  drainHermesQueue,
} from './hermes-session-operations'

export let eventSource: EventSource | null = null

export const reconnectSlot = 'hermes-reconnect'

export const drainSlots = (key: string | number) => ['hermes-drain-queue', key] as const

export function stopEvents() {
  if (eventSource) {
    eventSource.onopen = null
    eventSource.onmessage = null
    eventSource.onerror = null
    eventSource.close()
    eventSource = null
  }
}

export let streamSequence = 0

export function ensureHermesStreamMessage(key: string): number | undefined {
  const state = sessions()[key]
  if (!state) return undefined
  const streamMessageId =
    state.streamMessageId ?? `assistant-stream-${Date.now()}-${++streamSequence}`
  let index = state.messages.findIndex((message) => message.id === streamMessageId)
  if (index < 0) {
    index = state.messages.length
    updateHermesState(key, (state) => ({
      messages: [
        ...state.messages,
        { id: streamMessageId, role: 'assistant', text: '', pending: true },
      ],
    }))
  }
  patchHermesState(key, { streamMessageId, status: 'streaming', awaitingResponse: false })
  return index
}

export function appendHermesStreamDelta(key: string, field: 'text' | 'reasoning', delta: string) {
  if (!delta) return
  const state = sessions()[key]
  if (!state) return
  const id = state.streamMessageId ?? `assistant-stream-${Date.now()}-${++streamSequence}`
  const index = state.messages.findIndex((message) => message.id === id)
  const message =
    index < 0 ? { id, role: 'assistant', text: '', pending: true } : state.messages[index]!
  const next = { ...message, [field]: `${message[field] ?? ''}${delta}` }
  patchHermesState(key, {
    streamMessageId: id,
    status: 'streaming',
    awaitingResponse: false,
    messages:
      index < 0
        ? [...state.messages, next]
        : state.messages.map((message, at) => (at === index ? next : message)),
  })
}

export function upsertHermesStreamTool(
  key: string,
  payload: Record<string, unknown>,
  status: 'running' | 'complete',
) {
  const messageIndex = ensureHermesStreamMessage(key)
  if (messageIndex === undefined) return
  const id =
    scalarString(payload.tool_id) ??
    scalarString(payload.tool_call_id) ??
    scalarString(payload.id) ??
    scalarString(payload.name) ??
    'tool'
  const current = sessions()[key]!.messages[messageIndex]!.toolCalls ?? []
  const callIndex = current.findIndex((call) => call.id === id)
  const previous = callIndex >= 0 ? current[callIndex] : undefined
  const next: HermesToolCall = {
    id,
    name:
      scalarString(payload.name) ??
      scalarString(payload.tool_name) ??
      previous?.name ??
      'Unknown tool',
    arguments:
      displayValue(payload.args ?? payload.arguments ?? payload.input) || previous?.arguments || '',
    result:
      displayValue(payload.result ?? payload.output ?? payload.content ?? payload.message) ||
      previous?.result,
    status,
    inlineDiff:
      typeof payload.inline_diff === 'string' ? payload.inline_diff : previous?.inlineDiff,
  }
  updateHermesMessage(key, messageIndex, {
    toolCalls:
      callIndex >= 0
        ? current.map((call, index) => (index === callIndex ? next : call))
        : [...current, next],
  })
}

export function refreshIdle() {
  for (const key of Object.keys(sessions())) {
    if (
      sessions()[key]?.sessionId &&
      sessions()[key]?.status === 'idle' &&
      !sessions()[key]?.awaitingResponse
    ) {
      startHermesOperation(`history:${key}`, refreshHermesChat(key), 'replace')
    }
  }
}

export function settleHermesStream(key: string, finalText: string) {
  const streamMessageId = sessions()[key]?.streamMessageId
  const streamIndex = streamMessageId
    ? sessions()[key]!.messages.findIndex((message) => message.id === streamMessageId)
    : -1
  if (streamIndex >= 0) {
    updateHermesMessage(key, streamIndex, {
      ...(finalText ? { text: finalText } : {}),
      pending: false,
    })
  } else if (finalText) {
    updateHermesState(key, (state) => ({
      messages: [
        ...state.messages,
        {
          id: `assistant-complete-${Date.now()}-${++streamSequence}`,
          role: 'assistant',
          text: finalText,
        },
      ],
    }))
  }
  patchHermesState(key, { streamMessageId: undefined, awaitingResponse: false })
}

export function connectEvents() {
  if (registry.disposed || eventSource || typeof EventSource === 'undefined') return
  eventSource = new EventSource('/api/hermes/events')
  eventSource.onopen = () => {
    for (const key of Object.keys(sessions()))
      patchHermesState(key, { connection: 'connected', error: undefined })
    refreshIdle()
  }
  eventSource.onmessage = (message) => {
    let raw: unknown
    try {
      raw = JSON.parse(message.data)
    } catch {
      return
    }
    const decoded = Schema.decodeUnknownExit(eventFrameSchema)(raw)
    if (decoded._tag === 'Failure') return
    const frame = decoded.value
    const event = 'params' in frame ? frame.params : frame
    const sessionId = event?.durable_session_id
    const previousSessionId = event?.previous_durable_session_id
    const kind = String(event?.type ?? '')
    const routedKey =
      (typeof sessionId === 'string' ? stableKeyForSessionId(sessionId) : undefined) ??
      (typeof previousSessionId === 'string'
        ? stableKeyForSessionId(previousSessionId)
        : undefined) ??
      (typeof sessionId === 'string' || typeof previousSessionId === 'string'
        ? Object.keys(sessions()).find(
            (candidate) =>
              sessions()[candidate]?.sessionId === sessionId ||
              sessions()[candidate]?.sessionId === previousSessionId,
          )
        : undefined)
    const activeCandidates = Object.keys(sessions()).filter(
      (candidate) =>
        sessions()[candidate]?.awaitingResponse ||
        sessions()[candidate]?.status === 'sending' ||
        sessions()[candidate]?.status === 'streaming',
    )
    const key = routedKey ?? (activeCandidates.length === 1 ? activeCandidates[0] : undefined)
    const payload = event.payload ?? {}

    if (kind === 'transport.disconnected' || kind === 'transport.connected') {
      const connected = kind === 'transport.connected'
      for (const candidate of Object.keys(sessions())) {
        if (!sessions()[candidate]?.sessionId) continue
        patchHermesState(candidate, {
          connection: connected ? 'connected' : 'disconnected',
          error: connected ? undefined : 'Hermes gateway disconnected',
        })
      }
      if (connected) refreshIdle()
      return
    }
    if (!key || !sessions()[key]) return

    if (
      typeof sessionId === 'string' &&
      typeof previousSessionId === 'string' &&
      sessionId !== previousSessionId
    ) {
      bindHermesSessionId(key, sessionId)
    }
    if (kind === 'message.start') {
      patchHermesState(key, { status: 'streaming', awaitingResponse: true })
    } else if (kind === 'message.delta') {
      appendHermesStreamDelta(
        key,
        'text',
        messageText(payload.text ?? payload.delta ?? payload.content),
      )
    } else if (kind === 'reasoning.delta') {
      appendHermesStreamDelta(
        key,
        'reasoning',
        messageText(payload.text ?? payload.delta ?? payload.content),
      )
    } else if (kind === 'reasoning.available') {
      const index = ensureHermesStreamMessage(key)
      const reasoning = messageText(payload.text ?? payload.content)
      if (index !== undefined && reasoning) updateHermesMessage(key, index, { reasoning })
    } else if (kind === 'message.interim') {
      const index = ensureHermesStreamMessage(key)
      const text = messageText(payload.text ?? payload.rendered)
      if (index !== undefined) {
        updateHermesMessage(key, index, { ...(text ? { text } : {}), pending: false })
        patchHermesState(key, { streamMessageId: undefined })
      }
    } else if (kind === 'message.complete' || kind === 'error') {
      settleHermesStream(
        key,
        kind === 'message.complete' ? messageText(payload.text ?? payload.rendered) : '',
      )
      patchHermesState(key, {
        status: kind === 'error' ? 'error' : 'idle',
        ...(kind === 'message.complete' ? { unread: true } : {}),
      })
      if (kind === 'error')
        updateHermesState(key, () => ({ error: messageText(payload.message ?? payload.error) }))
      if (kind === 'message.complete')
        void registry.run(
          drainSlots(key),
          Effect.yieldNow.pipe(
            Effect.andThen(drainHermesQueue(key)),
            Effect.catch(() => Effect.void),
          ),
          'drop',
        )
    } else if (kind === 'tool.start' || kind === 'tool.progress') {
      upsertHermesStreamTool(key, payload, 'running')
    } else if (kind === 'tool.complete') {
      upsertHermesStreamTool(key, payload, 'complete')
    } else if (kind === 'approval.request') {
      updateHermesState(key, () => ({
        decision: {
          kind: 'approval',
          requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
          dedupeId:
            scalarString(payload.request_id) ??
            scalarString(payload.tool_id) ??
            scalarString(payload.tool_call_id) ??
            randomId(),
          prompt: messageText(payload.command ?? payload.description) || 'Hermes requests approval',
          choices: Array.isArray(payload.choices) ? payload.choices.map(String) : ['once', 'deny'],
        },
      }))
    } else if (kind === 'clarify.request') {
      updateHermesState(key, () => ({
        decision: {
          kind: 'clarify',
          requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
          dedupeId: scalarString(payload.request_id) ?? randomId(),
          prompt: messageText(payload.question),
          choices: Array.isArray(payload.choices)
            ? payload.choices.map((choice: unknown) =>
                typeof choice === 'string'
                  ? choice
                  : messageText(
                      typeof choice === 'object' && choice !== null
                        ? 'label' in choice
                          ? choice.label
                          : 'value' in choice
                            ? choice.value
                            : ''
                        : '',
                    ),
              )
            : [],
        },
      }))
    } else if (kind === 'sudo.request' || kind === 'secret.request') {
      updateHermesState(key, () => ({
        decision: {
          kind: kind === 'sudo.request' ? 'sudo' : 'secret',
          requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
          dedupeId: scalarString(payload.request_id) ?? randomId(),
          prompt:
            kind === 'sudo.request'
              ? 'Hermes needs administrator credentials'
              : messageText(payload.prompt ?? payload.env_var) || 'Hermes needs a secret value',
          choices: [],
        },
      }))
    } else if (kind.startsWith('subagent.')) {
      upsertHermesStreamTool(
        key,
        {
          ...payload,
          name: payload.name ?? 'delegate_task',
          tool_id: payload.tool_id ?? payload.id ?? payload.task_id,
        },
        kind === 'subagent.complete' ? 'complete' : 'running',
      )
    } else if (kind === 'session.info') {
      if (payload.running === true && sessions()[key]?.status === 'idle')
        updateHermesState(key, () => ({ status: 'streaming' }))
      if (
        payload.running === false &&
        !sessions()[key]?.awaitingResponse &&
        sessions()[key]?.status === 'streaming'
      ) {
        settleHermesStream(key, '')
        updateHermesState(key, () => ({ status: 'idle' }))
      }
    }
  }
  eventSource.onerror = () => {
    for (const key of Object.keys(sessions())) {
      if (sessions()[key]?.sessionId)
        patchHermesState(key, { connection: 'disconnected', error: 'Hermes gateway disconnected' })
    }
    eventSource?.close()
    eventSource = null
    void registry.run(
      reconnectSlot,
      Effect.sleep(1500).pipe(Effect.andThen(Effect.sync(connectEvents))),
      'replace',
    )
  }
}
