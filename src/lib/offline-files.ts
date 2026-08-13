import type { FileItem } from '@/lib/types'
import { removeWebOffline, saveForWebOffline, webOfflineSupported } from './web-offline-storage'

function absoluteUrl(relative: string): string {
  return new URL(relative, window.location.origin).href
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
  window.history.pushState(null, '', '/?offline=1')
  window.dispatchEvent(new window.PopStateEvent('popstate'))
  return true
}

export async function makeAvailableOffline(file: FileItem): Promise<boolean> {
  const relativePath = file.path
  const listUrl = file.isDirectory ? '/api/files?dir=' : null
  return saveForWebOffline({
    item: file,
    apiPath: relativePath,
    displayPath: file.path.replace(/\\/g, '/'),
    listBaseUrl: listUrl ? absoluteUrl(listUrl) : undefined,
    mediaBaseUrl: absoluteUrl('/api/media/'),
  })
}

export function removeOfflineFile(file: FileItem): boolean {
  return removeWebOffline(file.path, file.name)
}
