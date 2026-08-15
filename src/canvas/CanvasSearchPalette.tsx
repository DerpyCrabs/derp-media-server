import { api } from '@/lib/api/client'
import {
  FILE_SEARCH_DEFAULT_LIMIT,
  FILE_SEARCH_MIN_QUERY_LENGTH,
  fileSearchCodePointLength,
  fileSearchResultToFileItem,
  normalizeFileSearchText,
  type FileSearchResponse,
  type FileSearchResult,
} from '@/lib/files/file-search'
import type { CanvasWindow } from '@/canvas/model/infinite-canvas'
import { queryKeys } from '@/lib/api/query-keys'
import { fileItemIcon, type FileIconContext } from '@/features/explorer/use-file-icon'
import { useQuery } from '@tanstack/solid-query'
import Search from 'lucide-solid/icons/search'
import SquareStack from 'lucide-solid/icons/square-stack'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'

type CanvasSearchItem =
  | { kind: 'window'; id: string; title: string; detail: string }
  | { kind: 'file'; result: FileSearchResult; title: string; detail: string }

type SearchScope = 'all' | 'canvas' | 'library'

type Props = {
  windows: CanvasWindow[]
  fileIconContext: FileIconContext
  onClose: () => void
  onWindow: (id: string) => void
  onFile: (result: FileSearchResult) => void
}

function windowDetail(window: CanvasWindow): string {
  return window.definition.type === 'browser'
    ? (window.definition.initialState.dir ?? 'Library root')
    : (window.definition.initialState.viewing ?? '')
}

function libraryResultIcon(item: CanvasSearchItem, context: FileIconContext): JSX.Element | null {
  if (item.kind !== 'file') return null
  return fileItemIcon(fileSearchResultToFileItem(item.result), context)
}

