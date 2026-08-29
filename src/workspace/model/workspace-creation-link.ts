import { DEFAULT_WORKSPACE_SOURCE, type PersistedWorkspaceState } from './use-workspace'
import { convertWorkspaceSnapshot, type WorkspaceType } from './workspace-conversion'
import { defaultPersistedState } from '../shared/workspace-page-persistence'

export type WorkspaceCreationLink = {
  type: WorkspaceType
  name?: string
}

export function parseWorkspaceCreationLink(
  params: Pick<URLSearchParams, 'get'>,
): WorkspaceCreationLink | null {
  const type = params.get('new')
  if (type !== 'desktop' && type !== 'canvas') return null
  const name = params.get('name')?.trim()
  return {
    type,
    ...(name ? { name } : {}),
  }
}

export function createLinkedWorkspaceSnapshot(type: WorkspaceType): PersistedWorkspaceState {
  const desktop = defaultPersistedState(DEFAULT_WORKSPACE_SOURCE)
  return type === 'canvas' ? convertWorkspaceSnapshot(desktop, 'canvas') : desktop
}
