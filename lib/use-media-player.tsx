'use client'

import { createStore, useStore } from 'zustand'
import { createContext, useContext, useRef, type ReactNode } from 'react'

type MediaType = 'audio' | 'video' | null

export interface MediaPlayerState {
  currentFile: string | null
  mediaType: MediaType
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isRepeat: boolean

  playFile: (path: string, type: 'audio' | 'video') => void
  setCurrentFile: (path: string, type: 'audio' | 'video') => void
  setIsPlaying: (playing: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  toggleRepeat: () => void

  reset: () => void
}

export type MediaPlayerStore = ReturnType<typeof createMediaPlayerStore>

export function createMediaPlayerStore() {
  return createStore<MediaPlayerState>((set, get) => ({
    currentFile: null,
    mediaType: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    isRepeat: false,

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
    toggleRepeat: () => set((state) => ({ isRepeat: !state.isRepeat })),

    reset: () =>
      set({
        currentFile: null,
        mediaType: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      }),
  }))
}

const MediaPlayerContext = createContext<MediaPlayerStore | null>(null)

export function MediaPlayerProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<MediaPlayerStore>(null)
  if (!storeRef.current) {
    storeRef.current = createMediaPlayerStore()
  }
  return <MediaPlayerContext value={storeRef.current}>{children}</MediaPlayerContext>
}

export function useMediaPlayerStore(): MediaPlayerStore {
  const store = useContext(MediaPlayerContext)
  if (!store) throw new Error('useMediaPlayer must be used within MediaPlayerProvider')
  return store
}

export function useMediaPlayer(): MediaPlayerState
export function useMediaPlayer<T>(selector: (s: MediaPlayerState) => T): T
export function useMediaPlayer<T>(selector?: (s: MediaPlayerState) => T) {
  const store = useMediaPlayerStore()
  return useStore(store, selector as (s: MediaPlayerState) => T)
}
