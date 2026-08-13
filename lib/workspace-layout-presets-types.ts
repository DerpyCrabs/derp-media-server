import type { PersistedWorkspaceState } from '@/lib/use-workspace'

export type WorkspaceLayoutScope = 'admin'

export interface WorkspaceLayoutPreset {
  id: string
  name: string
  scope: WorkspaceLayoutScope
  snapshot: PersistedWorkspaceState
  createdAt: string
  updatedAt?: string
}

export function makeWorkspaceLayoutPresetId(): string {
  return `layout-${crypto.randomUUID()}`
}
