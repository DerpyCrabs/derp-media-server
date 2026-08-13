import { createStore, reconcile } from 'solid-js/store'
import type { FileDragData } from './file-drag-data'
import {
  extractHermesMessageImages,
  filterHermesCompletions,
  rewindTarget,
} from './hermes-chat-parity'

export type HermesMessage = {
  id: string
  role: string
  text: string
  reasoning?: string
  timestamp?: number
  toolName?: string
  toolCallId?: string
  toolStatus?: 'running' | 'complete' | 'error'
  toolInput?: string
  inlineDiff?: string
  toolCalls?: HermesToolCall[]
  images?: string[]
  pending?: boolean
}

export type HermesToolCall = {
  id: string
  name: string
  arguments: string
  result?: string
  status?: 'running' | 'complete' | 'error'
  inlineDiff?: string
}

export const HERMES_ATTACHMENT_LIMIT = 16 * 1024 * 1024

export type HermesAttachment = {
  id: string
  name: string
  mimeType: string
  size: number
  contentBase64: string
  status: 'ready' | 'uploading' | 'error'
  error?: string
}

export type HermesChatState = {
  sessionId?: string
  lineageRootId?: string
  draftId?: string
  cwd?: string | null
  messages: HermesMessage[]
  hasOlderMessages: boolean
  historyLoading: boolean
  composer: string
  attachments: HermesAttachment[]
  queuedPrompts: HermesQueuedPrompt[]
  queueParked: boolean
  completions: HermesCompletion[]
  model?: string
  provider?: string
  modelOptions: HermesModelOption[]
  voice: { transcription: boolean; playback: boolean; maxRecordingSeconds: number }
  status: 'idle' | 'loading' | 'sending' | 'streaming' | 'error'
  awaitingResponse: boolean
  streamMessageId?: string
  error?: string
  editorOwner?: string
  readOnly: boolean
  archived?: boolean
  unavailable?: boolean
  externallyActive?: boolean
  externalSource?: string
  takeoverPending?: boolean
  connection: 'connected' | 'disconnected' | 'auth-error'
  title?: string
  unread?: boolean
  decision?: {
    kind: 'approval' | 'clarify' | 'secret' | 'sudo'
    requestId?: string
    dedupeId: string
    prompt: string
    choices: string[]
  }
}

export type HermesCompletion = { text: string; display?: string; meta?: string; kind?: string }
export type HermesModelOption = { value: string; label: string; reasoning: boolean; fast: boolean }
export type HermesQueuedPrompt = { text: string; attachments: HermesAttachment[] }

const [sessions, setSessions] = createStore<Record<string, HermesChatState>>({})
let eventSource: EventSource | null = null
const activeHermesSends = new Set<string>()

export function hermesChatKey(target: { sessionId?: string; draftId?: string }): string {
  return target.sessionId
    ? `session:${target.sessionId}`
    : `draft:${target.draftId ?? crypto.randomUUID()}`
}

function messageText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>
          return typeof record.text === 'string'
            ? record.text
            : typeof record.content === 'string'
              ? record.content
              : ''
        }
        return ''
      })
      .join('')
  }
  return ''
}

function displayValue(value: unknown): string {
  const text = messageText(value)
  if (text) return text
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizeMessages(value: unknown): HermesMessage[] {
  if (!Array.isArray(value)) return []
  const messages = value.map((raw, index): HermesMessage => {
    const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const toolCalls = Array.isArray(row.tool_calls)
      ? row.tool_calls.map((call, callIndex): HermesToolCall => {
          const record = (call && typeof call === 'object' ? call : {}) as Record<string, unknown>
          const fn = (
            record.function && typeof record.function === 'object' ? record.function : {}
          ) as Record<string, unknown>
          return {
            id: String(record.id ?? `${row.id ?? index}-tool-${callIndex}`),
            name: String(fn.name ?? record.name ?? row.tool_name ?? 'Unknown tool'),
            arguments:
              typeof fn.arguments === 'string'
                ? fn.arguments
                : JSON.stringify(fn.arguments ?? record.arguments ?? {}, null, 2),
          }
        })
      : undefined
    const media = extractHermesMessageImages(messageText(row.text ?? row.content))
    return {
      id: String(row.id ?? row.row_id ?? `${row.timestamp ?? 0}-${index}`),
      role: typeof row.role === 'string' ? row.role : 'assistant',
      text: media.text,
      images: media.images.length ? media.images : undefined,
      reasoning: messageText(row.reasoning_content ?? row.reasoning) || undefined,
      timestamp: typeof row.timestamp === 'number' ? row.timestamp : undefined,
      toolName: typeof row.tool_name === 'string' ? row.tool_name : undefined,
      toolCallId: typeof row.tool_call_id === 'string' ? row.tool_call_id : undefined,
      toolStatus: row.role === 'tool' ? 'complete' : undefined,
      inlineDiff: typeof row.inline_diff === 'string' ? row.inline_diff : undefined,
      toolCalls,
    }
  })
  const calls = new Map<string, HermesToolCall>()
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) calls.set(call.id, call)
  }
  return messages.filter((message) => {
    if (message.role !== 'tool' || !message.toolCallId) return true
    const call = calls.get(message.toolCallId)
    if (!call) return true
    call.result = message.text
    call.status = message.toolStatus ?? 'complete'
    call.inlineDiff = message.inlineDiff
    return false
  })
}

