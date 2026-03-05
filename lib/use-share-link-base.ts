import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Returns the base URL (origin) to use when building share links.
 * Uses config.shareLinkDomain if set, otherwise window.location.origin.
 */
export function useShareLinkBase(): string {
  const { data } = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api<{ shareLinkDomain?: string }>('/api/auth/config'),
    staleTime: 5 * 60 * 1000,
  })

  if (typeof data?.shareLinkDomain === 'string' && data.shareLinkDomain.trim()) {
    return data.shareLinkDomain.trim().replace(/\/$/, '')
  }
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return ''
}
