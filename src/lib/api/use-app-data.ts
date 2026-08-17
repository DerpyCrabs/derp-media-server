import { useQuery } from '@tanstack/solid-query'
import { api } from './client'
import { queryKeys } from './query-keys'
import type { GlobalSettings } from '@/lib/models/settings-types'

export interface ServerConfig {
  editableFolders: string[]
  mediaRoots: Array<{
    id: string
    name: string
    editableFolders: string[]
  }>
}

export function useSettingsQuery<T extends GlobalSettings = GlobalSettings>() {
  return useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<T>('/api/settings'),
    staleTime: Infinity,
  }))
}

export function useServerConfigQuery() {
  return useQuery(() => ({
    queryKey: queryKeys.serverConfig(),
    queryFn: () => api<ServerConfig>('/api/config'),
    staleTime: Infinity,
  }))
}
