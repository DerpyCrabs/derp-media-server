import {
  createBrowserPlaybackPersistence,
  createPlaybackSession,
  type BrowserPlaybackPersistenceOptions,
  type PlaybackSession,
  type PlaybackSourceRequest,
  type PlaybackSourceResolution,
  type PlaybackSourceResolver,
} from '@/src/features/playback'
import { buildAudioExtractUrl, buildMediaUrl } from '@/src/lib/build-media-url'

export const ownerPlaybackSourceResolver: PlaybackSourceResolver = Object.freeze({
  resolve(request: PlaybackSourceRequest): PlaybackSourceResolution {
    if (request.item.resource.provider !== 'filesystem') {
      return { kind: 'error', message: 'This provider does not expose a playback source.' }
    }
    const url =
      request.item.media === 'video' && request.mode === 'audio'
        ? buildAudioExtractUrl(request.item.locator)
        : buildMediaUrl(request.item.locator)
    return { kind: 'resolved', url }
  },
})

export function createOwnerBrowserPlaybackSession(
  persistenceOptions: BrowserPlaybackPersistenceOptions = {},
): PlaybackSession {
  return createPlaybackSession({
    sourceResolver: ownerPlaybackSourceResolver,
    persistence: createBrowserPlaybackPersistence(persistenceOptions),
  })
}
