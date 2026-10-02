import { randomId } from '@/lib/random-id'
import { Effect, Schema } from 'effect'
import { apiSchemaEffect, ApiError } from '@/lib/api/client'
import { speakHermesText } from './hermes-reply-audio'

import { showAppConfirmEffect } from '@/lib/ui/app-dialog'
import type { FileDragData } from '@/lib/files/file-drag-data'
import { filterHermesCompletions, rewindTarget } from './hermes-chat-parity'
import {
  type HermesMessage,
  HERMES_ATTACHMENT_LIMIT,
  type HermesCompletion,
  type HermesModelOption,
  type HermesEditorClaimOptions,
} from './hermes-session-types'
import {
  registry,
  sessions,
  updateHermesState,
  patchHermesState,
  removeHermesState,
  bindHermesSessionId,
  deletedHermesSessionIds,
} from './hermes-session-registry'
import { normalizeMessages, sameHermesMessages } from './hermes-messages'
import {
  jsonRequest,
  capabilitiesSchema,
  sessionMessagesSchema,
  sessionDetailSchema,
  completionsSchema,
  modelOptionsSchema,
} from './hermes-api'

export const editorClaimGenerations = new Map<string, Map<string, number>>()

export const operationSlots = (key: string | number) => ['hermes-operation', key] as const

export function startHermesOperation(
  name: string,
  work: Effect.Effect<unknown, unknown>,
  policy: 'drop' | 'replace' = 'drop',
) {
  void registry.run(operationSlots(name), work.pipe(Effect.catch(() => Effect.void)), policy)
}

export function refreshHermesCapabilities(key: string) {
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const payload = yield* apiSchemaEffect(capabilitiesSchema, '/api/hermes/capabilities')
      if (!sessions()[key]) return
      patchHermesState(key, {
        voice: {
          transcription: payload.transcription === true,
          playback: payload.playback === true,
          maxRecordingSeconds:
            payload.maxRecordingSeconds && payload.maxRecordingSeconds > 0
              ? payload.maxRecordingSeconds
              : 120,
        },
      })
    }).pipe(
      Effect.catch((_error) =>
        Effect.sync(() => {
          // Optional controls remain hidden.
        }),
      ),
    )
  })
}

export function blobDataUrl(blob: Blob) {
  return Effect.callback<string, Error>((resume) => {
    const reader = new FileReader()
    reader.onerror = () =>
      resume(Effect.fail(reader.error ?? new Error('Could not read attachment')))
    reader.onload = () =>
      resume(Effect.succeed(typeof reader.result === 'string' ? reader.result : ''))
    reader.readAsDataURL(blob)
    return Effect.sync(() => {
      reader.onload = null
      reader.onerror = null
      if (reader.readyState === FileReader.LOADING) reader.abort()
    })
  })
}

export function transcribeHermesAudio(key: string, blob: Blob) {
  return Effect.gen(function* () {
    const dataUrl = yield* blobDataUrl(blob)
    const payload = yield* apiSchemaEffect(
      Schema.Struct({ transcript: Schema.String }),
      '/api/hermes/transcribe',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, mimeType: blob.type }),
      },
    )
    const transcript = typeof payload.transcript === 'string' ? payload.transcript.trim() : ''
    if (transcript && sessions()[key]) {
      const prefix = sessions()[key]!.composer && !/\s$/.test(sessions()[key]!.composer) ? ' ' : ''
      updateHermesState(key, (state) => ({ composer: `${state.composer}${prefix}${transcript}` }))
    }
  })
}

export function playHermesReply(text: string) {
  return speakHermesText(text)
}

