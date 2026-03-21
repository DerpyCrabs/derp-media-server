import { stripSharePrefix } from '@/lib/source-context'

export type MediaShareContext = { token: string; sharePath: string } | null | undefined

function encodeSegments(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

export function buildAdminMediaUrl(filePath: string): string {
  return `/api/media/${encodeSegments(filePath)}`
}

export function buildMediaUrl(filePath: string, ctx: MediaShareContext): string {
  if (ctx) return buildShareMediaUrl(ctx.token, ctx.sharePath, filePath)
  return buildAdminMediaUrl(filePath)
}

export function buildShareMediaUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  const relative = stripSharePrefix(filePath, shareBasePath.replace(/\\/g, '/'))
  return `/api/share/${shareToken}/media/${encodeSegments(relative || '.')}`
}

export function buildAdminAudioExtractUrl(filePath: string): string {
  return `/api/audio/extract/${filePath}`
}

export function buildShareAudioExtractUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  const relative = stripSharePrefix(filePath, shareBasePath.replace(/\\/g, '/'))
  return `/api/share/${shareToken}/audio/extract/${encodeSegments(relative || '.')}`
}

export function buildAudioExtractUrl(filePath: string, ctx: MediaShareContext): string {
  if (ctx) return buildShareAudioExtractUrl(ctx.token, ctx.sharePath, filePath)
  return buildAdminAudioExtractUrl(filePath)
}

export function buildAdminAudioMetadataUrl(filePath: string): string {
  return `/api/audio/metadata/${filePath}`
}

export function buildShareAudioMetadataUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  const relative = stripSharePrefix(filePath, shareBasePath.replace(/\\/g, '/'))
  return `/api/share/${shareToken}/audio/metadata/${encodeSegments(relative || '.')}`
}

export function buildAudioMetadataUrl(filePath: string, ctx: MediaShareContext): string {
  if (ctx) return buildShareAudioMetadataUrl(ctx.token, ctx.sharePath, filePath)
  return buildAdminAudioMetadataUrl(filePath)
}

export function buildAdminThumbnailUrl(filePath: string): string {
  return `/api/thumbnail/${filePath}`
}

export function buildShareThumbnailUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  const relative = stripSharePrefix(filePath, shareBasePath.replace(/\\/g, '/'))
  return `/api/share/${shareToken}/thumbnail/${encodeSegments(relative || '.')}`
}

export function buildThumbnailUrl(filePath: string, ctx: MediaShareContext): string {
  if (ctx) return buildShareThumbnailUrl(ctx.token, ctx.sharePath, filePath)
  return buildAdminThumbnailUrl(filePath)
}
