import { stripSharePrefix } from '@/lib/source-context'

export type MediaShareContext = { token: string; sharePath: string } | null | undefined

function encodeSegments(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

function shareRequestPath(filePath: string, shareBasePath: string): string {
  const normalizedBase = shareBasePath.replace(/\\/g, '/')
  return stripSharePrefix(filePath, normalizedBase) || normalizedBase
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
  return `/api/share/${shareToken}/media/${encodeSegments(shareRequestPath(filePath, shareBasePath))}`
}

function buildAdminAudioExtractUrl(filePath: string): string {
  return `/api/audio/extract/${filePath}`
}

function buildShareAudioExtractUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  return `/api/share/${shareToken}/audio/extract/${encodeSegments(shareRequestPath(filePath, shareBasePath))}`
}

export function buildAudioExtractUrl(filePath: string, ctx: MediaShareContext): string {
  if (ctx) return buildShareAudioExtractUrl(ctx.token, ctx.sharePath, filePath)
  return buildAdminAudioExtractUrl(filePath)
}

function buildAdminAudioMetadataUrl(filePath: string): string {
  return `/api/audio/metadata/${filePath}`
}

function buildShareAudioMetadataUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  return `/api/share/${shareToken}/audio/metadata/${encodeSegments(shareRequestPath(filePath, shareBasePath))}`
}

export function buildAudioMetadataUrl(filePath: string, ctx: MediaShareContext): string {
  if (ctx) return buildShareAudioMetadataUrl(ctx.token, ctx.sharePath, filePath)
  return buildAdminAudioMetadataUrl(filePath)
}

function buildAdminThumbnailUrl(filePath: string): string {
  return `/api/thumbnail/${encodeSegments(filePath)}`
}

function buildShareThumbnailUrl(
  shareToken: string,
  shareBasePath: string,
  filePath: string,
): string {
  return `/api/share/${shareToken}/thumbnail/${encodeSegments(shareRequestPath(filePath, shareBasePath))}`
}

export function buildThumbnailUrl(filePath: string, ctx: MediaShareContext): string {
  if (ctx) return buildShareThumbnailUrl(ctx.token, ctx.sharePath, filePath)
  return buildAdminThumbnailUrl(filePath)
}
