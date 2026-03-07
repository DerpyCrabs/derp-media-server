import { create } from 'zustand'

type MediaType = 'audio' | 'video' | null

interface MediaPlayerState {
  currentFile: string | null
  mediaType: MediaType
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isRepeat: boolean
  shareToken: string | null
  sharePath: string | null

  playFile: (path: string, type: 'audio' | 'video') => void
  setCurrentFile: (path: string, type: 'audio' | 'video') => void
  setIsPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  toggleRepeat: () => void
  setShareContext: (token: string, path: string) => void
  clearShareContext: () => void

  reset: () => void
}

export const useMediaPlayer = create<MediaPlayerState>((set, get) => ({
  currentFile: null,
  mediaType: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  isRepeat: false,
  shareToken: null,
  sharePath: null,

  playFile: (path, type) => {
    const state = get()

    if (state.currentFile === path && state.mediaType === type) {
      set({ isPlaying: !state.isPlaying })
      return
    }

    set({
      currentFile: path,
      mediaType: type,
      currentTime: 0,
      duration: 0,
      isPlaying: true,
    })
  },

  setCurrentFile: (path, type) => {
    const state = get()

    // Only update if different, don't change isPlaying
    if (state.currentFile !== path || state.mediaType !== type) {
      set({
        currentFile: path,
        mediaType: type,
        currentTime: 0,
        duration: 0,
      })
    }
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),
  setMuted: (muted) =>
    set((state) => ({ isMuted: muted, volume: muted ? 0 : state.volume || 0.5 })),
  toggleRepeat: () => set((state) => ({ isRepeat: !state.isRepeat })),

  setShareContext: (token, path) => set({ shareToken: token, sharePath: path }),
  clearShareContext: () => set({ shareToken: null, sharePath: null }),

  reset: () =>
    set({
      currentFile: null,
      mediaType: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 1,
      isMuted: false,
    }),
}))
