import { createSignal, For, Show, onCleanup, createEffect } from 'solid-js'
import { useQuery, useQueryClient } from '@tanstack/solid-query'
import type { ModelMessage } from 'ai'
import { queryKeys } from '@/lib/query-keys'
import { api } from '@/lib/api'
import { KbChatMessage } from './KbChatMessage'
import SendHorizontal from 'lucide-solid/icons/send-horizontal'
import Loader2 from 'lucide-solid/icons/loader-2'
import Square from 'lucide-solid/icons/square'
import RotateCcw from 'lucide-solid/icons/rotate-ccw'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import type { KbChatMessage as ChatMsg } from '@/lib/kb-chats'

function chatThreadContentMatches(prev: ChatMsg[], server: ChatMsg[]): boolean {
  if (prev.length !== server.length || server.length === 0) return false
  for (let i = 0; i < server.length; i++) {
    const pm = prev[i]
    const sm = server[i]
    if (!pm || pm.role !== sm.role || pm.content !== sm.content) return false
  }
  return true
}

function mergePreservedAnswerTiming(prev: ChatMsg[], server: ChatMsg[]): ChatMsg[] {
  return server.map((sm, i) => {
    const pm = prev[i]
    if (
      sm.role === 'assistant' &&
      pm?.role === 'assistant' &&
      pm.content === sm.content &&
      typeof pm.answerDurationSec === 'number'
    ) {
      return { ...sm, answerDurationSec: pm.answerDurationSec }
    }
    return sm
  })
}

type InProgressTool = { toolCallId: string; toolName: string }

type ApprovalMeta = {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
  lines?: string[]
}

type KbSseResult =
  | { outcome: 'done'; chatId: string; assistantText: string }
  | {
      outcome: 'approval'
      threadSnapshot: ModelMessage[]
      approvals: ApprovalMeta[]
      streamedAssistant: string
    }

type SseEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; chatId: string; assistantText?: string }
  | { type: 'error'; error: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown; lines?: string[] }
  | {
      type: 'tool-approval-request'
      approvalId: string
      toolCallId: string
      toolName: string
      lines?: string[]
    }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'tool-error'; toolCallId: string; toolName: string; error: string }
  | { type: 'approval-required'; approvals: ApprovalMeta[]; threadSnapshot: ModelMessage[] }

async function consumeKbChatSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abortSignal: AbortSignal,
  onEvent: (e: SseEvent) => void,
): Promise<KbSseResult> {
  const decoder = new TextDecoder()
  let buffer = ''
  let streamedAssistant = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6)
      let event: SseEvent
      try {
        event = JSON.parse(json) as SseEvent
      } catch {
        continue
      }
      onEvent(event)

      if (event.type === 'text') {
        streamedAssistant += event.text
      } else if (event.type === 'done') {
        return {
          outcome: 'done',
          chatId: event.chatId,
          assistantText: event.assistantText ?? streamedAssistant,
        }
      } else if (event.type === 'approval-required') {
        return {
          outcome: 'approval',
          threadSnapshot: event.threadSnapshot,
          approvals: event.approvals,
          streamedAssistant,
        }
      } else if (event.type === 'error') {
        throw new Error(event.error)
      }
    }
  }

  if (abortSignal.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  throw new Error('Connection closed before the reply finished')
}

type ApprovalDialogState = {
  approvals: ApprovalMeta[]
}

