import { describe, expect, test } from 'bun:test'
import { ApiError } from '@/lib/api'
import type { ResourceSummary } from '@/lib/resource'
import type {
  PlaybackItem,
  PlaybackSourceAdapter,
  PlaybackSourceRequest,
  PlaybackSourceResolution,
} from '@/lib/playback-session'
import { MediaType, type FileItem } from '@/lib/types'
import { openResource } from '@/src/lib/open-resource'
import {
  dedupePlaybackQueue,
  playbackItemFromFileItem,
  playbackItemFromOpenPlan,
  playbackItemFromResource,
  playbackItemKey,
  playbackQueueFromFiles,
} from '@/src/media/playback/items'
import {
  createGrantSessionPlaybackSourceAdapter,
  createOwnerPlaybackSourceAdapter,
} from '@/src/media/playback/source-adapters'

function summary(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    ref: { libraryId: 'library-1', resourceId: 'resource-1' },
    locator: { sourceId: 'source-1', providerLocator: 'opaque/item' },
    legacyLocator: 'Music/track one.mp3',
    version: 'version-1',
    name: 'track one.mp3',
    kind: 'file',
    presentation: 'audio',
    mimeType: 'audio/mpeg',
    providerOperations: ['read', 'stream'],
    availability: 'present',
    ...overrides,
  }
}

function item(overrides: Partial<PlaybackItem> = {}): PlaybackItem {
  return {
    ref: { libraryId: 'library-1', resourceId: 'resource-1' },
    version: 'version-1',
    locator: 'Music/track one.mp3',
    name: 'track one.mp3',
    media: 'audio',
    ...overrides,
  }
}

function request(
  source: PlaybackItem,
  overrides: Partial<PlaybackSourceRequest> = {},
): PlaybackSourceRequest {
  return {
    scope: { kind: 'owner' },
    item: source,
    mode: source.media,
    online: true,
    reason: 'load',
    signal: new AbortController().signal,
    ...overrides,
  }
}

async function resolved(
  adapter: PlaybackSourceAdapter,
  input: PlaybackSourceRequest,
): Promise<PlaybackSourceResolution> {
  return await adapter.resolve(input)
}

interface OfflinePlaybackFixture {
  path: string
  mediaUrl?: string
  ref?: PlaybackItem['ref']
  version?: PlaybackItem['version']
}

