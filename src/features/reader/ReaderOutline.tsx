import { Button } from '@/lib/ui/button'
import { cn } from '@/lib/ui/cn'
import { view, list, entities, type JSX } from 'effectweb'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import X from '@effectweb/lucide/icons/x'
export type ReaderNavigation = { tabs: JSX.Element; notes?: JSX.Element }
export type ReaderOutlineItem = {
  id: string
  label: string
  target: string | number
  anchor?: string
  children: ReaderOutlineItem[]
}
const OutlineItem = view<{
  item: ReaderOutlineItem
  active: string | number
  level: number
  expanded: string[]
  onToggle: (id: string) => void
  onNavigate: (target: string | number, anchor?: string) => void
  onClose: () => void
}>((props) => {
  const expanded = () => props.expanded.includes(props.item.id)
  return (
    <li>
      <div class='flex min-w-0 items-center' style={{ 'padding-left': `${props.level * 12}px` }}>
        {props.item.children.length ? (
          <Button
            size='icon'
            variant='ghost'
            type='button'
            class='grid h-7 w-6 shrink-0 place-items-center text-muted-foreground/55 hover:text-foreground'
            aria-label={expanded() ? `Collapse ${props.item.label}` : `Expand ${props.item.label}`}
            onClick={() => props.onToggle(props.item.id)}
          >
            {expanded() ? (
              <ChevronDown class='size-[14px]' size={14} />
            ) : (
              <ChevronRight class='size-[14px]' size={14} />
            )}
          </Button>
        ) : (
          <span class='h-7 w-6 shrink-0' />
        )}
        <Button
          variant='ghost'
          type='button'
          class={cn(
            'min-w-0 flex-1 truncate rounded px-1.5 py-1 justify-start text-left text-sm hover:bg-muted',
            {
              'bg-accent text-foreground': props.active === props.item.target,
              'text-muted-foreground/72': props.active !== props.item.target,
            },
          )}
          title={props.item.label}
          onClick={(event) => {
            props.onNavigate(props.item.target, props.item.anchor)
            const outline = event.currentTarget.closest<HTMLElement>(
              '[data-testid="reader-outline"]',
            )
            if (outline && getComputedStyle(outline).position === 'absolute') props.onClose()
          }}
        >
          {props.item.label}
        </Button>
      </div>
      {expanded() && props.item.children.length ? (
        <ul>
          {list(entities(props.item.children), (item) => (
            <OutlineItem {...props} item={item} level={props.level + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
})
export const ReaderOutline = view<{
  title: string
  navigation?: ReaderNavigation
  items: ReaderOutlineItem[]
  active: string | number
  onNavigate: (target: string | number, anchor?: string) => void
  onClose: () => void
  expanded: string[]
  onToggle: (id: string) => void
}>((props) => {
  return (
    <aside
      data-testid='reader-outline'
      class='absolute inset-0 z-20 flex flex-col border-r border-border bg-background md:relative md:inset-auto md:w-80 md:shrink-0'
    >
      <header class='flex h-10 shrink-0 items-center gap-2 border-b border-border px-2'>
        {props.navigation?.tabs ?? (
          <h2 class='min-w-0 flex-1 truncate text-sm font-semibold'>{props.title}</h2>
        )}
        <Button
          size='icon'
          variant='ghost'
          type='button'
          aria-label='Close document outline'
          class='grid h-7 w-7 place-items-center rounded hover:bg-muted'
          onClick={() => props.onClose()}
        >
          <X size={16} />
        </Button>
      </header>
      {props.navigation?.notes ?? (
        <nav class='min-h-0 flex-1 overflow-auto px-1 py-2' aria-label='Document outline'>
          <ul>
            {list(entities(props.items), (item) => (
              <OutlineItem
                item={item}
                active={props.active}
                level={0}
                expanded={props.expanded}
                onToggle={props.onToggle}
                onNavigate={props.onNavigate}
                onClose={props.onClose}
              />
            ))}
          </ul>
        </nav>
      )}
    </aside>
  )
})
