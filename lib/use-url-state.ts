import { useCallback } from 'react'
import { useSearchParams } from '@/lib/router'
import type { NavigationSession, NavigationState } from '@/lib/navigation-session'

type UrlParamKey = 'dir' | 'viewing' | 'playing' | 'audioOnly'

type ParamUpdates = Partial<Record<UrlParamKey, string | null>>

function applyUpdates(updates: ParamUpdates, mode: 'push' | 'replace') {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) {
      params.delete(key)
    } else {
      params.set(key, value)
    }
  }
  const qs = params.toString()
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  if (mode === 'push') {
    window.history.pushState(null, '', url)
  } else {
    window.history.replaceState(null, '', url)
  }
}

/**
 * Centralized, domain-typed URL search-parameter state.
 *
 * Exposes named actions instead of generic push/replace so the URL
 * contract is enforced at the type level. Reads are reactive (backed
 * by Next.js useSearchParams). Writes always read the *live* URL
 * first so concurrent updates from different components never
 * silently overwrite each other.
 */
export function useUrlState(): NavigationSession & { urlState: NavigationState } {
  const searchParams = useSearchParams()

  const state = {
    dir: searchParams.get('dir'),
    viewing: searchParams.get('viewing'),
    playing: searchParams.get('playing'),
    audioOnly: searchParams.get('audioOnly') === 'true',
  }

  const navigateToFolder = useCallback((path: string | null) => {
    applyUpdates({ dir: path }, 'push')
  }, [])

  const viewFile = useCallback((path: string, dir?: string) => {
    const updates: ParamUpdates = { viewing: path }
    if (dir !== undefined) updates.dir = dir
    applyUpdates(updates, 'replace')
  }, [])

  const playFile = useCallback((path: string, dir?: string) => {
    const updates: ParamUpdates = { playing: path, viewing: null }
    if (dir !== undefined) updates.dir = dir
    applyUpdates(updates, 'replace')
  }, [])

  const closeViewer = useCallback(() => {
    applyUpdates({ viewing: null }, 'replace')
  }, [])

  const closePlayer = useCallback(() => {
    applyUpdates({ playing: null, audioOnly: null }, 'replace')
  }, [])

  const setAudioOnly = useCallback((enabled: boolean) => {
    applyUpdates({ audioOnly: enabled ? 'true' : null }, 'replace')
  }, [])

  return {
    state,
    urlState: state,
    navigateToFolder,
    viewFile,
    playFile,
    closeViewer,
    closePlayer,
    setAudioOnly,
  }
}
