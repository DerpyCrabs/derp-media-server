import type { WorkspaceLayoutPresetDto } from './generated/api-contracts'

export type WorkspaceLayoutPreset = WorkspaceLayoutPresetDto

export function makeWorkspaceLayoutPresetId(): string {
  return `layout-${crypto.randomUUID()}`
}
