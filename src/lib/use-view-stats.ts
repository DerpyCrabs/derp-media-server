import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { apiEndpoints } from '@/lib/api-endpoints'
import { queryKeys } from '@/lib/query-keys'
import { statsQueryOptions } from '@/lib/query-options'
import type { Accessor } from 'solid-js'

type Options = {
  includeCounts?: boolean
}

export function useViewStats(_sourceContext?: Accessor<unknown>, options?: Options) {
  const includeCounts = options?.includeCounts ?? true
  const queryClient = useQueryClient()

  const statsQuery = useQuery(() => ({
    ...statsQueryOptions(),
    enabled: includeCounts,
  }))

  const incrementMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => apiEndpoints.stats.addView(vars.filePath),
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
  }
}
