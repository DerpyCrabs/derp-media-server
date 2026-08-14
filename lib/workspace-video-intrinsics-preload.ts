import { buildMediaUrl } from '@/lib/api-media-urls'
import { createDefaultBounds, getPlayerBoundsForAspectRatio } from '@/lib/workspace-geometry'

const cache = new Map<string, { width: number; height: number }>()
const inFlight = new Set<string>()

export function workspaceVideoIntrinsicsCacheKey(filePath: string): string {
  return filePath
}

export function getWorkspaceVideoIntrinsics(
  key: string,
): { width: number; height: number } | undefined {
  return cache.get(key)
}

export function rememberWorkspaceVideoIntrinsics(
  filePath: string,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return
  cache.set(workspaceVideoIntrinsicsCacheKey(filePath), { width, height })
}

function mediaUrlForPreload(filePath: string): string {
  return buildMediaUrl(filePath)
}

export function preloadWorkspaceVideoIntrinsics(filePath: string): void {
  if (typeof document === 'undefined') return
  const key = workspaceVideoIntrinsicsCacheKey(filePath)
  if (cache.has(key) || inFlight.has(key)) return
  inFlight.add(key)

  const url = mediaUrlForPreload(filePath)
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
  defaultIndex: number,
): ReturnType<typeof createDefaultBounds> {
  const key = workspaceVideoIntrinsicsCacheKey(filePath)
  const dims = getWorkspaceVideoIntrinsics(key)
  if (!dims) return createDefaultBounds(defaultIndex, 'viewer')
  return getPlayerBoundsForAspectRatio(dims.width / dims.height, null)
}
