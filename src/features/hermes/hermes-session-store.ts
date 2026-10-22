import { randomId } from '@/lib/random-id'
import { Effect } from 'effect'

import type { FileDragData } from '@/lib/files/file-drag-data'

import {
  type HermesChatState,
  type HermesCompletion,
  type HermesEditorClaimOptions,
  type HermesSessionTarget,
} from './hermes-session-types'
import {
  registry,
  hermesSessionsSource,
  sessions,
  durableSessionAliases,
  replaceHermesState,
  durableSessionKey,
  hermesChatKey,
  bindHermesSessionId,
  hermesSessionForId,
  deletedHermesSessionIds,
} from './hermes-session-registry'
import { stopEvents, connectEvents } from './hermes-session-events'
import {
  startHermesOperation,
  refreshHermesCapabilities,
  transcribeHermesAudio,
  playHermesReply,
  refreshHermesChat,
  loadOlderHermesMessages,
  refreshHermesModelOptions,
  sendHermesControl,
  setHermesComposer,
  setHermesError,
  applyHermesCompletion,
  renameHermesSession,
  branchHermesSession,
  rewindHermesSession,
  retryHermesLastTurn,
  exportHermesSession,
  addHermesAttachments,
  addHermesDraggedPath,
  removeHermesAttachment,
  queueHermesPrompt,
  removeHermesQueuedPrompt,
  editHermesQueuedPrompt,
  moveHermesQueuedPrompt,
  resumeHermesQueue,
  claimHermesEditor,
  releaseHermesEditor,
  sendHermesPrompt,
  takeOverHermesSession,
  stopHermesTurn,
  markHermesRead,
  restoreHermesSession,
  archiveHermesSession,
  answerHermesDecision,
  canCloseHermesWindow,
  discardHermesDraft,
} from './hermes-session-operations'

export function createHermesLifetime() {
  return {
    dispose: () => {
      stopEvents()
      registry.dispose()
    },
    close: () => Effect.sync(stopEvents).pipe(Effect.andThen(registry.close())),
  }
}

export function ensureHermesChat(target: {
  sessionId?: string
  draftId?: string
  cwd?: string | null
  readOnly?: boolean
}): string {
  const key = hermesChatKey(target)
  if (!sessions()[key]) {
    const initial: HermesChatState = {
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
    }
    replaceHermesState(key, initial)
    if (target.sessionId) startHermesOperation(`history:${key}`, refreshHermesChat(key), 'replace')
    startHermesOperation(`models:${key}`, refreshHermesModelOptions(key))
    startHermesOperation(`capabilities:${key}`, refreshHermesCapabilities(key))
  }
  if (target.sessionId) durableSessionAliases.set(durableSessionKey(target.sessionId), key)
  connectEvents()
  return key
}

export function createHermesSession(initial: HermesSessionTarget) {
  let fallbackDraftId: string | undefined
  const resolve = (target: HermesSessionTarget) =>
    target.sessionId || target.draftId
      ? target
      : { ...target, draftId: (fallbackDraftId ??= randomId()) }
  let current = resolve(initial)
  let currentKey = ensureHermesChat(current)
  const commands = createHermesSessionCommands(() => currentKey)
  return {
    ...commands,
    source: hermesSessionsSource,
    receive(target: HermesSessionTarget) {
      const next = resolve(target)
      if (
        next.sessionId === current.sessionId &&
        next.draftId === current.draftId &&
        next.cwd === current.cwd &&
        next.readOnly === current.readOnly
      )
        return
      current = next
      currentKey = ensureHermesChat(next)
    },
  }
}

export function createHermesSessionCommands(key: () => string) {
  const state = () => sessions()[key()]

  return {
    key,
    state,
    identity: { bind: (sessionId: string) => bindHermesSessionId(key(), sessionId) },
    editor: {
      claim: (owner: string, options?: HermesEditorClaimOptions) =>
        claimHermesEditor(key(), owner, options),
      release: (owner: string) => releaseHermesEditor(key(), owner),
      acquire: (sessionKey: string, owner: string, options?: HermesEditorClaimOptions) => ({
        owned: () => !sessions()[sessionKey]?.editorOwner,
        claim: () => claimHermesEditor(sessionKey, owner, options),
        release: () => releaseHermesEditor(sessionKey, owner),
      }),
    },
    composer: {
      setDraft: (value: string) => setHermesComposer(key(), value),
      setError: (error: unknown) => setHermesError(key(), error),
      applyCompletion: (completion: HermesCompletion) => applyHermesCompletion(key(), completion),
      control: (command: string) => sendHermesControl(key(), command),
    },
    prompt: {
      send: (takeover = false) => sendHermesPrompt(key(), takeover),
      stop: () => stopHermesTurn(key()),
      retry: () => retryHermesLastTurn(key()),
      rewind: (messageId: string, replacement?: string) =>
        rewindHermesSession(key(), messageId, replacement),
      queue: () => queueHermesPrompt(key()),
      removeQueued: (index: number) => removeHermesQueuedPrompt(key(), index),
      editQueued: (index: number) => editHermesQueuedPrompt(key(), index),
      moveQueued: (index: number, direction: -1 | 1) =>
        moveHermesQueuedPrompt(key(), index, direction),
      resumeQueue: () => resumeHermesQueue(key()),
    },
    attachments: {
      addFiles: (files: Iterable<File>) => addHermesAttachments(key(), files),
      addDraggedPath: (dragged: FileDragData) => addHermesDraggedPath(key(), dragged),
      remove: (id: string) => removeHermesAttachment(key(), id),
    },
    history: {
      refresh: () => refreshHermesChat(key()),
      loadOlder: () => loadOlderHermesMessages(key()),
    },
    decision: { answer: (answer: string) => answerHermesDecision(key(), answer) },
    lifecycle: {
      markRead: () => markHermesRead(key()),
      takeOver: () => takeOverHermesSession(key()),
      restore: () => restoreHermesSession(key()),
      archive: () => archiveHermesSession(key()),
      rename: (title: string) => renameHermesSession(key(), title),
      branch: (name?: string, count?: number) => branchHermesSession(key(), name, count),
      export: () => exportHermesSession(key()),
    },
    voice: {
      transcribe: (blob: Blob) => transcribeHermesAudio(key(), blob),
      speak: playHermesReply,
    },
  } as const
}

export const HermesSessions = Object.freeze({
  open: (target: HermesSessionTarget) => {
    const key = ensureHermesChat(target)
    return createHermesSessionCommands(() => key)
  },
  forId: hermesSessionForId,
  canClose: (target?: { draftId?: string; sessionId?: string }) => canCloseHermesWindow(target),
  discardDraft: discardHermesDraft,
  deletedIds: deletedHermesSessionIds,
})

export const HermesVoiceTransport = Object.freeze({
  transcribe: (key: string, blob: Blob) => transcribeHermesAudio(key, blob),
  reportError: setHermesError,
})
export type {
  HermesMessage,
  HermesToolCall,
  HermesAttachment,
  HermesChatState,
  HermesCompletion,
  HermesModelOption,
  HermesQueuedPrompt,
  HermesEditorClaimOptions,
  HermesSessionTarget,
} from './hermes-session-types'
export { HERMES_ATTACHMENT_LIMIT } from './hermes-session-types'
export { hermesSessionsSource } from './hermes-session-registry'
