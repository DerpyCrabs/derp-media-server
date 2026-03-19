import type { PersistedWorkspaceState } from '@/lib/use-workspace'

export type WorkspaceLayoutScope = 'admin' | `share:${string}`

export interface WorkspaceLayoutPreset {
  id: string
  name: string
  scope: WorkspaceLayoutScope
  snapshot: PersistedWorkspaceState
  createdAt: string
  updatedAt?: string
}

export function workspaceLayoutScopeFromShareToken(
  token: string | null | undefined,
): WorkspaceLayoutScope {
  return token ? `share:${token}` : 'admin'
}

export function makeWorkspaceLayoutPresetId(): string {
  return `layout-${crypto.randomUUID()}`
}
