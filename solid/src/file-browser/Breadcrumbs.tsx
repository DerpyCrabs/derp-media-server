import { cn } from '@/lib/utils'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import House from 'lucide-solid/icons/house'
import { createMemo, For, Show } from 'solid-js'

type BreadcrumbsProps = {
  currentPath: string
  onNavigate: (path: string) => void
}

export function Breadcrumbs(props: BreadcrumbsProps) {
  const crumbs = createMemo(() => {
    const parts = props.currentPath ? props.currentPath.split(/[/\\]/).filter(Boolean) : []
    return [
      { name: 'Home', path: '' },
      ...parts.map((part, index) => ({
        name: part,
        path: parts.slice(0, index + 1).join('/'),
      })),
    ]
  })

  return (
    <nav class='flex items-center gap-1 lg:gap-2 flex-wrap min-w-0 flex-1' aria-label='Breadcrumb'>
      <For each={crumbs()}>
        {(crumb, index) => (
          <div class='flex items-center gap-2'>
            <Show when={index() > 0}>
              <ChevronRight
                class='h-4 w-4 shrink-0 text-muted-foreground'
                size={16}
                stroke-width={2}
              />
            </Show>
            <button
              type='button'
              class={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring h-8 px-2.5 shrink-0',
                index() === crumbs().length - 1
                  ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={() => props.onNavigate(crumb.path)}
            >
              <Show when={index() === 0}>
                <House class='h-4 w-4 shrink-0' size={16} stroke-width={2} />
              </Show>
              {crumb.name}
            </button>
          </div>
        )}
      </For>
    </nav>
  )
}
