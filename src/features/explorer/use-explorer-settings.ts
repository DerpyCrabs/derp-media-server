import { useQuery } from '@tanstack/solid-query'
import { createMemo } from 'solid-js'
import { api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import type { GlobalSettings } from '@/lib/models/settings-types'

export function useExplorerSettings() {
  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
  }))

  const knowledgeBases = createMemo(() => settingsQuery.data?.knowledgeBases ?? [])
  const customIcons = createMemo(() => settingsQuery.data?.customIcons ?? {})

  return { settingsQuery, knowledgeBases, customIcons }
}
