import { MediaType } from './types'

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'json',
  'xml',
  'csv',
  'log',
  'yaml',
  'yml',
  'ini',
  'conf',
  'sh',
  'bat',
  'ps1',
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'scss',
  'html',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'swift',
  'kt',
  'sql',
]

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

  // Image
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',

  // Text
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  csv: 'text/csv',
  log: 'text/plain',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  ini: 'text/plain',
  conf: 'text/plain',
  sh: 'text/x-shellscript',
  bat: 'text/plain',
  ps1: 'text/plain',
  js: 'text/javascript',
  ts: 'text/typescript',
  jsx: 'text/javascript',
  tsx: 'text/typescript',
  css: 'text/css',
  scss: 'text/x-scss',
  html: 'text/html',
  py: 'text/x-python',
  java: 'text/x-java',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  cs: 'text/x-csharp',
  go: 'text/x-go',
  rs: 'text/x-rust',
  php: 'text/x-php',
  rb: 'text/x-ruby',
  swift: 'text/x-swift',
  kt: 'text/x-kotlin',
  sql: 'text/x-sql',
}

export function getMediaType(extension: string): MediaType {
  const ext = extension.toLowerCase()

  if (VIDEO_EXTENSIONS.includes(ext)) {
    return MediaType.VIDEO
  }

  if (AUDIO_EXTENSIONS.includes(ext)) {
    return MediaType.AUDIO
  }

  if (IMAGE_EXTENSIONS.includes(ext)) {
    return MediaType.IMAGE
  }

  if (TEXT_EXTENSIONS.includes(ext)) {
    return MediaType.TEXT
  }

  return MediaType.OTHER
}

export function getMimeType(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] || 'application/octet-stream'
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

export function isMediaFile(extension: string): boolean {
  const type = getMediaType(extension)
  return type === MediaType.VIDEO || type === MediaType.AUDIO || type === MediaType.IMAGE || type === MediaType.TEXT
}
