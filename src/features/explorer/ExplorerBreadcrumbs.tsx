import { FloatingContextMenu } from '@/src/file-browser/FloatingContextMenu'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import House from 'lucide-solid/icons/house'
import MoreHorizontal from 'lucide-solid/icons/more-horizontal'
import type { Accessor } from 'solid-js'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { ExplorerBreadcrumb, ExplorerLocation } from './types'

type BreadcrumbRow<TPayload> =
  | Readonly<{ kind: 'crumb'; crumb: ExplorerBreadcrumb<TPayload>; index: number }>
  | Readonly<{ kind: 'ellipsis' }>

export type ExplorerBreadcrumbsProps<TPayload> = Readonly<{
  breadcrumbs: Accessor<readonly ExplorerBreadcrumb<TPayload>[]>
  displayMode?: 'MediaServer' | 'Workspace'
  domValue?: (location: ExplorerLocation) => string | undefined
  onNavigate(location: ExplorerLocation): void
  onContextMenu?(event: MouseEvent, breadcrumb: ExplorerBreadcrumb<TPayload>): void
}>

export function ExplorerBreadcrumbs<TPayload>(props: ExplorerBreadcrumbsProps<TPayload>) {
  const [container, setContainer] = createSignal<HTMLDivElement | null>(null)
  const [measure, setMeasure] = createSignal<HTMLDivElement | null>(null)
  const [visibleIndices, setVisibleIndices] = createSignal<ReadonlySet<number>>(new Set())
  const [showEllipsis, setShowEllipsis] = createSignal(false)
  const [ellipsisSkipsParent, setEllipsisSkipsParent] = createSignal(false)
  const [compact, setCompact] = createSignal(false)
  const [pathMenuOpen, setPathMenuOpen] = createSignal(false)
  const [pathMenuAnchor, setPathMenuAnchor] = createSignal<HTMLButtonElement | null>(null)

  const isWorkspace = () => props.displayMode === 'Workspace'
  const crumbs = props.breadcrumbs
  const effectiveVisible = createMemo(() => {
    const current = visibleIndices()
    if (current.size > 0) return current
    return new Set(crumbs().map((_, index) => index))
  })
  const currentCrumb = createMemo(() => crumbs().at(-1))
  const hiddenCrumbs = createMemo(() =>
    crumbs()
      .map((crumb, index) => ({ crumb, index }))
      .filter(({ index }) => !effectiveVisible().has(index)),
  )
  const allCrumbs = createMemo(() => crumbs().map((crumb, index) => ({ crumb, index })))

  const crumbClass = (current: boolean) =>
    `inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
      isWorkspace() ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm'
    } ${
      current
        ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
        : 'text-foreground hover:bg-accent hover:text-accent-foreground'
    }`

  const ellipsisClass = () =>
    `inline-flex shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
      isWorkspace() ? 'h-7 px-2' : 'h-8 px-2.5'
    }`

  createEffect(() => {
    props.breadcrumbs()
    const bar = container()
    const measuring = measure()
    if (!bar || !measuring) return

    const layoutTarget = () => {
      const current = container()
      if (!current) return null
      const parent = current.parentElement
      return parent?.hasAttribute('data-breadcrumb-slot') ? parent : current
    }
    const calculate = () => {
      const values = props.breadcrumbs()
      const target = layoutTarget()
      const measuringNow = measure()
      if (!target || !measuringNow || values.length === 0) return
      const available = target.clientWidth
      const gap = parseFloat(window.getComputedStyle(bar).gap) || 0
      const widths = values.map(
        (_, index) => (measuringNow.children[index] as HTMLElement | undefined)?.offsetWidth ?? 0,
      )
      const ellipsisWidth =
        (measuringNow.children[values.length] as HTMLElement | undefined)?.offsetWidth ?? 0
      const total = (indices: readonly number[], withEllipsis: boolean) =>
        indices.reduce((sum, index) => sum + widths[index]!, 0) +
        Math.max(0, indices.length - 1) * gap +
        (withEllipsis ? ellipsisWidth + gap : 0) +
        10
      const all = values.map((_, index) => index)
      const last = values.length - 1

      if (values.length === 1 || total(all, false) <= available) {
        setVisibleIndices(new Set(all))
        setShowEllipsis(false)
        setEllipsisSkipsParent(false)
        setCompact(false)
      } else if (values.length <= 3) {
        setVisibleIndices(new Set([last]))
        setShowEllipsis(false)
        setEllipsisSkipsParent(false)
        setCompact(true)
      } else if (total([0, last - 1, last], true) <= available) {
        setVisibleIndices(new Set([0, last - 1, last]))
        setShowEllipsis(true)
        setEllipsisSkipsParent(false)
        setCompact(false)
      } else if (total([0, last], true) <= available) {
        setVisibleIndices(new Set([0, last]))
        setShowEllipsis(true)
        setEllipsisSkipsParent(true)
        setCompact(false)
      } else {
        setVisibleIndices(new Set([last]))
        setShowEllipsis(false)
        setEllipsisSkipsParent(false)
        setCompact(true)
      }
    }

    calculate()
    const observer = new ResizeObserver(calculate)
    const target = layoutTarget()
    if (target) observer.observe(target)
    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    if (!showEllipsis() && !compact()) setPathMenuOpen(false)
  })

  const rows = createMemo((): readonly BreadcrumbRow<TPayload>[] => {
    const values = props.breadcrumbs()
    if (compact() || values.length === 0) return []
    if (!showEllipsis()) {
      return values
        .map((crumb, index) => ({ kind: 'crumb' as const, crumb, index }))
        .filter(({ index }) => effectiveVisible().has(index))
    }
    const last = values.length - 1
    return ellipsisSkipsParent()
      ? [
          { kind: 'crumb', crumb: values[0]!, index: 0 },
          { kind: 'ellipsis' },
          { kind: 'crumb', crumb: values[last]!, index: last },
        ]
      : [
          { kind: 'crumb', crumb: values[0]!, index: 0 },
          { kind: 'ellipsis' },
          { kind: 'crumb', crumb: values[last - 1]!, index: last - 1 },
          { kind: 'crumb', crumb: values[last]!, index: last },
        ]
  })

  const menuItems = (
    entries: Accessor<readonly { crumb: ExplorerBreadcrumb<TPayload>; index: number }[]>,
  ) => (
    <For each={entries()}>
      {({ crumb, index }) => (
        <button
          type='button'
          role='menuitem'
          data-breadcrumb-path={props.domValue?.(crumb.location)}
          class='flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground'
          onClick={() => {
            setPathMenuOpen(false)
            props.onNavigate(crumb.location)
          }}
          onContextMenu={(event) => {
            if (!props.onContextMenu || !crumb.item) return
            event.preventDefault()
            event.stopPropagation()
            setPathMenuOpen(false)
            props.onContextMenu(event, crumb)
          }}
        >
          <Show when={index === 0}>
            <House class='h-4 w-4 shrink-0' />
          </Show>
          <span class='min-w-0 flex-1 whitespace-normal break-words text-left'>
            {index === 0 ? 'Home' : crumb.name}
          </span>
        </button>
      )}
    </For>
  )

  return (
    <>
      <div
        ref={setMeasure}
        class='pointer-events-none absolute top-0 left-0 flex items-center gap-1 lg:gap-2'
        style={{ visibility: 'hidden' }}
        aria-hidden='true'
      >
        <For each={props.breadcrumbs()}>
          {(crumb, index) => (
            <div class='flex shrink-0 items-center gap-2'>
              <Show when={index() > 0}>
                <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' />
              </Show>
              <button
                type='button'
                class={crumbClass(index() === props.breadcrumbs().length - 1)}
                disabled
              >
                {index() === 0 ? 'Home' : crumb.name}
              </button>
            </div>
          )}
        </For>
        <div class='flex shrink-0 items-center gap-2'>
          <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' />
          <button type='button' class={ellipsisClass()} disabled>
            <MoreHorizontal class='h-4 w-4' />
          </button>
        </div>
      </div>

      <Show
        when={!compact()}
        fallback={
          <div
            ref={setContainer}
            data-testid='breadcrumb-bar'
            data-breadcrumb-layout='compact'
            class='relative flex min-w-0 flex-1 items-center'
            aria-label='Breadcrumb'
          >
            <button
              ref={setPathMenuAnchor}
              type='button'
              data-breadcrumb-segment='path-picker'
              data-breadcrumb-path={
                currentCrumb() ? props.domValue?.(currentCrumb()!.location) : undefined
              }
              class={`inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-muted/40 font-medium text-foreground ${
                isWorkspace() ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm'
              }`}
              aria-haspopup='menu'
              aria-expanded={pathMenuOpen()}
              onClick={() => setPathMenuOpen((open) => !open)}
            >
              <span class='min-w-0 flex-1 truncate text-left'>
                {currentCrumb()?.name ?? 'Home'}
              </span>
              <ChevronDown class='h-4 w-4 shrink-0 opacity-70' />
            </button>
          </div>
        }
      >
        <div
          ref={setContainer}
          data-testid='breadcrumb-bar'
          data-breadcrumb-layout='inline'
          data-breadcrumb-path-ellipsis={showEllipsis() ? '' : undefined}
          class='relative flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden lg:gap-2'
          aria-label='Breadcrumb'
        >
          <For each={rows()}>
            {(row) => (
              <Show
                when={row.kind === 'crumb' ? row : null}
                fallback={
                  <div class='flex shrink-0 items-center gap-2'>
                    <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' />
                    <button
                      ref={setPathMenuAnchor}
                      type='button'
                      data-testid='breadcrumb-ellipsis'
                      class={ellipsisClass()}
                      aria-label='Show hidden path segments'
                      aria-haspopup='menu'
                      aria-expanded={pathMenuOpen()}
                      onClick={() => setPathMenuOpen((open) => !open)}
                    >
                      <MoreHorizontal class='h-4 w-4' />
                    </button>
                  </div>
                }
                keyed
              >
                {(entry) => (
                  <div class='flex shrink-0 items-center gap-2'>
                    <Show when={entry.index > 0}>
                      <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' />
                    </Show>
                    <button
                      type='button'
                      data-breadcrumb-path={props.domValue?.(entry.crumb.location)}
                      class={crumbClass(entry.index === props.breadcrumbs().length - 1)}
                      aria-label={entry.index === 0 ? 'Home' : entry.crumb.name}
                      onClick={() => props.onNavigate(entry.crumb.location)}
                      onContextMenu={(event) => {
                        if (!props.onContextMenu || !entry.crumb.item) return
                        event.preventDefault()
                        event.stopPropagation()
                        props.onContextMenu(event, entry.crumb)
                      }}
                    >
                      <Show when={entry.index === 0}>
                        <House class='h-4 w-4 shrink-0' />
                      </Show>
                      {entry.index === 0 ? 'Home' : entry.crumb.name}
                    </button>
                  </div>
                )}
              </Show>
            )}
          </For>
        </div>
      </Show>

      <FloatingContextMenu
        open={pathMenuOpen}
        anchorRef={pathMenuAnchor}
        onDismiss={() => setPathMenuOpen(false)}
        data-testid='breadcrumb-path-menu'
        class='max-h-64 overflow-y-auto ring-1 ring-foreground/10'
      >
        {menuItems(() => (compact() ? allCrumbs() : hiddenCrumbs()))}
      </FloatingContextMenu>
    </>
  )
}
