import File from 'lucide-solid/icons/file'
import Folder from 'lucide-solid/icons/folder'
import Search from 'lucide-solid/icons/search'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createUniqueId, onCleanup, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import type { SearchHit } from './contracts'
import { createSearchController } from './solid-controller'
import { resourceIsBrowsable } from '@/lib/domain/resource'

export type SearchPaletteProps = {
  search: Parameters<typeof createSearchController>[0]
  title: string
  testId: string
  placeholder: string
  onClose: () => void
  onSelect: (result: SearchHit) => void
  chrome: {
    overlayClass: string
    dialogClass: string
    resultsClass: string
    dialogStyle?: JSX.CSSProperties
    toolbar?: JSX.Element
    resultCountLimit?: number
  }
  messages: {
    idle: JSX.Element
    empty: JSX.Element
    loading?: JSX.Element
    stateClass?: string
    loadingClass?: string
    loadingWithResults?: boolean
    showErrors?: boolean
  }
  result: {
    icon?: (result: SearchHit) => JSX.Element
    detail?: (result: SearchHit) => JSX.Element
    badge?: (result: SearchHit) => JSX.Element
  } & Partial<Record<'group' | 'kind' | 'path', (result: SearchHit) => string | undefined>>
}

export function SearchPalette(props: SearchPaletteProps) {
  const controller = createSearchController(props.search)
  const listId = createUniqueId()
  let dialogEl: HTMLDivElement | undefined
  let inputEl: HTMLInputElement | undefined
  const previousFocus = document.activeElement as HTMLElement | null
  const results = controller.results
  const stateClass = () =>
    props.messages.stateClass ??
    'flex min-h-44 items-center justify-center px-6 text-center text-sm text-muted-foreground'
  const visibleError = () => (props.messages.showErrors ? controller.error() : null)
  const mainStatus = (): readonly [JSX.Element, string] | undefined => {
    const className = stateClass()
    if (!controller.queryLongEnough()) return [props.messages.idle, className]
    if (controller.loading()) {
      return !props.messages.loadingWithResults && !results().length
        ? [props.messages.loading ?? 'Searching…', props.messages.loadingClass ?? className]
        : undefined
    }
    const error = visibleError()
    if (error) return [error.message, `${className} text-destructive`]
    if (!results().length) return [props.messages.empty, className]
  }

  function choose(result: SearchHit) {
    props.onSelect(result)
    props.onClose()
  }

  createEffect(() => {
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    queueMicrotask(() => inputEl?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        props.onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogEl) return
      const focusable = [
        ...dialogEl.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
      ].filter((element) => element.offsetParent !== null)
      const edge = event.shiftKey
        ? [focusable[0], focusable.at(-1)]
        : [focusable.at(-1), focusable[0]]
      if (!edge[0] || document.activeElement !== edge[0]) return
      event.preventDefault()
      edge[1]?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      document.body.style.overflow = oldOverflow
      document.removeEventListener('keydown', onKeyDown)
      queueMicrotask(() => previousFocus?.focus())
    })
  })

  return (
    <Portal mount={document.body}>
      <div
        class={props.chrome.overlayClass}
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
          data-testid={props.testId}
          class={`flex w-full flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-2xl ${props.chrome.dialogClass}`}
          style={props.chrome.dialogStyle}
        >
          <div class='flex items-center gap-2 border-b border-border px-3 py-2'>
            <Search class='size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
            <input
              ref={(element) => (inputEl = element)}
              type='text'
              role='combobox'
              aria-label={props.title}
              aria-expanded='true'
              aria-controls={listId}
              aria-activedescendant={
                results().length > 0 ? `${listId}-option-${controller.activeIndex()}` : undefined
              }
              autocomplete='off'
              placeholder={props.placeholder}
              class='h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground'
              value={controller.query()}
              onInput={(event) => controller.setQuery(event.currentTarget.value)}
              onKeyDown={(event) => controller.onKeyDown(event, choose)}
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

          {props.chrome.toolbar}

          <div
            id={listId}
            role='listbox'
            class={`flex-1 overflow-y-auto p-2 ${props.chrome.resultsClass}`}
          >
            <Show when={mainStatus()}>
              {(status) => <div class={status()[1]}>{status()[0]}</div>}
            </Show>
            <For each={results()}>
              {(result, index) => {
                const group = () => props.result.group?.(result)
                return (
                  <>
                    <Show
                      when={
                        group() &&
                        (index() === 0 || props.result.group?.(results()[index() - 1]!) !== group())
                      }
                    >
                      <p class='px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                        {group()}
                      </p>
                    </Show>
                    <button
                      id={`${listId}-option-${index()}`}
                      type='button'
                      role='option'
                      aria-selected={index() === controller.activeIndex()}
                      data-search-result-kind={props.result.kind?.(result)}
                      data-search-result-path={props.result.path?.(result)}
                      class={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none ${
                        index() === controller.activeIndex()
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-muted'
                      }`}
                      onPointerMove={() => controller.setActiveIndex(index())}
                      onClick={() => choose(result)}
                    >
                      <span class='shrink-0'>
                        {props.result.icon?.(result) ??
                          (result.resource && resourceIsBrowsable(result.resource) ? (
                            <Folder class='size-5 text-amber-500' aria-hidden='true' />
                          ) : (
                            <File class='size-5 text-muted-foreground' aria-hidden='true' />
                          ))}
                      </span>
                      <span class='min-w-0 flex-1'>
                        <span class='block truncate text-sm font-medium'>{result.title}</span>
                        <span class='block truncate text-xs text-muted-foreground'>
                          {props.result.detail?.(result) ?? result.detail ?? result.snippet ?? ''}
                        </span>
                      </span>
                      <Show when={props.result.badge?.(result)}>
                        {(badge) => (
                          <span class='max-w-28 truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                            {badge()}
                          </span>
                        )}
                      </Show>
                    </button>
                  </>
                )
              }}
            </For>
            <Show
              when={
                controller.queryLongEnough() &&
                controller.loading() &&
                props.messages.loadingWithResults
              }
            >
              <div class={props.messages.loadingClass ?? stateClass()}>
                {props.messages.loading ?? 'Searching…'}
              </div>
            </Show>
          </div>

          <Show when={props.chrome.resultCountLimit}>
            {(limit) => (
              <div class='flex min-h-12 items-center border-t border-border px-3 py-2 text-xs text-muted-foreground'>
                <span aria-live='polite'>
                  {results().length.toLocaleString()} results
                  <Show when={controller.response().truncated}> · First {limit()} results</Show>
                </span>
              </div>
            )}
          </Show>
        </div>
      </div>
    </Portal>
  )
}
