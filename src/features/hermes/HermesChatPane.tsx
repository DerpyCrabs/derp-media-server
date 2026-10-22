import { Effect } from 'effect'
import { modelOwner, domMount, view, list, controllerView } from 'effectweb'
import type { HermesSessionTarget } from './hermes-session-store'
export type HermesChatPaneProps = {
  target: HermesSessionTarget | undefined
  ownerId?: string
  title?: string
  onSessionCreated?: (id: string) => void
  contentVisible?: boolean
  active?: boolean
  onBranchCreated?: (id: string, title: string) => void
  onTitleChanged?: (title: string) => void
}
import { createHermesSession } from '@/features/hermes/hermes-session-store'
import Paperclip from '@effectweb/lucide/icons/paperclip'
import X from '@effectweb/lucide/icons/x'
import Mic from '@effectweb/lucide/icons/mic'
import Square from '@effectweb/lucide/icons/square'
import MoreHorizontal from '@effectweb/lucide/icons/ellipsis'
import SendHorizontal from '@effectweb/lucide/icons/send-horizontal'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import ArrowDown from '@effectweb/lucide/icons/arrow-down'
import Pencil from '@effectweb/lucide/icons/pencil'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import { HermesMessageCard } from './HermesMessageCard'
import { getFileDragData, hasFileDragData } from '@/lib/files/file-drag-data'
import { unsupportedHermesCommand, voiceControlGates } from '@/features/hermes/hermes-chat-parity'
import { createHermesChatUiState } from './hermes-chat-ui-state'
import { createHermesVoiceRecorder } from './create-hermes-voice-recorder'
const chatCommands = (key: string | number) => ['hermes-chat', key] as const
/** A DOM mount that remembers its element, for controller work such as focus and scrolling. */
function elementHandle<T extends Element>(attached?: (element: T) => void | (() => void)) {
  let current: T | undefined
  const mount = domMount<T>((element) => {
    current = element
    const cleanup = attached?.(element)
    return () => {
      if (current === element) current = undefined
      cleanup?.()
    }
  })
  return { mount, element: () => current }
}

