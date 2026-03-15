import type { ReactNode } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ViewModeToggle } from '@/components/view-mode-toggle'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BrowserPaneProps {
  mode?: 'MediaServer' | 'Workspace'
  dialogs?: ReactNode
  mediaPlayers?: ReactNode
  progress?: ReactNode
  rootClassName?: string
  containerClassName?: string
  cardClassName?: string
  breadcrumbs: ReactNode
  search?: {
    visible: boolean
    placeholder: string
    value: string
    onChange: (value: string) => void
  }
  actions?: ReactNode
  trailingSlot?: ReactNode
  viewMode: 'list' | 'grid'
  onViewModeChange: (mode: 'list' | 'grid') => void
  children: ReactNode
}

export function BrowserPane({
  mode = 'MediaServer',
  dialogs,
  mediaPlayers,
  progress,
  rootClassName,
  containerClassName = 'container mx-auto lg:p-4',
  cardClassName = 'py-0 gap-0 rounded-none lg:rounded-xl',
  breadcrumbs,
  search,
  actions,
  trailingSlot,
  viewMode,
  onViewModeChange,
  children,
}: BrowserPaneProps) {
  const paneContent = (
    <>
      <div
        className={cn(
          'shrink-0 border-b flex items-center',
          mode === 'Workspace'
            ? 'h-9 border-border bg-muted/50 px-2 py-0'
            : 'border-border bg-muted/30 p-1.5 lg:p-2',
        )}
      >
        <div
          className={cn(
            'flex flex-wrap items-center justify-between w-full',
            mode === 'Workspace' ? 'gap-1' : 'gap-1.5 lg:gap-2',
          )}
        >
          {breadcrumbs}
          {search?.visible && (
            <div className='basis-full md:basis-auto order-last md:order-0 flex items-center justify-end md:justify-start'>
              <Popover.Root>
                <Popover.Trigger
                  className={cn(
                    'inline-flex shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground outline-none',
                    mode === 'Workspace' ? 'h-7 w-7' : 'h-8 w-8',
                  )}
                  aria-label='Open search'
                >
                  <Search className='h-4 w-4' />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Positioner
                    className='z-50 outline-none'
                    side='bottom'
                    align='start'
                    sideOffset={6}
                  >
                    <Popover.Popup className='w-72 rounded-md border border-border bg-popover p-2 shadow-lg outline-none'>
                      <Input
                        type='search'
                        placeholder={search.placeholder}
                        value={search.value}
                        onChange={(e) => search.onChange(e.target.value)}
                        className='h-9 w-full'
                        autoFocus
                      />
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            </div>
          )}
          <div className='flex gap-1 items-center'>
            {actions}
            <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} mode={mode} />
            {trailingSlot}
          </div>
        </div>
      </div>

      {children}
    </>
  )

  return (
    <>
      {dialogs}
      {mediaPlayers}

      {rootClassName ? (
        <div className={rootClassName}>
          <div className={containerClassName}>
            <Card className={cardClassName}>{paneContent}</Card>
          </div>
        </div>
      ) : (
        paneContent
      )}

      {progress}
    </>
  )
}
