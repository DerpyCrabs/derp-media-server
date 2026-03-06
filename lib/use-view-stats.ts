import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { resolveSourceContext, stripSharePrefix, type SourceContext } from '@/lib/source-context'

interface UseViewStatsOptions {
  includeCounts?: boolean
}

export function useViewStats(
  sourceContext?: SourceContext | null,
  { includeCounts = true }: UseViewStatsOptions = {},
) {
  const queryClient = useQueryClient()
  const resolvedSource = resolveSourceContext(sourceContext ?? undefined)
  const shareToken = resolvedSource.shareToken ?? null
  const sharePath = resolvedSource.sharePath ?? null

  const { data } = useQuery({
    queryKey: queryKeys.stats(),
    queryFn: () =>
      api<{ views: Record<string, number>; shareViews: Record<string, number> }>(
        '/api/stats/views',
      ),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    enabled: includeCounts && !shareToken,
  })

  const incrementMutation = useMutation({
    mutationFn: (vars: { filePath: string }) =>
      shareToken
        ? post(`/api/share/${shareToken}/view`, {
            filePath: stripSharePrefix(vars.filePath, sharePath),
          })
        : post('/api/stats/views', vars),
    onSuccess: () => {
      if (includeCounts && !shareToken) {
        queryClient.invalidateQueries({ queryKey: queryKeys.stats() })
      }
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
