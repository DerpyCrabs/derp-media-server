import { workspaceBrowserDirTitle } from '@/lib/workspace-browser-dir-title'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
  type PersistedWorkspaceState,
} from '@/lib/use-workspace'
import { getWorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'
import { defaultInitialBrowserTitle, defaultPersistedState } from '@/lib/workspace-default-state'
import { currentContentWindowPersistence } from '@/src/integrations/current-window-content'
import { parseRoute } from '../lib/routes'

export { defaultInitialBrowserTitle, defaultPersistedState }

export function isWorkspaceRoute(pathname: string) {
  return parseRoute({ pathname }).kind === 'workspace'
}

export function persistWorkspaceState(storageKey: string, state: PersistedWorkspaceState) {
  try {
    const toStore: PersistedWorkspaceState = {
      ...state,
      pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
      fileOpenTarget: state.fileOpenTarget ?? getWorkspaceFileOpenTarget(),
    }
    localStorage.setItem(
      storageKey,
      serializeWorkspacePersistedState(toStore, currentContentWindowPersistence),
    )
  } catch {}
}

export function loadPersisted(storageKey: string): PersistedWorkspaceState | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return normalizePersistedWorkspaceState(
      JSON.parse(raw) as unknown,
      currentContentWindowPersistence,
      { reconcileSnapZones: false },
    )
  } catch {
    return null
  }
}
