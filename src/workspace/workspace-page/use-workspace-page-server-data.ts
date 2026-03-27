import { api, post } from '@/lib/api'
import type { GlobalSettings } from '@/lib/use-settings'
import type { PinnedTaskbarItem } from '@/lib/use-workspace'
import { queryKeys } from '@/lib/query-keys'
import {
  workspaceLayoutScopeFromShareToken,
  type WorkspaceLayoutPreset,
} from '@/lib/workspace-layout-presets'
import type { WorkspaceShareConfig } from '@/src/workspace/WorkspaceBrowserPane'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { createMemo } from 'solid-js'
import type { WorkspacePageProps } from './workspace-page-types'

type AuthConfig = { enabled: boolean; editableFolders: string[] }

export function useWorkspacePageServerData(
  props: WorkspacePageProps,
  shareConfig: () => WorkspaceShareConfig | null,
) {
  const queryClient = useQueryClient()

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled: !shareConfig(),
  }))

  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<AuthConfig>('/api/auth/config'),
    staleTime: Infinity,
    enabled: !shareConfig(),
  }))

  const editableFolders = createMemo((): string[] => {
    const c = shareConfig()
    if (c?.sharePath) return [c.sharePath]
    return authQuery.data?.editableFolders ?? []
  })

  const sharePanel = createMemo((): WorkspaceShareConfig | null => {
    const c = shareConfig()
    if (!c) return null
    return { token: c.token, sharePath: c.sharePath }
  })

  const serverPinsReady = createMemo(() => (shareConfig() ? true : settingsQuery.isSuccess))

  const serverPinsList = createMemo((): PinnedTaskbarItem[] => {
    if (shareConfig()) return props.shareWorkspaceTaskbarPins ?? []
    return settingsQuery.data?.workspaceTaskbarPins ?? []
  })

  const serverLayoutPresets = createMemo((): WorkspaceLayoutPreset[] => {
    if (shareConfig()) return props.shareWorkspaceLayoutPresets ?? []
    return settingsQuery.data?.workspaceLayoutPresets ?? []
  })

  const presetsReady = createMemo(() => (shareConfig() ? true : settingsQuery.isSuccess))

  const layoutScope = createMemo(() =>
    workspaceLayoutScopeFromShareToken(shareConfig()?.token ?? null),
  )

  const persistPinsMutation = useMutation(() => ({
    mutationFn: (items: PinnedTaskbarItem[]) => {
      const c = shareConfig()
      if (c) {
        return post(`/api/share/${c.token}/workspaceTaskbarPins`, { items })
      }
      return post('/api/settings/workspaceTaskbarPins', { items })
    },
    onSettled: () => {
      const c = shareConfig()
      if (c) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(c.token) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      }
    },
  }))

  return {
    queryClient,
    settingsQuery,
    authQuery,
    editableFolders,
    sharePanel,
    serverPinsReady,
    serverPinsList,
    serverLayoutPresets,
    presetsReady,
    layoutScope,
    persistPinsMutation,
  }
}
