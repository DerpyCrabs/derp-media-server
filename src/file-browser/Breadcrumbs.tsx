import {
  breadcrumbFloating,
  clearCompactPathOpenOnly,
  setBreadcrumbCompactPathOpen,
  setBreadcrumbFolderMenu,
} from '@/lib/breadcrumb-floating-store'
import { cn } from '@/lib/utils'
import { FloatingContextMenu } from './FloatingContextMenu'
import ChevronDown from 'lucide-solid/icons/chevron-down'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import House from 'lucide-solid/icons/house'
import MoreHorizontal from 'lucide-solid/icons/more-horizontal'
import type { Accessor } from 'solid-js'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

type PathMenuEntry = { name: string; path: string; originIndex: number }

type BreadcrumbsProps = {
  currentPath: string
  onNavigate: (path: string) => void
  mode?: 'MediaServer' | 'Workspace'
  onCrumbContextMenu?: (
    e: MouseEvent,
    info: { navigatePath: string; displayName: string; isHome: boolean },
  ) => void
}

type BreadcrumbRow =
  | { id: string; kind: 'home'; path: string; name: string; isLast: boolean }
  | { id: string; kind: 'crumb'; path: string; name: string; isLast: boolean }
  | { id: string; kind: 'ellipsis-inline' }

export function Breadcrumbs(props: BreadcrumbsProps) {
  const isWorkspace = () => (props.mode ?? 'MediaServer') === 'Workspace'

  const crumbs = createMemo(() => {
    const parts = props.currentPath ? props.currentPath.split(/[/\\]/).filter(Boolean) : []
    return [
      { name: 'Home', path: '' },
      ...parts.map((part, index) => ({
        name: part,
        path: parts.slice(0, index + 1).join('/'),
      })),
    ]
  })

  const [containerEl, setContainerEl] = createSignal<HTMLDivElement | null>(null)
  const [measureEl, setMeasureEl] = createSignal<HTMLDivElement | null>(null)
  const [visibleIndices, setVisibleIndices] = createSignal<Set<number>>(new Set())
  const [showPathEllipsis, setShowPathEllipsis] = createSignal(false)
  /** When true, inline trail is Home > … > current (parent folder not in the bar). */
  const [ellipsisSkipsParent, setEllipsisSkipsParent] = createSignal(false)
  const [compactPathOnly, setCompactPathOnly] = createSignal(false)
  const [pathPickerButtonEl, setPathPickerButtonEl] = createSignal<HTMLButtonElement | null>(null)
  const [inlinePathMenuOpen, setInlinePathMenuOpen] = createSignal(false)
  const [ellipsisMenuAnchorEl, setEllipsisMenuAnchorEl] = createSignal<HTMLButtonElement | null>(
    null,
  )

  const effectiveVisible = createMemo(() => {
    const s = visibleIndices()
    const c = crumbs()
    if (s.size === 0 && c.length > 0) return new Set(c.map((_, i) => i))
    return s
  })

  const fullPathMenuEntries = createMemo((): PathMenuEntry[] =>
    crumbs().map((crumb, i) => ({ name: crumb.name, path: crumb.path, originIndex: i })),
  )

  const hiddenInlinePathMenuEntries = createMemo((): PathMenuEntry[] => {
    const list = crumbs()
    const vis = effectiveVisible()
    const out: PathMenuEntry[] = []
    for (let i = 0; i < list.length; i++) {
      if (!vis.has(i)) out.push({ name: list[i].name, path: list[i].path, originIndex: i })
    }
    return out
  })

  const btnClass = (isCurrent: boolean) =>
    cn(
      'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isWorkspace() ? 'h-7 px-2 text-xs gap-1' : 'h-8 px-2.5 text-sm gap-1.5',
      isCurrent
        ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
        : 'text-foreground hover:bg-accent hover:text-accent-foreground',
    )

  const ellipsisBtnClass = () =>
    cn(
      'inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isWorkspace() ? 'h-7 px-2' : 'h-8 px-2.5',
      'text-foreground hover:bg-accent hover:text-accent-foreground',
    )

  const compactPathPickerBtnClass = () =>
    cn(
      'inline-flex w-full max-w-full min-w-0 shrink items-center justify-between gap-2 rounded-md border border-border bg-muted/40 font-medium text-foreground shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      isWorkspace() ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm',
      'hover:bg-muted hover:text-foreground',
    )

  createEffect(() => {
    crumbs()
    const container = containerEl()
    const measure = measureEl()
    if (!container || !measure) return

    const layoutObserverTarget = () => {
      const el = containerEl()
      if (!el) return el
      const slot = el.parentElement
      return slot?.hasAttribute('data-breadcrumb-slot') ? slot : el
    }

    const calculate = () => {
      const bc = crumbs()
      if (!containerEl() || !measureEl()) return

      if (bc.length === 0) {
        setVisibleIndices(new Set<number>())
        setShowPathEllipsis(false)
        setEllipsisSkipsParent(false)
        setCompactPathOnly(false)
        return
      }

      const layoutEl = layoutObserverTarget()
      const barEl = containerEl()
      if (!layoutEl || !barEl) return
      const availableWidth = layoutEl.clientWidth
      const gap = parseFloat(window.getComputedStyle(barEl).gap) || 0
      const safetyMargin = 10

      const crumbElements = measure.children
      const nCrumbs = bc.length
      const crumbWidths: number[] = []
      for (let i = 0; i < nCrumbs; i++) {
        crumbWidths.push((crumbElements[i] as HTMLElement).offsetWidth)
      }
      const ellipsisWidth = (crumbElements[nCrumbs] as HTMLElement).offsetWidth

      const rowTotalFor = (sortedIndices: number[], ellip: boolean) => {
        const itemsWidth = sortedIndices.reduce((sum, idx) => sum + (crumbWidths[idx] || 0), 0)
        const gapsWidth = Math.max(0, sortedIndices.length - 1) * gap
        const ellipExtra = ellip ? ellipsisWidth + gap : 0
        return itemsWidth + gapsWidth + ellipExtra + safetyMargin
      }

      const allIndices = bc.map((_, i) => i)

      const n = bc.length

      if (n === 1) {
        setVisibleIndices(new Set([0]))
        setShowPathEllipsis(false)
        setEllipsisSkipsParent(false)
        setCompactPathOnly(false)
        return
      }

      if (n === 2) {
        if (rowTotalFor([0, 1], false) <= availableWidth) {
          setVisibleIndices(new Set([0, 1]))
          setShowPathEllipsis(false)
          setEllipsisSkipsParent(false)
          setCompactPathOnly(false)
        } else {
          setVisibleIndices(new Set([1]))
          setShowPathEllipsis(false)
          setEllipsisSkipsParent(false)
          setCompactPathOnly(true)
        }
        return
      }

      if (n === 3) {
        if (rowTotalFor([0, 1, 2], false) <= availableWidth) {
          setVisibleIndices(new Set([0, 1, 2]))
          setShowPathEllipsis(false)
          setEllipsisSkipsParent(false)
          setCompactPathOnly(false)
        } else {
          setVisibleIndices(new Set([2]))
          setShowPathEllipsis(false)
          setEllipsisSkipsParent(false)
          setCompactPathOnly(true)
        }
        return
      }

      if (rowTotalFor(allIndices, false) <= availableWidth) {
        setVisibleIndices(new Set(allIndices))
        setShowPathEllipsis(false)
        setEllipsisSkipsParent(false)
        setCompactPathOnly(false)
        return
      }

      const tail = [0, n - 2, n - 1] as number[]
      if (rowTotalFor(tail, true) <= availableWidth) {
        setVisibleIndices(new Set(tail))
        setShowPathEllipsis(true)
        setEllipsisSkipsParent(false)
        setCompactPathOnly(false)
        return
      }

      const homeCurrent = [0, n - 1] as number[]
      if (rowTotalFor(homeCurrent, true) <= availableWidth) {
        setVisibleIndices(new Set(homeCurrent))
        setShowPathEllipsis(true)
        setEllipsisSkipsParent(true)
        setCompactPathOnly(false)
        return
      }

      setVisibleIndices(new Set([n - 1]))
      setShowPathEllipsis(false)
      setEllipsisSkipsParent(false)
      setCompactPathOnly(true)
    }

    calculate()
    const ro = new ResizeObserver(calculate)
    const observeEl = layoutObserverTarget() ?? container
    ro.observe(observeEl)
    onCleanup(() => ro.disconnect())
  })

  createEffect(() => {
    if (!compactPathOnly()) {
      clearCompactPathOpenOnly()
    }
  })

  const [prevCompactLayout, setPrevCompactLayout] = createSignal<boolean | undefined>(undefined)
  createEffect(() => {
    const c = compactPathOnly()
    const p = prevCompactLayout()
    if (p !== undefined && p !== c) {
      setBreadcrumbFolderMenu(null)
      setInlinePathMenuOpen(false)
    }
    setPrevCompactLayout(c)
  })

  createEffect(() => {
    if (!showPathEllipsis() || compactPathOnly()) setInlinePathMenuOpen(false)
  })

  const PathMenuItems = (menu: { onAfterPick: () => void; entries: Accessor<PathMenuEntry[]> }) => (
    <For each={menu.entries()}>
      {(entry) => (
        <button
          type='button'
          role='menuitem'
          data-breadcrumb-segment={entry.originIndex === 0 ? 'home' : 'crumb'}
          data-breadcrumb-path={entry.path}
          class={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
            entry.originIndex === crumbs().length - 1 && 'bg-accent/50 font-medium',
          )}
          onClick={() => {
            props.onNavigate(entry.path)
            menu.onAfterPick()
          }}
          onContextMenu={(e) => {
            if (!props.onCrumbContextMenu) return
            e.preventDefault()
            e.stopPropagation()
            props.onCrumbContextMenu(e, {
              navigatePath: entry.path,
              displayName: entry.name,
              isHome: entry.originIndex === 0,
            })
          }}
        >
          <Show when={entry.originIndex === 0}>
            <House class='h-4 w-4 shrink-0' stroke-width={2} />
          </Show>
          <span class='min-w-0 flex-1 whitespace-normal break-words text-left'>{entry.name}</span>
        </button>
      )}
    </For>
  )

  const breadcrumbRows = createMemo((): BreadcrumbRow[] => {
    if (compactPathOnly()) return []

    const list = crumbs()
    const vis = effectiveVisible()
    if (list.length === 0) return []

    if (ellipsisSkipsParent()) {
      const last = list[list.length - 1]
      return [
        {
          id: 'home',
          kind: 'home',
          path: list[0].path,
          name: list[0].name,
          isLast: false,
        },
        { id: 'ellipsis-inline', kind: 'ellipsis-inline' },
        {
          id: `crumb-${last.path}`,
          kind: 'crumb',
          path: last.path,
          name: last.name,
          isLast: true,
        },
      ]
    }

    const rows: BreadcrumbRow[] = [
      {
        id: 'home',
        kind: 'home',
        path: list[0].path,
        name: list[0].name,
        isLast: list.length === 1,
      },
    ]

    for (let index = 1; index < list.length; index++) {
      const crumb = list[index]
      if (showPathEllipsis() && index === list.length - 2) {
        const hasHiddenCrumbs = !vis.has(index - 1)
        if (hasHiddenCrumbs) {
          rows.push({ id: 'ellipsis-inline', kind: 'ellipsis-inline' })
          rows.push({
            id: `crumb-${crumb.path}`,
            kind: 'crumb',
            path: crumb.path,
            name: crumb.name,
            isLast: index === list.length - 1,
          })
          continue
        }
      }
      if (vis.has(index)) {
        rows.push({
          id: `crumb-${crumb.path}`,
          kind: 'crumb',
          path: crumb.path,
          name: crumb.name,
          isLast: index === list.length - 1,
        })
      }
    }

    return rows
  })

  const currentCrumb = createMemo(() => {
    const c = crumbs()
    return c[c.length - 1]
  })

  return (
    <>
      <div
        ref={setMeasureEl}
        class='pointer-events-none absolute left-0 top-0 flex items-center gap-1 lg:gap-2'
        style={{ visibility: 'hidden' }}
        aria-hidden='true'
      >
        <For each={crumbs()}>
          {(crumb, index) => (
            <div class='flex shrink-0 items-center gap-2'>
              <Show when={index() > 0}>
                <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
              </Show>
              <button type='button' class={btnClass(index() === crumbs().length - 1)} disabled>
                <Show when={index() === 0}>
                  <House class='h-4 w-4 shrink-0' stroke-width={2} />
                </Show>
                {crumb.name}
              </button>
            </div>
          )}
        </For>
        <div class='flex shrink-0 items-center gap-2'>
          <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
          <button type='button' class={ellipsisBtnClass()} disabled>
            <MoreHorizontal class='h-4 w-4 shrink-0' stroke-width={2} />
          </button>
        </div>
      </div>

      <Show
        when={compactPathOnly()}
        fallback={
          <div
            ref={setContainerEl}
            data-testid='breadcrumb-bar'
            data-breadcrumb-layout='inline'
            data-breadcrumb-path-ellipsis={showPathEllipsis() ? '' : undefined}
            class='relative flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden lg:gap-2'
            aria-label='Breadcrumb'
          >
            <For each={breadcrumbRows()}>
              {(row) => {
                switch (row.kind) {
                  case 'home':
                    return (
                      <div class='flex shrink-0 items-center gap-2'>
                        <button
                          type='button'
                          data-breadcrumb-segment='home'
                          data-breadcrumb-path=''
                          class={btnClass(row.isLast)}
                          onClick={() => props.onNavigate(row.path)}
                          onContextMenu={(e) => {
                            if (!props.onCrumbContextMenu) return
                            e.preventDefault()
                            e.stopPropagation()
                            props.onCrumbContextMenu(e, {
                              navigatePath: row.path,
                              displayName: row.name,
                              isHome: true,
                            })
                          }}
                        >
                          <House class='h-4 w-4 shrink-0' stroke-width={2} />
                          {row.name}
                        </button>
                      </div>
                    )
                  case 'crumb':
                    return (
                      <div class='flex shrink-0 items-center gap-2'>
                        <ChevronRight
                          class='h-4 w-4 shrink-0 text-muted-foreground'
                          stroke-width={2}
                        />
                        <button
                          type='button'
                          data-breadcrumb-segment='crumb'
                          data-breadcrumb-path={row.path}
                          class={btnClass(row.isLast)}
                          onClick={() => props.onNavigate(row.path)}
                          onContextMenu={(e) => {
                            if (!props.onCrumbContextMenu) return
                            e.preventDefault()
                            e.stopPropagation()
                            props.onCrumbContextMenu(e, {
                              navigatePath: row.path,
                              displayName: row.name,
                              isHome: false,
                            })
                          }}
                        >
                          {row.name}
                        </button>
                      </div>
                    )
                  case 'ellipsis-inline':
                    return (
                      <div class='flex shrink-0 items-center gap-2'>
                        <ChevronRight
                          class='h-4 w-4 shrink-0 text-muted-foreground'
                          stroke-width={2}
                        />
                        <button
                          type='button'
                          ref={setEllipsisMenuAnchorEl}
                          data-testid='breadcrumb-ellipsis'
                          class={ellipsisBtnClass()}
                          aria-expanded={inlinePathMenuOpen()}
                          aria-haspopup='menu'
                          aria-label='Show hidden path segments'
                          onClick={() => {
                            if (inlinePathMenuOpen()) setInlinePathMenuOpen(false)
                            else setInlinePathMenuOpen(true)
                          }}
                        >
                          <MoreHorizontal class='h-4 w-4 shrink-0' stroke-width={2} />
                        </button>
                      </div>
                    )
                  default:
                    return null
                }
              }}
            </For>
            <FloatingContextMenu
              open={inlinePathMenuOpen}
              anchorRef={ellipsisMenuAnchorEl}
              onDismiss={() => setInlinePathMenuOpen(false)}
              dismissIgnoreInsideSelector=':is([data-slot="breadcrumb-context-menu"], [data-breadcrumb-folder-menu])'
              dismissIgnoreSelectorActive={() => breadcrumbFloating.folderMenu != null}
              data-testid='breadcrumb-path-menu'
              class='ring-foreground/10 max-h-64 overflow-y-auto ring-1'
            >
              <PathMenuItems
                onAfterPick={() => setInlinePathMenuOpen(false)}
                entries={hiddenInlinePathMenuEntries}
              />
            </FloatingContextMenu>
          </div>
        }
      >
        <div
          ref={setContainerEl}
          data-testid='breadcrumb-bar'
          data-breadcrumb-layout='compact'
          class='relative flex min-w-0 flex-1 items-center gap-1 lg:gap-2'
          aria-label='Breadcrumb'
        >
          <div class='relative min-w-0 flex-1'>
            <button
              type='button'
              ref={setPathPickerButtonEl}
              data-breadcrumb-segment='path-picker'
              data-breadcrumb-path={currentCrumb().path}
              class={compactPathPickerBtnClass()}
              aria-expanded={breadcrumbFloating.compactPathOpen}
              aria-haspopup='menu'
              title={currentCrumb().name}
              onClick={() => {
                if (breadcrumbFloating.compactPathOpen) setBreadcrumbCompactPathOpen(false)
                else setBreadcrumbCompactPathOpen(true)
              }}
            >
              <span class='min-w-0 whitespace-normal text-left break-words'>
                {currentCrumb().name}
              </span>
              <ChevronDown class='h-4 w-4 shrink-0 opacity-70' stroke-width={2} />
            </button>
            <FloatingContextMenu
              open={() => breadcrumbFloating.compactPathOpen}
              anchorRef={pathPickerButtonEl}
              onDismiss={() => setBreadcrumbCompactPathOpen(false)}
              dismissIgnoreInsideSelector=':is([data-slot="breadcrumb-context-menu"], [data-breadcrumb-folder-menu])'
              dismissIgnoreSelectorActive={() => breadcrumbFloating.folderMenu != null}
              data-testid='breadcrumb-path-menu'
              class='ring-foreground/10 max-h-64 overflow-y-auto ring-1'
            >
              <PathMenuItems
                onAfterPick={() => setBreadcrumbCompactPathOpen(false)}
                entries={fullPathMenuEntries}
              />
            </FloatingContextMenu>
          </div>
        </div>
      </Show>
    </>
  )
}
