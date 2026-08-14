/**
 * Named workspace layouts: stored on the server settings.
 * Draft window state stays in localStorage per tab (`workspace-state-*-ws-*`).
 */
import { serializeWorkspaceLayoutState, type PersistedWorkspaceState } from './use-workspace'
import type { ContentWindowPersistencePort } from './content-window-persistence'

export type { WorkspaceLayoutPreset } from './workspace-layout-presets-types'
export { makeWorkspaceLayoutPresetId } from './workspace-layout-presets-types'

export function createWorkspaceLayoutPresetSnapshot(
  state: PersistedWorkspaceState,
  persistence: ContentWindowPersistencePort,
): PersistedWorkspaceState {
  return JSON.parse(serializeWorkspaceLayoutState(state, persistence)) as PersistedWorkspaceState
}
