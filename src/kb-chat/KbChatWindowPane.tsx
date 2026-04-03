import { createMemo, createSignal, Show } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { KbChatPane } from './KbChatPane'
import { KbChatHistoryList } from './KbChatHistoryList'
import PanelLeftOpen from 'lucide-solid/icons/panel-left-open'
import PanelLeftClose from 'lucide-solid/icons/panel-left-close'

export function KbChatWindowPane(props: {
  windowId: string
  workspace: Accessor<PersistedWorkspaceState | null>
}) {
  const windowDef = createMemo(() =>
    props.workspace()?.windows.find((w) => w.id === props.windowId),
  )

  const kbRoot = createMemo(() => {
    const state = windowDef()?.initialState
    return (state as { kbRoot?: string })?.kbRoot ?? ''
  })

  const initialChatId = createMemo(() => {
    const state = windowDef()?.initialState
    return (state as { chatId?: string })?.chatId ?? null
  })

  const [chatId, setChatId] = createSignal<string | null>(initialChatId())
  const [showSidebar, setShowSidebar] = createSignal(true)

  return (
    <div class='flex h-full' data-no-window-drag>
      <Show when={showSidebar()}>
        <div class='border-border flex w-52 shrink-0 flex-col border-r'>
          <div class='border-border flex h-9 items-center justify-between border-b px-2'>
            <span class='text-xs font-medium'>Chat History</span>
            <button
              type='button'
              class='text-muted-foreground hover:text-foreground rounded p-1 transition-colors'
              onClick={() => setShowSidebar(false)}
              title='Close sidebar'
            >
              <PanelLeftClose class='h-3.5 w-3.5' stroke-width={2} />
            </button>
          </div>
          <div class='min-h-0 flex-1 overflow-y-auto p-1.5'>
            <KbChatHistoryList
              kbRoot={kbRoot()}
              activeChatId={chatId()}
              onSelectChat={(id) => setChatId(id)}
              onNewChat={() => setChatId(null)}
            />
          </div>
        </div>
      </Show>
      <div class='flex min-w-0 flex-1 flex-col'>
        <Show when={!showSidebar()}>
          <div class='border-border flex h-9 shrink-0 items-center border-b px-2'>
            <button
              type='button'
              class='text-muted-foreground hover:text-foreground rounded p-1 transition-colors'
              onClick={() => setShowSidebar(true)}
              title='Open sidebar'
            >
              <PanelLeftOpen class='h-3.5 w-3.5' stroke-width={2} />
            </button>
          </div>
        </Show>
        <div class='min-h-0 flex-1'>
          <Show
            when={kbRoot()}
            fallback={
              <div class='flex h-full items-center justify-center text-muted-foreground text-sm'>
                No knowledge base selected
              </div>
            }
          >
            <KbChatPane
              kbRoot={kbRoot()}
              chatId={chatId()}
              onChatIdChange={(id) => setChatId(id)}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}
