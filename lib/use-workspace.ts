import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WindowType =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'text'
  | 'unsupported'
  | 'file-browser'

export interface WorkspaceWindow {
  id: string
  type: WindowType
  title: string
  filePath?: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  zIndex: number
  minimized: boolean
  maximized: boolean
}

interface OpenWindowOpts {
  type: WindowType
  title: string
  filePath?: string
  position?: { x: number; y: number }
  size?: { width: number; height: number }
}

const DEFAULT_SIZE: Record<WindowType, { width: number; height: number }> = {
  image: { width: 800, height: 600 },
  video: { width: 854, height: 540 },
  audio: { width: 400, height: 160 },
  pdf: { width: 800, height: 700 },
  text: { width: 700, height: 600 },
  unsupported: { width: 400, height: 300 },
  'file-browser': { width: 500, height: 600 },
}

let nextZIndex = 100

export interface WorkspaceState {
  windows: WorkspaceWindow[]
  focusedWindowId: string | null
  sidebarDocked: boolean

  openWindow: (opts: OpenWindowOpts) => string
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  minimizeWindow: (id: string) => void
  toggleMaximize: (id: string) => void
  moveWindow: (id: string, position: { x: number; y: number }) => void
  resizeWindow: (id: string, size: { width: number; height: number }) => void
  toggleSidebar: () => void
  bringToFront: (id: string) => void
}

function generateId() {
  return `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function cascadePosition(existingWindows: WorkspaceWindow[]): { x: number; y: number } {
  const base = 60
  const offset = existingWindows.length * 30
  return { x: base + (offset % 300), y: base + (offset % 200) }
}

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      windows: [],
      focusedWindowId: null,
      sidebarDocked: true,

      openWindow: (opts) => {
        const existing = opts.filePath
          ? get().windows.find((w) => w.filePath === opts.filePath && w.type === opts.type)
          : null
        if (existing) {
          get().focusWindow(existing.id)
          if (existing.minimized) {
            set((s) => ({
              windows: s.windows.map((w) =>
                w.id === existing.id ? { ...w, minimized: false } : w,
              ),
            }))
          }
          return existing.id
        }

        const id = generateId()
        const z = ++nextZIndex
        const position = opts.position || cascadePosition(get().windows)
        const size = opts.size || DEFAULT_SIZE[opts.type]

        const win: WorkspaceWindow = {
          id,
          type: opts.type,
          title: opts.title,
          filePath: opts.filePath,
          position,
          size,
          zIndex: z,
          minimized: false,
          maximized: false,
        }

        set((s) => ({
          windows: [...s.windows, win],
          focusedWindowId: id,
        }))

        return id
      },

      closeWindow: (id) => {
        set((s) => {
          const windows = s.windows.filter((w) => w.id !== id)
          return {
            windows,
            focusedWindowId:
              s.focusedWindowId === id
                ? windows.length > 0
                  ? windows.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id
                  : null
                : s.focusedWindowId,
          }
        })
      },

      focusWindow: (id) => {
        const z = ++nextZIndex
        set((s) => ({
          focusedWindowId: id,
          windows: s.windows.map((w) => (w.id === id ? { ...w, zIndex: z } : w)),
        }))
      },

      minimizeWindow: (id) => {
        set((s) => {
          const windows = s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w))
          const remaining = windows.filter((w) => !w.minimized)
          return {
            windows,
            focusedWindowId:
              s.focusedWindowId === id
                ? remaining.length > 0
                  ? remaining.reduce((a, b) => (a.zIndex > b.zIndex ? a : b)).id
                  : null
                : s.focusedWindowId,
          }
        })
      },

      toggleMaximize: (id) => {
        set((s) => ({
          windows: s.windows.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w)),
        }))
      },

      moveWindow: (id, position) => {
        set((s) => ({
          windows: s.windows.map((w) => (w.id === id ? { ...w, position } : w)),
        }))
      },

      resizeWindow: (id, size) => {
        set((s) => ({
          windows: s.windows.map((w) => (w.id === id ? { ...w, size } : w)),
        }))
      },

      toggleSidebar: () => {
        set((s) => ({ sidebarDocked: !s.sidebarDocked }))
      },

      bringToFront: (id) => {
        get().focusWindow(id)
      },
    }),
    {
      name: 'workspace-state',
      partialize: (state) => ({
        windows: state.windows,
        sidebarDocked: state.sidebarDocked,
      }),
      onRehydrate: () => {
        return (state) => {
          if (state) {
            const maxZ = state.windows.reduce((max, w) => Math.max(max, w.zIndex), 100)
            nextZIndex = maxZ + 1
          }
        }
      },
    },
  ),
)