function sameHermesMessages(left: HermesMessage[], right: HermesMessage[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((message, index) => JSON.stringify(message) === JSON.stringify(right[index]))
}

let streamSequence = 0

function ensureHermesStreamMessage(key: string): number | undefined {
  const state = sessions[key]
  if (!state) return
  const streamMessageId =
    state.streamMessageId ?? `assistant-stream-${Date.now()}-${++streamSequence}`
  let index = state.messages.findIndex((message) => message.id === streamMessageId)
  if (index < 0) {
    setSessions(key, 'messages', (messages) => [
      ...messages,
      { id: streamMessageId, role: 'assistant', text: '', pending: true },
    ])
    index = sessions[key]!.messages.length - 1
  }
  setSessions(key, {
    streamMessageId,
    status: 'streaming',
    awaitingResponse: false,
  })
  return index
}

function appendHermesStreamDelta(key: string, field: 'text' | 'reasoning', delta: string) {
  if (!delta) return
  const index = ensureHermesStreamMessage(key)
  if (index === undefined) return
  setSessions(key, 'messages', index, field, (value) => `${value ?? ''}${delta}`)
}

function upsertHermesStreamTool(
  key: string,
  payload: Record<string, unknown>,
  status: 'running' | 'complete',
) {
  const messageIndex = ensureHermesStreamMessage(key)
  if (messageIndex === undefined) return
  const id = String(payload.tool_id ?? payload.tool_call_id ?? payload.id ?? payload.name ?? 'tool')
  const current = sessions[key]!.messages[messageIndex]!.toolCalls ?? []
  const callIndex = current.findIndex((call) => call.id === id)
  const previous = callIndex >= 0 ? current[callIndex] : undefined
  const next: HermesToolCall = {
    id,
    name: String(payload.name ?? payload.tool_name ?? previous?.name ?? 'Unknown tool'),
    arguments:
      displayValue(payload.args ?? payload.arguments ?? payload.input) || previous?.arguments || '',
    result:
      displayValue(payload.result ?? payload.output ?? payload.content ?? payload.message) ||
      previous?.result,
    status,
    inlineDiff:
      typeof payload.inline_diff === 'string' ? payload.inline_diff : previous?.inlineDiff,
  }
  setSessions(
    key,
    'messages',
    messageIndex,
    'toolCalls',
    callIndex >= 0
      ? current.map((call, index) => (index === callIndex ? next : call))
      : [...current, next],
  )
}

class HermesRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function jsonRequest(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null)
  if (!response.ok)
    throw new HermesRequestError(
      payload?.error ?? payload?.message ?? `Request failed (${response.status})`,
      response.status,
    )
  return payload
}

export function ensureHermesChat(target: {
  sessionId?: string
  draftId?: string
  cwd?: string | null
  readOnly?: boolean
}): string {
  const key = hermesChatKey(target)
  if (!sessions[key]) {
    setSessions(key, {
      ...target,
      lineageRootId: target.sessionId,
      messages: [],
      hasOlderMessages: true,
      historyLoading: false,
      composer: '',
      attachments: [],
      queuedPrompts: [],
      queueParked: false,
      completions: [],
      modelOptions: [],
      voice: { transcription: false, playback: false, maxRecordingSeconds: 120 },
      connection: 'connected',
      status: target.sessionId ? 'loading' : 'idle',
      awaitingResponse: false,
      readOnly: !!target.readOnly,
    })
    if (target.sessionId) void refreshHermesChat(key)
    void refreshHermesModelOptions(key)
    void refreshHermesCapabilities(key)
  }
  connectEvents()
  return key
}

