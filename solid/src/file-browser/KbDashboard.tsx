import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import FileText from 'lucide-solid/icons/file-text'
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'

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
}

export function KbDashboard(props: Props) {
  const recentQuery = useQuery(() => ({
    queryKey: queryKeys.kbRecent(props.scopePath),
    queryFn: () =>
      api<{ results: RecentFile[] }>(`/api/kb/recent?root=${encodeURIComponent(props.scopePath)}`),
    enabled: !!props.scopePath,
  }))

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
    <Show when={!recentQuery.isLoading && (recentQuery.data?.results?.length ?? 0) > 0}>
      <div
        ref={setScrollEl}
        class='min-w-0 shrink-0 overflow-x-auto scrollbar-none border-b border-border bg-muted/20 px-1.5 py-1.5 md:px-2 md:py-2'
      >
        <div class='flex w-max min-w-full flex-nowrap gap-1 md:gap-1.5'>
          <For each={recentQuery.data?.results ?? []}>
            {(file) => (
              <button
                type='button'
                class='flex shrink-0 items-center gap-1 rounded border border-border bg-background px-1.5 py-1 text-left transition-colors hover:bg-muted/50 md:gap-1.5 md:px-2 md:py-1.5'
                onClick={() => props.onFileClick(file.path)}
              >
                <FileText class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
                <span class='truncate text-sm font-medium'>{file.name}</span>
                <span class='shrink-0 text-xs text-muted-foreground'>
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
