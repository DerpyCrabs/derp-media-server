import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface VideoPlaybackTimes {
  [filePath: string]: number // filePath -> saved time in seconds
}

interface VideoPlaybackTimeState {
  playbackTimes: VideoPlaybackTimes
  getSavedTime: (filePath: string) => number | null
  saveTime: (filePath: string, time: number, duration: number) => void
  clearTime: (filePath: string) => void
}

export const useVideoPlaybackTime = create<VideoPlaybackTimeState>()(
  persist(
    (set, get) => ({
      playbackTimes: {},

      getSavedTime: (filePath: string) => {
        const { playbackTimes } = get()
        return playbackTimes[filePath] ?? null
      },

      saveTime: (filePath: string, time: number, duration: number) => {
        // If the video is in the last 10% of its duration, clear the saved time
        if (duration > 0 && time >= duration * 0.9) {
          set((state) => {
            const newPlaybackTimes = { ...state.playbackTimes }
            delete newPlaybackTimes[filePath]
            return { playbackTimes: newPlaybackTimes }
          })
        } else {
          // Save the current time
          set((state) => ({
            playbackTimes: {
              ...state.playbackTimes,
              [filePath]: time,
            },
          }))
        }
      },

      clearTime: (filePath: string) => {
        set((state) => {
          const newPlaybackTimes = { ...state.playbackTimes }
          delete newPlaybackTimes[filePath]
          return { playbackTimes: newPlaybackTimes }
        })
      },
    }),
    {
      name: 'video-playback-times',
    },
  ),
)
