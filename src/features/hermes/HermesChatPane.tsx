import type { WindowDefinition } from '@/lib/models/window-model'
import {
  addHermesAttachments,
  addHermesDraggedPath,
  applyHermesCompletion,
  archiveHermesSession,
  answerHermesDecision,
  branchHermesSession,
  claimHermesEditor,
  ensureHermesChat,
  hermesSessions,
  markHermesRead,
  loadOlderHermesMessages,
  exportHermesSession,
  queueHermesPrompt,
  releaseHermesEditor,
  editHermesQueuedPrompt,
  moveHermesQueuedPrompt,
  removeHermesQueuedPrompt,
  resumeHermesQueue,
  removeHermesAttachment,
  renameHermesSession,
  retryHermesLastTurn,
  rewindHermesSession,
  restoreHermesSession,
  sendHermesPrompt,
  setHermesComposer,
  setHermesError,
  sendHermesControl,
  speakHermesText,
  stopHermesTurn,
  takeOverHermesSession,
  transcribeHermesAudio,
} from '@/features/hermes/hermes-session-store'
import { For, Show, createEffect, createMemo, createSignal, onSettled, untrack } from 'solid-js'
import Paperclip from 'lucide-solid/icons/paperclip'
import X from 'lucide-solid/icons/x'
import Mic from 'lucide-solid/icons/mic'
import Square from 'lucide-solid/icons/square'
import MoreHorizontal from 'lucide-solid/icons/ellipsis'
import SendHorizontal from 'lucide-solid/icons/send-horizontal'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import ArrowDown from 'lucide-solid/icons/arrow-down'
import Pencil from 'lucide-solid/icons/pencil'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import { HermesMessageCard } from './HermesMessageCard'
import { getFileDragData, hasFileDragData } from '@/lib/files/file-drag-data'
import { unsupportedHermesCommand, voiceControlGates } from '@/features/hermes/hermes-chat-parity'