export function CanvasSearchPalette(props: Props) {
  const [query, setQuery] = createSignal('')
  const [debounced, setDebounced] = createSignal('')
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [scope, setScope] = createSignal<SearchScope>('all')
  let inputEl: HTMLInputElement | undefined
  let dialogEl: HTMLDivElement | undefined
  const previousFocus = document.activeElement as HTMLElement | null

  createEffect(() => {
    const value = query()
    const timer = window.setTimeout(() => setDebounced(value.trim()), 120)
    onCleanup(() => window.clearTimeout(timer))
  })

  const normalized = createMemo(() => normalizeFileSearchText(debounced()))
  const localMatches = createMemo(() => {
    const needle = normalized()
    if (!needle) return [] as CanvasSearchItem[]
    const windows: CanvasSearchItem[] =
      scope() === 'library'
        ? []
        : props.windows
            .filter((window) =>
              normalizeFileSearchText(
                `${window.definition.title} ${windowDetail(window)}`,
              ).includes(needle),
            )
            .map((window) => ({
              kind: 'window',
              id: window.id,
              title: window.definition.title,
              detail: windowDetail(window),
            }))
    return windows
  })

  const canSearchFiles = createMemo(
    () =>
      scope() !== 'canvas' &&
      fileSearchCodePointLength(normalized()) >= FILE_SEARCH_MIN_QUERY_LENGTH,
  )
  const fileQuery = useQuery(() => ({
    queryKey: queryKeys.fileSearch(normalized()),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api<FileSearchResponse>(
        `/api/files/search?q=${encodeURIComponent(debounced())}&limit=${FILE_SEARCH_DEFAULT_LIMIT}`,
        { signal },
      ),
    enabled: canSearchFiles(),
    staleTime: 0,
    gcTime: 30_000,
  }))
  const fileMatches = createMemo((): CanvasSearchItem[] => {
    const needle = normalized()
    return [...(fileQuery.data?.results ?? [])]
      .sort((a, b) => {
        const aName = normalizeFileSearchText(a.name)
        const bName = normalizeFileSearchText(b.name)
        const score = (name: string) =>
          name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3
        return score(aName) - score(bName) || a.path.split('/').length - b.path.split('/').length
      })
      .map((result) => ({
        kind: 'file',
        result,
        title: result.name,
        detail: result.parentPath || result.rootName,
      }))
  })
  const items = createMemo(() => [...localMatches(), ...fileMatches()])

  createEffect(() => {
    void normalized()
    setActiveIndex(0)
  })

  createEffect(() => {
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    queueMicrotask(() => inputEl?.focus())
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogEl) return
      const focusable = [
        ...dialogEl.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
      ].filter((element) => element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', close)
    onCleanup(() => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', close)
      queueMicrotask(() => previousFocus?.focus())
    })
  })

  function choose(item: CanvasSearchItem) {
    if (item.kind === 'window') props.onWindow(item.id)
    else props.onFile(item.result)
    props.onClose()
  }

  function onKeyDown(event: KeyboardEvent) {
    const all = items()
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (all.length) setActiveIndex((index) => (index + 1) % all.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (all.length) setActiveIndex((index) => (index - 1 + all.length) % all.length)
    } else if (event.key === 'Enter') {
      const item = all[activeIndex()]
      if (!item) return
      event.preventDefault()
      choose(item)
    }
  }

  return (
    <Portal mount={document.body}>
      <div
        class='fixed inset-0 z-[1100000] flex items-start justify-center bg-black/55 px-4 pt-[10vh]'
        onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}
      >
        <div
          ref={(element) => (dialogEl = element)}
          role='dialog'
          aria-modal='true'
          aria-label='Search canvas and library'
          data-testid='canvas-search-palette'
          class='flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl'
          style={{ 'max-height': 'min(480px, calc(100vh - 96px))' }}
        >
          <div class='flex items-center gap-2 border-b border-border px-3 py-2'>
            <Search class='size-5 text-muted-foreground' />
            <input
              ref={(element) => (inputEl = element)}
              aria-label='Search canvas and library'
              class='h-11 min-w-0 flex-1 bg-transparent text-base outline-none'
              placeholder='Search windows, files and folders…'
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <button
              type='button'
              class='inline-flex size-10 items-center justify-center rounded-md hover:bg-muted'
              aria-label='Close search'
              onClick={props.onClose}
            >
              <X class='size-5' />
            </button>
          </div>
          <div class='flex gap-1 border-b border-border px-3 py-2'>
            <For
              each={
                [
                  ['all', 'All'],
                  ['canvas', 'Canvas'],
                  ['library', 'Library'],
                ] as Array<[SearchScope, string]>
              }
            >
              {([value, label]) => (
                <button
                  type='button'
                  class='rounded-full px-3 py-1 text-xs hover:bg-muted'
                  classList={{ 'bg-primary text-primary-foreground': scope() === value }}
                  onClick={() => setScope(value)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
          <div class='min-h-52 flex-1 overflow-y-auto p-2'>
            <Show when={!normalized()}>
              <p class='flex min-h-48 items-center justify-center text-sm text-muted-foreground'>
                Search current canvas immediately. Type {FILE_SEARCH_MIN_QUERY_LENGTH} characters
                for library results.
              </p>
            </Show>
            <Show when={normalized() && items().length === 0 && !fileQuery.isFetching}>
              <p class='flex min-h-48 items-center justify-center text-sm text-muted-foreground'>
                No matches.
              </p>
            </Show>
            <For each={items()}>
              {(item, index) => (
                <>
                  <Show when={index() === 0 || items()[index() - 1]?.kind !== item.kind}>
                    <p class='px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                      {item.kind === 'window' ? 'Open windows' : 'Library'}
                    </p>
                  </Show>
                  <button
                    type='button'
                    data-search-result-kind={item.kind}
                    data-search-result-path={item.kind === 'file' ? item.result.path : undefined}
                    class={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                      index() === activeIndex()
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted'
                    }`}
                    onPointerMove={() => setActiveIndex(index())}
                    onClick={() => choose(item)}
                  >
                    <Show when={item.kind === 'window'}>
                      <SquareStack class='size-5 shrink-0' />
                    </Show>
                    <Show when={item.kind === 'file'}>
                      <span class='shrink-0'>{libraryResultIcon(item, props.fileIconContext)}</span>
                    </Show>
                    <span class='min-w-0'>
                      <span class='block truncate text-sm font-medium'>{item.title}</span>
                      <span class='block truncate text-xs text-muted-foreground'>
                        {item.detail}
                      </span>
                    </span>
                  </button>
                </>
              )}
            </For>
            <Show when={fileQuery.isFetching}>
              <p class='px-3 py-3 text-xs text-muted-foreground'>Searching library…</p>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  )
}