export function refreshHermesChat(key: string) {
  return Effect.gen(function* () {
    const state = sessions()[key]
    if (!state?.sessionId) return
    const isCurrent = () =>
      sessions()[key]?.sessionId === state.sessionId &&
      sessions()[key]?.messages === state.messages &&
      sessions()[key]?.status === state.status
    yield* Effect.gen(function* () {
      const encoded = encodeURIComponent(state.sessionId!)
      const historyLimit = Math.min(500, Math.max(100, state.messages.length))
      const [payload, detail] = yield* Effect.all(
        [
          apiSchemaEffect(
            sessionMessagesSchema,
            `/api/hermes/sessions/${encoded}/messages?limit=${historyLimit}&offset=0`,
          ),
          apiSchemaEffect(sessionDetailSchema, `/api/hermes/sessions/${encoded}`),
        ],
        { concurrency: 'unbounded' },
      )
      if (!isCurrent()) return
      const archived = detail.archived === true
      const externallyActive = detail.externallyActive === true
      const refreshed = normalizeMessages(payload.messages ?? payload.data)
      const current = sessions()[key]?.messages ?? []
      const refreshedIds = new Set(refreshed.map((message) => message.id))
      const firstRefreshedIndex = current.findIndex((message) => refreshedIds.has(message.id))
      const retainedCount = Math.max(
        Math.max(0, current.length - historyLimit),
        firstRefreshedIndex > 0 ? firstRefreshedIndex : 0,
      )
      const messages = retainedCount
        ? [...current.slice(0, retainedCount), ...refreshed]
        : refreshed
      updateHermesState(key, (draft) => ({
        messages: sameHermesMessages(draft.messages, messages) ? draft.messages : messages,
        hasOlderMessages: retainedCount
          ? draft.hasOlderMessages
          : (Array.isArray(payload.messages)
              ? payload.messages.length
              : Array.isArray(payload.data)
                ? payload.data.length
                : 0) >= historyLimit,
        archived,
        readOnly: archived || (externallyActive && !draft.takeoverPending),
        externallyActive: externallyActive && !draft.takeoverPending,
        externalSource: typeof detail.source === 'string' ? detail.source : undefined,
        unavailable: false,
        connection: 'connected',
        title: typeof detail.title === 'string' ? detail.title : draft.title,
        model: typeof detail.model === 'string' ? detail.model : draft.model,
        status: draft.status === 'loading' ? 'idle' : draft.status,
      }))
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (!isCurrent()) return
          const message = error instanceof Error ? error.message : String(error)
          const unavailable = error instanceof ApiError && error.status === 404
          const connection =
            error instanceof ApiError && (error.status === 401 || error.status === 403)
              ? 'auth-error'
              : 'disconnected'
          if (unavailable && state.sessionId)
            deletedHermesSessionIds.add(state.lineageRootId ?? state.sessionId)
          patchHermesState(key, {
            status: 'error',
            error: message,
            unavailable,
            connection,
            ...(unavailable ? { readOnly: true } : {}),
          })
        }),
      ),
    )
  })
}

export function loadOlderHermesMessages(key: string) {
  return Effect.gen(function* () {
    const state = sessions()[key]
    if (!state?.sessionId || state.historyLoading || !state.hasOlderMessages) return 0
    updateHermesState(key, () => ({ historyLoading: true }))
    return yield* Effect.gen(function* () {
      const payload = yield* apiSchemaEffect(
        sessionMessagesSchema,
        `/api/hermes/sessions/${encodeURIComponent(state.sessionId!)}/messages?limit=100&offset=${state.messages.length}`,
      )
      const older = normalizeMessages(payload.messages ?? payload.data)
      const existing = new Set(sessions()[key]!.messages.map((message) => message.id))
      const unique = older.filter((message) => !existing.has(message.id))
      patchHermesState(key, {
        messages: [...unique, ...sessions()[key]!.messages],
        hasOlderMessages: older.length === 100,
        historyLoading: false,
      })
      return unique.length
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          patchHermesState(key, {
            historyLoading: false,
            error: error instanceof Error ? error.message : String(error),
          })
          return 0
        }),
      ),
    )
  })
}

export function refreshHermesModelOptions(key: string) {
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const payload = yield* apiSchemaEffect(modelOptionsSchema, '/api/hermes/model-options')
      if (!sessions()[key]) return
      const providers = payload.providers ?? []
      const options: HermesModelOption[] = providers.flatMap((provider) => {
        if (provider.authenticated === false || !provider.models) return []
        return provider.models.map((model) => {
          const value = model
          const capabilities = provider.capabilities?.[value]
          return {
            value: `${String(provider.slug ?? provider.name)}/${value}`,
            label: `${String(provider.name ?? provider.slug)} · ${value}`,
            reasoning: capabilities?.reasoning !== false,
            fast: capabilities?.fast === true,
          }
        })
      })
      patchHermesState(key, {
        modelOptions: options,
        model: typeof payload.model === 'string' ? payload.model : undefined,
        provider: typeof payload.provider === 'string' ? payload.provider : undefined,
      })
    }).pipe(
      Effect.catch((_error) =>
        Effect.sync(() => {
          // Optional capability. Chat remains usable without model controls.
        }),
      ),
    )
  })
}

