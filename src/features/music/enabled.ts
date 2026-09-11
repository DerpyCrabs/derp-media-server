import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api/client'

export function useMusicAI() {
  const status = useQuery(() => ({
    queryKey: ['media-ai', 'status'],
    queryFn: () => api<{ enabled: boolean }>('/api/media-ai/status'),
    staleTime: 60_000,
  }))
  return () => status.data?.enabled === true
}
