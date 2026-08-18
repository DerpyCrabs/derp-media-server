import { post } from '@/lib/api/client'
import { useServerConfigQuery, useSettingsQuery } from '@/lib/api/use-app-data'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import type { PinnedTaskbarItem } from '@/workspace/model/use-workspace'
import { queryKeys } from '@/lib/api/query-keys'
import { useMutation, useQueryClient } from '@tanstack/solid-query'
import { createMemo, snapshot } from 'solid-js'

function fromQueryData<T>(value: T): T {
  return structuredClone(snapshot(value))
}

export function useWorkspacePageServerData() {
  const queryClient = useQueryClient()

  const settingsQuery = useSettingsQuery<WorkspaceSettings>()
  const serverConfigQuery = useServerConfigQuery()

  const editableFolders = createMemo((): string[] => {
    const folders = serverConfigQuery.data?.editableFolders
    return folders ? fromQueryData(folders) : []
  })

  const serverPinsReady = createMemo(() => settingsQuery.isSuccess)

  const serverPinsList = createMemo((): PinnedTaskbarItem[] => {
    const pins = settingsQuery.data?.workspaceTaskbarPins
    return pins ? fromQueryData(pins) : []
  })

  const persistPinsMutation = useMutation(() => ({
    mutationFn: (items: PinnedTaskbarItem[]) =>
      post('/api/settings/workspaceTaskbarPins', { items }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  return {
    queryClient,
    settingsQuery,
    editableFolders,
    serverPinsReady,
    serverPinsList,
    persistPinsMutation,
  }
}