export function sendHermesControl(key: string, command: string) {
  return Effect.gen(function* () {
    if (!sessions()[key] || sessions()[key]!.readOnly) return
    patchHermesState(key, { composer: command, completions: [] })
    yield* sendHermesPrompt(key)
  })
}

export function setHermesComposer(key: string, value: string) {
  if (!sessions()[key]) return
  updateHermesState(key, () => ({ composer: value }))
  startHermesOperation(`completion:${key}`, refreshHermesCompletions(key, value), 'replace')
}

export function setHermesError(key: string, error: unknown) {
  if (sessions()[key])
    updateHermesState(key, () => ({
      error: error instanceof Error ? error.message : String(error),
    }))
}

export function refreshHermesCompletions(key: string, value: string) {
  return Effect.gen(function* () {
    const word = value.split(/\s/).at(-1) ?? ''
    const kind =
      value.startsWith('/') && !value.includes('\n') ? 'slash' : word.startsWith('@') ? 'path' : ''
    if (!kind) {
      updateHermesState(key, () => ({ completions: [] }))
      return
    }
    yield* Effect.gen(function* () {
      const params = new URLSearchParams({ kind, text: kind === 'slash' ? value : word })
      const cwd = sessions()[key]?.cwd
      if (cwd) params.set('cwd', cwd)
      const payload = yield* apiSchemaEffect(completionsSchema, `/api/hermes/completions?${params}`)
      if (!sessions()[key]) return
      const items = payload.items ? [...payload.items] : []
      updateHermesState(key, () => ({
        completions: filterHermesCompletions(value, items).slice(0, 8),
      }))
    }).pipe(
      Effect.catch((_error) =>
        Effect.sync(() => {
          if (sessions()[key]) updateHermesState(key, () => ({ completions: [] }))
        }),
      ),
    )
  })
}

export function applyHermesCompletion(key: string, completion: HermesCompletion) {
  const state = sessions()[key]
  if (!state) return
  if (state.composer.startsWith('/')) {
    patchHermesState(key, { composer: completion.text, completions: [] })
    return
  }
  const start = Math.max(state.composer.lastIndexOf(' '), state.composer.lastIndexOf('\n')) + 1
  patchHermesState(key, {
    composer: `${state.composer.slice(0, start)}${completion.text}`,
    completions: [],
  })
}

export function renameHermesSession(key: string, title: string) {
  return Effect.gen(function* () {
    const sessionId = sessions()[key]?.sessionId
    if (!sessionId) return
    yield* jsonRequest('/api/hermes/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, title }),
    })
    patchHermesState(key, { title, error: undefined })
  })
}

export function branchHermesSession(key: string, name?: string, count?: number) {
  return Effect.gen(function* () {
    const sessionId = sessions()[key]?.sessionId
    if (!sessionId) return undefined
    const payload = yield* apiSchemaEffect(
      Schema.Struct({ stored_session_id: Schema.String, title: Schema.optional(Schema.String) }),
      '/api/hermes/branch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, name: name?.trim() || undefined, count }),
      },
    )
    return {
      sessionId: payload.stored_session_id,
      title: typeof payload.title === 'string' ? payload.title : 'Hermes branch',
    }
  })
}

export function rewindHermesSession(key: string, messageId: string, replacement?: string) {
  return Effect.gen(function* () {
    const state = sessions()[key]
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
    patchHermesState(key, {
      messages: [...state.messages.slice(0, index), optimistic],
      status: 'sending',
      awaitingResponse: true,
      streamMessageId: undefined,
      error: undefined,
    })
    yield* Effect.gen(function* () {
      yield* jsonRequest('/api/hermes/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId, text, userOrdinal }),
      })
      updateHermesState(key, (state) => ({
        status: state.status === 'sending' ? 'streaming' : state.status,
      }))
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          patchHermesState(key, {
            messages: state.messages,
            status: 'error',
            awaitingResponse: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }),
      ),
    )
  })
}

export function retryHermesLastTurn(key: string) {
  return Effect.gen(function* () {
    const message = [...(sessions()[key]?.messages ?? [])]
      .reverse()
      .find((item) => item.role === 'user')
    if (message) yield* rewindHermesSession(key, message.id)
  })
}

