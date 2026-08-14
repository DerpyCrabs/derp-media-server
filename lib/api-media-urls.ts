function encodeSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function buildMediaUrl(filePath: string): string {
  return `/api/media/${encodeSegments(filePath)}`
}

export type ResponsiveImageRequest = {
  width: number
  height: number
  dpr: number
  scale: number
  priority: 'active' | 'next' | 'prefetch'
}

function imageQuery(request: ResponsiveImageRequest): string {
  const params = new URLSearchParams({
    width: String(Math.max(1, Math.round(request.width))),
    height: String(Math.max(1, Math.round(request.height))),
    dpr: String(request.dpr),
    scale: String(request.scale),
    priority: request.priority,
  })
  return params.toString()
}

export function buildImageUrl(filePath: string, request: ResponsiveImageRequest): string {
  return `/api/image/${encodeSegments(filePath)}?${imageQuery(request)}`
}

export function buildImageConfigUrl(): string {
  return '/api/image-config'
}

export function buildAudioExtractUrl(filePath: string): string {
  return `/api/audio/extract/${filePath}`
}

export function buildAudioMetadataUrl(filePath: string): string {
  return `/api/audio/metadata/${filePath}`
}

export function buildThumbnailUrl(filePath: string): string {
  return `/api/thumbnail/${encodeSegments(filePath)}`
}
