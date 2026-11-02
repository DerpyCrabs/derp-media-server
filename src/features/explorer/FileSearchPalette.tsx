import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { createFileSearchPalette } from './file-search-controller'
import { component, list, available, resourceError, view, controllerView } from 'effectweb'
import { Dialog } from '@/lib/ui/dialog'
import { DropdownMenu } from '@/lib/ui/menu'
import {
  FILE_SEARCH_DEFAULT_LIMIT,
  FILE_SEARCH_MIN_QUERY_LENGTH,
  fileSearchCodePointLength,
  type FileSearchResult,
  type FileSearchStatus,
} from '@/lib/files/file-search'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import File from '@effectweb/lucide/icons/file'
import FileSearch from '@effectweb/lucide/icons/file-search'
import Folder from '@effectweb/lucide/icons/folder'
import Search from '@effectweb/lucide/icons/search'
import X from '@effectweb/lucide/icons/x'
export type FileSearchButtonProps = {
  title: string
  onSelect: (result: FileSearchResult) => void
  resultFilter?: (result: FileSearchResult) => boolean
  disabled?: boolean
  class?: string
  iconClass?: string
  testId?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}
function stateLabel(status: FileSearchStatus | undefined): string {
  if (!status) return 'Loading index status…'
  if (status.state === 'building')
    return `Indexing… ${status.indexedEntries.toLocaleString()} items`
  if (status.state === 'refreshing') return 'Checking for changes…'
  if (status.state === 'partial') return 'Some media directories are unavailable or incomplete'
  if (status.state === 'error') return status.error ?? 'Search index error'
  if (status.state === 'disabled') return 'File search is disabled'
  const polling = status.roots.filter((root) => root.refreshMode === 'polling').length
  return `${status.indexedEntries.toLocaleString()} indexed items · ${status.watcherCount} watched · ${polling} polling`
}
export const FileSearchButton = component(
  { init: (_props: FileSearchButtonProps) => ({ internalOpen: false }) },
  view((local, patch) => {
    const props = local.props
    const internalOpen = () => local.internalOpen,
      setInternalOpen = (value: boolean) => patch({ internalOpen: value })
    const open = () => props.open ?? internalOpen()
    const setOpen = (value: boolean) => {
      setInternalOpen(value)
      props.onOpenChange?.(value)
    }
    return (
      <>
        <Button
          size='icon'
          variant='ghost'
          type='button'
          class={
            props.class ??
            'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50'
          }
          title={props.title}
          aria-label={props.title}
          disabled={props.disabled}
          data-testid={props.testId}
          onClick={() => setOpen(true)}
        >
          <FileSearch class={props.iconClass ?? 'size-4'} aria-hidden='true' stroke-width={2} />
        </Button>
        {open() ? (
          <FileSearchPalette
            title={props.title}
            onClose={() => setOpen(false)}
            onSelect={props.onSelect}
            resultFilter={props.resultFilter}
          />
        ) : null}
      </>
    )
  }),
)
const FileSearchPalette = controllerView(
  { controller: createFileSearchPalette },
  view((model) => {
    const props = model.props
    const listId = model.listId
    const query = model.query
    const setQuery = model.setQuery
    const queryLongEnough = () =>
      fileSearchCodePointLength(model.debouncedQuery) >= FILE_SEARCH_MIN_QUERY_LENGTH
    const results = () =>
      (queryLongEnough() ? (available(model.searchResult)?.results ?? []) : []).filter(
        (result) => props.resultFilter?.(result) ?? true,
      )
    const status = () => available(model.searchResult)?.status ?? available(model.statusResult)
    const selection = model.selection
    const setSelection = model.setSelection
    const searchError = resourceError(model.searchResult)
    const reindexError = resourceError(model.reindexResult)
    const selectionKey = () =>
      `${model.debouncedQuery}\0${results()
        .map((result) => result.path)
        .join('\0')}`
    const activeIndex = () => {
      const current = selection
      if (current.key !== selectionKey()) return 0
      return Math.min(current.index, Math.max(0, results().length - 1))
    }
    const setActiveIndex = (update: number | ((index: number) => number)) => {
      const next = typeof update === 'function' ? update(activeIndex()) : update
      setSelection({ key: selectionKey(), index: next })
    }
    function choose(result: FileSearchResult) {
      const select = props.onSelect
      props.onClose()
      select(result)
    }
    function onInputKeyDown(event: KeyboardEvent) {
      const items = results()
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (items.length > 0) setActiveIndex((index) => (index + 1) % items.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (items.length > 0) setActiveIndex((index) => (index - 1 + items.length) % items.length)
      } else if (event.key === 'Home') {
        event.preventDefault()
        setActiveIndex(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        if (items.length > 0) setActiveIndex(items.length - 1)
      } else if (event.key === 'Enter') {
        const result = items[activeIndex()]
        if (result) {
          event.preventDefault()
          choose(result)
        }
      }
    }
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
        aria-label={props.title}
        showCloseButton={false}
        class='sm:max-w-2xl max-h-[80dvh] overflow-hidden p-0 gap-0 flex flex-col'
      >
        <div data-testid='file-search-palette' class='flex min-h-0 flex-col'>
          <div class='flex items-center gap-2 border-b border-border px-3 py-2'>
            <Search class='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
            <Input
              autofocus
              type='text'
              role='combobox'
              aria-expanded='true'
              aria-controls={listId}
              aria-activedescendant={
                results().length > 0 ? `${listId}-option-${activeIndex()}` : undefined
              }
              autocomplete='off'
              placeholder='Search files and folders…'
              class='h-11 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0'
              value={query}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onInputKeyDown}
            />
            <DropdownMenu
              trigger={
                <Button variant='ghost' size='icon' aria-label='Search options'>
                  <Ellipsis class='size-[18px]' size={18} />
                </Button>
              }
              items={[
                {
                  kind: 'item',
                  label: 'Refresh index',
                  disabled: model.reindexResult.waiting,
                  onSelect: () => model.reindex('reconcile'),
                },
                {
                  kind: 'item',
                  label: 'Rebuild index',
                  disabled: model.reindexResult.waiting,
                  onSelect: () => model.confirmRebuild(),
                },
              ]}
            />
            <Button variant='ghost' size='icon' aria-label='Close search' onClick={props.onClose}>
              <X class='size-[18px]' size={18} />
            </Button>
          </div>

          <div id={listId} role='listbox' class='min-h-48 flex-1 overflow-y-auto p-2'>
            {!queryLongEnough() ? (
              <div class='flex min-h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground'>
                Type at least {FILE_SEARCH_MIN_QUERY_LENGTH} characters to search every media
                directory.
              </div>
            ) : null}
            {queryLongEnough() &&
            model.searchResult.waiting &&
            !available(model.searchResult) &&
            results().length === 0 ? (
              <div class='flex min-h-44 items-center justify-center text-sm text-muted-foreground'>
                Searching…
              </div>
            ) : null}
            {queryLongEnough() && searchError ? (
              <div class='flex min-h-44 items-center justify-center px-6 text-center text-sm text-destructive'>
                {searchError || 'Search failed'}
              </div>
            ) : null}
            {queryLongEnough() &&
            !(model.searchResult.waiting && !available(model.searchResult)) &&
            !model.searchResult.waiting &&
            !searchError &&
            results().length === 0 ? (
              <div class='flex min-h-44 items-center justify-center text-sm text-muted-foreground'>
                No matching files or folders.
              </div>
            ) : null}
            {list(
              results(),
              (result) => result.path,
              (result, index) => (
                <Button
                  variant='ghost'
                  id={`${listId}-option-${index}`}
                  type='button'
                  role='option'
                  aria-selected={index === activeIndex() ? 'true' : 'false'}
                  class={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 justify-start text-left outline-none ${
                    index === activeIndex() ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
                  }`}
                  onPointerMove={() => setActiveIndex(index)}
                  onClick={() => choose(result)}
                >
                  {result.isDirectory ? (
                    <Folder class='size-5 shrink-0 text-amber-500' aria-hidden='true' />
                  ) : (
                    <File class='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
                  )}
                  <span class='min-w-0 flex-1'>
                    <span class='block truncate text-sm font-medium'>{result.name}</span>
                    <span class='block truncate text-xs text-muted-foreground'>
                      {result.parentPath || result.rootName}
                    </span>
                  </span>
                  <span class='max-w-28 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                    {result.rootName}
                  </span>
                </Button>
              ),
            )}
          </div>

          {reindexError ? (
            <p role='alert' class='px-4 py-2 text-sm text-destructive'>
              {reindexError}
            </p>
          ) : null}
          {status()?.state !== 'ready' || available(model.searchResult)?.truncated ? (
            <p class='border-t px-4 py-2 text-xs text-muted-foreground' role='status'>
              {available(model.searchResult)?.truncated
                ? `First ${FILE_SEARCH_DEFAULT_LIMIT} results`
                : stateLabel(status())}
            </p>
          ) : null}
        </div>
      </Dialog>
    )
  }),
)