function withOfflinePlaybackCatalog<T>(entries: OfflinePlaybackFixture[], run: () => T): T {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __DERP_WEB_OFFLINE_PLAYBACK__: entries },
    writable: true,
  })
  try {
    return run()
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

describe('playback item helpers', () => {
  test('copies only safe catalog fields and rejects unavailable or non-media resources', () => {
    expect(playbackItemFromResource(summary())).toEqual(item())
    expect(playbackItemFromResource(summary({ availability: 'missing' }))).toBeNull()
    expect(playbackItemFromResource(summary({ presentation: 'image' }))).toBeNull()
    expect(playbackItemFromResource(summary({ legacyLocator: undefined }))).toBeNull()
  })

  test('does not retain FileItem Grant credentials', () => {
    const file: FileItem = {
      name: 'track one.mp3',
      path: 'Shared/track one.mp3',
      type: MediaType.AUDIO,
      size: 12,
      extension: 'mp3',
      isDirectory: false,
      shareToken: 'do-not-persist-this-token',
      resource: summary({ legacyLocator: 'Shared/track one.mp3' }),
    }
    const safe = playbackItemFromFileItem(file)
    expect(safe).toEqual(item({ locator: 'Shared/track one.mp3' }))
    expect(JSON.stringify(safe)).not.toContain(file.shareToken!)
    expect(safe).not.toHaveProperty('shareToken')
  })

  test('prefers embedded catalog presentation over stale legacy file classification', () => {
    const file: FileItem = {
      name: 'clip.mp4',
      path: 'Movies/clip.mp4',
      type: MediaType.AUDIO,
      size: 12,
      extension: 'mp4',
      isDirectory: false,
      resource: summary({
        legacyLocator: 'Movies/clip.mp4',
        name: 'clip.mp4',
        presentation: 'video',
        mimeType: 'video/mp4',
      }),
    }
    expect(playbackItemFromFileItem(file)).toMatchObject({ media: 'video' })
    expect(
      playbackItemFromFileItem({
        ...file,
        resource: summary({ presentation: 'image', mimeType: 'image/jpeg' }),
      }),
    ).toBeNull()
  })

  test('uses OpenPlan media/version only for the same stable resource', () => {
    const video = summary({
      presentation: 'video',
      mimeType: 'video/mp4',
      legacyLocator: 'Movies/clip.mp4',
      name: 'clip.mp4',
    })
    const plan = openResource(video, 'play', {
      surface: 'library',
      scope: { kind: 'owner' },
    })
    expect(playbackItemFromOpenPlan(plan, video)).toEqual(
      item({ locator: 'Movies/clip.mp4', name: 'clip.mp4', media: 'video' }),
    )
    expect(
      playbackItemFromOpenPlan(plan, summary({ ref: { ...video.ref, resourceId: 'other' } })),
    ).toBeNull()
  })

  test('deduplicates by collision-safe stable ref while preserving first queue order', () => {
    const first = item()
    const movedDuplicate = item({ locator: 'Music/moved.mp3', name: 'moved.mp3' })
    const second = item({
      ref: { libraryId: 'library-1', resourceId: 'resource-2' },
      locator: 'Music/second.mp3',
      name: 'second.mp3',
    })
    expect(playbackItemKey(first)).not.toBe(
      playbackItemKey(item({ ref: { libraryId: 'library-1resource-', resourceId: '1' } })),
    )
    expect(dedupePlaybackQueue([first, movedDuplicate, second])).toEqual([first, second])
  })

  test('builds a media-only, ref-deduplicated queue from legacy rows', () => {
    const files: FileItem[] = [
      {
        name: 'track.mp3',
        path: 'Music/track.mp3',
        type: MediaType.AUDIO,
        size: 1,
        extension: 'mp3',
        isDirectory: false,
      },
      {
        name: 'note.txt',
        path: 'Music/note.txt',
        type: MediaType.TEXT,
        size: 1,
        extension: 'txt',
        isDirectory: false,
      },
    ]
    expect(playbackQueueFromFiles(files)).toHaveLength(1)
    expect(playbackQueueFromFiles(files)[0]).toMatchObject({
      locator: 'Music/track.mp3',
      media: 'audio',
    })
  })
})

describe('authorized playback source adapters', () => {
  test('resolves an explicit owner load synchronously for user-gesture playback', () => {
    const adapter = createOwnerPlaybackSourceAdapter()
    const outcome = adapter.resolve(request(item()))
    expect(outcome).not.toBeInstanceOf(Promise)
    expect(outcome).toEqual({
      kind: 'resolved',
      url: '/api/media/Music/track%20one.mp3',
      sourceKind: 'online',
    })
  })

  test('uses extraction online and original video bytes as the offline audio-only fallback', () => {
    const video = item({
      locator: 'Movies/movie one.mp4',
      name: 'movie one.mp4',
      media: 'video',
    })
    const adapter = createOwnerPlaybackSourceAdapter()
    expect(adapter.resolve(request(video, { mode: 'audio' }))).toEqual({
      kind: 'resolved',
      url: '/api/audio/extract/Movies/movie one.mp4',
      sourceKind: 'online',
    })
    withOfflinePlaybackCatalog(
      [
        {
          path: video.locator,
          mediaUrl: '/api/media/Movies/movie%20one.mp4',
          ref: video.ref,
          version: video.version,
        },
      ],
      () => {
        expect(adapter.resolve(request(video, { mode: 'audio', online: false }))).toEqual({
          kind: 'resolved',
          url: '/api/media/Movies/movie%20one.mp4',
          sourceKind: 'offline',
        })
      },
    )
  })

  test('resolves installed media synchronously by stable ref after its locator moves', () => {
    const queued = item({ locator: 'Music/Renamed/track one.mp3' })
    withOfflinePlaybackCatalog(
      [
        {
          path: 'Music/track one.mp3',
          mediaUrl: '/api/media/Music/track%20one.mp3',
          ref: queued.ref,
          version: queued.version,
        },
      ],
      () => {
        const outcome = createOwnerPlaybackSourceAdapter().resolve(
          request(queued, { online: false, reason: 'onlineChange' }),
        )
        expect(outcome).not.toBeInstanceOf(Promise)
        expect(outcome).toEqual({
          kind: 'resolved',
          url: '/api/media/Music/track%20one.mp3',
          sourceKind: 'offline',
        })
      },
    )
  })

  test('reports offlineUnavailable synchronously when the installed catalog has no entry', () => {
    withOfflinePlaybackCatalog([], () => {
      const outcome = createOwnerPlaybackSourceAdapter().resolve(
        request(item(), { online: false, reason: 'onlineChange' }),
      )
      expect(outcome).not.toBeInstanceOf(Promise)
      expect(outcome).toMatchObject({ kind: 'recoverable', issue: 'offlineUnavailable' })
    })
  })

  test('does not reuse offline media installed under another Grant token prefix', () => {
    const shared = item({ locator: 'Shared/track one.mp3' })
    withOfflinePlaybackCatalog(
      [
        {
          path: shared.locator,
          mediaUrl: '/api/share/another-token/media/track%20one.mp3',
          ref: shared.ref,
          version: shared.version,
        },
      ],
      () => {
        const adapter = createGrantSessionPlaybackSourceAdapter({
          id: 'grant-session-1',
          token: 'current/token',
          sharePath: 'Shared',
        })
        const outcome = adapter.resolve(
          request(shared, {
            scope: { kind: 'grantSession', id: 'grant-session-1' },
            online: false,
            reason: 'onlineChange',
          }),
        )
        expect(outcome).not.toBeInstanceOf(Promise)
        expect(outcome).toMatchObject({ kind: 'recoverable', issue: 'offlineUnavailable' })
      },
    )
  })

  test('keeps Grant credentials in its live closure and isolates session scopes', async () => {
    const token = 'secret/token value'
    let inspectedToken = ''
    const adapter = createGrantSessionPlaybackSourceAdapter({
      id: 'grant-session-1',
      token,
      sharePath: 'Shared',
      inspectResource: async (_target, access) => {
        inspectedToken = access.kind === 'grant' ? access.token : ''
        throw Object.assign(new Error(`failed for ${token} or ${encodeURIComponent(token)}`), {
          status: 500,
        })
      },
    })

    expect(JSON.stringify(adapter)).not.toContain(token)
    const mismatch = await resolved(
      adapter,
      request(item({ locator: 'Shared/track.mp3' }), {
        scope: { kind: 'grantSession', id: 'another-session' },
        reason: 'refresh',
      }),
    )
    expect(mismatch).toMatchObject({ kind: 'error', retryable: false })
    expect(inspectedToken).toBe('')

    const failure = await resolved(
      adapter,
      request(item({ locator: 'Shared/track.mp3' }), {
        scope: { kind: 'grantSession', id: 'grant-session-1' },
        reason: 'refresh',
      }),
    )
    expect(inspectedToken).toBe(token)
    expect(failure).toMatchObject({ kind: 'error', retryable: true })
    expect(JSON.stringify(failure)).not.toContain(token)
    expect(JSON.stringify(failure)).not.toContain(encodeURIComponent(token))

    expect(
      adapter.resolve(
        request(item({ locator: 'Shared/track one.mp3' }), {
          scope: { kind: 'grantSession', id: 'grant-session-1' },
        }),
      ),
    ).toEqual({
      kind: 'resolved',
      url: `/api/share/${encodeURIComponent(token)}/media/track%20one.mp3`,
      sourceKind: 'online',
    })
  })

  test('does not restore a persisted Grant item before the share is authorized', async () => {
    let authorized = false
    let inspections = 0
    const adapter = createGrantSessionPlaybackSourceAdapter({
      id: 'grant-session-1',
      token: 'protected-token',
      sharePath: 'Shared',
      authorized: () => authorized,
      inspectResource: async () => {
        inspections += 1
        return summary({ legacyLocator: 'Shared/track one.mp3' })
      },
    })
    const persisted = item({ locator: 'Shared/track one.mp3' })
    const restoreRequest = request(persisted, {
      scope: { kind: 'grantSession', id: 'grant-session-1' },
      reason: 'restore',
    })

    expect(await resolved(adapter, restoreRequest)).toMatchObject({
      kind: 'recoverable',
      issue: 'revoked',
    })
    expect(inspections).toBe(0)

    authorized = true
    expect(await resolved(adapter, { ...restoreRequest, reason: 'refresh' })).toMatchObject({
      kind: 'resolved',
      url: '/api/share/protected-token/media/track%20one.mp3',
    })
    expect(inspections).toBe(1)
  })

  test('re-inspects stable identity and updates a moved locator', async () => {
    let inspectedTarget: unknown
    const adapter = createOwnerPlaybackSourceAdapter({
      inspectResource: async (target) => {
        inspectedTarget = target
        return summary({
          legacyLocator: 'Music/Renamed/track.mp3',
          name: 'track.mp3',
        })
      },
    })
    const outcome = await resolved(adapter, request(item(), { reason: 'restore' }))
    expect(inspectedTarget).toEqual({
      ref: item().ref,
      legacyLocator: 'Music/track one.mp3',
    })
    expect(outcome).toEqual({
      kind: 'resolved',
      url: '/api/media/Music/Renamed/track.mp3',
      sourceKind: 'online',
      item: item({ locator: 'Music/Renamed/track.mp3', name: 'track.mp3' }),
    })
  })

  test('reports an opaque version change with the refreshed safe item and source', async () => {
    const adapter = createOwnerPlaybackSourceAdapter({
      inspectResource: async () =>
        summary({
          version: 'version-2',
          legacyLocator: 'Music/updated.mp3',
          name: 'updated.mp3',
        }),
    })
    expect(await resolved(adapter, request(item(), { reason: 'retry' }))).toEqual({
      kind: 'recoverable',
      issue: 'versionChanged',
      message: 'This media item changed since it was queued.',
      item: item({
        version: 'version-2',
        locator: 'Music/updated.mp3',
        name: 'updated.mp3',
      }),
      fallback: {
        url: '/api/media/Music/updated.mp3',
        sourceKind: 'online',
      },
    })
  })

  test('maps missing, source-unavailable, and revoked inspections to recoverable issues', async () => {
    const cases = [
      [null, 'missing'],
      [summary({ availability: 'missing' }), 'missing'],
      [summary({ availability: 'sourceUnavailable' }), 'sourceUnavailable'],
    ] as const
    for (const [inspected, issue] of cases) {
      const adapter = createOwnerPlaybackSourceAdapter({
        inspectResource: async () => inspected,
      })
      expect(await resolved(adapter, request(item(), { reason: 'refresh' }))).toMatchObject({
        kind: 'recoverable',
        issue,
      })
    }

    const revoked = createGrantSessionPlaybackSourceAdapter({
      id: 'grant-session-1',
      token: 'revoked-token',
      sharePath: 'Shared',
      inspectResource: async () => {
        throw new ApiError(403, 'forbidden')
      },
    })
    expect(
      await resolved(
        revoked,
        request(item({ locator: 'Shared/track.mp3' }), {
          scope: { kind: 'grantSession', id: 'grant-session-1' },
          reason: 'refresh',
        }),
      ),
    ).toMatchObject({ kind: 'recoverable', issue: 'revoked' })
  })

  test('backfills legacy path identity through the existing resolver', async () => {
    let inspected = false
    let resolvedLocator = ''
    const adapter = createOwnerPlaybackSourceAdapter({
      inspectResource: async () => {
        inspected = true
        return null
      },
      resolveLegacyResource: async (locator) => {
        resolvedLocator = locator
        return summary({ legacyLocator: 'Music/track one.mp3' })
      },
    })
    const legacy = item({
      ref: { libraryId: 'legacy-library', resourceId: 'legacy-path-Music%2Ftrack%20one.mp3' },
      version: undefined,
    })
    const outcome = await resolved(adapter, request(legacy, { reason: 'refresh' }))
    expect(inspected).toBe(false)
    expect(resolvedLocator).toBe(legacy.locator)
    expect(outcome).toMatchObject({
      kind: 'resolved',
      item: { ref: summary().ref, version: 'version-1' },
    })
  })
})
