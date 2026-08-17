import type { FileItem } from '@/lib/files/types'
import type {
  FileColumnVisibility,
  FileSortField,
  FileSortOrder,
  SortDirection,
} from '@/lib/models/settings-types'
import { isVirtualFolderPath } from '@/lib/files/constants'

export const DEFAULT_FILE_SORT: FileSortOrder = { field: 'name', direction: 'asc' }
export const DEFAULT_FILE_COLUMNS: FileColumnVisibility = { createdDate: false, size: true }

const naturalNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function defaultDirection(field: FileSortField): SortDirection {
  return field === 'name' ? 'asc' : 'desc'
}

function compareNames(a: FileItem, b: FileItem): number {
  return naturalNameCollator.compare(a.name, b.name)
}

function compareOptionalNumbers(
  a: number | undefined,
  b: number | undefined,
  direction: SortDirection,
): number {
  const aMissing = a === undefined
  const bMissing = b === undefined
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0
    return aMissing ? 1 : -1
  }
  const result = a - b
  return direction === 'asc' ? result : -result
}

export function sortFileItems(files: FileItem[], order: FileSortOrder): FileItem[] {
  return [...files].sort((a, b) => {
    const virtualOrder = Number(Boolean(b.isVirtual)) - Number(Boolean(a.isVirtual))
    if (virtualOrder !== 0) return virtualOrder

    const directoryOrder = Number(b.isDirectory) - Number(a.isDirectory)
    if (directoryOrder !== 0) return directoryOrder

    let result = 0
    if (order.field === 'name') result = compareNames(a, b)
    if (order.field === 'size') {
      result = a.isDirectory ? 0 : compareOptionalNumbers(a.size, b.size, order.direction)
    }
    if (order.field === 'createdDate') {
      result = compareOptionalNumbers(a.createdDate, b.createdDate, order.direction)
    }

    if (result !== 0) {
      return order.field === 'name' && order.direction === 'desc' ? -result : result
    }
    return compareNames(a, b)
  })
}

export function sortFilesForPath(
  files: FileItem[],
  path: string,
  sortOrders?: Record<string, FileSortOrder>,
  sortingDisabled = false,
): FileItem[] {
  if (sortingDisabled || isVirtualFolderPath(path)) return files
  return sortFileItems(files, sortOrders?.[path] ?? DEFAULT_FILE_SORT)
}

const createdDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'short',
})

export function formatCreatedDate(value: number | undefined): string {
  return value === undefined ? '—' : createdDateFormatter.format(value)
}
