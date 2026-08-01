import type { AutoSaveSettings } from './types'
import type { WorkspaceTaskbarPin } from './workspace-taskbar-pins'
import type { WorkspaceLayoutPreset } from './workspace-layout-presets-types'

type ViewMode = 'list' | 'grid'

export interface GlobalSettings {
  viewModes: Record<string, ViewMode>
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
  workspaceTaskbarPins?: WorkspaceTaskbarPin[]
  workspaceLayoutPresets?: WorkspaceLayoutPreset[]
}
