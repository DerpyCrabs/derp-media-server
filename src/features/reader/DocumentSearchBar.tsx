import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import ArrowDown from '@effectweb/lucide/icons/arrow-down'
import X from '@effectweb/lucide/icons/x'
import { domMount, view } from 'effectweb'
import type { DocumentMatch } from './document-search'
const focusSearch = domMount((input: HTMLInputElement) => {
  input.focus()
  input.select()
})
export const DocumentSearchBar = view<{
  query: string
  searching: boolean
  truncated?: boolean
  error?: string
  matches: readonly DocumentMatch[]
  index: number
  location: string
  onSearch: (query: string) => void
  onNext: (offset: number) => void
  onClose: () => void
}>((props) => (
  <div
    class='flex shrink-0 items-center gap-1.5 border-b border-border bg-background px-3 py-2 text-foreground'
    role='search'
    aria-label='Document search'
  >
    <Input
      type='search'
      aria-label='Find in document'
      placeholder='Find in document'
      value={props.query}
      use={focusSearch}
      class='min-w-0 flex-1'
      onInput={(event) => props.onSearch(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          props.onNext(event.shiftKey ? -1 : 1)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          props.onClose()
        }
      }}
    />
    <span role='status' class='shrink-0 text-xs text-muted-foreground'>
      {props.searching
        ? 'Searching…'
        : props.error ||
          (props.query.trim()
            ? props.matches.length
              ? `${props.index + 1}/${props.matches.length}${props.truncated ? '+' : ''}`
              : 'No matches'
            : '')}
    </span>
    <Button
      variant='outline'
      size='icon'
      aria-label='Previous match'
      disabled={!props.matches.length}
      onClick={() => props.onNext(-1)}
    >
      <ArrowUp />
    </Button>
    <Button
      variant='outline'
      size='icon'
      aria-label='Next match'
      disabled={!props.matches.length}
      onClick={() => props.onNext(1)}
    >
      <ArrowDown />
    </Button>
    <Button variant='ghost' size='icon' aria-label='Close search' onClick={props.onClose}>
      <X />
    </Button>
  </div>
))
