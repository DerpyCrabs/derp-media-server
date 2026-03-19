/**
 * Named workspace layouts: stored on the server (settings.json / share record).
 * Draft window state stays in localStorage per tab (`workspace-state-*-ws-*`).
 */
export type { WorkspaceLayoutPreset, WorkspaceLayoutScope } from './workspace-layout-presets-types'
export {
  workspaceLayoutScopeFromShareToken,
  makeWorkspaceLayoutPresetId,
} from './workspace-layout-presets-types'
export {
  MAX_WORKSPACE_LAYOUT_PRESETS,
  MAX_LAYOUT_PRESET_NAME_LENGTH,
  parseWorkspaceLayoutPresetsList,
  sanitizeAdminWorkspaceLayoutPresets,
  sanitizeShareWorkspaceLayoutPresets,
  snapshotAllowedForAdminSnapshot,
  snapshotAllowedForShareSnapshot,
} from './workspace-layout-presets-schema'
