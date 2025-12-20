export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  FOLDER = 'folder',
  OTHER = 'other'
}

export interface FileItem {
  name: string;
  path: string; // Relative to MEDIA_DIR
  type: MediaType;
  size: number;
  extension: string;
  isDirectory: boolean;
}

