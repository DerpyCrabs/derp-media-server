export type { WorkspaceLayoutPreset, WorkspaceLayoutScope } from './workspace-settings-types'

export function makeWorkspaceLayoutPresetId(): string {
  return `layout-${crypto.randomUUID()}`
}
