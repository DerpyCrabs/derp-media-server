import { knowledgeBaseRecentSchema } from '@/lib/files/file-schemas'
import {
  type Snapshot,
  list,
  available,
  clock,
  domMount,
  modelOwner,
  view,
  controllerView,
} from 'effectweb'
import { AsyncResult } from 'effect/unstable/reactivity'
import { groups, queryCache } from '@/lib/api/cache'
import { setFileDragData } from '@/lib/files/file-drag-data'
import {
  finePointerDragEnabled,
  subscribeFinePointerDragEnabled,
} from '@/lib/ui/enable-fine-pointer-drag'
import { apiSchemaEffect } from '@/lib/api/client'
import { cn } from '@/lib/ui/cn'
import FileText from '@effectweb/lucide/icons/file-text'
import { observeQuery, query } from '@effectweb/query'
type RecentFile = { path: string; name: string; modifiedAt: string }
function formatRelativeTime(dateStr: string, now: number): string {
  const date = new Date(dateStr)
  const diffMs = now - date.getTime()
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
  /** Tighter strip + chips for embedded window chrome. */
  compact?: boolean
  mode?: 'MediaServer' | 'Workspace'
  /** When set, recent chips use copyMove when true for this path; otherwise copy only (e.g. tab bar). */
  recentDragCanMove?: (filePath: string) => boolean
}
const recentQuery = query({
  name: 'kb-recent',
  groups: [groups.files],
  load: (path: string) =>
    apiSchemaEffect(knowledgeBaseRecentSchema, `/api/kb/recent?root=${encodeURIComponent(path)}`),
})
const minute = clock(60000)
const wheelBinding = domMount((element: HTMLDivElement) => {
  const handler = (event: WheelEvent) => {
    if (element.scrollWidth > element.clientWidth) {
      event.preventDefault()
      element.scrollLeft += event.deltaY
    }
  }
  element.addEventListener('wheel', handler, { passive: false })
  return () => element.removeEventListener('wheel', handler)
})
export const KbDashboard = controllerView({
  create: (props: Props) => {
    const owner = modelOwner({
      props,
      result: AsyncResult.initial<{ results: RecentFile[] }, Error>() as AsyncResult.AsyncResult<
        Snapshot<{ results: RecentFile[] }>,
        Error
      >,
      enableDrag: finePointerDragEnabled(),
      now: Date.now(),
    })
    owner.own(subscribeFinePointerDragEnabled((enableDrag) => owner.patch({ enableDrag })))
    owner.own(minute.subscribe((now) => owner.patch({ now })))
    const recent = observeQuery(owner, queryCache, recentQuery, 'result')
    recent.select(props.scopePath || undefined)
    return {
      source: owner.source,
      receive: (next: Props) => {
        owner.patch({ props: next })
        recent.select(next.scopePath || undefined)
      },
      dispose: owner.dispose,
    }
  },
  view: view((model) => {
    const props = model.props
    const compact = () => props.compact === true || props.mode === 'Workspace'
    const recent = () => available(model.result)?.results ?? []
    const isLoading = () => model.result.waiting && !available(model.result)
    const enableDrag = () => model.enableDrag
    function onRecentDragStart(file: RecentFile, e: globalThis.DragEvent) {
      const dtr = e.dataTransfer
      if (!dtr || !enableDrag()) return
      const canMove = props.recentDragCanMove?.(file.path) ?? false
      setFileDragData(dtr, { path: file.path, isDirectory: false, sourceKind: 'local' })
      dtr.effectAllowed = canMove ? 'copyMove' : 'copy'
    }
    return !isLoading() && recent().length > 0 ? (
      <div
        use={wheelBinding}
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
          {list(
            recent(),
            (file) => file.path,
            (file) => (
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
                draggable={enableDrag() ? 'true' : 'false'}
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
                  {formatRelativeTime(file.modifiedAt, model.now)}
                </span>
              </div>
            ),
          )}
        </div>
      </div>
    ) : null
  }),
})
