import { queryCache } from '@/lib/api/cache'
import { settingsQuery } from '@/lib/api/queries'
import type {
  FileColumnVisibility,
  FileColumnScope,
  FileSortOrder,
  GlobalSettings,
} from '@/lib/models/settings-types'
import type { FileOperationSnapshot } from './file-browser-mutations'
import { DEFAULT_FILE_COLUMNS, DEFAULT_FILE_SORT } from './file-display-settings'
export function fileDisplaySettings(
  path: string,
  settings: GlobalSettings | undefined,
  scope: FileColumnScope,
  operations: FileOperationSnapshot,
) {
  const sort = settings?.sortOrders?.[path] ?? DEFAULT_FILE_SORT
  const columns = settings?.fileColumns?.[scope] ?? DEFAULT_FILE_COLUMNS[scope]
  return {
    sortOrder: sort,
    fileColumns: columns,
    setSortOrder: (next: FileSortOrder) => {
      queryCache.updateQueryData(settingsQuery, true, (current) => ({
        ...current,
        sortOrders: { ...current.sortOrders, [path]: next },
      }))
      void operations.sort.run({ path, sortOrder: next })
    },
    setFileColumns: (next: FileColumnVisibility) => {
      queryCache.updateQueryData(settingsQuery, true, (current) => ({
        ...current,
        fileColumns: { ...current.fileColumns, [scope]: next },
      }))
      void operations.columns.run({ scope, columns: next })
    },
  }
}
