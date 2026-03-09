import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'

/**
 * Returns the base URL (origin) to use when building share links.
 * Uses config.shareLinkDomain if set, otherwise window.location.origin.
 */
export function useShareLinkBase(): string {
  const { data } = useQuery({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<{ shareLinkDomain?: string }>('/api/auth/config'),
  })

  if (typeof data?.shareLinkDomain === 'string' && data.shareLinkDomain.trim()) {
    return data.shareLinkDomain.trim().replace(/\/$/, '')
  }
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return ''
}
