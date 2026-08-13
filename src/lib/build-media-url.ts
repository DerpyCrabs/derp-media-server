function encodeSegments(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

export function buildAdminMediaUrl(filePath: string): string {
  return `/api/media/${encodeSegments(filePath)}`
}

export function buildMediaUrl(filePath: string): string {
  return buildAdminMediaUrl(filePath)
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

export function buildAdminImageUrl(filePath: string, request: ResponsiveImageRequest): string {
  return `/api/image/${encodeSegments(filePath)}?${imageQuery(request)}`
}

export function buildImageUrl(filePath: string, request: ResponsiveImageRequest): string {
  return buildAdminImageUrl(filePath, request)
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
