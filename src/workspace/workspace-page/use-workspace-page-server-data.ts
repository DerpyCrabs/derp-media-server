import { api, post } from '@/lib/api'
import type { GlobalSettings } from '@/lib/use-settings'
import type { PinnedTaskbarItem } from '@/lib/use-workspace'
import { queryKeys } from '@/lib/query-keys'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo } from 'solid-js'
import { unwrap } from 'solid-js/store'
import type { WorkspacePageProps } from './workspace-page-types'

type ServerConfig = { editableFolders: string[] }

function fromQueryData<T>(value: T): T {
  return structuredClone(unwrap(value))
}

export function useWorkspacePageServerData(props: WorkspacePageProps) {
  const queryClient = useQueryClient()

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
  }))

  const serverConfigQuery = useQuery(() => ({
    queryKey: queryKeys.serverConfig(),
    queryFn: () => api<ServerConfig>('/api/config'),
    staleTime: Infinity,
  }))

  const editableFolders = createMemo((): string[] => {
    const folders = serverConfigQuery.data?.editableFolders
    return folders ? fromQueryData(folders) : []
  })

  const serverPinsReady = createMemo(() => settingsQuery.isSuccess)

  const serverPinsList = createMemo((): PinnedTaskbarItem[] => {
    const pins = settingsQuery.data?.workspaceTaskbarPins
    return pins ? fromQueryData(pins) : []
  })

  const serverLayoutPresets = createMemo((): WorkspaceLayoutPreset[] => {
    const presets = settingsQuery.data?.workspaceLayoutPresets
    return presets ? fromQueryData(presets) : []
  })

  const presetsReady = createMemo(() => settingsQuery.isSuccess)
  const layoutScope = createMemo(() => 'admin' as const)

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
    serverLayoutPresets,
    presetsReady,
    layoutScope,
    persistPinsMutation,
  }
}
