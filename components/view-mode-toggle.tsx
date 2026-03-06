import { LayoutGrid, List } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ViewModeToggleProps {
  viewMode: 'list' | 'grid'
  onChange: (mode: 'list' | 'grid') => void
}

export function ViewModeToggle({ viewMode, onChange }: ViewModeToggleProps) {
  return (
    <>
      <Button
        variant={viewMode === 'list' ? 'default' : 'ghost'}
        size='sm'
        onClick={() => onChange('list')}
        className='h-8 w-8 p-0'
      >
        <List className='h-4 w-4' />
      </Button>
      <Button
        variant={viewMode === 'grid' ? 'default' : 'ghost'}
        size='sm'
        onClick={() => onChange('grid')}
        className='h-8 w-8 p-0'
      >
        <LayoutGrid className='h-4 w-4' />
      </Button>
    </>
  )
}
