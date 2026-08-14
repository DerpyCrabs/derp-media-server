import type { ExplorerItem, ExplorerVisibleRange } from './types'

export const EXPLORER_VIRTUALIZATION_THRESHOLD = 100
export const EXPLORER_VIRTUALIZATION_OVERSCAN = 8
export const EXPLORER_GRID_GAP_PX = 12
export const EXPLORER_GRID_MIN_ITEM_WIDTH_PX = 128
export const EXPLORER_GRID_MAX_COLUMNS = 6

type IndexedVirtualRow = Readonly<{ index: number }>

export function shouldVirtualizeExplorerItems(
  itemCount: number,
  threshold = EXPLORER_VIRTUALIZATION_THRESHOLD,
): boolean {
  return itemCount > threshold
}

export function explorerItemKey<TPayload>(
  items: readonly ExplorerItem<TPayload>[],
  index: number,
): string {
  return items[index]?.key ?? `missing-explorer-item:${index}`
}

export function explorerGridRowKey<TPayload>(
  items: readonly ExplorerItem<TPayload>[],
  rowIndex: number,
  columnCount: number,
): string {
  return explorerItemKey(items, rowIndex * Math.max(1, columnCount))
}

export function calculateExplorerGridColumns(
  width: number,
  options: Readonly<{
    gap?: number
    minItemWidth?: number
    maxColumns?: number
  }> = {},
): number {
  const gap = options.gap ?? EXPLORER_GRID_GAP_PX
  const minItemWidth = options.minItemWidth ?? EXPLORER_GRID_MIN_ITEM_WIDTH_PX
  const maxColumns = options.maxColumns ?? EXPLORER_GRID_MAX_COLUMNS
  if (!Number.isFinite(width) || width <= 0) return 1
  return Math.max(
    1,
    Math.min(maxColumns, Math.floor((width + gap) / (Math.max(1, minItemWidth) + gap))),
  )
}

export function explorerVisibleItemRange(
  virtualRows: readonly IndexedVirtualRow[],
  itemCount: number,
  columnCount = 1,
): ExplorerVisibleRange | undefined {
  const first = virtualRows[0]
  const last = virtualRows[virtualRows.length - 1]
  if (!first || !last || itemCount <= 0) return undefined

  const columns = Math.max(1, columnCount)
  return {
    startIndex: Math.min(itemCount - 1, first.index * columns),
    endIndex: Math.min(itemCount - 1, (last.index + 1) * columns - 1),
  }
}
