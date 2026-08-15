import { MediaType } from '@/lib/files/types'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
  type PersistedWorkspaceState,
  type WorkspaceSource,
} from '@/workspace/model/use-workspace'
import { DEFAULT_WORKSPACE_SOURCE } from '@/workspace/model/use-workspace'
import { getFileOpenTarget } from '@/features/explorer/file-open-target'
import { createDefaultBounds, createWindowLayout } from '@/workspace/model/workspace-geometry'

export { DEFAULT_WORKSPACE_SOURCE }

export function isWorkspaceRoute(pathname: string) {
  return pathname === '/workspace'
}

export function defaultInitialBrowserTitle(): string {
  return 'Browser 1'
}

export function defaultPersistedState(source: WorkspaceSource): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: defaultInitialBrowserTitle(),
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
    const toStore: PersistedWorkspaceState = {
      ...state,
      pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
      fileOpenTarget: state.fileOpenTarget ?? getFileOpenTarget(),
    }
    localStorage.setItem(storageKey, serializeWorkspacePersistedState(toStore))
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
