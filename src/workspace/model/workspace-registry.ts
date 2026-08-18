import type { PersistedWorkspaceState } from './use-workspace'

export type WorkspaceRecord = {
  id: string
  name?: string
  icon?: string
  iconColor?: string
  snapshot: PersistedWorkspaceState
  revision: number
  updatedAt: number
  lastOpenedAt: number
  locked?: boolean
}

export type WorkspaceRegistry = {
  version: 1
  order: string[]
  records: Record<string, WorkspaceRecord>
}

export type WorkspaceOpenResult = {
  record: WorkspaceRecord
  editable: boolean
  leaseDurationMs: number
}

export function workspaceDisplayName(record: WorkspaceRecord, position = 1): string {
  const named = record.name?.trim()
  if (named) return named
  return `Workspace ${position}`
}

export function workspaceClientId(): string {
  const key = 'workspace-client-id'
  const existing = sessionStorage.getItem(key)
  if (existing) return existing
  const id = crypto.randomUUID()
  sessionStorage.setItem(key, id)
  return id
}
