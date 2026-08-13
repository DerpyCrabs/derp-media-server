import { MediaType } from '@/lib/types'
import { workspaceBrowserDirTitle } from '@/lib/workspace-browser-dir-title'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
  type PersistedWorkspaceState,
  type WorkspaceSource,
} from '@/lib/use-workspace'
import { getWorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'
import { createDefaultBounds, createWindowLayout } from '@/lib/workspace-geometry'

export const DEFAULT_WORKSPACE_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }

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
      fileOpenTarget: state.fileOpenTarget ?? getWorkspaceFileOpenTarget(),
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
