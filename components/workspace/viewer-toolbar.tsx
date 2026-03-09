import type { ReactNode } from 'react'

interface WorkspaceViewerToolbarProps {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
}

export function WorkspaceViewerToolbar({ left, center, right }: WorkspaceViewerToolbarProps) {
  return (
    <div className='flex h-9 shrink-0 items-center gap-1 border-b border-white/8 bg-neutral-900/40 px-2'>
      {left && <div className='flex items-center gap-1'>{left}</div>}
      {center && <div className='flex-1 text-center text-xs text-muted-foreground'>{center}</div>}
      <div className='ml-auto flex items-center gap-0.5'>{right}</div>
    </div>
  )
}
