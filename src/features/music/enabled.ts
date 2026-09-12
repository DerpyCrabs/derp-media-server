import { queryData } from '@/lib/api/query-data'
import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api/client'

export function useMusicAI() {
  const status = useQuery(() => ({
    queryKey: ['media-ai', 'status'],
    queryFn: () => api<{ enabled: boolean }>('/api/media-ai/status'),
    staleTime: 60_000,
  }))
  return () => queryData(status)?.enabled === true
}
