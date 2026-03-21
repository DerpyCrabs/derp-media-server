import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type WorkspaceFileOpenTarget = 'new-tab' | 'new-window'

const LEGACY_STORAGE_KEY = 'workspace-file-open-target'
const DEFAULT: WorkspaceFileOpenTarget = 'new-window'

function parseStored(raw: string | null): WorkspaceFileOpenTarget {
  if (raw === 'new-tab' || raw === 'new-window') return raw
  return DEFAULT
}

function readLegacyTarget(): WorkspaceFileOpenTarget | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (raw == null) return null
  return parseStored(raw)
}

function initialTarget(): WorkspaceFileOpenTarget {
  const legacy = readLegacyTarget()
  if (legacy != null) return legacy
  return DEFAULT
}

interface WorkspaceFileOpenTargetState {
  target: WorkspaceFileOpenTarget
  setTarget: (value: WorkspaceFileOpenTarget) => void
}

export const useWorkspaceFileOpenTargetStore = create<WorkspaceFileOpenTargetState>()(
  persist(
    (set) => ({
      target: initialTarget(),
      setTarget(value) {
        set({ target: value })
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem(LEGACY_STORAGE_KEY)
          } catch {}
        }
      },
    }),
    {
      name: 'workspace-file-open-target-v2',
      storage: createJSONStorage<{ target: WorkspaceFileOpenTarget }>(() => localStorage),
      partialize: (s) => ({ target: s.target }),
    },
  ),
)

/** Non-reactive read (e.g. inside event handlers). */
export function getWorkspaceFileOpenTarget(): WorkspaceFileOpenTarget {
  return useWorkspaceFileOpenTargetStore.getState().target
}
