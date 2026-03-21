import { cn } from '@/lib/utils'
import LayoutGrid from 'lucide-solid/icons/layout-grid'
import List from 'lucide-solid/icons/list'

type ViewModeToggleProps = {
  viewMode: 'list' | 'grid'
  onChange: (mode: 'list' | 'grid') => void
  mode?: 'MediaServer' | 'Workspace'
}

export function ViewModeToggle(props: ViewModeToggleProps) {
  const isWorkspace = () => (props.mode ?? 'MediaServer') === 'Workspace'
  const sizeClass = () => (isWorkspace() ? 'h-7 w-7' : 'h-8 w-8')
  const iconClass = () => (isWorkspace() ? 'h-3.5 w-3.5' : 'h-4 w-4')

  return (
    <div class='flex items-center gap-1'>
      <button
        type='button'
        class={cn(
          sizeClass(),
          'inline-flex items-center justify-center rounded-md border border-transparent p-0 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'list'
            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
            : 'text-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50',
        )}
        onClick={() => props.onChange('list')}
        aria-label='List view'
      >
        <List class={iconClass()} stroke-width={2} />
      </button>
      <button
        type='button'
        class={cn(
          sizeClass(),
          'inline-flex items-center justify-center rounded-md border border-transparent p-0 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'grid'
            ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
            : 'text-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50',
        )}
        onClick={() => props.onChange('grid')}
        aria-label='Grid view'
      >
        <LayoutGrid class={iconClass()} stroke-width={2} />
      </button>
    </div>
  )
}