export function exportHermesSession(key: string) {
  return Effect.gen(function* () {
    const state = sessions()[key]
    if (!state?.sessionId) return
    const content = JSON.stringify(
      yield* jsonRequest(`/api/hermes/sessions/${encodeURIComponent(state.sessionId!)}/export`),
      null,
      2,
    )
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${(state.title || state.sessionId).replace(/[^a-z0-9._-]+/gi, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  })
}

export function readFileBase64(file: File) {
  return blobDataUrl(file).pipe(Effect.map((url) => url.split(',', 2)[1] ?? ''))
}

export function addHermesAttachments(key: string, files: Iterable<File>) {
  return Effect.gen(function* () {
    if (!sessions()[key]) return
    for (const file of files) {
      const id = randomId()
      if (file.size > HERMES_ATTACHMENT_LIMIT) {
        updateHermesState(key, () => ({
          error: `${file.name} exceeds the 16 MiB attachment limit`,
        }))
        continue
      }
      yield* Effect.gen(function* () {
        const contentBase64 = yield* readFileBase64(file)
        if (!sessions()[key]) return
        updateHermesState(key, (state) => ({
          attachments: [
            ...state.attachments,
            {
              id,
              name: file.name,
              mimeType: file.type || 'application/octet-stream',
              size: file.size,
              contentBase64,
              status: 'ready',
            },
          ],
        }))
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (sessions()[key])
              updateHermesState(key, () => ({
                error: error instanceof Error ? error.message : String(error),
              }))
          }),
        ),
      )
    }
  })
}

export function addHermesDraggedPath(key: string, dragged: FileDragData) {
  return Effect.gen(function* () {
    if (!sessions()[key]) return
    if (dragged.sourceKind !== 'local' || dragged.virtualOpenTarget) {
      updateHermesState(key, () => ({
        error: 'Only local derp files and folders can be attached to Hermes',
      }))
      return
    }
    yield* Effect.gen(function* () {
      const payload = yield* apiSchemaEffect(
        Schema.Union([
          Schema.Struct({ mode: Schema.Literal('shared'), text: Schema.String }),
          Schema.Struct({
            mode: Schema.Literal('upload'),
            attachment: Schema.Struct({
              name: Schema.String,
              mimeType: Schema.String,
              size: Schema.Number,
              contentBase64: Schema.String,
            }),
          }),
        ]),
        '/api/hermes/reference',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: dragged.path, isDirectory: dragged.isDirectory }),
        },
      )
      if (!sessions()[key]) return
      if (payload.mode === 'shared' && typeof payload.text === 'string') {
        const text = payload.text
        const prefix =
          sessions()[key]!.composer && !/\s$/.test(sessions()[key]!.composer) ? ' ' : ''
        updateHermesState(key, (state) => ({ composer: `${state.composer}${prefix}${text} ` }))
      } else if (payload.mode === 'upload' && payload.attachment) {
        const attachment = payload.attachment
        updateHermesState(key, (state) => ({
          attachments: [...state.attachments, { ...attachment, id: randomId(), status: 'ready' }],
        }))
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          updateHermesState(key, () => ({
            error: error instanceof Error ? error.message : String(error),
          }))
        }),
      ),
    )
  })
}

export function removeHermesAttachment(key: string, id: string) {
  if (sessions()[key])
    updateHermesState(key, (state) => ({
      attachments: state.attachments.filter((item) => item.id !== id),
    }))
}

export function queueHermesPrompt(key: string) {
  const text = sessions()[key]?.composer.trim()
  if (!text) return
  patchHermesState(key, {
    composer: '',
    attachments: [],
    queuedPrompts: [
      ...sessions()[key]!.queuedPrompts,
      { text, attachments: sessions()[key]!.attachments.map((item) => ({ ...item })) },
    ],
  })
}

export function drainHermesQueue(key: string) {
  return Effect.gen(function* () {
    const state = sessions()[key]
    const next = state?.queuedPrompts[0]
    if (
      !state ||
      !next ||
      state.queueParked ||
      state.status === 'sending' ||
      state.status === 'streaming'
    )
      return
    patchHermesState(key, {
      composer: next.text,
      attachments: next.attachments,
      queuedPrompts: state.queuedPrompts.slice(1),
    })
    yield* Effect.gen(function* () {
      yield* sendHermesPrompt(key)
    }).pipe(
      Effect.catch((_error) =>
        Effect.sync(() => {
          // sendHermesPrompt restores the failed item in the composer.
        }),
      ),
    )
  })
}

