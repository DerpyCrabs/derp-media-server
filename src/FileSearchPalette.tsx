import { api } from '@/lib/api'
import {
  FILE_SEARCH_DEFAULT_LIMIT,
  FILE_SEARCH_MIN_QUERY_LENGTH,
  fileSearchCodePointLength,
  normalizeFileSearchText,
  type FileSearchResponse,
  type FileSearchResult,
  type FileSearchStatus,
} from '@/lib/file-search'
import { queryKeys } from '@/lib/query-keys'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import Database from 'lucide-solid/icons/database'
import File from 'lucide-solid/icons/file'
import FileSearch from 'lucide-solid/icons/file-search'
import Folder from 'lucide-solid/icons/folder'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import Search from 'lucide-solid/icons/search'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createSignal, createUniqueId, on, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'

export type FileSearchButtonProps = {
  title: string
  onSelect: (result: FileSearchResult) => void
  disabled?: boolean
  class?: string
  iconClass?: string
  testId?: string
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

export function FileSearchButton(props: FileSearchButtonProps) {
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <button
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
      </button>
      <Show when={open()}>
        <FileSearchPalette
          title={props.title}
          onClose={() => setOpen(false)}
          onSelect={props.onSelect}
        />
      </Show>
    </>
  )
}

function FileSearchPalette(props: {
  title: string
  onClose: () => void
  onSelect: (result: FileSearchResult) => void
}) {
  const queryClient = useQueryClient()
  const listId = createUniqueId()
  const [query, setQuery] = createSignal('')
  const [debouncedQuery, setDebouncedQuery] = createSignal('')
  const [activeIndex, setActiveIndex] = createSignal(0)
  let dialogEl: HTMLDivElement | undefined
  let inputEl: HTMLInputElement | undefined
  const previousFocus = document.activeElement as HTMLElement | null

  createEffect(() => {
    const value = query()
    const timer = window.setTimeout(() => setDebouncedQuery(value.trim()), 120)
    onCleanup(() => window.clearTimeout(timer))
  })

  const normalizedQuery = () => normalizeFileSearchText(debouncedQuery())
  const queryLongEnough = () =>
    fileSearchCodePointLength(normalizedQuery()) >= FILE_SEARCH_MIN_QUERY_LENGTH

  const statusQuery = useQuery(() => ({
    queryKey: queryKeys.fileSearchStatus(),
    queryFn: () => api<FileSearchStatus>('/api/files/search/status'),
    refetchInterval: 2_000,
    staleTime: 0,
  }))

  const searchQuery = useQuery(() => ({
    queryKey: queryKeys.fileSearch(normalizedQuery()),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<FileSearchResponse>(
        `/api/files/search?q=${encodeURIComponent(debouncedQuery())}&limit=${FILE_SEARCH_DEFAULT_LIMIT}`,
        { signal },
      ),
    enabled: queryLongEnough(),
    staleTime: 0,
    gcTime: 30_000,
    placeholderData: (previousData) => previousData,
  }))

  const reindexMutation = useMutation(() => ({
    mutationFn: (mode: 'reconcile' | 'full') =>
      api<{ accepted: true }>('/api/files/search/reindex', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.fileSearchStatus() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.fileSearch() })
    },
  }))

  const results = () => (queryLongEnough() ? (searchQuery.data?.results ?? []) : [])
  const status = () => searchQuery.data?.status ?? statusQuery.data

  createEffect(
    on(
      () => `${normalizedQuery()}:${results().length}`,
      () => setActiveIndex(0),
    ),
  )

  createEffect(() => {
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    queueMicrotask(() => inputEl?.focus())
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogEl) return
      const focusable = [...dialogEl.querySelectorAll<HTMLElement>('button:not([disabled]), input')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', onKey)
      queueMicrotask(() => previousFocus?.focus())
    })
  })

  function choose(result: FileSearchResult) {
    props.onSelect(result)
    props.onClose()
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
    <Portal mount={document.body}>
      <div
        class='fixed inset-0 z-[1100000] flex items-end justify-center bg-black/55 sm:items-start sm:px-4 sm:pt-[12vh]'
        role='presentation'
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <div
          ref={(element) => (dialogEl = element)}
          role='dialog'
          aria-modal='true'
          aria-label={props.title}
          data-testid='file-search-palette'
          class='flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-popover text-popover-foreground shadow-2xl sm:max-h-[72vh] sm:max-w-2xl sm:rounded-xl'
        >
          <div class='flex items-center gap-2 border-b border-border px-3 py-2'>
            <Search class='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
            <input
              ref={(element) => (inputEl = element)}
              type='search'
              role='combobox'
              aria-expanded='true'
              aria-controls={listId}
              aria-activedescendant={
                results().length > 0 ? `${listId}-option-${activeIndex()}` : undefined
              }
              autocomplete='off'
              placeholder='Search files and folders…'
              class='h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground'
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onInputKeyDown}
            />
            <button
              type='button'
              class='inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
              aria-label='Close search'
              onClick={props.onClose}
            >
              <X class='size-5' aria-hidden='true' />
            </button>
          </div>

          <div id={listId} role='listbox' class='min-h-48 flex-1 overflow-y-auto p-2'>
            <Show when={!queryLongEnough()}>
              <div class='flex min-h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground'>
                Type at least {FILE_SEARCH_MIN_QUERY_LENGTH} characters to search every media
                directory.
              </div>
            </Show>
            <Show when={queryLongEnough() && searchQuery.isLoading && results().length === 0}>
              <div class='flex min-h-44 items-center justify-center text-sm text-muted-foreground'>
                Searching…
              </div>
            </Show>
            <Show when={queryLongEnough() && searchQuery.isError}>
              <div class='flex min-h-44 items-center justify-center px-6 text-center text-sm text-destructive'>
                {searchQuery.error?.message ?? 'Search failed'}
              </div>
            </Show>
            <Show
              when={
                queryLongEnough() &&
                !searchQuery.isLoading &&
                !searchQuery.isFetching &&
                !searchQuery.isError &&
                results().length === 0
              }
            >
              <div class='flex min-h-44 items-center justify-center text-sm text-muted-foreground'>
                No matching files or folders.
              </div>
            </Show>
            <For each={results()}>
              {(result, index) => (
                <button
                  id={`${listId}-option-${index()}`}
                  type='button'
                  role='option'
                  aria-selected={index() === activeIndex()}
                  class={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none ${
                    index() === activeIndex()
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted'
                  }`}
                  onPointerMove={() => setActiveIndex(index())}
                  onClick={() => choose(result)}
                >
                  <Show
                    when={result.isDirectory}
                    fallback={
                      <File class='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
                    }
                  >
                    <Folder class='size-5 shrink-0 text-amber-500' aria-hidden='true' />
                  </Show>
                  <span class='min-w-0 flex-1'>
                    <span class='block truncate text-sm font-medium'>{result.name}</span>
                    <span class='block truncate text-xs text-muted-foreground'>
                      {result.parentPath || result.rootName}
                    </span>
                  </span>
                  <span class='max-w-28 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                    {result.rootName}
                  </span>
                </button>
              )}
            </For>
          </div>

          <div class='flex min-h-12 flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground'>
            <Database class='size-4 shrink-0' aria-hidden='true' />
            <span class='min-w-0 flex-1' aria-live='polite'>
              {stateLabel(status())}
              <Show when={searchQuery.data?.truncated}>
                {' '}
                · First {FILE_SEARCH_DEFAULT_LIMIT} results
              </Show>
            </span>
            <button
              type='button'
              class='inline-flex h-9 items-center gap-1.5 rounded-md px-2 hover:bg-muted hover:text-foreground disabled:opacity-50'
              disabled={reindexMutation.isPending}
              onClick={() => reindexMutation.mutate('reconcile')}
            >
              <RefreshCw class={`size-3.5 ${reindexMutation.isPending ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type='button'
              class='h-9 rounded-md px-2 hover:bg-muted hover:text-foreground disabled:opacity-50'
              disabled={reindexMutation.isPending}
              onClick={() => {
                if (
                  window.confirm('Rebuild the complete file search index? This may take a while.')
                ) {
                  reindexMutation.mutate('full')
                }
              }}
            >
              Rebuild
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}
