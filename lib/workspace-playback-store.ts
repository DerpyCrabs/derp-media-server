import { useCallback, useMemo } from 'react'
import { create } from 'zustand'
import type { NavigationSession } from '@/lib/navigation-session'

export interface WorkspacePlaybackSlice {
  playing: string | null
  audioOnly: boolean
  dir: string | null
}

const DEFAULT_SLICE: WorkspacePlaybackSlice = {
  playing: null,
  audioOnly: false,
  dir: null,
}

function sliceFor(
  key: string,
  byKey: Record<string, WorkspacePlaybackSlice>,
): WorkspacePlaybackSlice {
  return byKey[key] ?? DEFAULT_SLICE
}

interface WorkspacePlaybackStore {
  byKey: Record<string, WorkspacePlaybackSlice>
  playFile: (key: string, path: string, dir?: string) => void
  closePlayer: (key: string) => void
  setAudioOnly: (key: string, enabled: boolean) => void
}

export const useWorkspacePlaybackStore = create<WorkspacePlaybackStore>((set, get) => ({
  byKey: {},

  playFile(key, path, dir) {
    set((state) => {
      const prev = sliceFor(key, state.byKey)
      return {
        byKey: {
          ...state.byKey,
          [key]: {
            ...prev,
            playing: path,
            ...(dir !== undefined ? { dir: dir || null } : {}),
          },
        },
      }
    })
  },

  closePlayer(key) {
    set((state) => {
      const prev = sliceFor(key, state.byKey)
      return {
        byKey: {
          ...state.byKey,
          [key]: {
            ...prev,
            playing: null,
            audioOnly: false,
          },
        },
      }
    })
  },

  setAudioOnly(key, enabled) {
    set((state) => {
      const prev = sliceFor(key, state.byKey)
      return {
        byKey: {
          ...state.byKey,
          [key]: {
            ...prev,
            audioOnly: enabled,
          },
        },
      }
    })
  },
}))

/** Workspace taskbar / player: subscribe to playback slice for one storage key. */
export function useWorkspacePlaybackSession(storageKey: string): NavigationSession {
  const playing = useWorkspacePlaybackStore((s) => s.byKey[storageKey]?.playing ?? null)
  const audioOnly = useWorkspacePlaybackStore((s) => s.byKey[storageKey]?.audioOnly ?? false)
  const dir = useWorkspacePlaybackStore((s) => s.byKey[storageKey]?.dir ?? null)

  const playFile = useCallback(
    (path: string, d?: string) => {
      useWorkspacePlaybackStore.getState().playFile(storageKey, path, d)
    },
    [storageKey],
  )
  const closePlayer = useCallback(() => {
    useWorkspacePlaybackStore.getState().closePlayer(storageKey)
  }, [storageKey])
  const setAudioOnly = useCallback(
    (enabled: boolean) => {
      useWorkspacePlaybackStore.getState().setAudioOnly(storageKey, enabled)
    },
    [storageKey],
  )

  const state = useMemo(
    () => ({
      dir,
      viewing: null,
      playing,
      audioOnly,
    }),
    [dir, playing, audioOnly],
  )

  return useMemo(
    () => ({
      state,
      navigateToFolder: () => {},
      viewFile: () => {},
      playFile,
      closeViewer: () => {},
      closePlayer,
      setAudioOnly,
    }),
    [state, playFile, closePlayer, setAudioOnly],
  )
}
