import { stripSharePrefix } from '@/lib/source-context'

function encodeSegments(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

export function buildAdminMediaUrl(filePath: string): string {
  return `/api/media/${encodeSegments(filePath)}`
}

export function buildShareMediaUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  const relative = stripSharePrefix(filePath, shareBasePath.replace(/\\/g, '/'))
  return `/api/share/${shareToken}/media/${encodeSegments(relative || '.')}`
}