export function HermesChatPane(props: {
  window: () => WindowDefinition | undefined
  onSessionCreated?: (sessionId: string) => void
  contentVisible?: () => boolean
  active?: () => boolean
  onBranchCreated?: (sessionId: string, title: string) => void
  onTitleChanged?: (title: string) => void
}) {
  const key = createMemo(() => ensureHermesChat(props.window()?.hermes ?? {}))
  const state = () => hermesSessions[key()]
  const owner = () => props.window()?.id ?? key()
  const ownsEditor = () => !state()?.editorOwner || state()?.editorOwner === owner()
  function claimCurrentEditor() {
    const claimKey = key()
    const claimOwner = owner()
    return claimHermesEditor(claimKey, claimOwner, {
      isAlive: () => !disposed && key() === claimKey && owner() === claimOwner,
    })
  }
  const [decisionAnswer, setDecisionAnswer] = createSignal('')
  const [recording, setRecording] = createSignal(false)
  const [microphoneDenied, setMicrophoneDenied] = createSignal(false)
  const [previewImage, setPreviewImage] = createSignal<string | null>(null)
  const [editTarget, setEditTarget] = createSignal<{ id: string; text: string } | null>(null)
  const [editValue, setEditValue] = createSignal('')
  const [renameOpen, setRenameOpen] = createSignal(false)
  const [renameValue, setRenameValue] = createSignal('')
  const [takeoverConfirmOpen, setTakeoverConfirmOpen] = createSignal(false)
  const [atTranscriptBottom, setAtTranscriptBottom] = createSignal(true)
  const [promptHistory, setPromptHistory] = createSignal<string[]>([])
  const [promptHistoryIndex, setPromptHistoryIndex] = createSignal(-1)
  const [showFind, setShowFind] = createSignal(false)
  const [findQuery, setFindQuery] = createSignal('')
  const [findIndex, setFindIndex] = createSignal(0)
  let attachmentInput: HTMLInputElement | undefined
  let mediaRecorder: MediaRecorder | undefined
  let recordingStream: MediaStream | undefined
  let recordingTimer: number | undefined
  let transcriptEl: HTMLDivElement | undefined
  let transcriptContentEl: HTMLDivElement | undefined
  let paneEl: HTMLDivElement | undefined
  let followLatest = true
  let scrollFrame: number | undefined
  let disposed = false
  let microphoneRequest = 0
  let paneActive = false
  let activeDecisionKey: string | undefined

  function scrollTranscriptToBottom() {
    if (!followLatest) return
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      if (!followLatest || !transcriptEl) return
      transcriptEl.scrollTop = transcriptEl.scrollHeight
      setAtTranscriptBottom(true)
    })
  }
  const findMatches = createMemo(() => {
    const query = findQuery().trim().toLowerCase()
    if (!query) return []
    return (state()?.messages ?? []).filter((message) =>
      `${message.text}\n${message.reasoning ?? ''}\n${message.toolName ?? ''}`
        .toLowerCase()
        .includes(query),
    )
  })
  function jumpToFindMatch(index: number) {
    const matches = findMatches()
    if (!matches.length || !transcriptEl) return
    const next = (index + matches.length) % matches.length
    setFindIndex(next)
    transcriptEl
      .querySelector<HTMLElement>(`#${CSS.escape(`hermes-msg-${matches[next]!.id}`)}`)
      ?.scrollIntoView({ block: 'center' })
  }
  const lastAssistantId = createMemo(
    () =>
      [...(state()?.messages ?? [])].reverse().find((message) => message.role === 'assistant')?.id,
  )
  const completedToolCallIds = createMemo(
    () =>
      new Set(
        (state()?.messages ?? [])
          .filter((message) => message.role === 'tool' && message.toolCallId)
          .map((message) => message.toolCallId!),
      ),
  )
  const activeModelOption = () =>
    state()?.modelOptions.find((option) => option.value.endsWith(`/${state()?.model}`))
  const voiceGates = () =>
    voiceControlGates({
      transcription: state()?.voice.transcription ?? false,
      playback: state()?.voice.playback ?? false,
      mediaRecorder: typeof MediaRecorder !== 'undefined',
      microphoneApi: !!navigator.mediaDevices?.getUserMedia,
      permissionDenied: microphoneDenied(),
    })

  onSettled(() => () => {
    disposed = true
    microphoneRequest++
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    if (recordingTimer !== undefined) window.clearTimeout(recordingTimer)
    if (mediaRecorder) {
      mediaRecorder.ondataavailable = null
      mediaRecorder.onstop = null
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop()
    }
    recordingStream?.getTracks().forEach((track) => track.stop())
  })

  onSettled(() => {
    const transcriptObserver = new ResizeObserver(scrollTranscriptToBottom)
    if (transcriptContentEl) transcriptObserver.observe(transcriptContentEl)

    const handleFind = (event: KeyboardEvent) => {
      if (
        (props.contentVisible?.() ?? true) &&
        ((props.active?.() ?? false) || paneActive || !!paneEl?.contains(document.activeElement)) &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setShowFind(true)
      }
    }
    const handlePointer = (event: PointerEvent) => {
      paneActive = !!paneEl?.contains(event.target as Node)
    }
    window.addEventListener('keydown', handleFind)
    window.addEventListener('pointerdown', handlePointer)
    // eslint-disable-next-line solid/reactivity
    return () => {
      transcriptObserver.disconnect()
      window.removeEventListener('keydown', handleFind)
      window.removeEventListener('pointerdown', handlePointer)
    }
  })

  async function toggleRecording() {
    if (recording()) {
      mediaRecorder?.stop()
      return
    }
    const request = ++microphoneRequest
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (disposed || request !== microphoneRequest || !(props.contentVisible?.() ?? true)) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      recordingStream = stream
      const chunks: Blob[] = []
      const recorder = new MediaRecorder(stream)
      const recordingKey = key()
      mediaRecorder = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        if (recordingStream === stream) recordingStream = undefined
        if (disposed) return
        setRecording(false)
        if (recordingTimer !== undefined) window.clearTimeout(recordingTimer)
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size)
          void transcribeHermesAudio(recordingKey, blob).catch((error) =>
            setHermesError(recordingKey, error),
          )
      }
      recorder.start()
      setRecording(true)
      recordingTimer = window.setTimeout(
        () => recorder.state !== 'inactive' && recorder.stop(),
        (state()?.voice.maxRecordingSeconds ?? 120) * 1000,
      )
    } catch (error) {
      if (disposed || request !== microphoneRequest) return
      setMicrophoneDenied(true)
      setHermesError(key(), error)
    }
  }

  createEffect(
    () => ({ currentKey: key(), currentOwner: owner() }),
    ({ currentKey, currentOwner }) => {
      let alive = true
      untrack(() => {
        if (!hermesSessions[currentKey]?.editorOwner)
          void claimHermesEditor(currentKey, currentOwner, {
            isAlive: () => alive && !disposed && key() === currentKey && owner() === currentOwner,
          })
      })
      return () => {
        alive = false
        releaseHermesEditor(currentKey, currentOwner)
      }
    },
  )
  createEffect(
    () => ({ visible: props.contentVisible?.() ?? true, currentKey: key() }),
    ({ visible, currentKey }) => {
      if (visible) markHermesRead(currentKey)
    },
  )
  createEffect(
    () => ({
      sessionId: state()?.sessionId,
      windowSessionId: props.window()?.hermes?.sessionId,
    }),
    ({ sessionId, windowSessionId }) => {
      if (sessionId && sessionId !== windowSessionId) props.onSessionCreated?.(sessionId)
    },
  )
  createEffect(
    () => {
      const decision = state()?.decision
      return {
        nextKey: decision ? `${key()}:${decision.kind}:${decision.dedupeId}` : undefined,
      }
    },
    ({ nextKey }) => {
      if (nextKey === activeDecisionKey) return
      activeDecisionKey = nextKey
      setDecisionAnswer('')
    },
  )
  createEffect(
    () => ({ title: state()?.title?.trim(), windowTitle: props.window()?.title }),
    ({ title, windowTitle }) => {
      if (title && title !== windowTitle) props.onTitleChanged?.(title)
    },
  )

  async function submit(takeover = false) {
    if (!(await claimCurrentEditor())) return
    const command = state()?.composer.trim() ?? ''
    const unsupported = unsupportedHermesCommand(command)
    if (unsupported) {
      setHermesError(key(), unsupported)
      return
    }
    if (command === '/export') {
      void exportHermesSession(key())
      setHermesComposer(key(), '')
      return
    }
    if (command === '/stop') {
      await stopHermesTurn(key())
      setHermesComposer(key(), '')
      return
    }
    if (command === '/retry') {
      await retryHermesLastTurn(key())
      setHermesComposer(key(), '')
      return
    }
    if (command === '/voice') {
      setHermesError(key(), 'Use Push to talk or Play reply controls for voice in this chat')
      return
    }
    if (command.startsWith('/title ')) {
      const title = command.slice(7).trim()
      await renameHermesSession(key(), title)
      props.onTitleChanged?.(title)
      setHermesComposer(key(), '')
      return
    }
    if (command === '/branch' || command.startsWith('/branch ')) {
      const branch = await branchHermesSession(key(), command.slice(7).trim())
      setHermesComposer(key(), '')
      if (branch) props.onBranchCreated?.(branch.sessionId, branch.title)
      return
    }
    if (state()?.status === 'sending' || state()?.status === 'streaming') {
      if (command)
        setPromptHistory((items) =>
          [...items.filter((item) => item !== command), command].slice(-100),
        )
      queueHermesPrompt(key())
      return
    }
    try {
      if (command)
        setPromptHistory((items) =>
          [...items.filter((item) => item !== command), command].slice(-100),
        )
      setPromptHistoryIndex(-1)
      await sendHermesPrompt(key(), takeover)
    } catch (error) {
      if (String(error).toLowerCase().includes('takeover')) setTakeoverConfirmOpen(true)
    }
  }

  return (
    <div
      ref={(element) => {
        paneEl = element
      }}
      class='relative flex h-full min-h-0 flex-col bg-background text-[13px] text-foreground'
      data-testid='hermes-chat-pane'
    >
      <Show when={showFind()}>
        <div class='absolute top-1 right-9 z-40 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md'>
          <input
            autofocus
            class='h-7 w-44 rounded border border-input bg-background px-2 text-xs'
            placeholder='Find in chat'
            value={findQuery()}
            onInput={(event) => {
              setFindQuery(event.currentTarget.value)
              setFindIndex(0)
              queueMicrotask(() => untrack(() => jumpToFindMatch(0)))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') jumpToFindMatch(findIndex() + (event.shiftKey ? -1 : 1))
              if (event.key === 'Escape') setShowFind(false)
            }}
          />
          <span class='min-w-10 text-center text-[10px] text-muted-foreground'>
            {findMatches().length ? `${findIndex() + 1}/${findMatches().length}` : '0/0'}
          </span>
          <button
            class='rounded p-1 hover:bg-muted'
            aria-label='Close find'
            onClick={() => setShowFind(false)}
          >
            <X class='h-3.5 w-3.5' />
          </button>
        </div>
      </Show>
      <Show when={state()?.status !== 'idle' || state()?.archived || state()?.unavailable}>
        <div class='flex min-h-7 items-center gap-2 border-b border-border px-3 py-1 pr-9 text-[11px] text-muted-foreground'>
          <Show when={state()?.status !== 'idle'}>
            <span>{state()?.status ?? 'loading'}</span>
          </Show>
          <Show when={state()?.archived}>
            <span>Archived</span>
          </Show>
          <Show when={state()?.unavailable}>
            <span>Session unavailable</span>
          </Show>
          <Show when={state()?.archived}>
            <button
              class='ml-auto hover:text-foreground'
              onClick={() => void restoreHermesSession(key())}
            >
              Restore
            </button>
          </Show>
        </div>
      </Show>
      <div
        ref={(element) => {
          transcriptEl = element
        }}
        data-testid='hermes-transcript'
        class='min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 pr-4 select-text [overflow-anchor:none]'
        onWheel={(event) => {
          if (event.deltaY < 0) followLatest = false
          else if (
            transcriptEl &&
            transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight <= 1
          )
            followLatest = true
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) followLatest = false
        }}
        onTouchStart={() => {
          followLatest = false
        }}
        onScroll={() => {
          if (!transcriptEl) return
          const atBottom =
            transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight <= 1
          setAtTranscriptBottom(atBottom)
          if (atBottom) followLatest = true
        }}
      >
        <div
          ref={(element) => {
            transcriptContentEl = element
          }}
          class='space-y-2'
        >
          <Show when={state()?.status === 'loading'}>
            <div>Loading transcript…</div>
          </Show>
          <Show when={state()?.hasOlderMessages}>
            <div class='text-center'>
              <button
                class='rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground'
                disabled={state()?.historyLoading}
                onClick={() => {
                  const before = transcriptEl?.scrollHeight ?? 0
                  void loadOlderHermesMessages(key()).then(() => {
                    queueMicrotask(() => {
                      if (transcriptEl) transcriptEl.scrollTop += transcriptEl.scrollHeight - before
                    })
                  })
                }}
              >
                {state()?.historyLoading ? 'Loading…' : 'Load older messages'}
              </button>
            </div>
          </Show>
          <For each={state()?.messages ?? []}>
            {(message) => (
              <div
                id={`hermes-msg-${message.id}`}
                class={
                  findMatches()[findIndex()]?.id === message.id
                    ? 'rounded-md ring-1 ring-violet-500/60'
                    : ''
                }
              >
                <HermesMessageCard
                  message={message}
                  completedToolCallIds={completedToolCallIds()}
                  onOpenImage={setPreviewImage}
                  onEdit={
                    state()?.readOnly || state()?.status !== 'idle'
                      ? undefined
                      : (item) => {
                          setEditTarget({ id: item.id, text: item.text })
                          setEditValue(item.text)
                        }
                  }
                  onBranch={
                    state()?.readOnly
                      ? undefined
                      : (item) => {
                          const count =
                            (state()?.messages.findIndex((candidate) => candidate.id === item.id) ??
                              -1) + 1
                          void branchHermesSession(key(), undefined, count).then((branch) =>
                            untrack(() => {
                              if (branch) props.onBranchCreated?.(branch.sessionId, branch.title)
                            }),
                          )
                        }
                  }
                  onSpeak={
                    voiceGates().playback && message.role === 'assistant'
                      ? (item) =>
                          void speakHermesText(item.text).catch((error) =>
                            untrack(() => setHermesError(key(), error)),
                          )
                      : undefined
                  }
                  onRetry={
                    message.id === lastAssistantId() &&
                    state()?.status === 'idle' &&
                    !state()?.readOnly
                      ? () => void retryHermesLastTurn(key())
                      : undefined
                  }
                />
              </div>
            )}
          </For>
          <Show when={state()?.awaitingResponse && !state()?.streamMessageId}>
            <div
              class='flex min-h-7 items-center gap-1.5 pl-5 text-xs text-muted-foreground'
              data-testid='hermes-awaiting-response'
            >
              <LoaderCircle class='h-3.5 w-3.5 animate-spin text-violet-500' />
              <span>Working…</span>
            </div>
          </Show>
        </div>
      </div>
      <Show when={!atTranscriptBottom()}>
        <button
          class='absolute bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-popover p-1.5 text-muted-foreground shadow-md hover:text-foreground'
          aria-label='Jump to latest message'
          onClick={() => {
            followLatest = true
            setAtTranscriptBottom(true)
            scrollTranscriptToBottom()
          }}
        >
          <ArrowDown class='h-3.5 w-3.5' />
        </button>
      </Show>
      <Show when={state()?.error}>
        <div class='border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
          {state()?.error}
        </div>
      </Show>
      <Show when={state()?.connection !== 'connected'}>
        <div
          class='border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300'
          role='status'
        >
          {state()?.connection === 'auth-error'
            ? 'Hermes authentication rejected. Check configured gateway token.'
            : 'Hermes gateway disconnected. Transcript remains available; reconnecting…'}
        </div>
      </Show>
      <Show when={state()?.decision}>
        {(decision) => (
          <div class='border-t border-amber-500/30 bg-amber-500/10 p-3 text-sm'>
            <div class='mb-2 whitespace-pre-wrap'>{decision().prompt}</div>
            <div class='flex flex-wrap gap-2'>
              <For each={decision().choices}>
                {(choice) => (
                  <button
                    class='rounded-md border border-amber-500/40 px-3 py-1.5 text-xs'
                    onClick={() => void answerHermesDecision(key(), choice)}
                  >
                    {choice}
                  </button>
                )}
              </For>
              <Show when={decision().choices.length === 0}>
                <input
                  type={
                    decision().kind === 'secret' || decision().kind === 'sudo' ? 'password' : 'text'
                  }
                  autocomplete='off'
                  class='min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs'
                  value={decisionAnswer()}
                  onInput={(event) => setDecisionAnswer(event.currentTarget.value)}
                />
                <button
                  class='rounded-md border border-amber-500/40 px-3 py-1.5 text-xs disabled:opacity-50'
                  disabled={!decisionAnswer()}
                  onClick={() => {
                    const answer = decisionAnswer()
                    if (!answer) return
                    setDecisionAnswer('')
                    void answerHermesDecision(key(), answer)
                  }}
                >
                  Answer
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <Show
        when={!state()?.readOnly}
        fallback={
          <div class='flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground'>
            <span>
              {state()?.externallyActive
                ? `Active in ${state()?.externalSource || 'another Hermes client'} — observer mode`
                : 'Archived session — read only'}
            </span>
            <Show when={state()?.externallyActive}>
              <button
                class='ml-auto rounded-md border border-input px-2 py-1 text-foreground hover:bg-muted'
                onClick={() => takeOverHermesSession(key())}
              >
                Take over
              </button>
            </Show>
          </div>
        }
      >
        <div
          data-testid='hermes-composer'
          class='relative shrink-0 rounded-t-lg border-t border-border bg-card px-2 py-1.5 shadow-[0_-4px_14px_rgba(0,0,0,0.12)]'
          onDragOver={(event) => {
            if (
              event.dataTransfer?.types.includes('Files') ||
              (event.dataTransfer && hasFileDragData(event.dataTransfer))
            )
              event.preventDefault()
          }}
          onDrop={(event) => {
            const dragged = event.dataTransfer && getFileDragData(event.dataTransfer)
            if (dragged) {
              event.preventDefault()
              void addHermesDraggedPath(key(), dragged)
              return
            }
            if (!event.dataTransfer?.files.length) return
            event.preventDefault()
            void addHermesAttachments(key(), event.dataTransfer.files)
          }}
          onPaste={(event) => {
            const files = event.clipboardData?.files
            if (!files?.length) return
            void addHermesAttachments(key(), files)
          }}
        >
          <input
            ref={(element) => {
              attachmentInput = element
            }}
            class='hidden'
            type='file'
            multiple
            onChange={(event) => {
              if (event.currentTarget.files)
                void addHermesAttachments(key(), event.currentTarget.files)
              event.currentTarget.value = ''
            }}
          />
          <Show when={state()?.attachments.length}>
            <div class='mb-2 flex flex-wrap gap-2' aria-label='Attachments'>
              <For each={state()?.attachments ?? []}>
                {(attachment) => (
                  <div
                    class='flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs'
                    title={attachment.error}
                  >
                    <span class='max-w-48 truncate'>{attachment.name}</span>
                    <span class='text-muted-foreground'>
                      {attachment.status === 'uploading' ? 'Uploading…' : attachment.status}
                    </span>
                    <button
                      aria-label={`Remove ${attachment.name}`}
                      disabled={attachment.status === 'uploading'}
                      onClick={() => removeHermesAttachment(key(), attachment.id)}
                    >
                      <X class='h-3.5 w-3.5' />
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={state()?.queuedPrompts.length}>
            <details class='mb-1 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground'>
              <summary class='cursor-pointer px-2 py-1'>
                {state()?.queuedPrompts.length} queued prompt
                {state()?.queuedPrompts.length === 1 ? '' : 's'}
                {state()?.queueParked ? ' · parked' : ''}
              </summary>
              <div class='space-y-1 border-t border-border p-1'>
                <For each={state()?.queuedPrompts ?? []}>
                  {(prompt, index) => (
                    <div class='flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted'>
                      <span class='min-w-0 flex-1 truncate'>{prompt.text}</span>
                      <button
                        title='Move up'
                        disabled={index() === 0}
                        onClick={() => moveHermesQueuedPrompt(key(), index(), -1)}
                      >
                        <ArrowUp class='h-3 w-3' />
                      </button>
                      <button
                        title='Move down'
                        disabled={index() === (state()?.queuedPrompts.length ?? 0) - 1}
                        onClick={() => moveHermesQueuedPrompt(key(), index(), 1)}
                      >
                        <ArrowDown class='h-3 w-3' />
                      </button>
                      <button
                        title='Edit queued prompt'
                        onClick={() => editHermesQueuedPrompt(key(), index())}
                      >
                        <Pencil class='h-3 w-3' />
                      </button>
                      <button
                        title='Remove queued prompt'
                        onClick={() => removeHermesQueuedPrompt(key(), index())}
                      >
                        <X class='h-3 w-3' />
                      </button>
                    </div>
                  )}
                </For>
                <Show when={state()?.queueParked}>
                  <button
                    class='rounded border border-input px-2 py-1 text-foreground'
                    onClick={() => resumeHermesQueue(key())}
                  >
                    Resume queue
                  </button>
                </Show>
              </div>
            </details>
          </Show>
          <Show when={state()?.completions.length}>
            <div class='absolute right-2 bottom-full left-2 z-30 mb-1 overflow-hidden rounded-md border border-border bg-popover shadow-md'>
              <For each={state()?.completions ?? []}>
                {(completion) => (
                  <button
                    class='flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-muted'
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyHermesCompletion(key(), completion)}
                  >
                    <span class='font-mono text-violet-500'>
                      {completion.display || completion.text}
                    </span>
                    <span class='truncate text-muted-foreground'>{completion.meta}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div class='flex items-center gap-1'>
            <button
              class='shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground'
              aria-label='Attach files (16 MiB maximum each)'
              title='Attach files (16 MiB maximum each)'
              disabled={state()?.connection !== 'connected'}
              onClick={() => attachmentInput?.click()}
            >
              <Paperclip class='h-4 w-4' />
            </button>
            <textarea
              class='scrollbar-none max-h-24 min-h-8 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-input bg-background px-2.5 py-1.5 text-[13px] leading-5 outline-none focus:ring-1 focus:ring-ring'
              rows={1}
              value={state()?.composer ?? ''}
              placeholder='Message Hermes…'
              disabled={!ownsEditor() || state()?.connection !== 'connected'}
              onFocus={() => void claimCurrentEditor()}
              onInput={(event) => {
                setHermesComposer(key(), event.currentTarget.value)
                setPromptHistoryIndex(-1)
                event.currentTarget.style.height = 'auto'
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`
              }}
              onKeyDown={(event) => {
                if (
                  (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
                  !state()?.completions.length &&
                  !event.shiftKey
                ) {
                  const history = promptHistory()
                  const atStart = event.currentTarget.selectionStart === 0
                  const atEnd =
                    event.currentTarget.selectionStart === event.currentTarget.value.length
                  if (
                    history.length &&
                    ((event.key === 'ArrowUp' && atStart) || (event.key === 'ArrowDown' && atEnd))
                  ) {
                    event.preventDefault()
                    const current = promptHistoryIndex()
                    const next =
                      event.key === 'ArrowUp'
                        ? Math.min(history.length - 1, current + 1)
                        : Math.max(-1, current - 1)
                    setPromptHistoryIndex(next)
                    setHermesComposer(
                      key(),
                      next < 0 ? '' : (history[history.length - 1 - next] ?? ''),
                    )
                    return
                  }
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />
            <Show when={(state()?.sessionId && !state()?.archived) || state()?.modelOptions.length}>
              <details class='relative shrink-0' name='hermes-composer-menu'>
                <summary
                  class='flex cursor-pointer list-none rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                  aria-label='Chat options'
                >
                  <MoreHorizontal class='h-4 w-4' />
                </summary>
                <div class='absolute right-0 bottom-full z-30 mb-1 flex min-w-52 max-w-[min(18rem,calc(100vw-2rem))] flex-col gap-1 rounded-md border border-border bg-popover p-1 text-xs text-foreground shadow-lg'>
                  <Show when={state()?.status === 'sending' || state()?.status === 'streaming'}>
                    <button
                      class='rounded px-2 py-1 text-left text-destructive hover:bg-muted'
                      onClick={() => void stopHermesTurn(key())}
                    >
                      Stop response
                    </button>
                  </Show>
                  <Show when={state()?.sessionId && !state()?.archived}>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted'
                      onClick={() => {
                        setRenameValue(state()?.title ?? '')
                        setRenameOpen(true)
                      }}
                    >
                      Rename
                    </button>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted'
                      onClick={() =>
                        void branchHermesSession(key()).then((branch) =>
                          untrack(() => {
                            if (branch) props.onBranchCreated?.(branch.sessionId, branch.title)
                          }),
                        )
                      }
                    >
                      Branch
                    </button>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted'
                      onClick={() => void exportHermesSession(key())}
                    >
                      Export
                    </button>
                    <button
                      class='rounded px-2 py-1 text-left hover:bg-muted disabled:opacity-50'
                      disabled={state()?.status !== 'idle' || !!state()?.queuedPrompts.length}
                      onClick={() =>
                        void archiveHermesSession(key()).catch((error) =>
                          untrack(() => setHermesError(key(), error)),
                        )
                      }
                    >
                      Archive
                    </button>
                  </Show>
                  <Show when={state()?.modelOptions.length}>
                    <div class='my-0.5 border-t border-border' />
                    <select
                      class='min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs'
                      aria-label='Hermes model'
                      value={
                        state()?.provider && state()?.model
                          ? `${state()?.provider}/${state()?.model}`
                          : ''
                      }
                      disabled={state()?.status !== 'idle'}
                      onChange={(event) =>
                        void sendHermesControl(key(), `/model ${event.currentTarget.value}`)
                      }
                    >
                      <option value='' disabled>
                        Model
                      </option>
                      <For each={state()?.modelOptions}>
                        {(option) => <option value={option.value}>{option.label}</option>}
                      </For>
                    </select>
                    <Show when={activeModelOption()?.reasoning}>
                      <select
                        class='min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs'
                        aria-label='Reasoning effort'
                        disabled={state()?.status !== 'idle'}
                        onChange={(event) =>
                          void sendHermesControl(key(), `/reasoning ${event.currentTarget.value}`)
                        }
                      >
                        <option value=''>Reasoning</option>
                        <For each={['none', 'low', 'medium', 'high', 'xhigh']}>
                          {(effort) => <option value={effort}>{effort}</option>}
                        </For>
                      </select>
                    </Show>
                    <Show when={activeModelOption()?.fast}>
                      <button
                        class='rounded-md border border-border px-2 py-1.5 text-left text-xs'
                        disabled={state()?.status !== 'idle'}
                        onClick={() => void sendHermesControl(key(), '/fast')}
                      >
                        Toggle Fast mode
                      </button>
                    </Show>
                  </Show>
                </div>
              </details>
            </Show>
            <Show when={voiceGates().record}>
              <button
                class={`shrink-0 rounded-md p-1.5 ${recording() ? 'text-red-500' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                aria-label={
                  microphoneDenied()
                    ? 'Microphone permission denied'
                    : recording()
                      ? 'Stop voice recording'
                      : 'Record voice prompt'
                }
                title={
                  microphoneDenied()
                    ? 'Microphone permission denied'
                    : recording()
                      ? 'Stop recording'
                      : 'Push to talk'
                }
                disabled={voiceGates().recordDisabled}
                onClick={() => void toggleRecording()}
              >
                <Show when={!recording()} fallback={<Square class='h-4 w-4' />}>
                  <Mic class='h-4 w-4' />
                </Show>
              </button>
            </Show>
            <Show when={!ownsEditor()}>
              <button
                class='rounded-md border border-border px-3 py-1.5 text-xs'
                onClick={() => void claimCurrentEditor()}
              >
                Take editing control
              </button>
            </Show>
            <button
              class='flex shrink-0 items-center gap-1 rounded-md bg-primary p-1.5 text-xs text-primary-foreground disabled:opacity-50'
              aria-label={
                state()?.status === 'sending' || state()?.status === 'streaming'
                  ? 'Queue prompt'
                  : 'Send'
              }
              disabled={!state()?.composer.trim() || state()?.connection !== 'connected'}
              onClick={() => void submit()}
            >
              <SendHorizontal class='h-4 w-4' />
            </button>
          </div>
        </div>
      </Show>
      <Show when={editTarget()}>
        {(target) => (
          <div
            class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
            role='presentation'
            onClick={() => setEditTarget(null)}
          >
            <form
              class='w-full max-w-md rounded-lg border border-border bg-card p-3 shadow-xl'
              role='dialog'
              aria-modal='true'
              aria-labelledby='hermes-edit-title'
              onClick={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault()
                const text = editValue().trim()
                if (!text) return
                void rewindHermesSession(key(), target().id, text).then(() => setEditTarget(null))
              }}
            >
              <h2 id='hermes-edit-title' class='text-sm font-semibold'>
                Edit prompt and rewind
              </h2>
              <p class='mt-1 text-xs text-muted-foreground'>
                Messages after this prompt will be replaced.
              </p>
              <textarea
                autofocus
                class='mt-3 max-h-52 min-h-24 w-full resize-y rounded-md border border-input bg-background p-2 text-sm'
                value={editValue()}
                onInput={(event) => setEditValue(event.currentTarget.value)}
              />
              <div class='mt-3 flex justify-end gap-2'>
                <button
                  type='button'
                  class='h-8 rounded-md border border-input px-3 text-xs'
                  onClick={() => setEditTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  class='h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50'
                  disabled={!editValue().trim()}
                >
                  Rewind
                </button>
              </div>
            </form>
          </div>
        )}
      </Show>
      <Show when={renameOpen()}>
        <div
          class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
          role='presentation'
          onClick={() => setRenameOpen(false)}
        >
          <form
            class='w-full max-w-sm rounded-lg border border-border bg-card p-3 shadow-xl'
            role='dialog'
            aria-modal='true'
            aria-labelledby='hermes-rename-title'
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault()
              const title = renameValue().trim()
              if (!title) return
              void renameHermesSession(key(), title).then(() =>
                untrack(() => {
                  props.onTitleChanged?.(title)
                  setRenameOpen(false)
                }),
              )
            }}
          >
            <h2 id='hermes-rename-title' class='text-sm font-semibold'>
              Rename session
            </h2>
            <input
              autofocus
              class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm'
              value={renameValue()}
              onInput={(event) => setRenameValue(event.currentTarget.value)}
            />
            <div class='mt-3 flex justify-end gap-2'>
              <button
                type='button'
                class='h-8 rounded-md border border-input px-3 text-xs'
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </button>
              <button
                type='submit'
                class='h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50'
                disabled={!renameValue().trim()}
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      </Show>
      <Show when={takeoverConfirmOpen()}>
        <div
          class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
          role='presentation'
          onClick={() => setTakeoverConfirmOpen(false)}
        >
          <div
            class='w-full max-w-xs rounded-lg border border-border bg-card p-3 shadow-xl'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='hermes-takeover-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id='hermes-takeover-title' class='text-sm font-semibold'>
              Take over session?
            </h2>
            <p class='mt-1 text-xs text-muted-foreground'>
              Session is active in another Hermes client. Taking over transfers editing here.
            </p>
            <div class='mt-3 flex justify-end gap-2'>
              <button
                class='h-8 rounded-md border border-input px-3 text-xs'
                onClick={() => setTakeoverConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                class='h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground'
                onClick={() => {
                  setTakeoverConfirmOpen(false)
                  void submit(true)
                }}
              >
                Take over
              </button>
            </div>
          </div>
        </div>
      </Show>
      <Show when={previewImage()}>
        {(src) => (
          <div
            class='absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-3'
            role='dialog'
            aria-modal='true'
            aria-label='Hermes image preview'
            tabindex={0}
            onClick={(event) => event.target === event.currentTarget && setPreviewImage(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setPreviewImage(null)
            }}
          >
            <button
              class='absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/80 hover:bg-black/70 hover:text-white'
              aria-label='Close image preview'
              onClick={() => setPreviewImage(null)}
            >
              <X class='h-4 w-4' />
            </button>
            <img
              src={src()}
              alt='Hermes image preview'
              class='max-h-full max-w-full object-contain'
            />
          </div>
        )}
      </Show>
    </div>
  )
}
