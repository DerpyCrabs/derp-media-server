export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
  TEXT = 'text',
  PDF = 'pdf',
  BOOK = 'book',
  DOCUMENT = 'document',
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
  isExecutable?: boolean
  isDirectory: boolean
  isVirtual?: boolean
  viewCount?: number
  thumbnailGenerated?: boolean
  version?: number
}
