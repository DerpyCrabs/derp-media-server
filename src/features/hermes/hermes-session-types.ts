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

export type HermesEditorClaimOptions = {
  /** Return false when caller pane was disposed or switched to another window. */
  isAlive?: () => boolean
}

export type HermesSessionTarget = {
  sessionId?: string
  draftId?: string
  cwd?: string | null
  readOnly?: boolean
}
