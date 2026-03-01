'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * Returns the base URL (origin) to use when building share links.
 * Uses config.shareLinkDomain if set, otherwise window.location.origin.
 */
export function useShareLinkBase(): string {
  const { data } = useQuery({
    queryKey: ['auth-config'],
    queryFn: async () => {
      const res = await fetch('/api/auth/config')
      const json = await res.json()
      return json as { enabled?: boolean; shareLinkDomain?: string }
    },
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
