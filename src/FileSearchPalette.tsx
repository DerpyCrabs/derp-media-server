import File from 'lucide-solid/icons/file'
import FileSearch from 'lucide-solid/icons/file-search'
import Folder from 'lucide-solid/icons/folder'
import Search from 'lucide-solid/icons/search'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createSignal, createUniqueId, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchHit,
} from './features/search/contracts'
import { createSearchController } from './features/search/solid-controller'
import { applicationSearchCoordinator } from './integrations/search'

export type FileSearchButtonProps = {
  title: string
  onSelect: (result: SearchHit) => void
  disabled?: boolean
  class?: string
  iconClass?: string
  testId?: string
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
  onSelect: (result: SearchHit) => void
}) {
  const listId = createUniqueId()
  const controller = createSearchController({
    coordinator: applicationSearchCoordinator,
    minimumQueryLength: SEARCH_MIN_QUERY_LENGTH,
    limit: SEARCH_DEFAULT_LIMIT,
  })
  let dialogEl: HTMLDivElement | undefined
  let inputEl: HTMLInputElement | undefined
  const previousFocus = document.activeElement as HTMLElement | null

  const results = controller.results

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

  function choose(result: SearchHit) {
    props.onSelect(result)
    props.onClose()
  }

  function onInputKeyDown(event: KeyboardEvent) {
    controller.onKeyDown(event, choose)
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
              type='text'
              role='combobox'
              aria-expanded='true'
              aria-controls={listId}
              aria-activedescendant={
                results().length > 0 ? `${listId}-option-${controller.activeIndex()}` : undefined
              }
              autocomplete='off'
              placeholder='Search files and folders…'
              class='h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground'
              value={controller.query()}
              onInput={(event) => controller.setQuery(event.currentTarget.value)}
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
            <Show when={!controller.queryLongEnough()}>
              <div class='flex min-h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground'>
                Type at least {SEARCH_MIN_QUERY_LENGTH} characters to search every media directory.
              </div>
            </Show>
            <Show
              when={controller.queryLongEnough() && controller.loading() && results().length === 0}
            >
              <div class='flex min-h-44 items-center justify-center text-sm text-muted-foreground'>
                Searching…
              </div>
            </Show>
            <Show when={controller.queryLongEnough() && controller.error()}>
              <div class='flex min-h-44 items-center justify-center px-6 text-center text-sm text-destructive'>
                {controller.error()?.message ?? 'Search failed'}
              </div>
            </Show>
            <Show
              when={
                controller.queryLongEnough() &&
                !controller.loading() &&
                !controller.error() &&
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
                  aria-selected={index() === controller.activeIndex()}
                  class={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none ${
                    index() === controller.activeIndex()
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted'
                  }`}
                  onPointerMove={() => controller.setActiveIndex(index())}
                  onClick={() => choose(result)}
                >
                  <Show
                    when={result.resource?.capabilities.includes('browse')}
                    fallback={
                      <File class='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
                    }
                  >
                    <Folder class='size-5 shrink-0 text-amber-500' aria-hidden='true' />
                  </Show>
                  <span class='min-w-0 flex-1'>
                    <span class='block truncate text-sm font-medium'>{result.title}</span>
                    <span class='block truncate text-xs text-muted-foreground'>
                      {result.detail ?? result.snippet ?? result.contributorLabel}
                    </span>
                  </span>
                  <span class='max-w-28 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                    {result.group ?? result.contributorLabel}
                  </span>
                </button>
              )}
            </For>
          </div>

          <div class='flex min-h-12 items-center border-t border-border px-3 py-2 text-xs text-muted-foreground'>
            <span aria-live='polite'>
              {results().length.toLocaleString()} results
              <Show when={controller.response().truncated}>
                {' '}
                · First {SEARCH_DEFAULT_LIMIT} results
              </Show>
            </span>
          </div>
        </div>
      </div>
    </Portal>
  )
}
