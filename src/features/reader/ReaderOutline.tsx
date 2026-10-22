import { cn } from '@/lib/ui/cn'
import { view, list, entities } from 'effectweb'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import X from '@effectweb/lucide/icons/x'
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
}>((props) => {
  const expanded = () => props.expanded.includes(props.item.id)
  return (
    <li>
      <div class='flex min-w-0 items-center' style={{ 'padding-left': `${props.level * 12}px` }}>
        {props.item.children.length ? (
          <button
            type='button'
            class='grid h-7 w-6 shrink-0 place-items-center text-white/55 hover:text-white'
            aria-label={expanded() ? `Collapse ${props.item.label}` : `Expand ${props.item.label}`}
            onClick={() => props.onToggle(props.item.id)}
          >
            {expanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span class='h-7 w-6 shrink-0' />
        )}
        <button
          type='button'
          class={cn(
            'min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-sm hover:bg-white/10',
            {
              'bg-white/15 text-white': props.active === props.item.target,
              'text-white/72': props.active !== props.item.target,
            },
          )}
          title={props.item.label}
          onClick={() => props.onNavigate(props.item.target, props.item.anchor)}
        >
          {props.item.label}
        </button>
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
      class='absolute inset-y-0 left-0 z-20 flex w-[min(320px,86vw)] flex-col border-r border-[#343434] bg-[#151515] shadow-xl md:relative md:shadow-none'
    >
      <header class='flex h-10 shrink-0 items-center gap-2 border-b border-[#303030] px-2'>
        <h2 class='min-w-0 flex-1 truncate text-sm font-semibold'>{props.title}</h2>
        <button
          type='button'
          aria-label='Close document outline'
          class='grid h-7 w-7 place-items-center rounded hover:bg-white/10'
          onClick={() => props.onClose()}
        >
          <X size={16} />
        </button>
      </header>
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
            />
          ))}
        </ul>
      </nav>
    </aside>
  )
})
