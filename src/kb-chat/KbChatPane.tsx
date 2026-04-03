import { createSignal, For, Show, onCleanup, createEffect } from 'solid-js'
import { useQuery, useQueryClient } from '@tanstack/solid-query'
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
  const [activeChatId, setActiveChatId] = createSignal<string | null>(props.chatId ?? null)
  const [error, setError] = createSignal<string | null>(null)
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
  }

  async function sendMessages(allMessages: ChatMsg[]) {
    setError(null)
    lastFailedMessages = null
    setStreaming(true)
    setStreamingText('')
    scrollToBottom()

    abortController = new AbortController()
    let answerFirstTokenAt: number | null = null
    try {
      const res = await fetch('/api/kb/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: activeChatId(),
          kbRoot: props.kbRoot,
          messages: allMessages,
        }),
        signal: abortController.signal,
      })

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error || 'Request failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''
      let chatId = activeChatId()
      let sawDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const json = line.slice(6)
          try {
            const event = JSON.parse(json) as
              | { type: 'text'; text: string }
              | { type: 'done'; chatId: string }
              | { type: 'error'; error: string }
            if (event.type === 'text') {
              if (answerFirstTokenAt === null) answerFirstTokenAt = performance.now()
              fullText += event.text
              setStreamingText(fullText)
              scrollToBottom()
            } else if (event.type === 'done') {
              sawDone = true
              chatId = event.chatId
            } else if (event.type === 'error') {
              throw new Error(event.error)
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== json) throw parseErr
          }
        }
      }

      if (!sawDone) {
        throw new Error('Connection closed before the reply finished')
      }
      if (!fullText.trim()) {
        throw new Error('Model returned an empty response')
      }

      const answerDurationSec =
        answerFirstTokenAt != null ? (performance.now() - answerFirstTokenAt) / 1000 : undefined
      const assistantMsg: ChatMsg = {
        role: 'assistant',
        content: fullText,
        ...(answerDurationSec != null ? { answerDurationSec } : {}),
      }
      setMessages([...allMessages, assistantMsg])
      setStreamingText('')

      if (chatId && chatId !== activeChatId()) {
        setActiveChatId(chatId)
        props.onChatIdChange?.(chatId)
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.kbChatHistory(props.kbRoot) })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        const partialText = streamingText()
        if (partialText) {
          const answerDurationSec =
            answerFirstTokenAt != null ? (performance.now() - answerFirstTokenAt) / 1000 : undefined
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
    } finally {
      setStreaming(false)
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

  return (
    <div class='kb-chat-selectable flex h-full flex-col select-text'>
      <div class='min-h-0 flex-1 overflow-y-auto'>
        <Show
          when={messages().length > 0 || streaming() || error()}
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
            <Show when={streaming() && streamingText()}>
              <KbChatMessage
                role='assistant'
                content={streamingText()}
                kbRoot={props.kbRoot}
                onMediaLinkClick={props.onOpenMedia}
              />
            </Show>
            <Show when={streaming() && !streamingText()}>
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
            disabled={streaming()}
          />
          <Show
            when={!streaming()}
            fallback={
              <button
                type='button'
                class='text-muted-foreground hover:text-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors'
                onClick={stopStreaming}
                title='Stop generating'
              >
                <Square class='h-3.5 w-3.5' stroke-width={2} />
              </button>
            }
          >
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
