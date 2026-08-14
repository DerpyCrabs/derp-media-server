import type { PersistedWorkspaceState, PinnedTaskbarItem } from '@/lib/use-workspace'
import { parseWorkspaceTaskbarPins } from '@/lib/workspace-taskbar-pins'
import {
  serverConfigQueryOptions,
  settingsMutationOptions,
  settingsQueryOptions,
} from '@/lib/query-options'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo } from 'solid-js'
import { unwrap } from 'solid-js/store'

function fromQueryData<T>(value: T): T {
  return structuredClone(unwrap(value))
}

export function withAuthoritativeServerPins(
  workspace: PersistedWorkspaceState,
  pins: readonly PinnedTaskbarItem[],
): PersistedWorkspaceState {
  return { ...workspace, pinnedTaskbarItems: [...pins] }
}

export function useWorkspacePageServerData() {
  const queryClient = useQueryClient()

  const settingsQuery = useQuery(settingsQueryOptions)

  const serverConfigQuery = useQuery(serverConfigQueryOptions)

  const editableFolders = createMemo((): string[] => {
    const folders = serverConfigQuery.data?.editableFolders
    return folders ? fromQueryData(folders) : []
  })

  const serverPinsReady = createMemo(() => settingsQuery.isSuccess)

  const serverPinsList = createMemo((): PinnedTaskbarItem[] => {
    const pins = settingsQuery.data?.workspaceTaskbarPins
    return parseWorkspaceTaskbarPins(pins ? fromQueryData(pins) : [])
  })

  const serverLayoutPresets = createMemo((): WorkspaceLayoutPreset[] => {
    const presets = settingsQuery.data?.workspaceLayoutPresets
    return presets ? fromQueryData(presets) : []
  })

  const presetsReady = createMemo(() => settingsQuery.isSuccess)
  const persistPinsMutation = useMutation(() =>
    settingsMutationOptions.workspaceTaskbarPins(queryClient),
  )

  return {
    queryClient,
    settingsQuery,
    editableFolders,
    serverPinsReady,
    serverPinsList,
    serverLayoutPresets,
    presetsReady,
    persistPinsMutation,
  }
}
