export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
  TEXT = 'text',
  PDF = 'pdf',
  FOLDER = 'folder',
  OTHER = 'other',
}

export interface FileItem {
  name: string
  path: string // Relative to MEDIA_DIR
  type: MediaType
  size: number
  extension: string
  isDirectory: boolean
  isVirtual?: boolean
  viewCount?: number
  shareToken?: string
}

export interface AutoSaveSettings {
  enabled: boolean
  readOnly?: boolean
}
