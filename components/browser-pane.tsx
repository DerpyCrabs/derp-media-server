import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ViewModeToggle } from '@/components/view-mode-toggle'

interface BrowserPaneProps {
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
  viewMode: 'list' | 'grid'
  onViewModeChange: (mode: 'list' | 'grid') => void
  children: ReactNode
}

export function BrowserPane({
  dialogs,
  mediaPlayers,
  progress,
  rootClassName,
  containerClassName = 'container mx-auto lg:p-4',
  cardClassName = 'py-0 gap-0 rounded-none lg:rounded-xl',
  breadcrumbs,
  search,
  actions,
  viewMode,
  onViewModeChange,
  children,
}: BrowserPaneProps) {
  const paneContent = (
    <>
      <div className='p-1.5 lg:p-2 border-b border-border bg-muted/30 shrink-0'>
        <div className='flex flex-wrap items-center justify-between gap-1.5 lg:gap-2'>
          {breadcrumbs}
          {search?.visible && (
            <div className='w-full md:w-auto md:flex-1 md:min-w-0 md:max-w-[200px] lg:max-w-[260px] basis-full md:basis-auto order-last md:order-0'>
              <Input
                type='search'
                placeholder={search.placeholder}
                value={search.value}
                onChange={(e) => search.onChange(e.target.value)}
                className='h-8 w-full'
              />
            </div>
          )}
          <div className='flex gap-1 items-center'>
            {actions}
            <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
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
