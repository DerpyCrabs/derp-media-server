export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
  TEXT = 'text',
  PDF = 'pdf',
  BOOK = 'book',
  FOLDER = 'folder',
  OTHER = 'other',
}

export interface FileItem {
  name: string
  path: string // Logical media path; root-prefixed when multiple media roots are configured
  type: MediaType
  size: number
  createdDate?: number
  extension: string
  isDirectory: boolean
  isVirtual?: boolean
  viewCount?: number
  thumbnailGenerated?: boolean
  version?: number
}
