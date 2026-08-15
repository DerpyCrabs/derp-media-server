import type { GlobalSettings } from '@/lib/models/settings-types'
import type { PersistedWindowState } from '@/lib/models/window-model'
import type { TaskbarPin } from '@/lib/models/taskbar-pins'

export type WorkspaceLayoutScope = 'admin'

export interface WorkspaceLayoutPreset {
  id: string
  name: string
  scope: WorkspaceLayoutScope
  snapshot: PersistedWindowState
  createdAt: string
  updatedAt?: string
}

export interface WorkspaceSettings extends GlobalSettings {
  workspaceTaskbarPins?: TaskbarPin[]
  workspaceLayoutPresets?: WorkspaceLayoutPreset[]
}
