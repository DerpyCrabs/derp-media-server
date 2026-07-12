import type { FileItem } from '@/lib/types'
import { removeWebOffline, saveForWebOffline, webOfflineSupported } from './web-offline-storage'

type ShareContext = { token: string; sharePath: string } | null

type AndroidBridge = {
  postMessage(message: string): void
}

declare global {
  interface Window {
    DerpAndroid?: AndroidBridge
    __DERP_OFFLINE_PATHS__?: string[]
  }
}

function send(payload: Record<string, unknown>): boolean {
  if (typeof window === 'undefined' || !window.DerpAndroid) return false
  window.DerpAndroid.postMessage(JSON.stringify(payload))
  return true
}

function announce(detail: Record<string, unknown>) {
  window.dispatchEvent(new window.CustomEvent('derp-offline-status', { detail }))
}

function absoluteUrl(relative: string): string {
  return new URL(relative, window.location.origin).href
}

function encodeSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function relativeSharePath(path: string, sharePath: string): string {
  const normalized = path.replace(/\\/g, '/')
  const base = sharePath.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized === base) return ''
  return normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized
}

export function isAndroidApp(): boolean {
  return typeof window !== 'undefined' && !!window.DerpAndroid
}

export function isOfflineFeatureAvailable(): boolean {
  return webOfflineSupported()
}

export async function fetchOfflineFiles(path: string): Promise<{ files: FileItem[] }> {
  const response = await fetch(`/__offline/files?dir=${encodeURIComponent(path)}`, {
    headers: isAndroidApp() ? { 'X-Derp-Native-Offline': '1' } : undefined,
  })
  if (!response.ok) throw new Error('Could not read offline files')
  return response.json() as Promise<{ files: FileItem[] }>
}

export function isAndroidPathAvailableOffline(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return (
    [...(window.__DERP_OFFLINE_PATHS__ ?? []), ...(window.__DERP_WEB_OFFLINE_PATHS__ ?? [])].some(
      (saved) => saved === normalized || saved.startsWith(`${normalized}/`),
    ) ?? false
  )
}

export function openAndroidOffline(): boolean {
  if (!isAndroidApp() && !webOfflineSupported()) return false
  window.history.pushState(null, '', '/?offline=1')
  window.dispatchEvent(new window.PopStateEvent('popstate'))
  return true
}

export function changeAndroidServer(): boolean {
  return send({ type: 'changeServer' })
}

export function playInAndroid(file: FileItem, share: ShareContext = null): boolean {
  if (!isAndroidApp()) return false
  const mediaPath = share ? relativeSharePath(file.path, share.sharePath) || '.' : file.path
  const mediaUrl = share
    ? `/api/share/${encodeURIComponent(share.token)}/media/${encodeSegments(mediaPath)}`
    : `/api/media/${encodeSegments(file.path)}`
  return send({
    type: 'play',
    url: absoluteUrl(mediaUrl),
    title: file.name,
    mediaType: file.type,
  })
}

export function downloadInAndroid(file: FileItem, share: ShareContext = null): boolean {
  if (!isAndroidApp()) return false
  if (!isOfflineFeatureAvailable()) {
    const relativePath = share ? relativeSharePath(file.path, share.sharePath) : file.path
    const downloadUrl = share
      ? `/api/share/${encodeURIComponent(share.token)}/download?path=${encodeURIComponent(relativePath)}`
      : `/api/files/download?path=${encodeURIComponent(file.path)}`
    return send({
      type: 'deviceDownload',
      url: absoluteUrl(downloadUrl),
      name: file.isDirectory ? `${file.name}.zip` : file.name,
    })
  }
  void makeAvailableOffline(file, share)
  return true
}

export async function makeAvailableOffline(file: FileItem, share: ShareContext = null): Promise<boolean> {
  const relativePath = share ? relativeSharePath(file.path, share.sharePath) : file.path
  const downloadUrl = share
    ? `/api/share/${encodeURIComponent(share.token)}/download?path=${encodeURIComponent(relativePath)}`
    : `/api/files/download?path=${encodeURIComponent(file.path)}`
  const listUrl = file.isDirectory
    ? share
      ? `/api/share/${encodeURIComponent(share.token)}/files?dir=`
      : '/api/files?dir='
    : null
  if (!isAndroidApp()) {
    return saveForWebOffline({
      item: file,
      apiPath: relativePath,
      displayPath: file.path.replace(/\\/g, '/'),
      listBaseUrl: listUrl ? absoluteUrl(listUrl) : undefined,
      mediaBaseUrl: share
        ? absoluteUrl(`/api/share/${encodeURIComponent(share.token)}/media/`)
        : absoluteUrl('/api/media/'),
    })
  }
  const sent = send({
    type: 'download',
    name: file.name,
    path: relativePath,
    displayPath: file.path.replace(/\\/g, '/'),
    mediaType: file.type,
    isDirectory: file.isDirectory,
    downloadUrl: absoluteUrl(downloadUrl),
    mediaUrl: file.isDirectory
      ? null
      : absoluteUrl(
          share
            ? `/api/share/${encodeURIComponent(share.token)}/media/${encodeSegments(relativePath || '.')}`
            : `/api/media/${encodeSegments(file.path)}`,
        ),
    thumbnailUrl:
      !file.isDirectory && (file.type === 'image' || file.type === 'video')
        ? absoluteUrl(
            share
              ? `/api/share/${encodeURIComponent(share.token)}/thumbnail/${encodeSegments(relativePath || '.')}`
              : `/api/thumbnail/${encodeSegments(file.path)}`,
          )
        : null,
    listUrl: listUrl ? absoluteUrl(listUrl) : null,
    mediaBaseUrl: share
      ? absoluteUrl(`/api/share/${encodeURIComponent(share.token)}/media/`)
      : absoluteUrl('/api/media/'),
    thumbnailBaseUrl: share
      ? absoluteUrl(`/api/share/${encodeURIComponent(share.token)}/thumbnail/`)
      : absoluteUrl('/api/thumbnail/'),
  })
  if (sent) announce({ state: 'queued', name: file.name, path: file.path })
  return sent
}

export function removeOfflineInAndroid(file: FileItem): boolean {
  if (!isAndroidApp()) return removeWebOffline(file.path, file.name)
  const sent = send({
    type: 'removeOffline',
    name: file.name,
    displayPath: file.path.replace(/\\/g, '/'),
  })
  if (sent) announce({ state: 'removed', name: file.name, path: file.path })
  return sent
}
