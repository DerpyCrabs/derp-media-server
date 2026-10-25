import { MediaType } from '@/lib/files/types'

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
const PDF_EXTENSIONS = ['pdf']
const BOOK_EXTENSIONS = ['epub', 'fb2', 'fb2.zip']
const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'json',
  'xml',
  'csv',
  'tsv',
  'm3u',
  'm3u8',
  'pls',
  'xspf',
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
  'toml',
  'jsonc',
  'jsonl',
  'ndjson',
  'desktop',
  'service',
  'socket',
  'timer',
  'target',
  'cfg',
  'config',
  'env',
  'fish',
  'zsh',
  'bash',
  'nix',
  'lua',
  'srt',
  'vtt',
  'ass',
  'diff',
  'patch',
  'properties',
]

const MIME_TYPES: Record<string, string> = {
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',

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

  // PDF
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  fb2: 'application/x-fictionbook+xml',
  'fb2.zip': 'application/zip',

  // Text
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  m3u: 'audio/x-mpegurl',
  m3u8: 'audio/x-mpegurl',
  pls: 'audio/x-scpls',
  xspf: 'application/xspf+xml',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
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

  if (PDF_EXTENSIONS.includes(ext)) {
    return MediaType.PDF
  }

  if (BOOK_EXTENSIONS.includes(ext)) {
    return MediaType.BOOK
  }

  if (TEXT_EXTENSIONS.includes(ext)) {
    return MediaType.TEXT
  }

  return MediaType.OTHER
}

export function getMediaExtensionFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.fb2.zip')) return 'fb2.zip'
  const name = lower.split(/[/\\]/).at(-1) ?? ''
  return name.includes('.') ? (name.split('.').at(-1) ?? '') : ''
}

export function getMediaTypeFromPath(path: string): MediaType {
  const name = path.split(/[/\\]/).at(-1)?.toLowerCase() ?? ''
  if (
    [
      'makefile',
      'dockerfile',
      'readme',
      'license',
      '.bashrc',
      '.zshrc',
      '.profile',
      '.bash_profile',
      '.bash_logout',
      '.gitignore',
      '.gitattributes',
      '.editorconfig',
      '.env',
      '.npmrc',
    ].includes(name) ||
    name.startsWith('.env.')
  )
    return MediaType.TEXT
  return getMediaType(getMediaExtensionFromPath(path))
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
