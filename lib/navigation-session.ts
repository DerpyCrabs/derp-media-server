import { useCallback, useMemo, useState } from 'react'

export interface NavigationState {
  dir: string | null
  viewing: string | null
  playing: string | null
  audioOnly: boolean
}

export interface NavigationSession {
  state: NavigationState
  navigateToFolder: (path: string | null) => void
  viewFile: (path: string, dir?: string) => void
  playFile: (path: string, dir?: string) => void
  closeViewer: () => void
  closePlayer: () => void
  setAudioOnly: (enabled: boolean) => void
}

const DEFAULT_STATE: NavigationState = {
  dir: null,
  viewing: null,
  playing: null,
  audioOnly: false,
}

function mergeState(state: NavigationState, updates: Partial<NavigationState>): NavigationState {
  return {
    ...state,
    ...updates,
  }
}

export function getParentDirectory(path: string): string | null {
  const parts = path.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

export function useInMemoryNavigationSession(
  initialState: Partial<NavigationState> = {},
): NavigationSession {
  const [state, setState] = useState<NavigationState>(() => ({
    ...DEFAULT_STATE,
    ...initialState,
  }))

  const navigateToFolder = useCallback((path: string | null) => {
    setState((current) => mergeState(current, { dir: path }))
  }, [])

  const viewFile = useCallback((path: string, dir?: string) => {
    setState((current) =>
      mergeState(current, {
        viewing: path,
        ...(dir !== undefined ? { dir } : {}),
      }),
    )
  }, [])

  const playFile = useCallback((path: string, dir?: string) => {
    setState((current) =>
      mergeState(current, {
        playing: path,
        viewing: null,
        ...(dir !== undefined ? { dir } : {}),
      }),
    )
  }, [])

  const closeViewer = useCallback(() => {
    setState((current) => mergeState(current, { viewing: null }))
  }, [])

  const closePlayer = useCallback(() => {
    setState((current) => mergeState(current, { playing: null, audioOnly: false }))
  }, [])

  const setAudioOnly = useCallback((enabled: boolean) => {
    setState((current) => mergeState(current, { audioOnly: enabled }))
  }, [])

  return useMemo(
    () => ({
      state,
      navigateToFolder,
      viewFile,
      playFile,
      closeViewer,
      closePlayer,
      setAudioOnly,
    }),
    [state, navigateToFolder, viewFile, playFile, closeViewer, closePlayer, setAudioOnly],
  )
}
