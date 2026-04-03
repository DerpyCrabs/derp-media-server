import { createSignal, Show } from 'solid-js'
import { useQuery } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/query-keys'
import { api } from '@/lib/api'
import { KbChatPane } from './KbChatPane'
import { KbChatHistoryList } from './KbChatHistoryList'
import MessageSquareText from 'lucide-solid/icons/message-square-text'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronUp from 'lucide-solid/icons/chevron-up'
import History from 'lucide-solid/icons/history'
import ExternalLink from 'lucide-solid/icons/external-link'

export function KbChatFooter(props: {
  kbRoot: string
  noWindowDrag?: boolean
  onOpenInWindow?: (chatId: string | null) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const [chatId, setChatId] = createSignal<string | null>(null)
  const [showHistory, setShowHistory] = createSignal(false)

  const statusQuery = useQuery(() => ({
    queryKey: queryKeys.kbChatStatus(),
    queryFn: () => api<{ enabled: boolean }>('/api/kb/chat/status'),
    staleTime: 60_000,
  }))

  const aiEnabled = () => statusQuery.data?.enabled === true

  const dragProps = () =>
    props.noWindowDrag ? ({ 'data-no-window-drag': true } as const) : ({} as const)

  return (
    <Show when={aiEnabled()}>
      <div
        class='border-border bg-card shrink-0 border-t'
        {...dragProps()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type='button'
          class='text-muted-foreground hover:text-foreground flex h-8 w-full items-center gap-2 px-3 text-xs transition-colors'
          onClick={() => setExpanded((v) => !v)}
        >
          <MessageSquareText class='h-3.5 w-3.5' stroke-width={2} />
          <span class='flex-1 text-left'>AI Chat</span>
          <Show when={props.onOpenInWindow}>
            <span
              role='button'
              tabIndex={0}
              class='hover:text-foreground rounded p-0.5 transition-colors'
              onClick={(e) => {
                e.stopPropagation()
                props.onOpenInWindow?.(chatId())
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  props.onOpenInWindow?.(chatId())
                }
              }}
              title='Open in window'
            >
              <ExternalLink class='h-3 w-3' stroke-width={2} />
            </span>
          </Show>
          <Show when={expanded()}>
            <span
              role='button'
              tabIndex={0}
              class={`hover:text-foreground rounded p-0.5 transition-colors ${showHistory() ? 'text-foreground' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setShowHistory((v) => !v)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation()
                  setShowHistory((v) => !v)
                }
              }}
              title='Chat history'
            >
              <History class='h-3 w-3' stroke-width={2} />
            </span>
          </Show>
          {expanded() ? (
            <ChevronDown class='h-3.5 w-3.5' stroke-width={2} />
          ) : (
            <ChevronUp class='h-3.5 w-3.5' stroke-width={2} />
          )}
        </button>

        <Show when={expanded()}>
          <div class='flex h-[350px] max-h-[50vh] min-h-[200px]'>
            <Show when={showHistory()}>
              <div class='border-border w-48 shrink-0 overflow-y-auto border-r p-1.5'>
                <KbChatHistoryList
                  kbRoot={props.kbRoot}
                  activeChatId={chatId()}
                  onSelectChat={(id) => {
                    setChatId(id)
                    setShowHistory(false)
                  }}
                  onNewChat={() => {
                    setChatId(null)
                    setShowHistory(false)
                  }}
                />
              </div>
            </Show>
            <div class='min-w-0 flex-1'>
              <KbChatPane
                kbRoot={props.kbRoot}
                chatId={chatId()}
                onChatIdChange={(id) => setChatId(id)}
              />
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
