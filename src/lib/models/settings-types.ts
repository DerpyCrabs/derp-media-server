export type ViewMode = 'list' | 'grid'
export type FileSortField = 'name' | 'createdDate' | 'size'
export type SortDirection = 'asc' | 'desc'

export interface FileSortOrder {
  field: FileSortField
  direction: SortDirection
}

export interface FileColumnVisibility {
  createdDate: boolean
  size: boolean
}

export interface AutoSaveSettings {
  enabled: boolean
  readOnly?: boolean
}

export interface GlobalSettings {
  viewModes: Record<string, ViewMode>
  sortOrders: Record<string, FileSortOrder>
  fileColumns: FileColumnVisibility
  favorites: string[]
  knowledgeBases: string[]
  customIcons: Record<string, string>
  autoSave: Record<string, AutoSaveSettings>
  workspaceTransition?: 'instant' | 'fade'
}
