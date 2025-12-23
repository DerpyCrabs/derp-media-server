import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface Position {
  x: number
  y: number
}

interface VideoPlayerPositionState {
  position: Position
  setPosition: (position: Position) => void
  resetPosition: () => void
}

const defaultPosition: Position = { x: 0, y: 0 }

export const useVideoPlayerPosition = create<VideoPlayerPositionState>()(
  persist(
    (set) => ({
      position: defaultPosition,
      setPosition: (position: Position) => set({ position }),
      resetPosition: () => set({ position: defaultPosition }),
    }),
    {
      name: 'video-player-position',
    },
  ),
)

// Helper function to validate and constrain position within viewport
export function validatePosition(position: Position): Position {
  if (typeof window === 'undefined') return position

  const constrainedX = Math.max(0, Math.min(position.x, window.innerWidth - 100))
  const constrainedY = Math.max(0, Math.min(position.y, window.innerHeight - 100))

  return { x: constrainedX, y: constrainedY }
}

// Helper function to get default position (bottom-right with padding)
export function getDefaultPosition(): Position {
  if (typeof window === 'undefined') return defaultPosition

  const defaultX = window.innerWidth - 320 - 16 // 320px width + 16px padding
  const defaultY = window.innerHeight - 300 - 80 // approximate height + padding

  return {
    x: Math.max(0, defaultX),
    y: Math.max(0, defaultY),
  }
}
