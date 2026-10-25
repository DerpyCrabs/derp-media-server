import { domBinding, view } from 'effectweb'
import X from '@effectweb/lucide/icons/x'
const focusFilter = (element: HTMLInputElement) => {
  element.focus()
}
export const FolderFilter = view<{
  value: string
  count: number
  onChange: (value: string) => void
  onClose: () => void
}>((props) => (
  <div
    class='flex shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-2 py-1.5'
    data-no-window-drag
  >
    <input
      use={domBinding(true, focusFilter)}
      type='search'
      aria-label='Filter this folder'
      placeholder='Filter this folder…'
      class='h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring'
      value={props.value}
      onInput={(event) => props.onChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          event.currentTarget.select()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          const surface = event.currentTarget.closest('[data-explorer-surface]')
          props.onClose()
          queueMicrotask(() => surface?.querySelector<HTMLElement>('[data-file-path]')?.focus())
        } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget
            .closest('[data-explorer-surface]')
            ?.querySelector<HTMLElement>('[data-file-path]')
            ?.focus()
        }
      }}
    />
    <span class='shrink-0 text-xs tabular-nums text-muted-foreground' role='status'>
      {props.count === 0 && props.value
        ? 'No matches'
        : `${props.count} ${props.count === 1 ? 'item' : 'items'}`}
    </span>
    <button
      type='button'
      aria-label='Close folder filter'
      class='inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted'
      onClick={props.onClose}
    >
      <X class='size-4' />
    </button>
  </div>
))
