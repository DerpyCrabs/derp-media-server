import { type ReactNode, useRef } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface WorkspaceTaskbarItem {
  id: string
  label: string
  active: boolean
  icon?: ReactNode
  onSelect: () => void
  onClose: () => void
}

interface WorkspaceLayoutProps {
  items: WorkspaceTaskbarItem[]
  onNewBrowser: () => void
  children: ReactNode
  emptyState?: ReactNode
  className?: string
  taskbarRightSlot?: ReactNode
}

export function Layout({
  items,
  onNewBrowser,
  children,
  emptyState,
  className,
  taskbarRightSlot,
}: WorkspaceLayoutProps) {
  const handledByMouseDownRef = useRef(false)

  return (
    <div className={cn('fixed inset-0 flex flex-col overflow-hidden bg-background', className)}>
      <div className='relative min-h-0 flex-1 overflow-hidden'>
        {items.length > 0 ? children : emptyState}
      </div>

      <div
        className='relative border-t border-border bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/90'
        style={{ zIndex: 999999 }}
      >
        <div className='flex h-10 items-center gap-2'>
          <Button
            variant='ghost'
            size='icon-sm'
            onClick={onNewBrowser}
            title='Open browser window'
            className='rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400'
          >
            <FolderOpen className='h-6 w-6' strokeWidth={1.75} />
          </Button>

          <div className='flex min-w-0 flex-1 items-center gap-0 overflow-x-auto'>
            {items.length > 0 ? (
              items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'flex h-10 min-w-[120px] flex-[0_1_220px] items-center gap-1 overflow-hidden border-r border-border bg-muted/50 px-2 text-muted-foreground',
                    item.active && 'bg-muted text-foreground',
                  )}
                >
                  <button
                    type='button'
                    onMouseDown={(e) => {
                      if (e.button === 0) {
                        handledByMouseDownRef.current = true
                        item.onSelect()
                      }
                    }}
                    onClick={() => {
                      if (handledByMouseDownRef.current) {
                        handledByMouseDownRef.current = false
                        return
                      }
                      item.onSelect()
                    }}
                    className='flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left text-xs touch-manipulation'
                  >
                    <span className='shrink-0 text-muted-foreground'>{item.icon}</span>
                    <span className='min-w-0 truncate'>{item.label}</span>
                  </button>
                  <button
                    type='button'
                    onClick={item.onClose}
                    className='shrink-0 p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                    aria-label={`Close ${item.label}`}
                  >
                    <X className='h-3 w-3' />
                  </button>
                </div>
              ))
            ) : (
              <div className='text-sm text-muted-foreground'>
                No windows open. Use the browser button to start a workspace.
              </div>
            )}
          </div>

          {taskbarRightSlot ? (
            <div className='flex h-10 shrink-0 items-center gap-0'>{taskbarRightSlot}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