async function refreshHermesCapabilities(key: string) {
  try {
    const payload = await jsonRequest('/api/hermes/capabilities')
    if (!sessions[key]) return
    setSessions(key, {
      voice: {
        transcription: payload.transcription === true,
        playback: payload.playback === true,
        maxRecordingSeconds: Number(payload.maxRecordingSeconds) || 120,
      },
    })
  } catch {
    // Optional controls remain hidden.
  }
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read voice recording'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

export async function transcribeHermesAudio(key: string, blob: Blob) {
  const dataUrl = await blobDataUrl(blob)
  const payload = await jsonRequest('/api/hermes/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, mimeType: blob.type }),
  })
  const transcript = typeof payload.transcript === 'string' ? payload.transcript.trim() : ''
  if (transcript && sessions[key]) {
    const prefix = sessions[key]!.composer && !/\s$/.test(sessions[key]!.composer) ? ' ' : ''
    setSessions(key, 'composer', `${sessions[key]!.composer}${prefix}${transcript}`)
  }
}

let replyAudio: HTMLAudioElement | undefined
export async function speakHermesText(text: string) {
  replyAudio?.pause()
  const payload = await jsonRequest('/api/hermes/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (typeof payload.data_url !== 'string') throw new Error('Hermes returned no reply audio')
  replyAudio = new Audio(payload.data_url)
  await replyAudio.play()
}

export async function refreshHermesChat(key: string) {
  const state = sessions[key]
  if (!state?.sessionId) return
  try {
    const encoded = encodeURIComponent(state.sessionId)
    const historyLimit = Math.min(500, Math.max(100, state.messages.length))
    const [payload, detail] = await Promise.all([
      jsonRequest(`/api/hermes/sessions/${encoded}/messages?limit=${historyLimit}&offset=0`),
      jsonRequest(`/api/hermes/sessions/${encoded}`),
    ])
    const archived = detail.archived === true
    const externallyActive = detail.externallyActive === true
    const refreshed = normalizeMessages(payload.messages ?? payload.data)
    const current = sessions[key]?.messages ?? []
    const retainedCount = Math.max(0, current.length - historyLimit)
    const messages = retainedCount ? [...current.slice(0, retainedCount), ...refreshed] : refreshed
    if (!sameHermesMessages(current, messages))
      setSessions(key, 'messages', reconcile(messages, { key: 'id' }))
    setSessions(key, {
      hasOlderMessages: retainedCount
        ? state.hasOlderMessages
        : (Array.isArray(payload.messages)
            ? payload.messages.length
            : Array.isArray(payload.data)
              ? payload.data.length
              : 0) >= historyLimit,
      archived,
      readOnly: archived || externallyActive,
      externallyActive,
      externalSource: typeof detail.source === 'string' ? detail.source : undefined,
      unavailable: false,
      connection: 'connected',
      title: typeof detail.title === 'string' ? detail.title : state.title,
      model: typeof detail.model === 'string' ? detail.model : state.model,
    })
    if (sessions[key]?.status === 'loading') setSessions(key, 'status', 'idle')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const unavailable = error instanceof HermesRequestError && error.status === 404
    const connection =
      error instanceof HermesRequestError && (error.status === 401 || error.status === 403)
        ? 'auth-error'
        : 'disconnected'
    if (unavailable && state.sessionId)
      deletedHermesSessionIds.add(state.lineageRootId ?? state.sessionId)
    setSessions(key, {
      status: 'error',
      error: message,
      unavailable,
      connection,
      ...(unavailable ? { readOnly: true } : {}),
    })
  }
}

export async function loadOlderHermesMessages(key: string) {
  const state = sessions[key]
  if (!state?.sessionId || state.historyLoading || !state.hasOlderMessages) return 0
  setSessions(key, 'historyLoading', true)
  try {
    const payload = await jsonRequest(
      `/api/hermes/sessions/${encodeURIComponent(state.sessionId)}/messages?limit=100&offset=${state.messages.length}`,
    )
    const older = normalizeMessages(payload.messages ?? payload.data)
    const existing = new Set(sessions[key]!.messages.map((message) => message.id))
    const unique = older.filter((message) => !existing.has(message.id))
    setSessions(key, {
      messages: [...unique, ...sessions[key]!.messages],
      hasOlderMessages: older.length === 100,
      historyLoading: false,
    })
    return unique.length
  } catch (error) {
    setSessions(key, {
      historyLoading: false,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

async function refreshHermesModelOptions(key: string) {
  try {
    const payload = await jsonRequest('/api/hermes/model-options')
    if (!sessions[key]) return
    const providers = Array.isArray(payload.providers) ? payload.providers : []
    const options: HermesModelOption[] = providers.flatMap((provider: any) => {
      if (provider?.authenticated === false || !Array.isArray(provider?.models)) return []
      return provider.models.map((model: unknown) => {
        const value = String(model)
        const capabilities = provider.capabilities?.[value]
        return {
          value: `${String(provider.slug ?? provider.name)}/${value}`,
          label: `${String(provider.name ?? provider.slug)} · ${value}`,
          reasoning: capabilities?.reasoning !== false,
          fast: capabilities?.fast === true,
        }
      })
    })
    setSessions(key, { modelOptions: options, model: payload.model, provider: payload.provider })
  } catch {
    // Optional capability. Chat remains usable without model controls.
  }
}

export async function sendHermesControl(key: string, command: string) {
  if (!sessions[key] || sessions[key]!.readOnly) return
  setSessions(key, { composer: command, completions: [] })
  return sendHermesPrompt(key)
}

function refreshIdle() {
  for (const key of Object.keys(sessions)) {
    if (
      sessions[key]?.sessionId &&
      sessions[key]?.status === 'idle' &&
      !sessions[key]?.awaitingResponse
    ) {
      void refreshHermesChat(key)
    }
  }
}

function settleHermesStream(key: string, finalText: string) {
  const streamMessageId = sessions[key]?.streamMessageId
  const streamIndex = streamMessageId
    ? sessions[key]!.messages.findIndex((message) => message.id === streamMessageId)
    : -1
  if (streamIndex >= 0) {
    if (finalText) setSessions(key, 'messages', streamIndex, 'text', finalText)
    setSessions(key, 'messages', streamIndex, 'pending', false)
  } else if (finalText) {
    setSessions(key, 'messages', (messages) => [
      ...messages,
      {
        id: `assistant-complete-${Date.now()}-${++streamSequence}`,
        role: 'assistant',
        text: finalText,
      },
    ])
  }
  setSessions(key, { streamMessageId: undefined, awaitingResponse: false })
}

function connectEvents() {
  if (eventSource || typeof EventSource === 'undefined') return
  eventSource = new EventSource('/api/hermes/events')
  eventSource.onopen = () => {
    for (const key of Object.keys(sessions))
      setSessions(key, { connection: 'connected', error: undefined })
    refreshIdle()
  }
  eventSource.onmessage = (message) => {
    let frame: any
    try {
      frame = JSON.parse(message.data)
    } catch {
      return
    }
    const event = frame?.params ?? frame
    const sessionId = event?.durable_session_id
    const previousSessionId = event?.previous_durable_session_id
    const kind = String(event?.type ?? '')
    const routedKey =
      typeof sessionId === 'string'
        ? sessions[`session:${sessionId}`]
          ? `session:${sessionId}`
          : Object.keys(sessions).find(
              (candidate) =>
                sessions[candidate]?.sessionId === sessionId ||
                sessions[candidate]?.sessionId === previousSessionId,
            )
        : typeof previousSessionId === 'string'
          ? Object.keys(sessions).find(
              (candidate) => sessions[candidate]?.sessionId === previousSessionId,
            )
          : undefined
    const activeCandidates = Object.keys(sessions).filter(
      (candidate) =>
        sessions[candidate]?.awaitingResponse ||
        sessions[candidate]?.status === 'sending' ||
        sessions[candidate]?.status === 'streaming',
    )
    let key = routedKey ?? (activeCandidates.length === 1 ? activeCandidates[0] : undefined)
    const payload = (event?.payload ?? {}) as Record<string, unknown>

    if (kind === 'transport.disconnected' || kind === 'transport.connected') {
      const connected = kind === 'transport.connected'
      for (const candidate of Object.keys(sessions)) {
        if (!sessions[candidate]?.sessionId) continue
        setSessions(candidate, {
          connection: connected ? 'connected' : 'disconnected',
          error: connected ? undefined : 'Hermes gateway disconnected',
        })
      }
      if (connected) refreshIdle()
      return
    }
    if (!key || !sessions[key]) return

    if (
      typeof sessionId === 'string' &&
      typeof previousSessionId === 'string' &&
      sessionId !== previousSessionId
    ) {
      const nextKey = `session:${sessionId}`
      if (nextKey !== key) {
        const previousKey = key
        setSessions(nextKey, {
          ...sessions[key]!,
          sessionId,
          draftId: undefined,
        })
        // Keep the old entry long enough for mounted panes to persist the new durable id.
        setSessions(key, 'sessionId', sessionId)
        key = nextKey
        queueMicrotask(() => cleanupHermesAlias(previousKey))
      } else {
        setSessions(key, 'sessionId', sessionId)
      }
    }
    if (kind === 'message.start') {
      setSessions(key, { status: 'streaming', awaitingResponse: true })
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
      if (index !== undefined && reasoning)
        setSessions(key, 'messages', index, 'reasoning', reasoning)
    } else if (kind === 'message.interim') {
      const index = ensureHermesStreamMessage(key)
      const text = messageText(payload.text ?? payload.rendered)
      if (index !== undefined) {
        if (text) setSessions(key, 'messages', index, 'text', text)
        setSessions(key, 'messages', index, 'pending', false)
        setSessions(key, 'streamMessageId', undefined)
      }
    } else if (kind === 'message.complete' || kind === 'error') {
      settleHermesStream(
        key,
        kind === 'message.complete' ? messageText(payload.text ?? payload.rendered) : '',
      )
      setSessions(key, {
        status: kind === 'error' ? 'error' : 'idle',
        ...(kind === 'message.complete' ? { unread: true } : {}),
      })
      if (kind === 'error') setSessions(key, 'error', messageText(payload.message ?? payload.error))
      if (kind === 'message.complete') window.setTimeout(() => void drainHermesQueue(key), 0)
    } else if (kind === 'tool.start' || kind === 'tool.progress') {
      upsertHermesStreamTool(key, payload, 'running')
    } else if (kind === 'tool.complete') {
      upsertHermesStreamTool(key, payload, 'complete')
    } else if (kind === 'approval.request') {
      setSessions(key, 'decision', {
        kind: 'approval',
        requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
        dedupeId: String(
          payload.request_id ?? payload.tool_id ?? payload.tool_call_id ?? crypto.randomUUID(),
        ),
        prompt: messageText(payload.command ?? payload.description) || 'Hermes requests approval',
        choices: Array.isArray(payload.choices) ? payload.choices.map(String) : ['once', 'deny'],
      })
    } else if (kind === 'clarify.request') {
      setSessions(key, 'decision', {
        kind: 'clarify',
        requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
        dedupeId: String(payload.request_id ?? crypto.randomUUID()),
        prompt: messageText(payload.question),
        choices: Array.isArray(payload.choices)
          ? payload.choices.map((choice: unknown) =>
              typeof choice === 'string'
                ? choice
                : messageText((choice as any)?.label ?? (choice as any)?.value),
            )
          : [],
      })
    } else if (kind === 'sudo.request' || kind === 'secret.request') {
      setSessions(key, 'decision', {
        kind: kind === 'sudo.request' ? 'sudo' : 'secret',
        requestId: typeof payload.request_id === 'string' ? payload.request_id : undefined,
        dedupeId: String(payload.request_id ?? crypto.randomUUID()),
        prompt:
          kind === 'sudo.request'
            ? 'Hermes needs administrator credentials'
            : messageText(payload.prompt ?? payload.env_var) || 'Hermes needs a secret value',
        choices: [],
      })
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
      if (payload.running === true && sessions[key]?.status === 'idle')
        setSessions(key, 'status', 'streaming')
      if (
        payload.running === false &&
        !sessions[key]?.awaitingResponse &&
        sessions[key]?.status === 'streaming'
      ) {
        settleHermesStream(key, '')
        setSessions(key, 'status', 'idle')
      }
    }
  }
  eventSource.onerror = () => {
    for (const key of Object.keys(sessions)) {
      if (sessions[key]?.sessionId)
        setSessions(key, { connection: 'disconnected', error: 'Hermes gateway disconnected' })
    }
    eventSource?.close()
    eventSource = null
    window.setTimeout(connectEvents, 1500)
  }
}

export function setHermesComposer(key: string, value: string) {
  if (!sessions[key]) return
  setSessions(key, 'composer', value)
  void refreshHermesCompletions(key, value)
}

export function setHermesError(key: string, error: unknown) {
  if (sessions[key])
    setSessions(key, 'error', error instanceof Error ? error.message : String(error))
}

const completionSequences = new Map<string, number>()

function cleanupHermesAlias(key: string) {
  if (activeHermesSends.has(key)) return
  const state = sessions[key]
  if (!state?.sessionId) return
  const canonicalKey = `session:${state.sessionId}`
  if (canonicalKey === key || !sessions[canonicalKey]) return
  setSessions(key, undefined!)
  completionSequences.delete(key)
}

async function refreshHermesCompletions(key: string, value: string) {
  const word = value.split(/\s/).at(-1) ?? ''
  const kind =
    value.startsWith('/') && !value.includes('\n') ? 'slash' : word.startsWith('@') ? 'path' : ''
  const sequence = (completionSequences.get(key) ?? 0) + 1
  completionSequences.set(key, sequence)
  if (!kind) {
    setSessions(key, 'completions', [])
    return
  }
  try {
    const params = new URLSearchParams({ kind, text: kind === 'slash' ? value : word })
    const cwd = sessions[key]?.cwd
    if (cwd) params.set('cwd', cwd)
    const payload = await jsonRequest(`/api/hermes/completions?${params}`)
    if (sequence !== completionSequences.get(key) || !sessions[key]) return
    const items = Array.isArray(payload.items) ? payload.items : []
    setSessions(key, 'completions', filterHermesCompletions(value, items).slice(0, 8))
  } catch {
    if (sequence === completionSequences.get(key) && sessions[key])
      setSessions(key, 'completions', [])
  }
}

export function applyHermesCompletion(key: string, completion: HermesCompletion) {
  const state = sessions[key]
  if (!state) return
  if (state.composer.startsWith('/')) {
    setSessions(key, { composer: completion.text, completions: [] })
    return
  }
  const start = Math.max(state.composer.lastIndexOf(' '), state.composer.lastIndexOf('\n')) + 1
  setSessions(key, {
    composer: `${state.composer.slice(0, start)}${completion.text}`,
    completions: [],
  })
}

export async function renameHermesSession(key: string, title: string) {
  const sessionId = sessions[key]?.sessionId
  if (!sessionId) return
  await jsonRequest('/api/hermes/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, title }),
  })
  setSessions(key, { title, error: undefined })
}

export async function branchHermesSession(key: string, name?: string, count?: number) {
  const sessionId = sessions[key]?.sessionId
  if (!sessionId) return undefined
  const payload = await jsonRequest('/api/hermes/branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, name: name?.trim() || undefined, count }),
  })
  return {
    sessionId: String(payload.stored_session_id),
    title: String(payload.title ?? 'Hermes branch'),
  }
}

export async function rewindHermesSession(key: string, messageId: string, replacement?: string) {
  const state = sessions[key]
  if (!state?.sessionId || state.status === 'sending' || state.status === 'streaming') return
  const target = rewindTarget(state.messages, messageId)
  if (!target) return
  const { index, userOrdinal } = target
  const text = (replacement ?? state.messages[index]!.text).trim()
  if (!text) return
  const optimistic: HermesMessage = {
    id: `local-${Date.now()}`,
    role: 'user',
    text,
    timestamp: Date.now() / 1000,
  }
  setSessions(key, {
    messages: [...state.messages.slice(0, index), optimistic],
    status: 'sending',
    awaitingResponse: true,
    streamMessageId: undefined,
    error: undefined,
  })
  try {
    await jsonRequest('/api/hermes/rewind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, text, userOrdinal }),
    })
    setSessions(key, 'status', 'streaming')
  } catch (error) {
    setSessions(key, {
      messages: state.messages,
      status: 'error',
      awaitingResponse: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function retryHermesLastTurn(key: string) {
  const message = [...(sessions[key]?.messages ?? [])]
    .reverse()
    .find((item) => item.role === 'user')
  if (message) return rewindHermesSession(key, message.id)
}

export async function exportHermesSession(key: string) {
  const state = sessions[key]
  if (!state?.sessionId) return
  const content = JSON.stringify(
    await jsonRequest(`/api/hermes/sessions/${encodeURIComponent(state.sessionId)}/export`),
    null,
    2,
  )
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${(state.title || state.sessionId).replace(/[^a-z0-9._-]+/gi, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

export async function addHermesAttachments(key: string, files: Iterable<File>) {
  if (!sessions[key]) return
  for (const file of files) {
    const id = crypto.randomUUID()
    if (file.size > HERMES_ATTACHMENT_LIMIT) {
      setSessions(key, 'error', `${file.name} exceeds the 16 MiB attachment limit`)
      continue
    }
    try {
      const contentBase64 = await readFileBase64(file)
      if (!sessions[key]) return
      setSessions(key, 'attachments', (items) => [
        ...items,
        {
          id,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          contentBase64,
          status: 'ready',
        },
      ])
    } catch (error) {
      if (sessions[key])
        setSessions(key, 'error', error instanceof Error ? error.message : String(error))
    }
  }
}

export async function addHermesDraggedPath(key: string, dragged: FileDragData) {
  if (!sessions[key]) return
  if (dragged.sourceKind !== 'local' || dragged.virtualOpenTarget) {
    setSessions(key, 'error', 'Only local derp files and folders can be attached to Hermes')
    return
  }
  try {
    const payload = await jsonRequest('/api/hermes/reference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dragged.path, isDirectory: dragged.isDirectory }),
    })
    if (!sessions[key]) return
    if (payload.mode === 'shared' && typeof payload.text === 'string') {
      const prefix = sessions[key]!.composer && !/\s$/.test(sessions[key]!.composer) ? ' ' : ''
      setSessions(key, 'composer', `${sessions[key]!.composer}${prefix}${payload.text} `)
    } else if (payload.mode === 'upload' && payload.attachment) {
      const attachment = payload.attachment as Omit<HermesAttachment, 'id' | 'status'>
      setSessions(key, 'attachments', (items) => [
        ...items,
        { ...attachment, id: crypto.randomUUID(), status: 'ready' },
      ])
    }
  } catch (error) {
    setSessions(key, 'error', error instanceof Error ? error.message : String(error))
  }
}

export function removeHermesAttachment(key: string, id: string) {
  if (sessions[key])
    setSessions(key, 'attachments', (items) => items.filter((item) => item.id !== id))
}

export function queueHermesPrompt(key: string) {
  const text = sessions[key]?.composer.trim()
  if (!text) return
  setSessions(key, {
    composer: '',
    attachments: [],
    queuedPrompts: [
      ...sessions[key]!.queuedPrompts,
      { text, attachments: sessions[key]!.attachments.map((item) => ({ ...item })) },
    ],
  })
}

async function drainHermesQueue(key: string) {
  const state = sessions[key]
  const next = state?.queuedPrompts[0]
  if (
    !state ||
    !next ||
    state.queueParked ||
    state.status === 'sending' ||
    state.status === 'streaming'
  )
    return
  setSessions(key, {
    composer: next.text,
    attachments: next.attachments,
    queuedPrompts: state.queuedPrompts.slice(1),
  })
  try {
    await sendHermesPrompt(key)
  } catch {
    // sendHermesPrompt restores the failed item in the composer.
  }
}

export function removeHermesQueuedPrompt(key: string, index: number) {
  if (sessions[key])
    setSessions(key, 'queuedPrompts', (items) =>
      items.filter((_, itemIndex) => itemIndex !== index),
    )
}

export function editHermesQueuedPrompt(key: string, index: number) {
  const item = sessions[key]?.queuedPrompts[index]
  if (!item) return
  setSessions(key, {
    composer: item.text,
    attachments: item.attachments,
    queuedPrompts: sessions[key]!.queuedPrompts.filter((_, itemIndex) => itemIndex !== index),
  })
}

export function moveHermesQueuedPrompt(key: string, index: number, direction: -1 | 1) {
  const items = [...(sessions[key]?.queuedPrompts ?? [])]
  const target = index + direction
  if (!items[index] || target < 0 || target >= items.length) return
  ;[items[index], items[target]] = [items[target]!, items[index]!]
  setSessions(key, 'queuedPrompts', items)
}

export function resumeHermesQueue(key: string) {
  if (!sessions[key]) return
  setSessions(key, 'queueParked', false)
  void drainHermesQueue(key)
}

export async function steerHermesPrompt(key: string) {
  const state = sessions[key]
  const text = state?.composer.trim()
  if (!state?.sessionId || !text) return
  await jsonRequest('/api/hermes/steer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId, text }),
  })
  setSessions(key, { composer: '', error: undefined })
}

export function claimHermesEditor(key: string, owner: string): boolean {
  const current = sessions[key]?.editorOwner
  if (current && current !== owner && sessions[key]?.composer.trim()) {
    if (!window.confirm('Take editing control? Unsaved text in another window will remain shared.'))
      return false
  }
  setSessions(key, 'editorOwner', owner)
  return true
}

export function releaseHermesEditor(key: string, owner: string) {
  if (sessions[key]?.editorOwner === owner) setSessions(key, 'editorOwner', undefined)
}

export async function sendHermesPrompt(key: string, takeover = false): Promise<string | undefined> {
  const state = sessions[key]
  const text = state?.composer.trim()
  if (!state || !text || (state.readOnly && !state.takeoverPending)) return state?.sessionId
  const requestedSessionId = state.sessionId
  setSessions(key, {
    composer: '',
    status: 'sending',
    awaitingResponse: true,
    streamMessageId: undefined,
    error: undefined,
  })
  setSessions(key, 'attachments', (items) =>
    items.map((item) => ({ ...item, status: 'uploading' as const, error: undefined })),
  )
  const optimistic: HermesMessage = {
    id: `local-${Date.now()}`,
    role: 'user',
    text,
    timestamp: Date.now() / 1000,
    images: state.attachments
      .filter((attachment) => attachment.mimeType.startsWith('image/'))
      .map((attachment) => `data:${attachment.mimeType};base64,${attachment.contentBase64}`),
  }
  setSessions(key, 'messages', (messages) => [...messages, optimistic])
  activeHermesSends.add(key)
  try {
    const payload = await jsonRequest('/api/hermes/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: requestedSessionId,
        cwd: state.cwd,
        text,
        takeover: takeover || state.takeoverPending === true,
        attachments: state.attachments.map(({ name, mimeType, contentBase64 }) => ({
          name,
          mimeType,
          contentBase64,
        })),
      }),
    })
    const responseSessionId = String(payload.sessionId)
    const currentSessionId = sessions[key]?.sessionId
    // SSE can rotate a durable id while /turn is in flight; its newer id wins the race.
    const sessionId =
      currentSessionId && currentSessionId !== requestedSessionId
        ? currentSessionId
        : responseSessionId
    setSessions(key, {
      sessionId,
      lineageRootId: state.lineageRootId ?? sessionId,
      status: 'streaming',
      attachments: [],
      externallyActive: false,
      takeoverPending: false,
      readOnly: false,
    })
    const canonicalKey = `session:${sessionId}`
    if (canonicalKey !== key)
      setSessions(canonicalKey, { ...sessions[key]!, sessionId, draftId: undefined })
    return sessionId
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const currentSessionId = sessions[key]?.sessionId
    const canonicalKey = currentSessionId ? `session:${currentSessionId}` : key
    const targetKey = canonicalKey !== key && sessions[canonicalKey] ? canonicalKey : key
    setSessions(targetKey, 'messages', (messages) =>
      messages.filter((item) => item.id !== optimistic.id),
    )
    setSessions(targetKey, {
      composer: text,
      status: 'error',
      awaitingResponse: false,
      error: message,
      attachments: state.attachments.map((item) => ({ ...item, status: 'error', error: message })),
    })
    throw error
  } finally {
    activeHermesSends.delete(key)
    cleanupHermesAlias(key)
  }
}

export function takeOverHermesSession(key: string) {
  const state = sessions[key]
  if (!state || state.archived) return
  setSessions(key, {
    externallyActive: false,
    takeoverPending: true,
    readOnly: false,
    error: undefined,
  })
}

export async function stopHermesTurn(key: string) {
  const sessionId = sessions[key]?.sessionId
  if (!sessionId) return
  await jsonRequest('/api/hermes/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  setSessions(key, { status: 'idle', queueParked: sessions[key]?.queuedPrompts.length > 0 })
  await refreshHermesChat(key)
}

export function markHermesRead(key: string) {
  if (sessions[key]?.unread) setSessions(key, 'unread', false)
}

export async function restoreHermesSession(key: string) {
  const sessionId = sessions[key]?.sessionId
  if (!sessionId) return
  await jsonRequest('/api/hermes/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  setSessions(key, { archived: false, readOnly: false, error: undefined })
  await refreshHermesChat(key)
}

export async function archiveHermesSession(key: string) {
  const state = sessions[key]
  if (!state?.sessionId) return
  await jsonRequest('/api/hermes/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: state.sessionId }),
  })
  setSessions(key, { archived: true, readOnly: true, error: undefined })
  await refreshHermesChat(key)
}

const answeredDecisions = new Set<string>()

export async function answerHermesDecision(key: string, answer: string) {
  const state = sessions[key]
  const decision = state?.decision
  if (!state?.sessionId || !decision) return
  const decisionKey = `${state.sessionId}:${decision.kind}:${decision.dedupeId}`
  if (answeredDecisions.has(decisionKey)) return
  answeredDecisions.add(decisionKey)
  setSessions(key, 'decision', undefined)
  try {
    await jsonRequest('/api/hermes/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,
        kind: decision.kind,
        requestId: decision.requestId,
        choice: answer,
      }),
    })
  } catch (error) {
    answeredDecisions.delete(decisionKey)
    setSessions(key, { decision, error: error instanceof Error ? error.message : String(error) })
  }
}

export function canCloseHermesWindow(target?: { draftId?: string; sessionId?: string }): boolean {
  if (!target?.draftId || target.sessionId) return true
  const state = sessions[`draft:${target.draftId}`]
  const hasDraft =
    !!state?.composer.trim() || !!state?.attachments.length || !!state?.queuedPrompts.length
  return !hasDraft || window.confirm('Discard unsent Hermes draft?')
}

export function discardHermesDraft(target?: { draftId?: string; sessionId?: string }) {
  if (!target?.draftId || target.sessionId) return
  setSessions(`draft:${target.draftId}`, undefined!)
}

export { sessions as hermesSessions }
export const deletedHermesSessionIds = new Set<string>()
