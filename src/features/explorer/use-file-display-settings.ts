import { useMutation, useQueryClient } from '@tanstack/solid-query'
import type { Accessor } from 'solid-js'
import { createMemo } from 'solid-js'
import { queryKeys } from '@/lib/api/query-keys'
import type {
  FileColumnVisibility,
  FileSortOrder,
  GlobalSettings,
} from '@/lib/models/settings-types'
import { persistFileColumns, persistFileSortOrder } from './file-display-persistence'
import type { useExplorerSettings } from './use-explorer-settings'
import { DEFAULT_FILE_COLUMNS, DEFAULT_FILE_SORT } from './file-display-settings'

type ExplorerSettingsQuery = ReturnType<typeof useExplorerSettings>['settingsQuery']

export function useFileDisplaySettings(
  path: Accessor<string>,
  settingsQuery: ExplorerSettingsQuery,
) {
  const queryClient = useQueryClient()

  const sortOrder = createMemo(() => settingsQuery.data?.sortOrders?.[path()] ?? DEFAULT_FILE_SORT)
  const fileColumns = createMemo(() => settingsQuery.data?.fileColumns ?? DEFAULT_FILE_COLUMNS)

  const sortOrderMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; sortOrder: FileSortOrder }) =>
      persistFileSortOrder(vars.path, vars.sortOrder),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const fileColumnsMutation = useMutation(() => ({
    mutationFn: persistFileColumns,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  function setSortOrder(next: FileSortOrder) {
    const folderPath = path()
    queryClient.setQueryData(queryKeys.settings(), (current: GlobalSettings | undefined) =>
      current
        ? { ...current, sortOrders: { ...(current.sortOrders ?? {}), [folderPath]: next } }
        : current,
    )
    sortOrderMutation.mutate({ path: folderPath, sortOrder: next })
  }

  function setFileColumns(next: FileColumnVisibility) {
    queryClient.setQueryData(queryKeys.settings(), (current: GlobalSettings | undefined) =>
      current ? { ...current, fileColumns: next } : current,
    )
    fileColumnsMutation.mutate(next)
  }

  return { sortOrder, fileColumns, setSortOrder, setFileColumns }
}
