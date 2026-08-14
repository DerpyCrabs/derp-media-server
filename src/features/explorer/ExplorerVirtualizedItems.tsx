import { cn } from '@/lib/utils'
import {
  createVirtualizer,
  createWindowVirtualizer,
  type VirtualItem,
} from '@tanstack/solid-virtual'
import type { Accessor, JSX } from 'solid-js'
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { ExplorerItem, ExplorerViewMode, ExplorerVisibleRange } from './types'
import {
  calculateExplorerGridColumns,
  EXPLORER_GRID_GAP_PX,
  EXPLORER_GRID_MAX_COLUMNS,
  EXPLORER_GRID_MIN_ITEM_WIDTH_PX,
  EXPLORER_VIRTUALIZATION_OVERSCAN,
  EXPLORER_VIRTUALIZATION_THRESHOLD,
  explorerGridRowKey,
  explorerItemKey,
  explorerVisibleItemRange,
  shouldVirtualizeExplorerItems,
} from './virtualization'

export type ExplorerVirtualizedItemsProps<TPayload = unknown> = {
  items: Accessor<readonly ExplorerItem<TPayload>[]>
  viewMode: Accessor<ExplorerViewMode>
  getScrollElement: () => HTMLElement | undefined | null
  scrollMode?: 'contained' | 'window'
  renderListRow: (item: ExplorerItem<TPayload>, index: number) => JSX.Element
  renderGridItem: (item: ExplorerItem<TPayload>, index: number) => JSX.Element
  renderListHeader?: () => JSX.Element
  onVisibleRange?: (range: ExplorerVisibleRange) => void
  threshold?: number
  overscan?: number
  estimateListRowSize?: number
  estimateGridRowSize?: (itemWidth: number) => number
  gridGap?: number
  gridMinItemWidth?: number
  gridMaxColumns?: number
  listColumnCount?: number
  listWrapperClass?: string
  listClass?: string
  listBodyClass?: string
  gridClass?: string
}

function VirtualListRow<TPayload>(props: {
  row: VirtualItem
  items: Accessor<readonly ExplorerItem<TPayload>[]>
  render: (item: ExplorerItem<TPayload>, index: number) => JSX.Element
}) {
  return (
    <Show keyed when={props.items()[props.row.index]}>
      {(item) => props.render(item, props.row.index)}
    </Show>
  )
}

function VirtualGridRow<TPayload>(props: {
  row: VirtualItem
  columns: Accessor<number>
  items: Accessor<readonly ExplorerItem<TPayload>[]>
  gap: Accessor<number>
  offset: (row: VirtualItem) => number
  render: (item: ExplorerItem<TPayload>, index: number) => JSX.Element
}) {
  const rowItems = createMemo(() => {
    const start = props.row.index * props.columns()
    return props
      .items()
      .slice(start, start + props.columns())
      .map((item, index) => ({
        absoluteIndex: start + index,
        item,
      }))
  })

  return (
    <div
      data-index={props.row.index}
      style={{
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        transform: `translateY(${props.offset(props.row)}px)`,
        display: 'grid',
        'grid-template-columns': `repeat(${props.columns()}, minmax(0, 1fr))`,
        gap: `${props.gap()}px`,
      }}
    >
      <For each={rowItems()}>{(entry) => props.render(entry.item, entry.absoluteIndex)}</For>
    </div>
  )
}

