export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
  TEXT = 'text',
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
