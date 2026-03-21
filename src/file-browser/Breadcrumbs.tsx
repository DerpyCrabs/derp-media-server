import { cn } from '@/lib/utils'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import House from 'lucide-solid/icons/house'
import MoreHorizontal from 'lucide-solid/icons/more-horizontal'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

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
  | { id: string; kind: 'ellipsis-end' }

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
  const [showEllipsis, setShowEllipsis] = createSignal(false)
  const [isManuallyExpanded, setIsManuallyExpanded] = createSignal(false)
  const [wouldShowEllipsis, setWouldShowEllipsis] = createSignal(false)

  const effectiveVisible = createMemo(() => {
    const s = visibleIndices()
    const c = crumbs()
    if (s.size === 0 && c.length > 0) return new Set(c.map((_, i) => i))
    return s
  })

  const btnClass = (isCurrent: boolean) =>
    cn(
      'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

  createEffect(() => {
    crumbs()
    isManuallyExpanded()
    const container = containerEl()
    const measure = measureEl()
    if (!container || !measure) return

    const calculate = () => {
      const bc = crumbs()
      const expanded = isManuallyExpanded()
      if (!containerEl() || !measureEl() || bc.length <= 3) {
        setVisibleIndices(new Set(bc.map((_, i) => i)))
        setShowEllipsis(false)
        setWouldShowEllipsis(false)
        return
      }

      const availableWidth = container.clientWidth
      const computedStyle = window.getComputedStyle(container)
      const gap = parseFloat(computedStyle.gap) || 0

      const crumbElements = measure.children
      const crumbWidths: number[] = []
      for (let i = 0; i < crumbElements.length; i++) {
        crumbWidths.push((crumbElements[i] as HTMLElement).offsetWidth)
      }
      const ellipsisWidth = (crumbElements[crumbElements.length - 1] as HTMLElement).offsetWidth

      const calculateTotalWidth = (indices: number[]) => {
        const itemsWidth = indices.reduce((sum, idx) => sum + (crumbWidths[idx] || 0), 0)
        const gapsWidth = (indices.length - 1) * gap
        const safetyMargin = 10
        return itemsWidth + gapsWidth + safetyMargin
      }

      const allIndices = Array.from({ length: bc.length }, (_, i) => i)
      const totalWidth = calculateTotalWidth(allIndices)

      if (expanded) {
        setVisibleIndices(new Set(bc.map((_, i) => i)))
        setShowEllipsis(false)
        setWouldShowEllipsis(totalWidth > availableWidth)
        return
      }

      if (totalWidth <= availableWidth) {
        setVisibleIndices(new Set(allIndices))
        setShowEllipsis(false)
        setWouldShowEllipsis(false)
        setIsManuallyExpanded(false)
        return
      }

      const requiredIndices = [0, bc.length - 2, bc.length - 1]
      const visible = [...requiredIndices]

      for (let i = 1; i < bc.length - 2; i++) {
        const testIndices = [...visible, i].sort((a, b) => a - b)
        const testWidth = calculateTotalWidth(testIndices) + ellipsisWidth + gap
        if (testWidth <= availableWidth) {
          visible.push(i)
        } else {
          break
        }
      }

      visible.sort((a, b) => a - b)
      const allVisible = visible.length === bc.length
      setShowEllipsis(!allVisible)
      setWouldShowEllipsis(!allVisible)
      setVisibleIndices(new Set(visible))
    }

    calculate()
    const ro = new ResizeObserver(calculate)
    ro.observe(container)
    onCleanup(() => ro.disconnect())
  })

  const toggleEllipsis = () => setIsManuallyExpanded((v) => !v)

  const breadcrumbRows = createMemo((): BreadcrumbRow[] => {
    const list = crumbs()
    const vis = effectiveVisible()
    if (list.length === 0) return []

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
      if (showEllipsis() && index === list.length - 2) {
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

    if (isManuallyExpanded() && wouldShowEllipsis()) {
      rows.push({ id: 'ellipsis-end', kind: 'ellipsis-end' })
    }

    return rows
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
            <div class='flex items-center gap-2'>
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
        <div class='flex items-center gap-2'>
          <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
          <button type='button' class={ellipsisBtnClass()} disabled>
            <MoreHorizontal class='h-4 w-4 shrink-0' stroke-width={2} />
          </button>
        </div>
      </div>

      <div
        ref={setContainerEl}
        class='relative flex min-w-0 flex-1 flex-wrap items-center gap-1 lg:gap-2'
        aria-label='Breadcrumb'
      >
        <For each={breadcrumbRows()}>
          {(row) => {
            switch (row.kind) {
              case 'home':
                return (
                  <div class='flex items-center gap-2'>
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
                  <div class='flex items-center gap-2'>
                    <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
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
                  <div class='flex items-center gap-2'>
                    <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
                    <button
                      type='button'
                      class={ellipsisBtnClass()}
                      onClick={toggleEllipsis}
                      aria-label={
                        isManuallyExpanded() ? 'Collapse breadcrumbs' : 'Expand breadcrumbs'
                      }
                    >
                      <MoreHorizontal class='h-4 w-4 shrink-0' stroke-width={2} />
                    </button>
                  </div>
                )
              case 'ellipsis-end':
                return (
                  <div class='flex items-center gap-2'>
                    <ChevronRight class='h-4 w-4 shrink-0 text-muted-foreground' stroke-width={2} />
                    <button
                      type='button'
                      class={ellipsisBtnClass()}
                      onClick={toggleEllipsis}
                      title='Collapse breadcrumbs'
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
      </div>
    </>
  )
}
