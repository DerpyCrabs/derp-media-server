import { Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import type { GlobalSettings } from '@/lib/use-settings'
import { queryKeys } from '@/lib/query-keys'
import { api, post } from '@/lib/api'
import { KbChatPane } from './KbChatPane'
import { KbChatHistoryList } from './KbChatHistoryList'
import PanelLeftOpen from 'lucide-solid/icons/panel-left-open'
import PanelLeftClose from 'lucide-solid/icons/panel-left-close'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronUp from 'lucide-solid/icons/chevron-up'

export function KbChatWindowPane(props: {
  windowId: string
  workspace: Accessor<PersistedWorkspaceState | null>
  openMedia?: (path: string, isDirectory: boolean) => void
}) {
  const queryClient = useQueryClient()
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
  const [instrExpanded, setInstrExpanded] = createSignal(false)
  const [draftPrompt, setDraftPrompt] = createSignal('')

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: 10_000,
  }))

  createEffect(() => {
    const root = kbRoot()
    const data = settingsQuery.data
    if (!root || !data) return
    const v = data.kbChatSystemPrompts?.[root] ?? ''
    setDraftPrompt(v)
  })

  const savePromptMutation = useMutation(() => ({
    mutationFn: (vars: { kbRoot: string; prompt: string | null }) =>
      post<{ success: boolean; kbChatSystemPrompts?: Record<string, string> }>(
        '/api/settings/kbChatSystemPrompt',
        vars,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  function saveInstructions() {
    const root = kbRoot()
    if (!root) return
    const t = draftPrompt().trim()
    savePromptMutation.mutate({ kbRoot: root, prompt: t.length ? t : null })
  }

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
          <Show when={kbRoot()}>
            <div class='border-border shrink-0 border-t'>
              <button
                type='button'
                class='text-muted-foreground hover:text-foreground hover:bg-muted flex h-8 w-full items-center gap-1 px-2 text-xs transition-colors'
                onClick={() => setInstrExpanded((v) => !v)}
              >
                {instrExpanded() ? (
                  <ChevronDown class='h-3 w-3 shrink-0' stroke-width={2} />
                ) : (
                  <ChevronUp class='h-3 w-3 shrink-0' stroke-width={2} />
                )}
                <span class='truncate text-left'>KB instructions</span>
              </button>
              <Show when={instrExpanded()}>
                <div class='flex flex-col gap-1.5 p-1.5 pt-0'>
                  <textarea
                    class='border-border bg-background text-foreground placeholder:text-muted-foreground h-24 w-full resize-y rounded border px-2 py-1.5 text-xs'
                    placeholder='Extra system instructions for this knowledge base…'
                    value={draftPrompt()}
                    onInput={(e) => setDraftPrompt(e.currentTarget.value)}
                  />
                  <div class='flex items-center gap-1'>
                    <button
                      type='button'
                      class='bg-primary text-primary-foreground hover:bg-primary/90 rounded px-2 py-1 text-xs disabled:opacity-50'
                      disabled={savePromptMutation.isPending}
                      onClick={() => saveInstructions()}
                    >
                      {savePromptMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <Show when={savePromptMutation.isError}>
                      <span class='text-destructive text-[0.65rem]'>
                        {savePromptMutation.error?.message ?? 'Save failed'}
                      </span>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
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
              onOpenMedia={props.openMedia}
            />
          </Show>
        </div>
      </div>
    </div>
  )
}
