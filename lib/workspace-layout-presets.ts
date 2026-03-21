/**
 * Named workspace layouts: stored on the server (settings.json / share record).
 * Draft window state stays in localStorage per tab (`workspace-state-*-ws-*`).
 */
export type { WorkspaceLayoutPreset, WorkspaceLayoutScope } from './workspace-layout-presets-types'
export {
  workspaceLayoutScopeFromShareToken,
  makeWorkspaceLayoutPresetId,
} from './workspace-layout-presets-types'
