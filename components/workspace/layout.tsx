import { type ReactNode, useRef } from 'react'
import { FolderOpen, PinOff, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { setFileDragData, type FileDragData } from '@/lib/file-drag-data'

interface WorkspaceTaskbarItem {
  id: string
  label: string
  active: boolean
  icon?: ReactNode
  tooltip?: string
  onSelect: () => void
  onClose: () => void
  dragData?: FileDragData
}

export interface PinnedTaskbarItemView {
  id: string
  label: string
  icon?: ReactNode
  tooltip: string
  onSelect: () => void
  onUnpin: () => void
  dragData?: FileDragData
}

interface WorkspaceLayoutProps {
  items: WorkspaceTaskbarItem[]
  pinnedItems?: PinnedTaskbarItemView[]
  onNewBrowser: () => void
  children: ReactNode
  emptyState?: ReactNode
  className?: string
  taskbarRightSlot?: ReactNode
}

function PinnedTaskbarIcon({
  icon,
  tooltip,
  onSelect,
  onUnpin,
  dragData,
}: {
  id: string
  icon?: ReactNode
  tooltip: string
  onSelect: () => void
  onUnpin: () => void
  dragData?: FileDragData
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className='flex shrink-0 items-center justify-center py-1 px-0.5'
        draggable={!!dragData}
        onDragStart={
          dragData
            ? (e) => {
                setFileDragData(e.dataTransfer, dragData)
                e.dataTransfer.effectAllowed = 'copy'
              }
            : undefined
        }
      >
        <Button
          variant='ghost'
          size='icon-sm'
          type='button'
          title={tooltip}
          onClick={() => onSelect()}
          className='h-7 w-7 shrink-0 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label={tooltip}
        >
          {icon}
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onUnpin}>
          <PinOff className='mr-2 h-4 w-4' />
          Unpin
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function TaskbarButton({
  id,
  label,
  icon,
  tooltip,
  onSelect,
  onClose,
  closeLabel,
  closeIcon: CloseIcon,
  active,
  dragData,
  handledByMouseDownRef,
}: {
  id: string
  label: string
  icon?: ReactNode
  tooltip: string
  onSelect: () => void
  onClose: () => void
  closeLabel: string
  closeIcon: typeof X
  active?: boolean
  dragData?: FileDragData
  handledByMouseDownRef: React.MutableRefObject<boolean>
}) {
  return (
    <div
      key={id}
      className={cn(
        'flex h-8 min-w-[120px] flex-[0_1_220px] items-center gap-1 overflow-hidden border-r border-border bg-muted/50 px-2 text-muted-foreground',
        active && 'bg-muted text-foreground',
      )}
      draggable={!!dragData}
      onDragStart={
        dragData
          ? (e) => {
              setFileDragData(e.dataTransfer, dragData)
              e.dataTransfer.effectAllowed = 'copy'
            }
          : undefined
      }
    >
      <button
        type='button'
        title={tooltip}
        onMouseDown={(e) => {
          if (e.button === 0) {
            handledByMouseDownRef.current = true
            onSelect()
          }
        }}
        onClick={() => {
          if (handledByMouseDownRef.current) {
            handledByMouseDownRef.current = false
            return
          }
          onSelect()
        }}
        className='flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left text-xs touch-manipulation'
      >
        <span className='shrink-0 text-muted-foreground'>{icon}</span>
        <span className='min-w-0 truncate'>{label}</span>
      </button>
      <button
        type='button'
        onClick={onClose}
        className='flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        aria-label={closeLabel}
      >
        <CloseIcon className='h-4 w-4' strokeWidth={2} />
      </button>
    </div>
  )
}

export function Layout({
  items,
  pinnedItems = [],
  onNewBrowser,
  children,
  emptyState,
  className,
  taskbarRightSlot,
}: WorkspaceLayoutProps) {
  const handledByMouseDownRef = useRef(false)
  const hasAnyTaskbarItems = items.length > 0 || pinnedItems.length > 0

  return (
    <div
      className={cn(
        'workspace-layout select-none fixed inset-0 flex flex-col overflow-hidden bg-background',
        className,
      )}
    >
      <div className='relative min-h-0 flex-1 overflow-hidden'>
        {items.length > 0 ? children : emptyState}
      </div>

      <div className='relative bg-background px-3' style={{ zIndex: 999999 }}>
        <div className='flex h-8 items-center gap-2'>
          <Button
            variant='ghost'
            size='icon-sm'
            onClick={onNewBrowser}
            title='Open browser window'
            className='h-7 w-7 shrink-0 rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400'
          >
            <FolderOpen className='h-5 w-5' strokeWidth={1.75} />
          </Button>

          <div className='flex min-w-0 flex-1 items-center overflow-x-auto'>
            {hasAnyTaskbarItems ? (
              <>
                {pinnedItems.length > 0 ? (
                  <div className='flex shrink-0 items-center gap-2'>
                    {pinnedItems.map((pin) => (
                      <PinnedTaskbarIcon
                        key={pin.id}
                        id={pin.id}
                        icon={pin.icon}
                        tooltip={pin.tooltip}
                        onSelect={pin.onSelect}
                        onUnpin={pin.onUnpin}
                        dragData={pin.dragData}
                      />
                    ))}
                  </div>
                ) : null}
                {pinnedItems.length > 0 && items.length > 0 ? (
                  <div className='w-2 shrink-0' aria-hidden />
                ) : null}
                <div className='flex min-w-0 flex-1 items-center gap-0 overflow-x-auto'>
                  {items.map((item) => (
                    <TaskbarButton
                      key={item.id}
                      id={item.id}
                      label={item.label}
                      icon={item.icon}
                      tooltip={item.tooltip ?? item.label}
                      onSelect={item.onSelect}
                      onClose={item.onClose}
                      closeLabel={`Close ${item.label}`}
                      closeIcon={X}
                      active={item.active}
                      dragData={item.dragData}
                      handledByMouseDownRef={handledByMouseDownRef}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className='text-sm text-muted-foreground'>
                No windows open. Use the browser button to start a workspace.
              </div>
            )}
          </div>

          {taskbarRightSlot ? (
            <div className='flex h-8 shrink-0 items-center gap-3'>{taskbarRightSlot}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
