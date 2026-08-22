import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import type { Accessor } from 'solid-js'

type Options = {
  includeCounts?: boolean
}

export function useViewStats(_sourceContext?: Accessor<unknown>, options?: Options) {
  const includeCounts = options?.includeCounts ?? true
  const queryClient = useQueryClient()

  const statsQuery = useQuery(() => ({
    queryKey: queryKeys.stats(),
    queryFn: () => api<{ views: Record<string, number> }>('/api/stats/views'),
    enabled: includeCounts,
  }))

  const incrementMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => post('/api/stats/views', vars),
    onSuccess: () => {
      if (includeCounts) void queryClient.invalidateQueries({ queryKey: queryKeys.stats() })
    },
  }))

  function incrementView(filePath: string) {
    incrementMutation.mutate({ filePath })
  }

  function getViewCount(filePath: string) {
    return statsQuery.data?.views?.[filePath] ?? 0
  }

  return {
    incrementView,
    getViewCount,
    viewCounts: () => statsQuery.data?.views ?? {},
    query: statsQuery,
  }
}