function createChatPane(props: HermesChatPaneProps) {
  const session = createHermesSession(props.target ?? {})
  const key = session.key
  const state = session.state
  const owner = () => props.ownerId ?? key()
  function claimCurrentEditor() {
    const claimKey = key()
    const claimOwner = owner()
    return session.editor.claim(claimOwner, {
      isAlive: () => !disposed && key() === claimKey && owner() === claimOwner,
    })
  }
  const ui = createHermesChatUiState()
  const voiceRecorder = createHermesVoiceRecorder({
    sessionKey: key,
    visible: () => props.contentVisible ?? true,
    maxSeconds: () => state()?.voice.maxRecordingSeconds ?? 120,
  })
  const attachmentInput = elementHandle<HTMLInputElement>()
  const transcriptEl = elementHandle<HTMLDivElement>(() => scrollTranscriptToBottom())
  const transcriptContentEl = elementHandle<HTMLDivElement>((element) => {
    transcriptObserver.observe(element)
    return () => transcriptObserver.unobserve(element)
  })
  const paneEl = elementHandle<HTMLDivElement>()
  const findInputEl = elementHandle<HTMLInputElement>((element) => element.focus())
  let findReturnFocus: HTMLElement | null = null
  let followLatest = true
  let awaitingScrollAway = false
  let scrollFrame: number | undefined
  let disposed = false
  let paneActive = false
  const decisionKey = () => {
    const decision = state()?.decision
    return decision ? `${key()}:${decision.kind}:${decision.dedupeId}` : ''
  }
  const setDecisionAnswer = (answer: string) =>
    model.patch({ decisionDraft: { key: decisionKey(), answer } })
  function openFind() {
    findReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ui.search.show()
    queueMicrotask(() => findInputEl.element()?.focus())
  }
  function closeFind() {
    ui.search.hide()
    queueMicrotask(() => {
      if (findReturnFocus?.isConnected) findReturnFocus.focus()
      findReturnFocus = null
    })
  }
  function pauseTranscriptFollow() {
    if (followLatest) awaitingScrollAway = true
    followLatest = false
    if (scrollFrame !== undefined) {
      cancelAnimationFrame(scrollFrame)
      scrollFrame = undefined
    }
  }
  function scrollTranscriptToBottom() {
    if (!followLatest) return
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = undefined
      const transcript = transcriptEl.element()
      if (!followLatest || !transcript) return
      transcript.scrollTop = transcript.scrollHeight
      ui.transcript.markAtBottom(true)
    })
  }
  const findMatches = () => {
    const query = ui.search.query().trim().toLowerCase()
    if (!query) return []
    return (state()?.messages ?? []).filter((message) =>
      `${message.text}\n${message.reasoning ?? ''}\n${message.toolName ?? ''}`
        .toLowerCase()
        .includes(query),
    )
  }
  function jumpToFindMatch(index: number) {
    const matches = findMatches()
    const transcript = transcriptEl.element()
    if (!matches.length || !transcript) return
    const next = (index + matches.length) % matches.length
    ui.search.setIndex(next)
    transcript
      .querySelector<HTMLElement>(`#${CSS.escape(`hermes-msg-${matches[next]!.id}`)}`)
      ?.scrollIntoView({ block: 'center' })
  }
  const transcriptObserver = new ResizeObserver(scrollTranscriptToBottom)
  const handleFind = (event: KeyboardEvent) => {
    if (
      (props.contentVisible ?? true) &&
      ((props.active ?? false) ||
        paneActive ||
        !!paneEl.element()?.contains(document.activeElement)) &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'f'
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
      openFind()
    }
  }
  const handlePointer = (event: PointerEvent) => {
    paneActive = !!paneEl.element()?.contains(event.target as Node)
  }
  window.addEventListener('keydown', handleFind, true)
  window.addEventListener('pointerdown', handlePointer)
  function submit(takeover = false) {
    void model.run(
      chatCommands('submit'),
      Effect.gen(function* () {
        if (!(yield* claimCurrentEditor())) return
        const command = state()?.composer.trim() ?? ''
        const unsupported = unsupportedHermesCommand(command)
        if (unsupported) {
          session.composer.setError(unsupported)
          return
        }
        if (command === '/export') {
          yield* session.lifecycle.export()
          session.composer.setDraft('')
          return
        }
        if (command === '/stop') {
          yield* session.prompt.stop()
          session.composer.setDraft('')
          return
        }
        if (command === '/retry') {
          yield* session.prompt.retry()
          session.composer.setDraft('')
          return
        }
        if (command === '/voice') {
          session.composer.setError(
            'Use Push to talk or Play reply controls for voice in this chat',
          )
          return
        }
        if (command.startsWith('/title ')) {
          const title = command.slice(7).trim()
          yield* session.lifecycle.rename(title)
          props.onTitleChanged?.(title)
          session.composer.setDraft('')
          return
        }
        if (command === '/branch' || command.startsWith('/branch ')) {
          const branch = yield* session.lifecycle.branch(command.slice(7).trim())
          session.composer.setDraft('')
          if (branch) props.onBranchCreated?.(branch.sessionId, branch.title)
          return
        }
        if (state()?.status === 'sending' || state()?.status === 'streaming') {
          if (command) ui.promptHistory.record(command)
          session.prompt.queue()
          return
        }
        if (command) ui.promptHistory.record(command)
        ui.promptHistory.resetCursor()
        yield* session.prompt.send(takeover)
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (String(error).toLowerCase().includes('takeover')) ui.dialogs.openTakeover()
            else session.composer.setError(error)
          }),
        ),
      ),
      'queue',
    )
  }
  const reportError = (error: unknown) => Effect.sync(() => session.composer.setError(error))

  const elements = { paneEl, findInputEl, transcriptEl, transcriptContentEl, attachmentInput }
  const actions = {
    restore: () =>
      model.run(
        chatCommands('lifecycle'),
        session.lifecycle.restore().pipe(Effect.catch(reportError)),
        'queue',
      ),
    retry: () => model.run(chatCommands('submit'), session.prompt.retry(), 'queue'),
    stop: () =>
      model.run(
        chatCommands('stop'),
        session.prompt.stop().pipe(Effect.catch(reportError)),
        'drop',
      ),
    exportSession: () =>
      model.run(
        chatCommands('export'),
        session.lifecycle.export().pipe(Effect.catch(reportError)),
        'drop',
      ),
    archive: () =>
      model.run(
        chatCommands('lifecycle'),
        session.lifecycle.archive().pipe(Effect.catch(reportError)),
        'queue',
      ),
    answer: (answer: string) =>
      model.run(chatCommands('decision'), session.decision.answer(answer), 'drop'),
    addFiles: (files: Iterable<File>) =>
      model.run(chatCommands('attachments'), session.attachments.addFiles(files), 'queue'),
    addDraggedPath: (dragged: Parameters<typeof session.attachments.addDraggedPath>[0]) =>
      model.run(chatCommands('attachments'), session.attachments.addDraggedPath(dragged), 'queue'),
    speak: (text: string) =>
      model.run(
        chatCommands('speak'),
        session.voice.speak(text).pipe(Effect.catch(reportError)),
        'replace',
      ),
    control: (command: string) =>
      model.run(
        chatCommands('submit'),
        session.composer.control(command).pipe(Effect.catch(reportError)),
        'queue',
      ),
    branch: (count?: number) =>
      model.run(
        chatCommands('branch'),
        session.lifecycle.branch(undefined, count).pipe(
          Effect.tap((branch) =>
            Effect.sync(() => {
              if (branch) props.onBranchCreated?.(branch.sessionId, branch.title)
            }),
          ),
          Effect.catch(reportError),
        ),
        'drop',
      ),
    rewind: (id: string, text: string) =>
      model.run(
        chatCommands('submit'),
        session.prompt
          .rewind(id, text)
          .pipe(Effect.tap(() => Effect.sync(() => ui.dialogs.close('edit')))),
        'queue',
      ),
    rename: (title: string) =>
      model.run(
        chatCommands('lifecycle'),
        session.lifecycle.rename(title).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              props.onTitleChanged?.(title)
              ui.dialogs.close('rename')
            }),
          ),
          Effect.catch(reportError),
        ),
        'queue',
      ),
    elements,
    session,
    openFind,
    closeFind,
    claimCurrentEditor: () => model.run(chatCommands('editor'), claimCurrentEditor(), 'drop'),
    setDecisionAnswer,
    jumpToFindMatch,
    submit,
    pauseTranscriptFollow,
    attach: () => attachmentInput.element()?.click(),
    toggleVoice: voiceRecorder.toggle,
    jumpLatest: () => {
      followLatest = true
      ui.transcript.markAtBottom(true)
      scrollTranscriptToBottom()
    },
    loadOlder: () => {
      const before = transcriptEl.element()?.scrollHeight ?? 0
      void model.run(
        chatCommands('older'),
        session.history.loadOlder().pipe(
          Effect.andThen(
            Effect.callback<void>((resume) => queueMicrotask(() => resume(Effect.void))),
          ),
          Effect.tap(() =>
            Effect.sync(() => {
              const transcript = transcriptEl.element()
              if (transcript) transcript.scrollTop += transcript.scrollHeight - before
            }),
          ),
        ),
        'drop',
      )
    },
    wheel: (event: WheelEvent) => {
      const transcript = transcriptEl.element()
      if (event.deltaY < 0) pauseTranscriptFollow()
      else if (
        transcript &&
        transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 1
      ) {
        awaitingScrollAway = false
        followLatest = true
      }
    },
    scroll: () => {
      const transcript = transcriptEl.element()
      if (!transcript) return
      const bottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <= 1
      ui.transcript.markAtBottom(bottom)
      if (!bottom) awaitingScrollAway = false
      if (bottom && !awaitingScrollAway) followLatest = true
    },
  }
  const model = modelOwner({
    props,
    state: state(),
    key: key(),
    ui: ui.snapshot(ui.read()),
    recording: voiceRecorder.recording(),
    denied: voiceRecorder.denied(),
    mediaRecorderAvailable: typeof MediaRecorder !== 'undefined',
    microphoneAvailable: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    decisionDraft: { key: '', answer: '' },
    actions,
  })
  let editorKey = ''
  let releaseEditor: (() => void) | undefined
  let lastSessionId: string | undefined
  let lastTitle: string | undefined
  const publish = () => {
    if (disposed) return
    model.patch({ state: state(), key: key() })
    const nextEditor = `${key()}\0${owner()}`
    if (editorKey !== nextEditor) {
      releaseEditor?.()
      editorKey = nextEditor
      const claimKey = key(),
        claimOwner = owner()
      let alive = true
      const editor = session.editor.acquire(claimKey, claimOwner, {
        isAlive: () => alive && !disposed && key() === claimKey && owner() === claimOwner,
      })
      releaseEditor = () => {
        alive = false
        queueMicrotask(editor.release)
      }
      if (editor.owned()) void model.run(chatCommands('editor'), editor.claim(), 'replace')
    }
    if ((props.contentVisible ?? true) && state()?.unread) session.lifecycle.markRead()
    const id = state()?.sessionId,
      title = state()?.title?.trim()
    if (id && id !== props.target?.sessionId && id !== lastSessionId) {
      lastSessionId = id
      props.onSessionCreated?.(id)
    }
    if (title && title !== props.title && title !== lastTitle) {
      lastTitle = title
      props.onTitleChanged?.(title)
    }
    scrollTranscriptToBottom()
  }
  model.own(session.source.subscribe(publish))
  model.own(ui.source.subscribe(() => model.patch({ ui: ui.snapshot(ui.read()) })))
  model.own(
    voiceRecorder.source.subscribe(() =>
      model.patch({ recording: voiceRecorder.recording(), denied: voiceRecorder.denied() }),
    ),
  )
  publish()
  return {
    source: model.source,
    receive: (next: HermesChatPaneProps) => {
      props = next
      session.receive(props.target ?? {})
      voiceRecorder.update()
      model.patch({ props })
      publish()
    },
    lifetime: {
      dispose: () => {
        disposed = true
        releaseEditor?.()
        voiceRecorder.dispose()
        ui.dispose()
        transcriptObserver.disconnect()
        window.removeEventListener('keydown', handleFind, true)
        window.removeEventListener('pointerdown', handlePointer)
        if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame)
        model.dispose()
      },
    },
  }
}
export const HermesChatPane = controllerView(
  { controller: createChatPane },
  view((model) => {
    const { props, ui, actions } = model
    const {
      closeFind,
      claimCurrentEditor,
      setDecisionAnswer,
      jumpToFindMatch,
      submit,
      pauseTranscriptFollow,
    } = actions
    const session = actions.session
    const state = model.state
    const key = model.key
    const owner = () => props.ownerId ?? key
    const ownsEditor = () => !state?.editorOwner || state?.editorOwner === owner()
    const recording = model.recording
    const voiceRecorder = { toggle: actions.toggleVoice }
    const decisionAnswer = () => {
      const decision = state?.decision
      const key = decision ? `${model.key}:${decision.kind}:${decision.dedupeId}` : ''
      return model.decisionDraft.key === key ? model.decisionDraft.answer : ''
    }
    const findMatches = () => {
      const query = ui.search.query().trim().toLowerCase()
      if (!query) return []
      return (state?.messages ?? []).filter((message) =>
        `${message.text}\n${message.reasoning ?? ''}\n${message.toolName ?? ''}`
          .toLowerCase()
          .includes(query),
      )
    }
    const lastAssistantId = () =>
      [...(state?.messages ?? [])].reverse().find((message) => message.role === 'assistant')?.id
    const completedToolCallIds = () =>
      new Set(
        (state?.messages ?? [])
          .filter((message) => message.role === 'tool' && message.toolCallId)
          .map((message) => message.toolCallId!),
      )
    const activeModelOption = () =>
      state?.modelOptions.find((option) => option.value.endsWith(`/${state?.model}`))
    const voiceGates = () =>
      voiceControlGates({
        transcription: state?.voice.transcription ?? false,
        playback: state?.voice.playback ?? false,
        mediaRecorder: model.mediaRecorderAvailable,
        microphoneApi: model.microphoneAvailable,
        permissionDenied: model.denied,
      })
    return (
      <div
        use={actions.elements.paneEl.mount}
        class='relative flex h-full min-h-0 flex-col bg-background text-[13px] text-foreground'
        data-testid='hermes-chat-pane'
      >
        {ui.search.open() ? (
          <div
            class='absolute top-1 right-9 z-40 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-md'
            data-modal-escape-scope
          >
            <input
              use={actions.elements.findInputEl.mount}
              autofocus
              class='h-7 w-44 rounded border border-input bg-background px-2 text-xs'
              placeholder='Find in chat'
              value={ui.search.query()}
              onInput={(event) => {
                ui.search.changeQuery(event.currentTarget.value)
                queueMicrotask(() => (() => jumpToFindMatch(0))())
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter')
                  jumpToFindMatch(ui.search.index() + (event.shiftKey ? -1 : 1))
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  closeFind()
                }
              }}
            />
            <span class='min-w-10 text-center text-[10px] text-muted-foreground'>
              {findMatches().length ? `${ui.search.index() + 1}/${findMatches().length}` : '0/0'}
            </span>
            <button class='rounded p-1 hover:bg-muted' aria-label='Close find' onClick={closeFind}>
              <X class='h-3.5 w-3.5' />
            </button>
          </div>
        ) : null}
        {state?.status !== 'idle' || state?.archived || state?.unavailable ? (
          <div class='flex min-h-7 items-center gap-2 border-b border-border px-3 py-1 pr-9 text-[11px] text-muted-foreground'>
            {state?.status !== 'idle' ? <span>{state?.status ?? 'loading'}</span> : null}
            {state?.archived ? <span>Archived</span> : null}
            {state?.unavailable ? <span>Session unavailable</span> : null}
            {state?.archived ? (
              <button class='ml-auto hover:text-foreground' onClick={() => actions.restore()}>
                Restore
              </button>
            ) : null}
          </div>
        ) : null}
        <div
          use={actions.elements.transcriptEl.mount}
          data-testid='hermes-transcript'
          class='min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 pr-4 select-text [overflow-anchor:none]'
          onWheel={actions.wheel}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) pauseTranscriptFollow()
          }}
          onTouchStart={pauseTranscriptFollow}
          onScroll={actions.scroll}
        >
          <div use={actions.elements.transcriptContentEl.mount} class='space-y-2'>
            {state?.status === 'loading' ? <div>Loading transcript…</div> : null}
            {state?.hasOlderMessages ? (
              <div class='text-center'>
                <button
                  class='rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground'
                  disabled={state?.historyLoading}
                  onClick={actions.loadOlder}
                >
                  {state?.historyLoading ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            ) : null}
            {list(
              state?.messages ?? [],
              (message) => message.id,
              (message) => (
                <div
                  id={`hermes-msg-${message.id}`}
                  class={
                    findMatches()[ui.search.index()]?.id === message.id
                      ? 'rounded-md ring-1 ring-violet-500/60'
                      : ''
                  }
                >
                  <HermesMessageCard
                    message={message}
                    completedToolCallIds={completedToolCallIds()}
                    onOpenImage={ui.dialogs.openImage}
                    onEdit={
                      state?.readOnly || state?.status !== 'idle'
                        ? undefined
                        : (item) => {
                            ui.dialogs.openEdit({ id: item.id, text: item.text })
                          }
                    }
                    onBranch={
                      state?.readOnly
                        ? undefined
                        : (item) => {
                            const count =
                              (state?.messages.findIndex((candidate) => candidate.id === item.id) ??
                                -1) + 1
                            void actions.branch(count)
                          }
                    }
                    onSpeak={
                      voiceGates().playback && message.role === 'assistant'
                        ? (item) => actions.speak(item.text)
                        : undefined
                    }
                    onRetry={
                      message.id === lastAssistantId() &&
                      state?.status === 'idle' &&
                      !state?.readOnly
                        ? () => actions.retry()
                        : undefined
                    }
                  />
                </div>
              ),
            )}
            {state?.awaitingResponse && !state?.streamMessageId ? (
              <div
                class='flex min-h-7 items-center gap-1.5 pl-5 text-xs text-muted-foreground'
                data-testid='hermes-awaiting-response'
              >
                <LoaderCircle class='h-3.5 w-3.5 animate-spin text-violet-500' />
                <span>Working…</span>
              </div>
            ) : null}
          </div>
        </div>
        {!ui.transcript.atBottom() ? (
          <button
            class='absolute bottom-12 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border bg-popover p-1.5 text-muted-foreground shadow-md hover:text-foreground'
            aria-label='Jump to latest message'
            onClick={actions.jumpLatest}
          >
            <ArrowDown class='h-3.5 w-3.5' />
          </button>
        ) : null}
        {state?.error ? (
          <div class='border-t border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
            {state?.error}
          </div>
        ) : null}
        {state?.connection !== 'connected' ? (
          <div
            class='border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300'
            role='status'
          >
            {state?.connection === 'auth-error'
              ? 'Hermes authentication rejected. Check configured gateway token.'
              : 'Hermes gateway disconnected. Transcript remains available; reconnecting…'}
          </div>
        ) : null}
        {((decision) =>
          decision ? (
            <div class='border-t border-amber-500/30 bg-amber-500/10 p-3 text-sm'>
              <div class='mb-2 whitespace-pre-wrap'>{decision.prompt}</div>
              <div class='flex flex-wrap gap-2'>
                {list(
                  decision.choices,
                  (choice) => choice,
                  (choice) => (
                    <button
                      class='rounded-md border border-amber-500/40 px-3 py-1.5 text-xs'
                      onClick={() => actions.answer(choice)}
                    >
                      {choice}
                    </button>
                  ),
                )}
                {decision.choices.length === 0 ? (
                  <>
                    <input
                      type={
                        decision.kind === 'secret' || decision.kind === 'sudo' ? 'password' : 'text'
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
                        void actions.answer(answer)
                      }}
                    >
                      Answer
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null)(state?.decision)}
        {!state?.readOnly ? (
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
                void actions.addDraggedPath(dragged)
                return
              }
              if (!event.dataTransfer?.files.length) return
              event.preventDefault()
              void actions.addFiles(event.dataTransfer.files)
            }}
            onPaste={(event) => {
              const files = event.clipboardData?.files
              if (!files?.length) return
              void actions.addFiles(files)
            }}
          >
            <input
              use={actions.elements.attachmentInput.mount}
              class='hidden'
              type='file'
              multiple
              onChange={(event) => {
                if (event.currentTarget.files) void actions.addFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
            {state?.attachments.length ? (
              <div class='mb-2 flex flex-wrap gap-2' aria-label='Attachments'>
                {list(
                  state?.attachments ?? [],
                  (attachment) => attachment.id,
                  (attachment) => (
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
                        onClick={() => session.attachments.remove(attachment.id)}
                      >
                        <X class='h-3.5 w-3.5' />
                      </button>
                    </div>
                  ),
                )}
              </div>
            ) : null}
            {state?.queuedPrompts.length ? (
              <details class='mb-1 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground'>
                <summary class='cursor-pointer px-2 py-1'>
                  {state?.queuedPrompts.length} queued prompt
                  {state?.queuedPrompts.length === 1 ? '' : 's'}
                  {state?.queueParked ? ' · parked' : ''}
                </summary>
                <div class='space-y-1 border-t border-border p-1'>
                  {list(
                    (state?.queuedPrompts ?? []).map((prompt, index) => ({ prompt, index })),
                    (row) => row.index,
                    ({ prompt, index }) => (
                      <div class='flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted'>
                        <span class='min-w-0 flex-1 truncate'>{prompt.text}</span>
                        <button
                          title='Move up'
                          disabled={index === 0}
                          onClick={() => session.prompt.moveQueued(index, -1)}
                        >
                          <ArrowUp class='h-3 w-3' />
                        </button>
                        <button
                          title='Move down'
                          disabled={index === (state?.queuedPrompts.length ?? 0) - 1}
                          onClick={() => session.prompt.moveQueued(index, 1)}
                        >
                          <ArrowDown class='h-3 w-3' />
                        </button>
                        <button
                          title='Edit queued prompt'
                          onClick={() => session.prompt.editQueued(index)}
                        >
                          <Pencil class='h-3 w-3' />
                        </button>
                        <button
                          title='Remove queued prompt'
                          onClick={() => session.prompt.removeQueued(index)}
                        >
                          <X class='h-3 w-3' />
                        </button>
                      </div>
                    ),
                  )}
                  {state?.queueParked ? (
                    <button
                      class='rounded border border-input px-2 py-1 text-foreground'
                      onClick={() => session.prompt.resumeQueue()}
                    >
                      Resume queue
                    </button>
                  ) : null}
                </div>
              </details>
            ) : null}
            {state?.completions.length ? (
              <div class='absolute right-2 bottom-full left-2 z-30 mb-1 overflow-hidden rounded-md border border-border bg-popover shadow-md'>
                {list(
                  state?.completions ?? [],
                  (completion) => completion.text,
                  (completion) => (
                    <button
                      class='flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-muted'
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => session.composer.applyCompletion(completion)}
                    >
                      <span class='font-mono text-violet-500'>
                        {completion.display || completion.text}
                      </span>
                      <span class='truncate text-muted-foreground'>{completion.meta}</span>
                    </button>
                  ),
                )}
              </div>
            ) : null}
            <div class='flex items-center gap-1'>
              <button
                class='shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                aria-label='Attach files (16 MiB maximum each)'
                title='Attach files (16 MiB maximum each)'
                disabled={state?.connection !== 'connected'}
                onClick={actions.attach}
              >
                <Paperclip class='h-4 w-4' />
              </button>
              <textarea
                class='scrollbar-none max-h-24 min-h-8 min-w-0 flex-1 resize-none overflow-y-auto rounded-lg border border-input bg-background px-2.5 py-1.5 text-[13px] leading-5 outline-none focus:ring-1 focus:ring-ring'
                rows={1}
                value={state?.composer ?? ''}
                placeholder='Message Hermes…'
                disabled={!ownsEditor() || state?.connection !== 'connected'}
                onFocus={() => claimCurrentEditor()}
                onInput={(event) => {
                  session.composer.setDraft(event.currentTarget.value)
                  ui.promptHistory.resetCursor()
                  event.currentTarget.style.height = 'auto'
                  event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 112)}px`
                }}
                onKeyDown={(event) => {
                  if (
                    (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
                    !state?.completions.length &&
                    !event.shiftKey
                  ) {
                    const atStart = event.currentTarget.selectionStart === 0
                    const atEnd =
                      event.currentTarget.selectionStart === event.currentTarget.value.length
                    if (
                      (event.key === 'ArrowUp' && atStart) ||
                      (event.key === 'ArrowDown' && atEnd)
                    ) {
                      const prompt = ui.promptHistory.navigate(
                        event.key === 'ArrowUp' ? 'older' : 'newer',
                      )
                      if (prompt !== undefined) {
                        event.preventDefault()
                        session.composer.setDraft(prompt)
                        return
                      }
                    }
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submit()
                  }
                }}
              />
              {(state?.sessionId && !state?.archived) || state?.modelOptions.length ? (
                <details class='relative shrink-0' name='hermes-composer-menu'>
                  <summary
                    class='flex cursor-pointer list-none rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                    aria-label='Chat options'
                  >
                    <MoreHorizontal class='h-4 w-4' />
                  </summary>
                  <div class='absolute right-0 bottom-full z-30 mb-1 flex min-w-52 max-w-[min(18rem,calc(100vw-2rem))] flex-col gap-1 rounded-md border border-border bg-popover p-1 text-xs text-foreground shadow-lg'>
                    {state?.status === 'sending' || state?.status === 'streaming' ? (
                      <button
                        class='rounded px-2 py-1 text-left text-destructive hover:bg-muted'
                        onClick={() => actions.stop()}
                      >
                        Stop response
                      </button>
                    ) : null}
                    {state?.sessionId && !state?.archived ? (
                      <>
                        <button
                          class='rounded px-2 py-1 text-left hover:bg-muted'
                          onClick={() => {
                            ui.dialogs.openRename(state?.title ?? '')
                          }}
                        >
                          Rename
                        </button>
                        <button
                          class='rounded px-2 py-1 text-left hover:bg-muted'
                          onClick={() => actions.branch()}
                        >
                          Branch
                        </button>
                        <button
                          class='rounded px-2 py-1 text-left hover:bg-muted'
                          onClick={() => actions.exportSession()}
                        >
                          Export
                        </button>
                        <button
                          class='rounded px-2 py-1 text-left hover:bg-muted disabled:opacity-50'
                          disabled={state?.status !== 'idle' || !!state?.queuedPrompts.length}
                          onClick={() => actions.archive()}
                        >
                          Archive
                        </button>
                      </>
                    ) : null}
                    {state?.modelOptions.length ? (
                      <>
                        <div class='my-0.5 border-t border-border' />
                        <select
                          class='min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs'
                          aria-label='Hermes model'
                          value={
                            state?.provider && state?.model
                              ? `${state?.provider}/${state?.model}`
                              : ''
                          }
                          disabled={state?.status !== 'idle'}
                          onChange={(event) =>
                            actions.control(`/model ${event.currentTarget.value}`)
                          }
                        >
                          <option value='' disabled>
                            Model
                          </option>
                          {list(
                            state?.modelOptions,
                            (option) => option.value,
                            (option) => (
                              <option value={option.value}>{option.label}</option>
                            ),
                          )}
                        </select>
                        {activeModelOption()?.reasoning ? (
                          <select
                            class='min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs'
                            aria-label='Reasoning effort'
                            disabled={state?.status !== 'idle'}
                            onChange={(event) =>
                              actions.control(`/reasoning ${event.currentTarget.value}`)
                            }
                          >
                            <option value=''>Reasoning</option>
                            {list(
                              ['none', 'low', 'medium', 'high', 'xhigh'],
                              (level) => level,
                              (effort) => (
                                <option value={effort}>{effort}</option>
                              ),
                            )}
                          </select>
                        ) : null}
                        {activeModelOption()?.fast ? (
                          <button
                            class='rounded-md border border-border px-2 py-1.5 text-left text-xs'
                            disabled={state?.status !== 'idle'}
                            onClick={() => actions.control('/fast')}
                          >
                            Toggle Fast mode
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </details>
              ) : null}
              {voiceGates().record ? (
                <button
                  class={`shrink-0 rounded-md p-1.5 ${recording ? 'text-red-500' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  aria-label={
                    model.denied
                      ? 'Microphone permission denied'
                      : recording
                        ? 'Stop voice recording'
                        : 'Record voice prompt'
                  }
                  title={
                    model.denied
                      ? 'Microphone permission denied'
                      : recording
                        ? 'Stop recording'
                        : 'Push to talk'
                  }
                  disabled={voiceGates().recordDisabled}
                  onClick={() => voiceRecorder.toggle()}
                >
                  {!recording ? <Mic class='h-4 w-4' /> : <Square class='h-4 w-4' />}
                </button>
              ) : null}
              {!ownsEditor() ? (
                <button
                  class='rounded-md border border-border px-3 py-1.5 text-xs'
                  onClick={() => claimCurrentEditor()}
                >
                  Take editing control
                </button>
              ) : null}
              <button
                class='flex shrink-0 items-center gap-1 rounded-md bg-primary p-1.5 text-xs text-primary-foreground disabled:opacity-50'
                aria-label={
                  state?.status === 'sending' || state?.status === 'streaming'
                    ? 'Queue prompt'
                    : 'Send'
                }
                disabled={!state?.composer.trim() || state?.connection !== 'connected'}
                onClick={() => submit()}
              >
                <SendHorizontal class='h-4 w-4' />
              </button>
            </div>
          </div>
        ) : (
          <div class='flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground'>
            <span>
              {state?.externallyActive
                ? `Active in ${state?.externalSource || 'another Hermes client'} — observer mode`
                : 'Archived session — read only'}
            </span>
            {state?.externallyActive ? (
              <button
                class='ml-auto rounded-md border border-input px-2 py-1 text-foreground hover:bg-muted'
                onClick={() => session.lifecycle.takeOver()}
              >
                Take over
              </button>
            ) : null}
          </div>
        )}
        {((target) =>
          target ? (
            <div
              class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
              role='presentation'
              onClick={() => ui.dialogs.close('edit')}
            >
              <form
                class='w-full max-w-md rounded-lg border border-border bg-card p-3 shadow-xl'
                role='dialog'
                aria-modal='true'
                aria-labelledby='hermes-edit-title'
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  event.stopPropagation()
                  ui.dialogs.close('edit')
                }}
                onSubmit={(event) => {
                  event.preventDefault()
                  const text = ui.dialogs.editValue().trim()
                  if (!text) return
                  void actions.rewind(target.id, text)
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
                  value={ui.dialogs.editValue()}
                  onInput={(event) => ui.dialogs.updateEdit(event.currentTarget.value)}
                />
                <div class='mt-3 flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-8 rounded-md border border-input px-3 text-xs'
                    onClick={() => ui.dialogs.close('edit')}
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    class='h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50'
                    disabled={!ui.dialogs.editValue().trim()}
                  >
                    Rewind
                  </button>
                </div>
              </form>
            </div>
          ) : null)(ui.dialogs.editTarget())}
        {ui.dialogs.renameOpen() ? (
          <div
            class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
            role='presentation'
            onClick={() => ui.dialogs.close('rename')}
          >
            <form
              class='w-full max-w-sm rounded-lg border border-border bg-card p-3 shadow-xl'
              role='dialog'
              aria-modal='true'
              aria-labelledby='hermes-rename-title'
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                ui.dialogs.close('rename')
              }}
              onSubmit={(event) => {
                event.preventDefault()
                const title = ui.dialogs.renameValue().trim()
                if (!title) return
                void actions.rename(title)
              }}
            >
              <h2 id='hermes-rename-title' class='text-sm font-semibold'>
                Rename session
              </h2>
              <input
                autofocus
                class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm'
                value={ui.dialogs.renameValue()}
                onInput={(event) => ui.dialogs.updateRename(event.currentTarget.value)}
              />
              <div class='mt-3 flex justify-end gap-2'>
                <button
                  type='button'
                  class='h-8 rounded-md border border-input px-3 text-xs'
                  onClick={() => ui.dialogs.close('rename')}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  class='h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50'
                  disabled={!ui.dialogs.renameValue().trim()}
                >
                  Rename
                </button>
              </div>
            </form>
          </div>
        ) : null}
        {ui.dialogs.takeoverOpen() ? (
          <div
            class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
            role='presentation'
            onClick={() => ui.dialogs.close('takeover')}
          >
            <div
              class='w-full max-w-xs rounded-lg border border-border bg-card p-3 shadow-xl'
              role='alertdialog'
              aria-modal='true'
              aria-labelledby='hermes-takeover-title'
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                ui.dialogs.close('takeover')
              }}
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
                  onClick={() => ui.dialogs.close('takeover')}
                >
                  Cancel
                </button>
                <button
                  class='h-8 rounded-md bg-primary px-3 text-xs text-primary-foreground'
                  onClick={() => {
                    ui.dialogs.close('takeover')
                    submit(true)
                  }}
                >
                  Take over
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {((src) =>
          src ? (
            <div
              class='absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-3'
              role='dialog'
              aria-modal='true'
              aria-label='Hermes image preview'
              tabindex={0}
              onClick={(event) => event.target === event.currentTarget && ui.dialogs.close('image')}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                ui.dialogs.close('image')
              }}
            >
              <button
                class='absolute top-2 right-2 rounded-md bg-black/50 p-1.5 text-white/80 hover:bg-black/70 hover:text-white'
                aria-label='Close image preview'
                onClick={() => ui.dialogs.close('image')}
              >
                <X class='h-4 w-4' />
              </button>
              <img
                src={src}
                alt='Hermes image preview'
                class='max-h-full max-w-full object-contain'
              />
            </div>
          ) : null)(ui.dialogs.previewImage())}
      </div>
    )
  }),
)
