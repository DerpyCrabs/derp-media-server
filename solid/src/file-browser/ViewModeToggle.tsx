import { cn } from '@/lib/utils'
import LayoutGrid from 'lucide-solid/icons/layout-grid'
import List from 'lucide-solid/icons/list'

type ViewModeToggleProps = {
  viewMode: 'list' | 'grid'
  onChange: (mode: 'list' | 'grid') => void
}

export function ViewModeToggle(props: ViewModeToggleProps) {
  return (
    <div class='flex gap-1 items-center'>
      <button
        type='button'
        class={cn(
          'h-8 w-8 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'list'
            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
            : 'text-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        onClick={() => props.onChange('list')}
        aria-label='List view'
      >
        <List class='h-4 w-4' size={16} stroke-width={2} />
      </button>
      <button
        type='button'
        class={cn(
          'h-8 w-8 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'grid'
            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
            : 'text-foreground hover:bg-accent hover:text-accent-foreground',
        )}
        onClick={() => props.onChange('grid')}
        aria-label='Grid view'
      >
        <LayoutGrid class='h-4 w-4' size={16} stroke-width={2} />
      </button>
    </div>
  )
}
