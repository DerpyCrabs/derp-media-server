import type { CanvasWindow } from '@/lib/infinite-canvas'
import { createSearchCoordinator } from '@/src/features/search/coordinator'
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchContributor,
  type SearchHit,
} from '@/src/features/search/contracts'
import { createSearchController } from '@/src/features/search/solid-controller'
import { applicationSearchCoordinator } from '@/src/integrations/search'
import { resourceSummaryIcon, type FileIconContext } from '@/src/lib/use-file-icon'
import Search from 'lucide-solid/icons/search'
import SquareStack from 'lucide-solid/icons/square-stack'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import { contentWindowKind } from '@/lib/content-window'
import { contentWindowFilesystemPath } from '@/src/integrations/current-window-content'

type SearchScope = 'all' | 'canvas' | 'library'

type Props = {
  windows: CanvasWindow[]
  fileIconContext: FileIconContext
  onClose: () => void
  onWindow: (id: string) => void
  onResult: (result: SearchHit) => void
}

function windowDetail(window: CanvasWindow): string {
  return (
    contentWindowFilesystemPath(window.definition) ??
    (contentWindowKind(window.definition) === 'browser' ? 'Library root' : '')
  )
}

export function CanvasSearchPalette(props: Props) {
  const [scope, setScope] = createSignal<SearchScope>('all')
  const libraryContributorIds = () =>
    applicationSearchCoordinator.contributors.map((contributor) => contributor.id)
  const canvasContributor: SearchContributor = {
    id: 'canvas.windows',
    label: 'Open windows',
    async search(request) {
      const query = request.query.toLowerCase()
      return {
        results: props.windows.flatMap((window) => {
          const detail = windowDetail(window)
          if (!`${window.definition.title} ${detail}`.toLowerCase().includes(query)) return []
          return [
            {
              id: window.id,
              title: window.definition.title,
              detail,
              group: 'Open windows',
              metadata: { windowId: window.id },
            },
          ]
        }),
      }
    },
    execute(result) {
      const windowId = result.metadata?.windowId
      if (typeof windowId === 'string') props.onWindow(windowId)
    },
  }
  const coordinator = createSearchCoordinator(() => [
    ...applicationSearchCoordinator.contributors,
    canvasContributor,
  ])
  const controller = createSearchController({
    coordinator,
    minimumQueryLength: 1,
    limit: SEARCH_DEFAULT_LIMIT,
    contributorIds: () =>
      scope() === 'canvas'
        ? [canvasContributor.id]
        : scope() === 'library'
          ? libraryContributorIds()
          : undefined,
  })
  let inputEl: HTMLInputElement | undefined
  let dialogEl: HTMLDivElement | undefined
  const previousFocus = document.activeElement as HTMLElement | null

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

  function choose(item: SearchHit) {
    if (item.resource) props.onResult(item)
    else void coordinator.execute(item)
    props.onClose()
  }

  function resultPath(item: SearchHit): string | undefined {
    const path = item.resource?.metadata?.logicalPath
    return typeof path === 'string' ? path : undefined
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
              value={controller.query()}
              onInput={(event) => controller.setQuery(event.currentTarget.value)}
              onKeyDown={(event) => controller.onKeyDown(event, choose)}
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
            <Show when={!controller.query().trim()}>
              <p class='flex min-h-48 items-center justify-center text-sm text-muted-foreground'>
                Search current canvas immediately. Type {SEARCH_MIN_QUERY_LENGTH} characters for
                library results.
              </p>
            </Show>
            <Show
              when={
                controller.query().trim() &&
                controller.results().length === 0 &&
                !controller.loading()
              }
            >
              <p class='flex min-h-48 items-center justify-center text-sm text-muted-foreground'>
                No matches.
              </p>
            </Show>
            <For each={controller.results()}>
              {(item, index) => {
                const group = () => item.group ?? item.contributorLabel
                return (
                  <>
                    <Show
                      when={
                        index() === 0 ||
                        (controller.results()[index() - 1]?.group ??
                          controller.results()[index() - 1]?.contributorLabel) !== group()
                      }
                    >
                      <p class='px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                        {group()}
                      </p>
                    </Show>
                    <button
                      type='button'
                      data-search-result-kind={item.resource ? 'file' : 'window'}
                      data-search-result-path={resultPath(item)}
                      class={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                        index() === controller.activeIndex()
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-muted'
                      }`}
                      onPointerMove={() => controller.setActiveIndex(index())}
                      onClick={() => choose(item)}
                    >
                      <Show when={!item.resource}>
                        <SquareStack class='size-5 shrink-0' />
                      </Show>
                      <Show when={item.resource}>
                        {(resource) => (
                          <span class='shrink-0'>
                            {resourceSummaryIcon(resource(), props.fileIconContext)}
                          </span>
                        )}
                      </Show>
                      <span class='min-w-0'>
                        <span class='block truncate text-sm font-medium'>{item.title}</span>
                        <span class='block truncate text-xs text-muted-foreground'>
                          {item.detail ?? item.snippet ?? ''}
                        </span>
                      </span>
                    </button>
                  </>
                )
              }}
            </For>
            <Show when={controller.loading()}>
              <p class='px-3 py-3 text-xs text-muted-foreground'>Searching…</p>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  )
}
