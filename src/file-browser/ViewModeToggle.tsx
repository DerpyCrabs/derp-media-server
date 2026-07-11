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
  const sizeClass = () => (isWorkspace() ? 'size-6.5' : 'size-7')
  const iconClass = () => (isWorkspace() ? 'h-3.5 w-3.5' : 'h-4 w-4')

  return (
    <div
      class='flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 dark:bg-input/30'
      role='group'
      aria-label='View mode'
    >
      <button
        type='button'
        class={cn(
          sizeClass(),
          'inline-flex items-center justify-center rounded-md border border-transparent p-0 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'list'
            ? 'bg-background text-foreground shadow-sm dark:bg-background/80'
            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
        )}
        onClick={() => props.onChange('list')}
        aria-label='List view'
        aria-pressed={props.viewMode === 'list'}
        title='List view'
      >
        <List class={iconClass()} stroke-width={2} aria-hidden='true' />
      </button>
      <button
        type='button'
        class={cn(
          sizeClass(),
          'inline-flex items-center justify-center rounded-md border border-transparent p-0 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.viewMode === 'grid'
            ? 'bg-background text-foreground shadow-sm dark:bg-background/80'
            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
        )}
        onClick={() => props.onChange('grid')}
        aria-label='Grid view'
        aria-pressed={props.viewMode === 'grid'}
        title='Grid view'
      >
        <LayoutGrid class={iconClass()} stroke-width={2} aria-hidden='true' />
      </button>
    </div>
  )
}