export function KbChatPane(props: {
  kbRoot: string
  chatId?: string | null
  onChatIdChange?: (id: string | null) => void
  onOpenMedia?: (path: string, isDirectory: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [messages, setMessages] = createSignal<ChatMsg[]>([])
  const [input, setInput] = createSignal('')
  const [streaming, setStreaming] = createSignal(false)
  const [streamingText, setStreamingText] = createSignal('')
  const [toolsInProgress, setToolsInProgress] = createSignal<InProgressTool[]>([])
  const [activeChatId, setActiveChatId] = createSignal<string | null>(props.chatId ?? null)
  const [error, setError] = createSignal<string | null>(null)
  const [approvalDialog, setApprovalDialog] = createSignal<ApprovalDialogState | null>(null)

  let dialogDecision: ((approved: boolean) => void) | null = null
  let lastFailedMessages: ChatMsg[] | null = null
  let messagesEndEl: HTMLDivElement | undefined
  let textareaEl: HTMLTextAreaElement | undefined
  let abortController: AbortController | null = null

  const chatDetailQuery = useQuery(() => ({
    queryKey: queryKeys.kbChatDetail(activeChatId()!),
    queryFn: () => api<{ id: string; messages: ChatMsg[] }>(`/api/kb/chat/${activeChatId()}`),
    enabled: !!activeChatId(),
    staleTime: 30_000,
  }))

  createEffect(() => {
    const data = chatDetailQuery.data
    const id = activeChatId()
    if (!data || data.id !== id) return
    setMessages((prev) =>
      chatThreadContentMatches(prev, data.messages)
        ? mergePreservedAnswerTiming(prev, data.messages)
        : data.messages,
    )
  })

  createEffect(() => {
    const id = props.chatId ?? null
    setActiveChatId(id)
    if (!id) setMessages([])
  })

  function scrollToBottom() {
    requestAnimationFrame(() => messagesEndEl?.scrollIntoView({ behavior: 'smooth' }))
  }

  function stopStreaming() {
    abortController?.abort()
    abortController = null
    setStreaming(false)
    dialogDecision = null
    setApprovalDialog(null)
  }

  function addToolInProgress(toolCallId: string, toolName: string) {
    setToolsInProgress((prev) => {
      if (prev.some((t) => t.toolCallId === toolCallId)) return prev
      return [...prev, { toolCallId, toolName }]
    })
  }

  function removeToolInProgress(toolCallId: string) {
    setToolsInProgress((prev) => prev.filter((t) => t.toolCallId !== toolCallId))
  }

  /**
   * Only non-approval tools stay visible here (spinner). Approval tools move to the inline approval card;
   * we drop them from this list on `tool-approval-request`. Duplicate stream parts share one `toolCallId`.
   */
  function handleSseEvent(e: SseEvent, seenToolInvocationIds: Set<string>) {
    if (e.type === 'tool-call') {
      if (seenToolInvocationIds.has(e.toolCallId)) return
      seenToolInvocationIds.add(e.toolCallId)
      addToolInProgress(e.toolCallId, e.toolName)
    } else if (e.type === 'tool-approval-request') {
      seenToolInvocationIds.add(e.toolCallId)
      removeToolInProgress(e.toolCallId)
    } else if (e.type === 'tool-result' || e.type === 'tool-error') {
      removeToolInProgress(e.toolCallId)
    }
  }

  function waitForDialogChoice(): Promise<boolean> {
    return new Promise((resolve) => {
      dialogDecision = resolve
    })
  }

  function resolveApproval(approved: boolean) {
    const r = dialogDecision
    dialogDecision = null
    setApprovalDialog(null)
    r?.(approved)
  }

  async function sendMessages(allMessages: ChatMsg[]) {
    setError(null)
    lastFailedMessages = null
    setStreaming(true)
    setStreamingText('')
    setToolsInProgress([])
    scrollToBottom()

    abortController = new AbortController()
    const answerFirstTokenAt = { value: null as number | null }
    let fullAssistantDraft = ''
    let persistPrefix = ''
    let url = '/api/kb/chat'
    let reqBody: Record<string, unknown> = {
      chatId: activeChatId(),
      kbRoot: props.kbRoot,
      messages: allMessages,
    }

    try {
      while (true) {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
          signal: abortController.signal,
        })

        if (!res.ok || !res.body) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error((errBody as { error?: string }).error || 'Request failed')
        }

        setToolsInProgress([])

        const seenToolInvocationIds = new Set<string>()
        const result = await consumeKbChatSse(
          res.body.getReader(),
          abortController.signal,
          (ev) => {
            handleSseEvent(ev, seenToolInvocationIds)
            if (ev.type === 'text') {
              if (answerFirstTokenAt.value === null) answerFirstTokenAt.value = performance.now()
              fullAssistantDraft += ev.text
              setStreamingText(fullAssistantDraft)
              scrollToBottom()
            }
          },
        )

        if (result.outcome === 'approval') {
          setStreamingText(result.streamedAssistant)
          fullAssistantDraft = result.streamedAssistant
          setApprovalDialog({ approvals: result.approvals })
          setStreaming(false)
          scrollToBottom()
          const approved = await waitForDialogChoice()
          setStreaming(true)
          setToolsInProgress([])
          setStreamingText(fullAssistantDraft)

          url = '/api/kb/chat/continue'
          reqBody = {
            kbRoot: props.kbRoot,
            chatId: activeChatId() ?? undefined,
            modelMessages: result.threadSnapshot,
            approvals: result.approvals.map((a) => ({
              approvalId: a.approvalId,
              approved,
              ...(approved ? {} : { reason: 'User denied in knowledge base chat' }),
            })),
            kbMessagesForSave: allMessages,
            assistantPrefix: persistPrefix + result.streamedAssistant,
          }
          persistPrefix += result.streamedAssistant
          continue
        }

        const content = result.assistantText.trim()
        if (!content) {
          throw new Error('Model returned an empty response')
        }

        const answerDurationSec =
          answerFirstTokenAt.value != null
            ? (performance.now() - answerFirstTokenAt.value) / 1000
            : undefined
        const assistantMsg: ChatMsg = {
          role: 'assistant',
          content: result.assistantText,
          ...(answerDurationSec != null ? { answerDurationSec } : {}),
        }
        setMessages([...allMessages, assistantMsg])
        setStreamingText('')
        setToolsInProgress([])

        const cid = result.chatId
        if (cid && cid !== activeChatId()) {
          setActiveChatId(cid)
          props.onChatIdChange?.(cid)
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.kbChatHistory(props.kbRoot) })
        break
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partialText = streamingText()
        if (partialText) {
          const answerDurationSec =
            answerFirstTokenAt.value != null
              ? (performance.now() - answerFirstTokenAt.value) / 1000
              : undefined
          setMessages([
            ...allMessages,
            {
              role: 'assistant',
              content: partialText,
              ...(answerDurationSec != null ? { answerDurationSec } : {}),
            },
          ])
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        lastFailedMessages = allMessages
        setError(errorMsg)
      }
      setStreamingText('')
      setToolsInProgress([])
    } finally {
      setStreaming(false)
      setApprovalDialog(null)
      dialogDecision = null
      abortController = null
      scrollToBottom()
    }
  }

  async function sendMessage() {
    const text = input().trim()
    if (!text || streaming()) return

    const userMsg: ChatMsg = { role: 'user', content: text }
    const allMessages = [...messages(), userMsg]
    setMessages(allMessages)
    setInput('')
    if (textareaEl) textareaEl.style.height = 'auto'
    await sendMessages(allMessages)
  }

  function retry() {
    if (!lastFailedMessages || streaming()) return
    const msgs = lastFailedMessages
    setError(null)
    sendMessages(msgs)
  }

  onCleanup(() => abortController?.abort())

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const showThinking = () =>
    streaming() && streamingText().length === 0 && toolsInProgress().length === 0

  const showInlineAssistantWork = () =>
    (streaming() && (streamingText().length > 0 || toolsInProgress().length > 0)) ||
    (!!approvalDialog() && !streaming())

  return (
    <div class='kb-chat-selectable flex h-full flex-col select-text'>
      <div class='min-h-0 flex-1 overflow-y-auto'>
        <Show
          when={messages().length > 0 || streaming() || error() || !!approvalDialog()}
          fallback={
            <div class='flex h-full items-center justify-center p-4'>
              <p class='text-muted-foreground text-center text-xs'>
                Ask a question about this knowledge base
              </p>
            </div>
          }
        >
          <div class='flex flex-col gap-0.5 py-2'>
            <For each={messages()}>
              {(msg) => (
                <KbChatMessage
                  role={msg.role}
                  content={msg.content}
                  answerDurationSec={msg.answerDurationSec}
                  kbRoot={props.kbRoot}
                  onMediaLinkClick={props.onOpenMedia}
                />
              )}
            </For>
            <Show when={showInlineAssistantWork()}>
              <div class='flex flex-col gap-1 px-3 py-2'>
                <Show when={toolsInProgress().length > 0}>
                  <div class='border-border bg-muted/40 text-muted-foreground rounded-md border px-2 py-1.5 text-xs'>
                    <For each={toolsInProgress()}>
                      {(t) => (
                        <div class='flex items-center gap-2 py-0.5'>
                          <Loader2
                            class='h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground'
                            stroke-width={2}
                          />
                          <span class='font-mono text-[11px]'>{t.toolName}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <Show when={streamingText().length > 0}>
                  <KbChatMessage
                    role='assistant'
                    content={streamingText()}
                    kbRoot={props.kbRoot}
                    onMediaLinkClick={props.onOpenMedia}
                  />
                </Show>
                <Show when={approvalDialog()}>
                  {(dlg) => (
                    <div class='border-border bg-card mt-1 rounded-lg border p-3 shadow-sm'>
                      <p class='text-foreground mb-1 text-xs font-semibold'>
                        Confirm filesystem changes
                      </p>
                      <p class='text-muted-foreground mb-2 text-xs'>
                        The assistant wants to modify this knowledge base. Review the actions below.
                      </p>
                      <ul class='text-foreground mb-3 max-h-40 space-y-2 overflow-y-auto text-xs'>
                        <For each={dlg().approvals}>
                          {(a) => (
                            <li class='border-border rounded-md border bg-muted/20 p-2'>
                              <div class='font-mono text-[11px] text-muted-foreground'>
                                {a.toolName}
                              </div>
                              <Show when={a.lines && a.lines.length > 0}>
                                <ul class='mt-1 list-inside list-disc'>
                                  <For each={a.lines!}>
                                    {(line) => <li class='break-words'>{line}</li>}
                                  </For>
                                </ul>
                              </Show>
                            </li>
                          )}
                        </For>
                      </ul>
                      <div class='flex flex-wrap justify-end gap-2'>
                        <button
                          type='button'
                          class='border-border text-foreground hover:bg-muted rounded-md border px-3 py-1.5 text-xs font-medium'
                          onClick={() => resolveApproval(false)}
                        >
                          Deny
                        </button>
                        <button
                          type='button'
                          class='bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-xs font-medium'
                          onClick={() => resolveApproval(true)}
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  )}
                </Show>
              </div>
            </Show>
            <Show when={showThinking()}>
              <div class='flex gap-2.5 px-3 py-2'>
                <div class='bg-muted flex h-6 w-6 shrink-0 items-center justify-center rounded-full'>
                  <Loader2
                    class='h-3.5 w-3.5 animate-spin text-muted-foreground'
                    stroke-width={2}
                  />
                </div>
                <div class='bg-muted/50 rounded-lg px-3 py-2 text-sm text-muted-foreground'>
                  Thinking...
                </div>
              </div>
            </Show>
            <Show when={error()}>
              <div class='mx-3 my-1.5 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm'>
                <AlertCircle class='text-destructive mt-0.5 h-4 w-4 shrink-0' stroke-width={2} />
                <div class='min-w-0 flex-1'>
                  <p class='text-destructive text-xs font-medium'>Failed to get response</p>
                  <p class='text-destructive/80 mt-0.5 text-xs break-words'>{error()}</p>
                </div>
                <button
                  type='button'
                  class='text-destructive hover:bg-destructive/20 flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors'
                  onClick={retry}
                >
                  <RotateCcw class='h-3 w-3' stroke-width={2} />
                  Retry
                </button>
              </div>
            </Show>
            <div
              ref={(el) => {
                messagesEndEl = el
              }}
            />
          </div>
        </Show>
      </div>

      <div class='border-border shrink-0 border-t p-2'>
        <div class='bg-muted/50 border-border flex items-end gap-1.5 rounded-lg border px-2 py-1.5'>
          <textarea
            ref={(el) => {
              textareaEl = el
            }}
            class='min-h-[28px] max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground'
            placeholder='Ask about this knowledge base...'
            rows={1}
            value={input()}
            onInput={(e) => {
              setInput(e.currentTarget.value)
              autoResize(e.currentTarget)
            }}
            onKeyDown={handleKeyDown}
            disabled={streaming() || !!approvalDialog()}
          />
          <Show when={streaming()}>
            <button
              type='button'
              class='text-muted-foreground hover:text-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors'
              onClick={stopStreaming}
              title='Stop generating'
            >
              <Square class='h-3.5 w-3.5' stroke-width={2} />
            </button>
          </Show>
          <Show when={!streaming() && !approvalDialog()}>
            <button
              type='button'
              class='text-muted-foreground hover:text-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors disabled:opacity-50'
              onClick={sendMessage}
              disabled={!input().trim()}
              title='Send message'
            >
              <SendHorizontal class='h-3.5 w-3.5' stroke-width={2} />
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}
