import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import FileText from 'lucide-solid/icons/file-text'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

type RecentFile = { path: string; name: string; modifiedAt: string }

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

type Props = {
  scopePath: string
  onFileClick: (path: string) => void
  shareToken?: string
  dir?: string
  /** Tighter strip + chips (workspace window chrome). */
  mode?: 'MediaServer' | 'Workspace'
}

export function KbDashboard(props: Props) {
  const compact = () => (props.mode ?? 'MediaServer') === 'Workspace'
  const directQuery = useQuery(() => ({
    queryKey: queryKeys.kbRecent(props.scopePath),
    queryFn: () =>
      api<{ results: RecentFile[] }>(`/api/kb/recent?root=${encodeURIComponent(props.scopePath)}`),
    enabled: !props.shareToken && !!props.scopePath,
  }))

  const shareQuery = useQuery(() => ({
    queryKey: queryKeys.shareKbRecent(props.shareToken!, props.dir),
    queryFn: () => {
      const params = new URLSearchParams()
      if (props.dir) params.set('dir', props.dir)
      return api<{ results: RecentFile[] }>(`/api/share/${props.shareToken}/kb/recent?${params}`)
    },
    enabled: !!props.shareToken,
  }))

  const recent = createMemo(() => {
    const data = props.shareToken ? shareQuery.data : directQuery.data
    return (data?.results ?? []) as RecentFile[]
  })

  const isLoading = createMemo(() =>
    props.shareToken ? shareQuery.isLoading : directQuery.isLoading,
  )

  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement | null>(null)

  function handleWheel(e: WheelEvent) {
    const el = scrollEl()
    if (!el || el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += e.deltaY
  }

  createEffect(() => {
    const el = scrollEl()
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    onCleanup(() => el.removeEventListener('wheel', handleWheel))
  })

  return (
    <Show when={!isLoading() && recent().length > 0}>
      <div
        ref={setScrollEl}
        data-testid='kb-recent-strip'
        class={cn(
          'min-w-0 shrink-0 overflow-x-auto scrollbar-none border-b border-border',
          compact()
            ? 'flex items-center -mx-2 -mt-2 px-2 py-1.5 mb-1'
            : 'bg-muted/20 px-1.5 py-1.5 md:px-2 md:py-2',
        )}
      >
        <div
          class={cn('flex w-max min-w-full flex-nowrap', compact() ? 'gap-1' : 'gap-1 md:gap-1.5')}
        >
          <For each={recent()}>
            {(file) => (
              <button
                type='button'
                class={cn(
                  'flex shrink-0 items-center rounded border border-border bg-background text-left transition-colors hover:bg-muted/50',
                  compact()
                    ? 'gap-1 px-1.5 py-0.5'
                    : 'gap-1 px-1.5 py-1 md:gap-1.5 md:px-2 md:py-1.5',
                )}
                onClick={() => props.onFileClick(file.path)}
              >
                <FileText
                  class={cn(
                    'shrink-0 text-muted-foreground',
                    compact() ? 'h-3.5 w-3.5' : 'h-4 w-4',
                  )}
                  stroke-width={2}
                />
                <span
                  class={cn(
                    'truncate font-medium',
                    compact() ? 'max-w-[10rem] text-xs' : 'text-sm',
                  )}
                >
                  {file.name}
                </span>
                <span
                  class={cn(
                    'shrink-0 text-muted-foreground',
                    compact() ? 'text-[10px] leading-none' : 'text-xs',
                  )}
                >
                  {formatRelativeTime(file.modifiedAt)}
                </span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
