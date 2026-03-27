import { buildAdminMediaUrl, buildShareMediaUrl } from '@/src/lib/build-media-url'
import { createDefaultBounds, getPlayerBoundsForAspectRatio } from '@/lib/workspace-geometry'
import type { WorkspaceSource } from '@/lib/use-workspace'

const cache = new Map<string, { width: number; height: number }>()
const inFlight = new Set<string>()

export function workspaceVideoIntrinsicsCacheKey(
  source: WorkspaceSource,
  filePath: string,
): string {
  const tok = source.kind === 'share' ? (source.token ?? '') : ''
  return `${source.kind}:${tok}:${filePath}`
}

export function getWorkspaceVideoIntrinsics(
  key: string,
): { width: number; height: number } | undefined {
  return cache.get(key)
}

export function rememberWorkspaceVideoIntrinsics(
  source: WorkspaceSource,
  filePath: string,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return
  cache.set(workspaceVideoIntrinsicsCacheKey(source, filePath), { width, height })
}

function mediaUrlForPreload(
  source: WorkspaceSource,
  filePath: string,
  shareBasePath: string,
): string {
  if (source.kind === 'share' && source.token) {
    return buildShareMediaUrl(source.token, shareBasePath.replace(/\\/g, '/'), filePath)
  }
  return buildAdminMediaUrl(filePath)
}

export function preloadWorkspaceVideoIntrinsics(
  source: WorkspaceSource,
  filePath: string,
  shareBasePath: string,
): void {
  if (typeof document === 'undefined') return
  const key = workspaceVideoIntrinsicsCacheKey(source, filePath)
  if (cache.has(key) || inFlight.has(key)) return
  inFlight.add(key)

  const url = mediaUrlForPreload(source, filePath, shareBasePath)
  const abs = new URL(url, window.location.origin).href
  const v = document.createElement('video')
  v.preload = 'metadata'
  v.muted = true
  v.playsInline = true

  const cleanup = () => {
    inFlight.delete(key)
    v.removeEventListener('loadedmetadata', onMeta)
    v.removeEventListener('error', onErr)
    v.src = ''
    v.load()
  }

  const onMeta = () => {
    const w = v.videoWidth
    const h = v.videoHeight
    cleanup()
    if (w > 0 && h > 0) cache.set(key, { width: w, height: h })
  }

  const onErr = () => {
    cleanup()
  }

  v.addEventListener('loadedmetadata', onMeta)
  v.addEventListener('error', onErr)
  v.src = abs
  v.load()
}

/** Initial viewer window bounds when opening a video, if hover (or prior play) filled the cache. */
export function viewerBoundsForVideoOpen(
  filePath: string,
  source: WorkspaceSource,
  defaultIndex: number,
): ReturnType<typeof createDefaultBounds> {
  const key = workspaceVideoIntrinsicsCacheKey(source, filePath)
  const dims = getWorkspaceVideoIntrinsics(key)
  if (!dims) return createDefaultBounds(defaultIndex, 'viewer')
  return getPlayerBoundsForAspectRatio(dims.width / dims.height, null)
}
