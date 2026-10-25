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
    class='flex shrink-0 flex-wrap items-center gap-2 border-b border-white/15 bg-neutral-900 px-3 py-2 text-sm'
    role='search'
    aria-label='Document search'
  >
    <input
      aria-label='Find in document'
      type='search'
      value={props.query}
      use={focusSearch}
      class='min-w-20 flex-1 rounded border border-white/25 bg-neutral-800 px-2 py-1'
      onInput={(event) => props.onSearch(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          props.onNext(event.shiftKey ? -1 : 1)
        }
      }}
    />
    <span role='status' class='text-xs text-neutral-300'>
      {props.searching
        ? 'Searching…'
        : props.error ||
          (props.query.trim()
            ? props.matches.length
              ? `${props.index + 1} of ${props.matches.length}${props.truncated ? '+' : ''}`
              : 'No matches'
            : '')}
    </span>
    <button
      type='button'
      aria-label='Previous match'
      disabled={!props.matches.length}
      onClick={() => props.onNext(-1)}
      class='rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40'
    >
      ↑
    </button>
    <button
      type='button'
      aria-label='Next match'
      disabled={!props.matches.length}
      onClick={() => props.onNext(1)}
      class='rounded px-2 py-1 hover:bg-white/10 disabled:opacity-40'
    >
      ↓
    </button>
    <button
      type='button'
      aria-label='Close search'
      onClick={props.onClose}
      class='rounded px-2 py-1 hover:bg-white/10'
    >
      ×
    </button>
    {props.matches[props.index] ? (
      <p class='w-full truncate text-xs text-neutral-400'>
        {props.location} · {props.matches[props.index]!.excerpt}
      </p>
    ) : null}
  </div>
))
