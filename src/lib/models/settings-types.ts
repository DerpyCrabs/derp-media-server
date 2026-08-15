export type ViewMode = 'list' | 'grid'

export interface AutoSaveSettings {
  enabled: boolean
  readOnly?: boolean
}

export interface GlobalSettings {
  viewModes: Record<string, ViewMode>
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
}
