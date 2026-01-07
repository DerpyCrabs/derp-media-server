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
}

export interface AudioMetadata {
  title: string | null
  artist: string | null
  album: string | null
  year: number | null
  genre: string[] | null
  duration: number | null
  coverArt: string | null
  trackNumber: number | null
  albumArtist: string | null
}

export interface AutoSaveSettings {
  enabled: boolean
  readOnly?: boolean
}
