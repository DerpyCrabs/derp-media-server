import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

export function useViewStats() {
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: queryKeys.stats(),
    queryFn: () =>
      api<{ views: Record<string, number>; shareViews: Record<string, number> }>(
        '/api/stats/views',
      ),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })

  const incrementMutation = useMutation({
    mutationFn: (vars: { filePath: string }) => post('/api/stats/views', vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stats() })
    },
  })

  const views = data?.views || {}
  const shareViews = data?.shareViews || {}

  const incrementView = (filePath: string) => {
    incrementMutation.mutate({ filePath })
  }

  const getViewCount = (filePath: string): number => {
    return views[filePath] || 0
  }

  const getShareViewCount = (filePath: string): number => {
    return shareViews[filePath] || 0
  }

  return {
    views,
    shareViews,
    incrementView,
    getViewCount,
    getShareViewCount,
  }
}
