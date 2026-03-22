import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { resolveSourceContext, stripSharePrefix, type SourceContext } from '@/lib/source-context'
import type { Accessor } from 'solid-js'

type Options = {
  includeCounts?: boolean
}

export function useViewStats(
  sourceContext: Accessor<SourceContext | null | undefined>,
  options?: Options,
) {
  const includeCounts = options?.includeCounts ?? true
  const queryClient = useQueryClient()

  const resolved = () => resolveSourceContext(sourceContext() ?? undefined)
  const shareToken = () => resolved().shareToken ?? null
  const sharePath = () => resolved().sharePath ?? null

  const statsQuery = useQuery(() => ({
    queryKey: queryKeys.stats(),
    queryFn: () =>
      api<{ views: Record<string, number>; shareViews: Record<string, number> }>(
        '/api/stats/views',
      ),
    enabled: includeCounts && !shareToken(),
  }))

  const incrementMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => {
      const st = shareToken()
      const sp = sharePath()
      if (st) {
        return post(`/api/share/${st}/view`, {
          filePath: stripSharePrefix(vars.filePath, sp),
        })
      }
      return post('/api/stats/views', vars)
    },
    onSuccess: () => {
      if (includeCounts && !shareToken()) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.stats() })
      }
    },
  }))

  function incrementView(filePath: string) {
    incrementMutation.mutate({ filePath })
  }

  function getViewCount(filePath: string) {
    return statsQuery.data?.views?.[filePath] ?? 0
  }

  function getShareViewCount(filePath: string) {
    return statsQuery.data?.shareViews?.[filePath] ?? 0
  }

  return {
    incrementView,
    getViewCount,
    getShareViewCount,
  }
}
