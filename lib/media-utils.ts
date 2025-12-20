import { MediaType } from './types';

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'];

export const MIME_TYPES: Record<string, string> = {
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  opus: 'audio/opus',
};

export function getMediaType(extension: string): MediaType {
  const ext = extension.toLowerCase();
  
  if (VIDEO_EXTENSIONS.includes(ext)) {
    return MediaType.VIDEO;
  }
  
  if (AUDIO_EXTENSIONS.includes(ext)) {
    return MediaType.AUDIO;
  }
  
  return MediaType.OTHER;
}

export function getMimeType(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] || 'application/octet-stream';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

export function isMediaFile(extension: string): boolean {
  const type = getMediaType(extension);
  return type === MediaType.VIDEO || type === MediaType.AUDIO;
}

