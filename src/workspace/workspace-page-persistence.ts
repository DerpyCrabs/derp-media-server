import { MediaType } from '@/lib/types'
import {
  normalizePersistedWorkspaceState,
  type PersistedWorkspaceState,
  type WorkspaceSource,
} from '@/lib/use-workspace'
import { PLAYER_WINDOW_ID, createDefaultBounds, createWindowLayout } from '@/lib/workspace-geometry'

export const DEFAULT_WORKSPACE_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }

export function isWorkspaceRoute(pathname: string) {
  return pathname === '/workspace' || /^\/share\/[^/]+\/workspace\/?$/.test(pathname)
}

export function defaultPersistedState(source: WorkspaceSource): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: 'Browser 1',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
      },
    ],
    activeWindowId: 'workspace-window-1',
    activeTabMap: {},
    nextWindowId: 2,
    pinnedTaskbarItems: [],
  }
}

export function persistWorkspaceState(storageKey: string, state: PersistedWorkspaceState) {
  try {
    const serializable = {
      ...state,
      windows: state.windows.filter((w) => w.id !== PLAYER_WINDOW_ID),
      pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
    }
    localStorage.setItem(storageKey, JSON.stringify(serializable))
  } catch {}
}

export function loadPersisted(storageKey: string): PersistedWorkspaceState | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return normalizePersistedWorkspaceState(JSON.parse(raw) as unknown, {
      reconcileSnapZones: false,
    })
  } catch {
    return null
  }
}
