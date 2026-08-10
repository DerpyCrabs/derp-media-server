import type { FileItem } from '@/lib/types'
import { shareOfflineJobScope } from './offline-job-observer'
import { removeWebOffline, saveForWebOffline, webOfflineSupported } from './web-offline-storage'
import { navigate } from './routes'

type ShareContext = { token: string; sharePath: string } | null

function absoluteUrl(relative: string): string {
  return new URL(relative, window.location.origin).href
}

function relativeSharePath(path: string, sharePath: string): string {
  const normalized = path.replace(/\\/g, '/')
  const base = sharePath.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized === base) return ''
  return normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized
}

export function isOfflineFeatureAvailable(): boolean {
  return webOfflineSupported()
}

export async function fetchOfflineFiles(path: string): Promise<{ files: FileItem[] }> {
  const response = await fetch(`/__offline/files?dir=${encodeURIComponent(path)}`)
  if (!response.ok) throw new Error('Could not read offline files')
  return response.json() as Promise<{ files: FileItem[] }>
}

export function isPathAvailableOffline(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return (window.__DERP_WEB_OFFLINE_PATHS__ ?? []).some(
    (saved) => saved === normalized || saved.startsWith(`${normalized}/`),
  )
}

export function openOfflineFiles(): boolean {
  if (!webOfflineSupported()) return false
  navigate({ kind: 'offline' })
  return true
}

export async function makeAvailableOffline(
  file: FileItem,
  share: ShareContext = null,
): Promise<boolean> {
  const relativePath = share ? relativeSharePath(file.path, share.sharePath) : file.path
  const listUrl = file.isDirectory
    ? share
      ? `/api/share/${encodeURIComponent(share.token)}/files?dir=`
      : '/api/files?dir='
    : null
  return saveForWebOffline({
    item: file,
    apiPath: relativePath,
    displayPath: file.path.replace(/\\/g, '/'),
    listBaseUrl: listUrl ? absoluteUrl(listUrl) : undefined,
    mediaBaseUrl: share
      ? absoluteUrl(`/api/share/${encodeURIComponent(share.token)}/media/`)
      : absoluteUrl('/api/media/'),
    scope: share ? shareOfflineJobScope(share.token) : 'owner',
  })
}

export function removeOfflineFile(file: FileItem, share: ShareContext = null): boolean {
  return removeWebOffline(file.path, file.name, share ? shareOfflineJobScope(share.token) : 'owner')
}
