import { ApiError } from '@/lib/api'
import type { PersistedResourceTarget, ResourceRef, ResourceSummary } from '@/lib/resource'
import {
  inspectResourceTarget,
  resolveLegacyResourceTarget,
  type ResourceInspectAccess,
} from '@/lib/resource-target-resolution'
import type {
  PlaybackItem,
  PlaybackScope,
  PlaybackSourceAdapter,
  PlaybackSourceRequest,
  PlaybackSourceResolution,
} from '@/lib/playback-session'
import { grantOpenScope } from '@/src/lib/legacy-resource-adapter'
import { findWebOfflinePlaybackMedia } from '@/src/lib/web-offline-storage'
import {
  buildAudioExtractUrl,
  buildMediaUrl,
  type MediaShareContext,
} from '@/src/lib/build-media-url'

type InspectResource = typeof inspectResourceTarget
type ResolveLegacyResource = typeof resolveLegacyResourceTarget

type PlaybackSourceDependencies = Readonly<{
  inspectResource?: InspectResource
  resolveLegacyResource?: ResolveLegacyResource
}>

export type OwnerPlaybackSourceAdapterOptions = PlaybackSourceDependencies &
  Readonly<{
    surface?: Extract<ResourceInspectAccess, { kind: 'owner' }>['surface']
  }>

export type GrantSessionPlaybackSourceAdapterOptions = PlaybackSourceDependencies &
  Readonly<{
    token: string
    sharePath: string | (() => string)
    authorized?: () => boolean
    /** Opaque authorization-session identity. Defaults to a one-way token-derived id. */
    id?: string
  }>

type AdapterConfig = Readonly<{
  scope: PlaybackScope
  access: ResourceInspectAccess
  shareContext(): MediaShareContext
  redact(message: string): string
  inspectResource: InspectResource
  resolveLegacyResource: ResolveLegacyResource
  authorized?: () => boolean
}>

function sameRef(left: ResourceRef, right: ResourceRef): boolean {
  return left.libraryId === right.libraryId && left.resourceId === right.resourceId
}

function sameScope(left: PlaybackScope, right: PlaybackScope): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'owner' || (right.kind === 'grantSession' && left.id === right.id))
  )
}

function isLegacyRef(ref: ResourceRef): boolean {
  return ref.libraryId === 'legacy-library' || ref.resourceId.startsWith('legacy-path-')
}

function sourceFor(
  item: PlaybackItem,
  mode: PlaybackSourceRequest['mode'],
  online: boolean,
  shareContext: MediaShareContext,
): Extract<PlaybackSourceResolution, { kind: 'resolved' }> {
  const originalUrl = buildMediaUrl(item.locator, shareContext)
  const useExtractedAudio = online && item.media === 'video' && mode === 'audio'
  return {
    kind: 'resolved',
    url: useExtractedAudio ? buildAudioExtractUrl(item.locator, shareContext) : originalUrl,
    sourceKind: online ? 'online' : 'offline',
  }
}

function offlineSourceFor(
  item: PlaybackItem,
  shareContext: MediaShareContext,
): PlaybackSourceResolution {
  const prefix = shareContext
    ? `/api/share/${encodeURIComponent(shareContext.token)}/media/`
    : '/api/media/'
  const saved = findWebOfflinePlaybackMedia(item.ref, item.version, item.locator, prefix)
  if (saved.status === 'found') {
    return { kind: 'resolved', url: saved.mediaUrl, sourceKind: 'offline' }
  }
  return {
    kind: 'recoverable',
    issue: 'offlineUnavailable',
    message: 'This media item is not available offline.',
  }
}

function targetFor(item: PlaybackItem): PersistedResourceTarget {
  return { ref: { ...item.ref }, legacyLocator: item.locator }
}

function playableMedia(summary: ResourceSummary): PlaybackItem['media'] | null {
  if (summary.presentation === 'audio') return 'audio'
  if (summary.presentation === 'video') return 'video'
  return null
}

function safeResolvedItem(
  previous: PlaybackItem,
  summary: ResourceSummary,
  allowIdentityBackfill: boolean,
): PlaybackItem | null {
  if (!allowIdentityBackfill && !sameRef(previous.ref, summary.ref)) return null
  const media = playableMedia(summary)
  const locator =
    summary.legacyLocator ?? (sameRef(previous.ref, summary.ref) ? previous.locator : '')
  if (!media || !locator) return null
  const version = summary.version ?? previous.version
  return {
    ref: { ...summary.ref },
    ...(version === undefined ? {} : { version }),
    locator,
    name: summary.name,
    media,
  }
}

function sameItem(left: PlaybackItem, right: PlaybackItem): boolean {
  return (
    sameRef(left.ref, right.ref) &&
    left.version === right.version &&
    left.locator === right.locator &&
    left.name === right.name &&
    left.media === right.media
  )
}

