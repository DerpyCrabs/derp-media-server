import { component, view, domBinding, observe, list } from 'effectweb'
import {
  breadcrumbFloating,
  clearCompactPathOpenOnly,
  setBreadcrumbCompactPathOpen,
  setBreadcrumbFolderMenu,
} from '@/features/explorer/breadcrumb-floating-store'
import { cn } from '@/lib/ui/cn'
import { FloatingContextMenu } from './FloatingContextMenu'
import ChevronDown from '@effectweb/lucide/icons/chevron-down'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import House from '@effectweb/lucide/icons/house'
import MoreHorizontal from '@effectweb/lucide/icons/more-horizontal'
type PathMenuEntry = { name: string; path: string; originIndex: number }
type BreadcrumbsProps = {
  currentPath: string
  homeLabel?: string
  onNavigate: (path: string) => void
  compact?: boolean
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
type LayoutBinding = {
  crumbs: readonly { path: string; name: string }[]
  commitLayout: (
    visible: Set<number>,
    ellipsis: boolean,
    skipsParent: boolean,
    compactOnly: boolean,
  ) => void
}
const breadcrumbLayout = (element: HTMLDivElement, current: () => LayoutBinding) => {
  const calculate = () => {
    const value = current()
    const bc = value.crumbs
    const commitLayout = value.commitLayout
    const container = element.querySelector<HTMLDivElement>('[data-testid="breadcrumb-bar"]')
    const measure = element.querySelector<HTMLDivElement>('[data-breadcrumb-measure]')
    if (!container || !measure) return
    const layoutObserverTarget = () => {
      const slot = element.parentElement
      return slot?.hasAttribute('data-breadcrumb-slot') ? slot : container
    }
    if (bc.length === 0) {
      commitLayout(new Set<number>(), false, false, false)
      return
    }
    const layoutEl = layoutObserverTarget()
    const barEl = container
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
      commitLayout(new Set([0]), false, false, false)
      return
    }
    if (n === 2) {
      if (rowTotalFor([0, 1], false) <= availableWidth) {
        commitLayout(new Set([0, 1]), false, false, false)
      } else {
        commitLayout(new Set([1]), false, false, true)
      }
      return
    }
    if (n === 3) {
      if (rowTotalFor([0, 1, 2], false) <= availableWidth) {
        commitLayout(new Set([0, 1, 2]), false, false, false)
      } else {
        commitLayout(new Set([2]), false, false, true)
      }
      return
    }
    if (rowTotalFor(allIndices, false) <= availableWidth) {
      commitLayout(new Set(allIndices), false, false, false)
      return
    }
    const tail = [0, n - 2, n - 1] as number[]
    if (rowTotalFor(tail, true) <= availableWidth) {
      commitLayout(new Set(tail), true, false, false)
      return
    }
    const homeCurrent = [0, n - 1] as number[]
    if (rowTotalFor(homeCurrent, true) <= availableWidth) {
      commitLayout(new Set(homeCurrent), true, true, false)
      return
    }
    commitLayout(new Set([n - 1]), false, false, true)
  }
  let frame = 0
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(calculate)
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(element.parentElement ?? element)
  schedule()
  return {
    update: schedule,
    dispose: () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    },
  }
}
const BreadcrumbsContent = component(
  {
    init: (
      _props: BreadcrumbsProps & { floating: { compactPathOpen: boolean; folderMenu: unknown } },
    ) => ({
      visibleIndices: new Set() as Set<number>,
      pathEllipsisVisible: false,
      ellipsisSkipsParent: false,
      compactPathOnly: false,
      pathPickerButtonEl: null as HTMLButtonElement | null,
      inlinePathMenuOpen: false,
      ellipsisMenuAnchorEl: null as HTMLButtonElement | null,
    }),
  },
  view((local, patch) => {
    const props = local.props
    const visibleIndices = () => local.visibleIndices,
      setVisibleIndices = (value: Set<number>) => patch({ visibleIndices: value })
    const pathEllipsisVisible = () => local.pathEllipsisVisible,
      setPathEllipsis = (value: boolean) => patch({ pathEllipsisVisible: value })
    const ellipsisSkipsParent = () => local.ellipsisSkipsParent,
      setEllipsisSkipsParent = (value: boolean) => patch({ ellipsisSkipsParent: value })
    const compactPathOnly = () => local.compactPathOnly,
      setCompactPathOnly = (value: boolean) => patch({ compactPathOnly: value })
    const pathPickerButtonEl = () => local.pathPickerButtonEl,
      setPathPickerButtonEl = (value: HTMLButtonElement | null) =>
        patch({ pathPickerButtonEl: value })
    const inlinePathMenuOpen = () => local.inlinePathMenuOpen,
      setInlinePathMenuOpen = (value: boolean) => patch({ inlinePathMenuOpen: value })
    const ellipsisMenuAnchorEl = () => local.ellipsisMenuAnchorEl,
      setEllipsisMenuAnchorEl = (value: HTMLButtonElement | null) =>
        patch({ ellipsisMenuAnchorEl: value })
    const compact = () => props.compact === true || props.mode === 'Workspace'
    const crumbs = () => {
      const parts = props.currentPath ? props.currentPath.split(/[/\\]/).filter(Boolean) : []
      return [
        { name: props.homeLabel ?? 'Home', path: '' },
        ...parts.map((part, index) => ({ name: part, path: parts.slice(0, index + 1).join('/') })),
      ]
    }
    function commitLayout(
      visible: Set<number>,
      ellipsis: boolean,
      skipsParent: boolean,
      compactOnly: boolean,
    ) {
      if (
        compactOnly === compactPathOnly() &&
        ellipsis === pathEllipsisVisible() &&
        skipsParent === ellipsisSkipsParent() &&
        visible.size === visibleIndices().size &&
        [...visible].every((index) => visibleIndices().has(index))
      )
        return
      if (compactPathOnly() !== compactOnly) setBreadcrumbFolderMenu(null)
      if (!compactOnly) clearCompactPathOpenOnly()
      if (!ellipsis || compactOnly) setInlinePathMenuOpen(false)
      setVisibleIndices(visible)
      setPathEllipsis(ellipsis)
      setEllipsisSkipsParent(skipsParent)
      setCompactPathOnly(compactOnly)
    }
    const effectiveVisible = () => {
      const s = visibleIndices()
      const c = crumbs()
      if (s.size === 0 && c.length > 0) return new Set(c.map((_, i) => i))
      return s
    }
    const fullPathMenuEntries = (): PathMenuEntry[] =>
      crumbs().map((crumb, i) => ({ name: crumb.name, path: crumb.path, originIndex: i }))
    const hiddenInlinePathMenuEntries = (): PathMenuEntry[] => {
      const list = crumbs()
      const vis = effectiveVisible()
      const out: PathMenuEntry[] = []
      for (let i = 0; i < list.length; i++) {
        if (!vis.has(i)) out.push({ name: list[i].name, path: list[i].path, originIndex: i })
      }
      return out
    }
    const btnClass = (isCurrent: boolean) =>
      cn(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact() ? 'h-7 px-2 text-xs gap-1' : 'h-8 px-2.5 text-sm gap-1.5',
        isCurrent
          ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
          : 'text-foreground hover:bg-accent hover:text-accent-foreground',
      )
    const ellipsisBtnClass = () =>
      cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact() ? 'h-7 px-2' : 'h-8 px-2.5',
        'text-foreground hover:bg-accent hover:text-accent-foreground',
      )
    const compactPathPickerBtnClass = () =>
      cn(
        'inline-flex w-full max-w-full min-w-0 shrink items-center justify-between gap-2 rounded-md border border-border bg-muted/40 font-medium text-foreground shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact() ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-sm',
        'hover:bg-muted hover:text-foreground',
      )
    const PathMenuItems = (menu: { onAfterPick: () => void; entries: readonly PathMenuEntry[] }) =>
      list(
        menu.entries,
        (entry) => entry.path,
        (entry) => (
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
            {entry.originIndex === 0 ? <House class='h-4 w-4 shrink-0' stroke-width={2} /> : null}
            <span class='min-w-0 flex-1 whitespace-normal break-words text-left'>{entry.name}</span>
          </button>
        ),
      )
    const breadcrumbRows = (): BreadcrumbRow[] => {
      if (compactPathOnly()) return []
      const list = crumbs()
      const vis = effectiveVisible()
      if (list.length === 0) return []
      if (ellipsisSkipsParent()) {
        const last = list[list.length - 1]
        return [
          { id: 'home', kind: 'home', path: list[0].path, name: list[0].name, isLast: false },
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
        if (pathEllipsisVisible() && index === list.length - 2) {
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
    }
    const currentCrumb = () => {
      const c = crumbs()
      return c[c.length - 1]
    }
    return (
      <div class='contents' use={domBinding({ crumbs: crumbs(), commitLayout }, breadcrumbLayout)}>
        <div
          data-breadcrumb-measure
          class='pointer-events-none absolute left-0 top-0 flex items-center gap-1 lg:gap-2'
          style={{ visibility: 'hidden' }}
          aria-hidden='true'
        >
          {list(
            crumbs(),
            (crumb) => crumb.path,
            (crumb, index) => (
              <div class='flex shrink-0 items-center gap-2'>
                {index > 0 ? (
                  <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
                ) : null}
                <button type='button' class={btnClass(index === crumbs().length - 1)} disabled>
                  {index === 0 ? <House class='h-4 w-4 shrink-0' stroke-width={2} /> : null}
                  {crumb.name}
                </button>
              </div>
            ),
          )}
          <div class='flex shrink-0 items-center gap-2'>
            <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
            <button type='button' class={ellipsisBtnClass()} disabled>
              <MoreHorizontal class='h-4 w-4 shrink-0' stroke-width={2} />
            </button>
          </div>
        </div>

        {compactPathOnly() ? (
          <div
            data-testid='breadcrumb-bar'
            data-breadcrumb-layout='compact'
            class='relative flex min-w-0 flex-1 items-center gap-1 lg:gap-2'
            aria-label='Breadcrumb'
          >
            <div class='relative min-w-0 flex-1'>
              <button
                type='button'
                data-breadcrumb-segment='path-picker'
                data-breadcrumb-path={currentCrumb().path}
                class={compactPathPickerBtnClass()}
                aria-expanded={props.floating.compactPathOpen ? 'true' : 'false'}
                aria-haspopup='menu'
                title={currentCrumb().name}
                onClick={(event) => {
                  setPathPickerButtonEl(event.currentTarget)
                  if (props.floating.compactPathOpen) setBreadcrumbCompactPathOpen(false)
                  else setBreadcrumbCompactPathOpen(true)
                }}
              >
                <span class='min-w-0 flex-1 truncate text-left'>{currentCrumb().name}</span>
                <ChevronDown class='h-4 w-4 shrink-0 opacity-70' stroke-width={2} />
              </button>
              <FloatingContextMenu
                open={props.floating.compactPathOpen}
                anchorRef={pathPickerButtonEl()}
                onDismiss={() => setBreadcrumbCompactPathOpen(false)}
                dismissIgnoreInsideSelector=':is([data-slot="breadcrumb-context-menu"], [data-breadcrumb-folder-menu])'
                dismissIgnoreSelectorActive={props.floating.folderMenu != null}
                data-testid='breadcrumb-path-menu'
                class='ring-foreground/10 max-h-64 overflow-y-auto ring-1'
              >
                {PathMenuItems({
                  onAfterPick: () => setBreadcrumbCompactPathOpen(false),
                  entries: fullPathMenuEntries(),
                })}
              </FloatingContextMenu>
            </div>
          </div>
        ) : (
          <div
            data-testid='breadcrumb-bar'
            data-breadcrumb-layout='inline'
            data-breadcrumb-path-ellipsis={pathEllipsisVisible() ? '' : undefined}
            class='relative flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden lg:gap-2'
            aria-label='Breadcrumb'
          >
            {list(
              breadcrumbRows(),
              (row) => row.id,
              (row) => {
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
                          data-testid='breadcrumb-ellipsis'
                          class={ellipsisBtnClass()}
                          aria-expanded={inlinePathMenuOpen() ? 'true' : 'false'}
                          aria-haspopup='menu'
                          aria-label='Show hidden path segments'
                          onClick={(event) => {
                            setEllipsisMenuAnchorEl(event.currentTarget)
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
              },
            )}
            <FloatingContextMenu
              open={inlinePathMenuOpen()}
              anchorRef={ellipsisMenuAnchorEl()}
              onDismiss={() => setInlinePathMenuOpen(false)}
              dismissIgnoreInsideSelector=':is([data-slot="breadcrumb-context-menu"], [data-breadcrumb-folder-menu])'
              dismissIgnoreSelectorActive={props.floating.folderMenu != null}
              data-testid='breadcrumb-path-menu'
              class='ring-foreground/10 max-h-64 overflow-y-auto ring-1'
            >
              {PathMenuItems({
                onAfterPick: () => setInlinePathMenuOpen(false),
                entries: hiddenInlinePathMenuEntries(),
              })}
            </FloatingContextMenu>
          </div>
        )}
      </div>
    )
  }),
)
export const Breadcrumbs = view<BreadcrumbsProps>((props) =>
  observe(breadcrumbFloating.source, (floating) => (
    <BreadcrumbsContent {...props} floating={floating} />
  )),
)
