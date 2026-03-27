import { stripSharePrefix } from '@/lib/source-context'

export type ShareDownloadContext = { token: string; sharePath: string }

export function fileDownloadHref(
  path: string,
  share: ShareDownloadContext | null | undefined,
): string {
  const norm = path.replace(/\\/g, '/')
  if (share) {
    const shareNorm = share.sharePath.replace(/\\/g, '/')
    const rel = stripSharePrefix(norm, shareNorm)
    return `/api/share/${share.token}/download?path=${encodeURIComponent(rel)}`
  }
  return `/api/files/download?path=${encodeURIComponent(path)}`
}
