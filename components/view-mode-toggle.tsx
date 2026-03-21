import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ViewModeToggleProps {
  viewMode: 'list' | 'grid'
  onChange: (mode: 'list' | 'grid') => void
  mode?: 'MediaServer' | 'Workspace'
}

export function ViewModeToggle({ viewMode, onChange, mode = 'MediaServer' }: ViewModeToggleProps) {
  const isWorkspace = mode === 'Workspace'
  const sizeClass = isWorkspace ? 'h-7 w-7' : 'h-8 w-8'
  const iconClass = isWorkspace ? 'h-3.5 w-3.5' : 'h-4 w-4'

  return (
    <>
      <Button
        variant={viewMode === 'list' ? 'default' : 'ghost'}
        size='sm'
        onClick={() => onChange('list')}
        className={`${sizeClass} p-0`}
        aria-label='List view'
      >
        <List className={iconClass} />
      </Button>
      <Button
        variant={viewMode === 'grid' ? 'default' : 'ghost'}
        size='sm'
        onClick={() => onChange('grid')}
        className={`${sizeClass} p-0`}
        aria-label='Grid view'
      >
        <LayoutGrid className={iconClass} />
      </Button>
    </>
  )
}