export function ExplorerVirtualizedItems<TPayload = unknown>(
  props: ExplorerVirtualizedItemsProps<TPayload>,
) {
  let gridElement: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  const [gridWidth, setGridWidth] = createSignal(0)
  const gap = () => props.gridGap ?? EXPLORER_GRID_GAP_PX
  const columns = createMemo(() =>
    calculateExplorerGridColumns(gridWidth(), {
      gap: gap(),
      minItemWidth: props.gridMinItemWidth ?? EXPLORER_GRID_MIN_ITEM_WIDTH_PX,
      maxColumns: props.gridMaxColumns ?? EXPLORER_GRID_MAX_COLUMNS,
    }),
  )
  const gridItemWidth = createMemo(() => {
    const width = gridWidth()
    const count = columns()
    if (width <= 0) return props.gridMinItemWidth ?? EXPLORER_GRID_MIN_ITEM_WIDTH_PX
    return Math.max(1, (width - gap() * Math.max(0, count - 1)) / count)
  })
  const gridRowSize = createMemo(
    () =>
      props.estimateGridRowSize?.(gridItemWidth()) ??
      Math.ceil(gridItemWidth() * (9 / 16) + 76 + gap()),
  )
  const unitCount = createMemo(() =>
    props.viewMode() === 'list'
      ? props.items().length
      : Math.ceil(props.items().length / columns()),
  )
  const useWindowScroll = () => props.scrollMode === 'window'
  const elementVirtualizer = createVirtualizer<HTMLElement, HTMLElement>({
    get count() {
      return useWindowScroll() ? 0 : unitCount()
    },
    getScrollElement: () => props.getScrollElement() ?? null,
    get estimateSize() {
      const size = props.viewMode() === 'list' ? (props.estimateListRowSize ?? 44) : gridRowSize()
      return () => size
    },
    get getItemKey() {
      const items = props.items()
      const columnCount = columns()
      const mode = props.viewMode()
      return (index: number) =>
        mode === 'list'
          ? explorerItemKey(items, index)
          : explorerGridRowKey(items, index, columnCount)
    },
    get overscan() {
      return props.overscan ?? EXPLORER_VIRTUALIZATION_OVERSCAN
    },
  })
  const windowVirtualizer = createWindowVirtualizer<HTMLElement>({
    get count() {
      return useWindowScroll() ? unitCount() : 0
    },
    get estimateSize() {
      const size = props.viewMode() === 'list' ? (props.estimateListRowSize ?? 44) : gridRowSize()
      return () => size
    },
    get getItemKey() {
      const items = props.items()
      const columnCount = columns()
      const mode = props.viewMode()
      return (index: number) =>
        mode === 'list'
          ? explorerItemKey(items, index)
          : explorerGridRowKey(items, index, columnCount)
    },
    get overscan() {
      return props.overscan ?? EXPLORER_VIRTUALIZATION_OVERSCAN
    },
  })
  const virtualizer = () => (useWindowScroll() ? windowVirtualizer : elementVirtualizer)

  function updateGridWidth() {
    if (gridElement) setGridWidth(gridElement.getBoundingClientRect().width)
  }

  function setGridElement(element: HTMLDivElement) {
    gridElement = element
    updateGridWidth()
    resizeObserver?.observe(element)
  }

  onMount(() => {
    updateGridWidth()
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateGridWidth)
      if (gridElement) resizeObserver.observe(gridElement)
    }
    window.addEventListener('resize', updateGridWidth)
    onCleanup(() => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateGridWidth)
    })
  })

  let previousVisibleRange = ''
  createEffect(() => {
    const callback = props.onVisibleRange
    if (!callback) return
    const range = explorerVisibleItemRange(
      virtualizer().getVirtualItems(),
      props.items().length,
      props.viewMode() === 'grid' ? columns() : 1,
    )
    if (!range) return
    const rangeKey = `${range.startIndex}:${range.endIndex}`
    if (rangeKey === previousVisibleRange) return
    previousVisibleRange = rangeKey
    callback(range)
  })

  const shouldVirtualize = () =>
    shouldVirtualizeExplorerItems(
      props.items().length,
      props.threshold ?? EXPLORER_VIRTUALIZATION_THRESHOLD,
    )

  function topPadding() {
    const first = virtualizer().getVirtualItems()[0]
    return first ? Math.max(0, first.start) : 0
  }

  function bottomPadding() {
    const rows = virtualizer().getVirtualItems()
    const last = rows[rows.length - 1]
    return last ? Math.max(0, virtualizer().getTotalSize() - last.end) : 0
  }

  const unvirtualizedListRows = () => (
    <For each={props.items()}>{(item, index) => props.renderListRow(item, index())}</For>
  )

  const virtualizedListRows = () => (
    <Show when={virtualizer().getVirtualItems().length > 0} fallback={unvirtualizedListRows()}>
      <Show when={topPadding() > 0}>
        <tr aria-hidden='true'>
          <td
            colSpan={props.listColumnCount ?? 1}
            style={{ height: `${topPadding()}px`, padding: '0' }}
          />
        </tr>
      </Show>
      <For each={virtualizer().getVirtualItems()}>
        {(row) => <VirtualListRow row={row} items={props.items} render={props.renderListRow} />}
      </For>
      <Show when={bottomPadding() > 0}>
        <tr aria-hidden='true'>
          <td
            colSpan={props.listColumnCount ?? 1}
            style={{ height: `${bottomPadding()}px`, padding: '0' }}
          />
        </tr>
      </Show>
    </Show>
  )

  const list = () => (
    <div class={props.listWrapperClass}>
      <table class={cn('w-full table-fixed caption-bottom text-sm', props.listClass)}>
        {props.renderListHeader?.()}
        <tbody class={cn('[&_tr:last-child]:border-0', props.listBodyClass)}>
          <Show when={shouldVirtualize()} fallback={unvirtualizedListRows()}>
            {virtualizedListRows()}
          </Show>
        </tbody>
      </table>
    </div>
  )

  const unvirtualizedGrid = () => (
    <For each={props.items()}>{(item, index) => props.renderGridItem(item, index())}</For>
  )

  const grid = () => (
    <Show
      when={shouldVirtualize()}
      fallback={
        <div ref={setGridElement} class={cn('file-browser-grid gap-3 p-3', props.gridClass)}>
          {unvirtualizedGrid()}
        </div>
      }
    >
      <div
        ref={setGridElement}
        class={cn('file-browser-grid gap-3 p-3', props.gridClass)}
        style={{
          display: 'block',
          position: 'relative',
          height: `${virtualizer().getTotalSize()}px`,
        }}
      >
        <Show when={virtualizer().getVirtualItems().length > 0} fallback={unvirtualizedGrid()}>
          <For each={virtualizer().getVirtualItems()}>
            {(row) => (
              <VirtualGridRow
                row={row}
                columns={columns}
                items={props.items}
                gap={gap}
                offset={(item) => item.start}
                render={props.renderGridItem}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  )

  return (
    <Show when={props.viewMode() === 'list'} fallback={grid()}>
      {list()}
    </Show>
  )
}
