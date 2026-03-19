import { create } from 'zustand'

export type WorkspaceFileOpenTarget = 'new-tab' | 'new-window'

const STORAGE_KEY = 'workspace-file-open-target'
const DEFAULT: WorkspaceFileOpenTarget = 'new-window'

function parseStored(raw: string | null): WorkspaceFileOpenTarget {
  if (raw === 'new-tab' || raw === 'new-window') return raw
  return DEFAULT
}

function readStored(): WorkspaceFileOpenTarget {
  if (typeof window === 'undefined') return DEFAULT
  return parseStored(localStorage.getItem(STORAGE_KEY))
}

interface WorkspaceFileOpenTargetState {
  target: WorkspaceFileOpenTarget
  setTarget: (value: WorkspaceFileOpenTarget) => void
}

export const useWorkspaceFileOpenTargetStore = create<WorkspaceFileOpenTargetState>((set) => ({
  target: readStored(),
  setTarget(value) {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, value)
    }
    set({ target: value })
  },
}))

/** Non-reactive read (e.g. inside event handlers). */
export function getWorkspaceFileOpenTarget(): WorkspaceFileOpenTarget {
  return useWorkspaceFileOpenTargetStore.getState().target
}

export function setWorkspaceFileOpenTarget(value: WorkspaceFileOpenTarget): void {
  useWorkspaceFileOpenTargetStore.getState().setTarget(value)
}

export function useWorkspaceFileOpenTarget(): WorkspaceFileOpenTarget {
  return useWorkspaceFileOpenTargetStore((s) => s.target)
}
