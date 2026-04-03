import { For, Show } from 'solid-js'
import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/query-keys'
import { api } from '@/lib/api'
import MessageSquare from 'lucide-solid/icons/message-square'
import Trash2 from 'lucide-solid/icons/trash-2'

interface ChatSummary {
  id: string
  kbRoot: string
  title: string
  createdAt: number
  updatedAt: number
}

export function KbChatHistoryList(props: {
  kbRoot: string
  activeChatId: string | null
  onSelectChat: (chatId: string) => void
  onNewChat: () => void
}) {
  const queryClient = useQueryClient()

  const historyQuery = useQuery(() => ({
    queryKey: queryKeys.kbChatHistory(props.kbRoot),
    queryFn: () =>
      api<{ chats: ChatSummary[] }>(
        `/api/kb/chat/history?kbRoot=${encodeURIComponent(props.kbRoot)}`,
      ),
    staleTime: 10_000,
  }))

  const chats = () => historyQuery.data?.chats ?? []

  async function handleDelete(e: MouseEvent, chatId: string) {
    e.stopPropagation()
    await fetch(`/api/kb/chat/${chatId}`, { method: 'DELETE' })
    queryClient.invalidateQueries({ queryKey: queryKeys.kbChatHistory(props.kbRoot) })
  }

  return (
    <div class='flex flex-col gap-1'>
      <button
        type='button'
        class='text-muted-foreground hover:text-foreground hover:bg-muted flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors'
        onClick={() => props.onNewChat()}
      >
        <MessageSquare class='h-3.5 w-3.5' stroke-width={2} />
        New chat
      </button>
      <Show when={chats().length > 0}>
        <div class='border-border border-t pt-1'>
          <For each={chats()}>
            {(chat) => (
              <button
                type='button'
                class={`group flex h-7 w-full items-center gap-1.5 rounded px-2 text-xs transition-colors ${
                  props.activeChatId === chat.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                onClick={() => props.onSelectChat(chat.id)}
              >
                <span class='min-w-0 flex-1 truncate text-left'>{chat.title}</span>
                <span
                  role='button'
                  tabIndex={0}
                  class='hidden shrink-0 group-hover:block'
                  onClick={(e) => handleDelete(e, chat.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleDelete(e as unknown as MouseEvent, chat.id)
                  }}
                >
                  <Trash2
                    class='text-muted-foreground hover:text-destructive h-3 w-3'
                    stroke-width={2}
                  />
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
