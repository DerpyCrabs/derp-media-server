import { setFileDragData } from '@/lib/file-drag-data'
import {
  finePointerDragEnabled,
  subscribeFinePointerDragEnabled,
} from '@/lib/enable-fine-pointer-drag'
import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import FileText from 'lucide-solid/icons/file-text'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

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
  /** When set, recent chips use copyMove when true for this path; otherwise copy only (e.g. tab bar). */
  recentDragCanMove?: (filePath: string) => boolean
}

export function KbDashboard(props: Props) {
  const compact = () => (props.mode ?? 'MediaServer') === 'Workspace'
  const [enableDrag, setEnableDrag] = createSignal(finePointerDragEnabled())

  onMount(() => {
    setEnableDrag(finePointerDragEnabled())
    return subscribeFinePointerDragEnabled(setEnableDrag)
  })

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

  function onRecentDragStart(file: RecentFile, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!dtr || !enableDrag()) return
    const token = props.shareToken
    const canMove = props.recentDragCanMove?.(file.path) ?? false
    setFileDragData(dtr, {
      path: file.path,
      isDirectory: false,
      sourceKind: token ? 'share' : 'local',
      ...(token ? { sourceToken: token } : {}),
    })
    dtr.effectAllowed = canMove ? 'copyMove' : 'copy'
  }

  return (
    <Show when={!isLoading() && recent().length > 0}>
      <div
        ref={setScrollEl}
        data-testid='kb-recent-strip'
        class={cn(
          'min-w-0 shrink-0 overflow-x-auto scrollbar-none border-b border-border',
          compact()
            ? 'flex items-center px-1.5 py-1.5 mb-1'
            : 'bg-muted/20 px-1.5 py-1.5 md:px-2 md:py-2',
        )}
      >
        <div
          class={cn('flex w-max min-w-full flex-nowrap', compact() ? 'gap-1' : 'gap-1 md:gap-1.5')}
        >
          <For each={recent()}>
            {(file) => (
              <div
                role='button'
                tabindex={0}
                {...(compact() ? { 'data-no-window-drag': '' } : {})}
                class={cn(
                  'flex shrink-0 cursor-pointer items-center rounded border border-border bg-background text-left transition-colors hover:bg-muted/50',
                  compact()
                    ? 'gap-1 px-1.5 py-0.5'
                    : 'gap-1 px-1.5 py-1 md:gap-1.5 md:px-2 md:py-1.5',
                )}
                draggable={enableDrag()}
                onClick={() => props.onFileClick(file.path)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    props.onFileClick(file.path)
                  }
                }}
                onDragStart={(e) => onRecentDragStart(file, e)}
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
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