function statusFor(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

function messageFor(error: unknown, redact: (message: string) => string): string {
  const message = error instanceof Error ? error.message : 'Playback source could not be resolved'
  return redact(message)
}

function unavailable(
  issue: 'missing' | 'sourceUnavailable',
  item?: PlaybackItem,
): PlaybackSourceResolution {
  return {
    kind: 'recoverable',
    issue,
    message:
      issue === 'missing'
        ? 'This media item is no longer available.'
        : 'The media source is currently unavailable.',
    ...(item ? { item } : {}),
  }
}

function validateSummary(
  previous: PlaybackItem,
  summary: ResourceSummary | null,
  request: PlaybackSourceRequest,
  config: AdapterConfig,
  allowIdentityBackfill: boolean,
): PlaybackSourceResolution {
  if (!summary) return unavailable('missing')
  if (summary.availability !== 'present') return unavailable(summary.availability)
  if (!allowIdentityBackfill && !sameRef(previous.ref, summary.ref)) return unavailable('missing')
  const item = safeResolvedItem(previous, summary, allowIdentityBackfill)
  if (!item) return unavailable('sourceUnavailable')
  if (
    !summary.providerOperations.some((operation) => operation === 'read' || operation === 'stream')
  ) {
    return unavailable('sourceUnavailable', item)
  }

  const source = sourceFor(item, request.mode, request.online, config.shareContext())
  if (
    previous.version !== undefined &&
    summary.version !== undefined &&
    previous.version !== summary.version
  ) {
    return {
      kind: 'recoverable',
      issue: 'versionChanged',
      message: 'This media item changed since it was queued.',
      item,
      fallback: { url: source.url, sourceKind: source.sourceKind },
    }
  }
  return { ...source, ...(sameItem(previous, item) ? {} : { item }) }
}

async function refreshSource(
  request: PlaybackSourceRequest,
  config: AdapterConfig,
): Promise<PlaybackSourceResolution> {
  try {
    const legacy = isLegacyRef(request.item.ref)
    const summary = legacy
      ? await config.resolveLegacyResource(request.item.locator, config.access, request.signal)
      : await config.inspectResource(targetFor(request.item), config.access, request.signal)
    return validateSummary(request.item, summary, request, config, legacy)
  } catch (error) {
    if (request.signal.aborted) throw error
    const status = statusFor(error)
    if (status === 401 || status === 403) {
      return {
        kind: 'recoverable',
        issue: 'revoked',
        message: 'Access to this media item expired or was revoked.',
      }
    }
    if (status === 404 || status === 410) return unavailable('missing')
    return {
      kind: 'error',
      message: messageFor(error, config.redact),
      retryable: status === undefined || status === 408 || status === 429 || status >= 500,
    }
  }
}

function createAdapter(config: AdapterConfig): PlaybackSourceAdapter {
  return Object.freeze({
    resolve(
      request: PlaybackSourceRequest,
    ): PlaybackSourceResolution | Promise<PlaybackSourceResolution> {
      if (!sameScope(request.scope, config.scope)) {
        return {
          kind: 'error',
          message: 'Playback source scope does not match the active session.',
          retryable: false,
        }
      }
      if (config.authorized && !config.authorized()) {
        return {
          kind: 'recoverable',
          issue: 'revoked',
          message: 'Authorize this share to restore its playback session.',
        }
      }

      // Explicit loads and offline transitions must stay synchronous so the media
      // element can call play() inside the originating user gesture.
      if (!request.online) {
        return offlineSourceFor(request.item, config.shareContext())
      }
      if (request.reason === 'load') {
        return sourceFor(request.item, request.mode, request.online, config.shareContext())
      }
      return refreshSource(request, config)
    },
  })
}

export function createOwnerPlaybackSourceAdapter(
  options: OwnerPlaybackSourceAdapterOptions = {},
): PlaybackSourceAdapter {
  return createAdapter({
    scope: { kind: 'owner' },
    access: { kind: 'owner', surface: options.surface ?? 'library' },
    shareContext: () => null,
    redact: (message) => message,
    inspectResource: options.inspectResource ?? inspectResourceTarget,
    resolveLegacyResource: options.resolveLegacyResource ?? resolveLegacyResourceTarget,
  })
}

export function createGrantSessionPlaybackSourceAdapter(
  options: GrantSessionPlaybackSourceAdapterOptions,
): PlaybackSourceAdapter {
  if (!options.token) throw new Error('A Grant token is required for playback source access.')
  const generatedScope = grantOpenScope(options.token)
  const opaqueId =
    options.id ?? (generatedScope.kind === 'grant' ? generatedScope.id : 'invalid-grant-session')
  const encodedToken = encodeURIComponent(options.token)
  const redact = (message: string) =>
    message.replaceAll(options.token, '[grant]').replaceAll(encodedToken, '[grant]')
  return createAdapter({
    scope: { kind: 'grantSession', id: opaqueId },
    access: { kind: 'grant', token: options.token },
    shareContext: () => ({
      token: options.token,
      sharePath: typeof options.sharePath === 'function' ? options.sharePath() : options.sharePath,
    }),
    redact,
    inspectResource: options.inspectResource ?? inspectResourceTarget,
    resolveLegacyResource: options.resolveLegacyResource ?? resolveLegacyResourceTarget,
    authorized: options.authorized,
  })
}
