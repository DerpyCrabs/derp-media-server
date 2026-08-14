/**
 * Named workspace layouts: stored on the server settings.
 * Draft window state stays in localStorage per tab (`workspace-state-*-ws-*`).
 */
import { serializeWorkspaceLayoutState, type PersistedWorkspaceState } from './use-workspace'

export type { WorkspaceLayoutPreset } from './workspace-layout-presets-types'
export { makeWorkspaceLayoutPresetId } from './workspace-layout-presets-types'

export function createWorkspaceLayoutPresetSnapshot(
  state: PersistedWorkspaceState,
): PersistedWorkspaceState {
  return JSON.parse(serializeWorkspaceLayoutState(state)) as PersistedWorkspaceState
}