export function removeHermesQueuedPrompt(key: string, index: number) {
  if (sessions()[key])
    updateHermesState(key, (state) => ({
      queuedPrompts: state.queuedPrompts.filter((_, itemIndex) => itemIndex !== index),
    }))
}

export function editHermesQueuedPrompt(key: string, index: number) {
  const item = sessions()[key]?.queuedPrompts[index]
  if (!item) return
  patchHermesState(key, {
    composer: item.text,
    attachments: item.attachments,
    queuedPrompts: sessions()[key]!.queuedPrompts.filter((_, itemIndex) => itemIndex !== index),
  })
}

export function moveHermesQueuedPrompt(key: string, index: number, direction: -1 | 1) {
  const items = [...(sessions()[key]?.queuedPrompts ?? [])]
  const target = index + direction
  if (!items[index] || target < 0 || target >= items.length) return
  ;[items[index], items[target]] = [items[target]!, items[index]!]
  updateHermesState(key, () => ({ queuedPrompts: items }))
}

export function resumeHermesQueue(key: string) {
  if (!sessions()[key]) return
  updateHermesState(key, () => ({ queueParked: false }))
  startHermesOperation(`drain:${key}`, drainHermesQueue(key))
}

export function claimHermesEditor(
  key: string,
  owner: string,
  options: HermesEditorClaimOptions = {},
) {
  return Effect.gen(function* () {
    const generations = editorClaimGenerations.get(key) ?? new Map<string, number>()
    editorClaimGenerations.set(key, generations)
    const generation = (generations.get(owner) ?? 0) + 1
    generations.set(owner, generation)
    const claimIsCurrent = () =>
      editorClaimGenerations.get(key)?.get(owner) === generation && options.isAlive?.() !== false
    const currentState = sessions()[key]
    if (!currentState || !claimIsCurrent()) return false
    const current = currentState.editorOwner
    if (current && current !== owner && sessions()[key]?.composer.trim()) {
      const confirmed = yield* showAppConfirmEffect({
        title: 'Take editing control?',
        message: 'Unsaved text in the other window will remain shared.',
        confirmLabel: 'Take control',
      })
      if (!confirmed) return false
    }
    const latest = sessions()[key]
    if (!latest || !claimIsCurrent()) return false
    if (latest.editorOwner && latest.editorOwner !== owner && latest.editorOwner !== current) {
      return false
    }
    updateHermesState(key, () => ({ editorOwner: owner }))
    return true
  })
}

export function releaseHermesEditor(key: string, owner: string) {
  const generations = editorClaimGenerations.get(key) ?? new Map<string, number>()
  generations.set(owner, (generations.get(owner) ?? 0) + 1)
  editorClaimGenerations.set(key, generations)
  if (sessions()[key]?.editorOwner === owner)
    updateHermesState(key, () => ({ editorOwner: undefined }))
}

