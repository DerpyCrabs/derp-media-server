import { buildAdminMediaUrl } from '@/lib/media/build-media-url'
import type { WindowSource } from '@/lib/models/window-model'

const cache = new Map<string, { width: number; height: number }>()
const inFlight = new Set<string>()

export function videoIntrinsicsCacheKey(source: WindowSource, filePath: string): string {
  return `${source.kind}:${filePath}`
}

export function getVideoIntrinsics(key: string): { width: number; height: number } | undefined {
  return cache.get(key)
}

export function rememberVideoIntrinsics(
  source: WindowSource,
  filePath: string,
  width: number,
  height: number,
): void {
  if (width <= 0 || height <= 0) return
  cache.set(videoIntrinsicsCacheKey(source, filePath), { width, height })
}

export function preloadVideoIntrinsics(source: WindowSource, filePath: string): void {
  if (typeof document === 'undefined') return
  const key = videoIntrinsicsCacheKey(source, filePath)
  if (cache.has(key) || inFlight.has(key)) return
  inFlight.add(key)

  const url = buildAdminMediaUrl(filePath)
  const abs = new URL(url, window.location.origin).href
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true

  const cleanup = () => {
    inFlight.delete(key)
    video.removeEventListener('loadedmetadata', onMeta)
    video.removeEventListener('error', onError)
    video.src = ''
    video.load()
  }

  const onMeta = () => {
    const width = video.videoWidth
    const height = video.videoHeight
    cleanup()
    rememberVideoIntrinsics(source, filePath, width, height)
  }

  const onError = () => cleanup()

  video.addEventListener('loadedmetadata', onMeta)
  video.addEventListener('error', onError)
  video.src = abs
  video.load()
}
