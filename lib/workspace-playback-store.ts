import { create } from 'zustand'

interface WorkspacePlaybackSlice {
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

export const useWorkspacePlaybackStore = create<WorkspacePlaybackStore>((set, _get) => ({
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