export function sendHermesPrompt(key: string, takeover = false) {
  return Effect.gen(function* () {
    const state = sessions()[key]
    const text = state?.composer.trim()
    if (!state || !text || (state.readOnly && !state.takeoverPending)) return state?.sessionId
    const requestedSessionId = state.sessionId
    const optimistic: HermesMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now() / 1000,
      images: state.attachments
        .filter((attachment) => attachment.mimeType.startsWith('image/'))
        .map((attachment) => `data:${attachment.mimeType};base64,${attachment.contentBase64}`),
    }
    patchHermesState(key, {
      composer: '',
      completions: [],
      status: 'sending',
      awaitingResponse: true,
      streamMessageId: undefined,
      error: undefined,
      attachments: state.attachments.map((item) => ({
        ...item,
        status: 'uploading',
        error: undefined,
      })),
      messages: [...state.messages, optimistic],
    })
    return yield* Effect.gen(function* () {
      const payload = yield* apiSchemaEffect(
        Schema.Struct({ sessionId: Schema.String }),
        '/api/hermes/turn',
        {
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
        },
      )
      const responseSessionId = payload.sessionId
      const currentSessionId = sessions()[key]?.sessionId
      // SSE can rotate a durable id while /turn is in flight; its newer id wins the race.
      const sessionId =
        currentSessionId && currentSessionId !== requestedSessionId
          ? currentSessionId
          : responseSessionId
      bindHermesSessionId(key, sessionId)
      patchHermesState(key, {
        lineageRootId: state.lineageRootId ?? sessionId,
        status:
          sessions()[key]?.status === 'sending' ? 'streaming' : (sessions()[key]?.status ?? 'idle'),
        attachments: [],
        externallyActive: false,
        takeoverPending: false,
        readOnly: false,
      })
      return sessionId
    }).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          const message = error instanceof Error ? error.message : String(error)
          updateHermesState(key, (state) => ({
            messages: state.messages.filter((item) => item.id !== optimistic.id),
          }))
          patchHermesState(key, {
            composer: text,
            status: 'error',
            awaitingResponse: false,
            error: message,
            attachments: state.attachments.map((item) => ({
              ...item,
              status: 'error',
              error: message,
            })),
          })
          return yield* Effect.fail(error)
        }),
      ),
    )
  })
}

export function takeOverHermesSession(key: string) {
  const state = sessions()[key]
  if (!state || state.archived) return
  patchHermesState(key, {
    externallyActive: false,
    takeoverPending: true,
    readOnly: false,
    error: undefined,
  })
}

export function stopHermesTurn(key: string) {
  return Effect.gen(function* () {
    const sessionId = sessions()[key]?.sessionId
    if (!sessionId) return
    yield* jsonRequest('/api/hermes/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    patchHermesState(key, {
      status: 'idle',
      queueParked: sessions()[key]?.queuedPrompts.length > 0,
    })
    yield* refreshHermesChat(key)
  })
}

export function markHermesRead(key: string) {
  if (sessions()[key]?.unread) updateHermesState(key, () => ({ unread: false }))
}

export function restoreHermesSession(key: string) {
  return Effect.gen(function* () {
    const sessionId = sessions()[key]?.sessionId
    if (!sessionId) return
    yield* jsonRequest('/api/hermes/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    patchHermesState(key, { archived: false, readOnly: false, error: undefined })
    yield* refreshHermesChat(key)
  })
}

export function archiveHermesSession(key: string) {
  return Effect.gen(function* () {
    const state = sessions()[key]
    if (!state?.sessionId) return
    yield* jsonRequest('/api/hermes/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId }),
    })
    patchHermesState(key, { archived: true, readOnly: true, error: undefined })
    yield* refreshHermesChat(key)
  })
}

export const answeredDecisions = new Set<string>()

export function answerHermesDecision(key: string, answer: string) {
  return Effect.gen(function* () {
    const state = sessions()[key]
    const decision = state?.decision
    if (!state?.sessionId || !decision) return
    const decisionKey = `${state.sessionId}:${decision.kind}:${decision.dedupeId}`
    if (answeredDecisions.has(decisionKey)) return
    answeredDecisions.add(decisionKey)
    updateHermesState(key, () => ({ decision: undefined }))
    yield* Effect.gen(function* () {
      yield* jsonRequest('/api/hermes/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.sessionId,
          kind: decision.kind,
          requestId: decision.requestId,
          choice: answer,
        }),
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          answeredDecisions.delete(decisionKey)
          patchHermesState(key, {
            decision,
            error: error instanceof Error ? error.message : String(error),
          })
        }),
      ),
    )
  })
}

export function canCloseHermesWindow(target?: { draftId?: string; sessionId?: string }) {
  return Effect.gen(function* () {
    if (!target?.draftId || target.sessionId) return true
    const state = sessions()[`draft:${target.draftId}`]
    const hasDraft =
      !!state?.composer.trim() || !!state?.attachments.length || !!state?.queuedPrompts.length
    if (!hasDraft) return true
    return yield* showAppConfirmEffect({
      title: 'Discard unsent draft?',
      message: 'The unsent prompt and attachments will be permanently discarded.',
      confirmLabel: 'Discard',
      destructive: true,
    })
  })
}

export function discardHermesDraft(target?: { draftId?: string; sessionId?: string }) {
  if (!target?.draftId || target.sessionId) return
  removeHermesState(`draft:${target.draftId}`)
}
