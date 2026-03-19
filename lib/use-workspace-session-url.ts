import { useLayoutEffect, useRef } from 'react'
import { navigate, usePathname, useSearchParams } from '@/lib/router'

/**
 * Ensures `?ws=<uuid>` exists so each browser tab has an isolated workspace draft key.
 * Synchronizes the URL via replaceState on first paint when the param was missing.
 */
export function useWorkspaceSessionUrl(): string {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const fromUrl = searchParams.get('ws')
  const fallbackRef = useRef<string | null>(null)

  if (fallbackRef.current === null && !fromUrl) {
    fallbackRef.current = crypto.randomUUID()
  }

  const sessionId = fromUrl ?? fallbackRef.current!

  useLayoutEffect(() => {
    if (fromUrl) return
    const id = fallbackRef.current
    if (!id) return
    const next = new URLSearchParams(window.location.search)
    next.set('ws', id)
    const qs = next.toString()
    navigate(`${pathname}${qs ? `?${qs}` : ''}`, { replace: true })
  }, [fromUrl, pathname])

  return sessionId
}
