export type ViewMode = 'list' | 'grid'
export type FileSortField = 'name' | 'createdDate' | 'size' | 'favorite' | 'views'
export type SortDirection = 'asc' | 'desc'

export interface FileSortOrder {
  field: FileSortField
  direction: SortDirection
}

export interface FileColumnVisibility {
  createdDate: boolean
  size: boolean
  favorite: boolean
  views: boolean
}

export type FileColumnScope = 'media' | 'workspace'
export type FileColumnSettings = Record<FileColumnScope, FileColumnVisibility>

export interface AutoSaveSettings {
  enabled: boolean
  readOnly?: boolean
}

export type WorkspaceTransition = 'instant' | 'fade'

export interface GlobalSettings {
  viewModes: Record<string, ViewMode>
  sortOrders: Record<string, FileSortOrder>
  fileColumns: FileColumnSettings
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
  workspaceTransition: WorkspaceTransition
}
