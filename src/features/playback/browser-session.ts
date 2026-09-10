import { trackPlayback } from '@/features/media-ai/activity'
import { buildAudioExtractUrl, buildMediaUrl } from '@/lib/media/build-media-url'
import { createPlaybackSession } from './playback-session'
import { videoPlaybackProgress } from './video-progress-persistence'
import type { QueryClient } from '@tanstack/solid-query'
import { resolveVideoSource } from './video-source'
import type {
  PersistedPlaybackState,
  PlaybackPersistence,
  PlaybackSession,
  PlaybackSourceRequest,
  PlaybackSourceResolution,
  PlaybackSourceResolver,
} from './types'

export const ownerPlaybackSourceResolver: PlaybackSourceResolver = Object.freeze({
  resolve(request: PlaybackSourceRequest): PlaybackSourceResolution {
    const url =
      request.item.media === 'video' && request.mode === 'audio'
        ? buildAudioExtractUrl(request.item.locator)
        : buildMediaUrl(request.item.locator)
    return { kind: 'resolved', url }
  },
})

const legacyVideoPlaybackPersistence: PlaybackPersistence = {
  load: () => null,
  save(state: PersistedPlaybackState) {
    const item = state.queue[state.currentIndex]
    if (item?.media === 'video') {
      videoPlaybackProgress.getState().saveTime(item.locator, state.position, state.duration)
    }
  },
  legacyPosition(locator: string) {
    return videoPlaybackProgress.getState().getSavedTime(locator)
  },
}

export function createOwnerBrowserPlaybackSession(queryClient: QueryClient): PlaybackSession {
  const persistence: PlaybackPersistence = {
    ...legacyVideoPlaybackPersistence,
    save(state) {
      legacyVideoPlaybackPersistence.save(state)
    },
  }
  return trackPlayback(
    createPlaybackSession({
      sourceResolver: {
        resolve: (request) =>
          request.item.media === 'video'
            ? resolveVideoSource(queryClient, request)
            : ownerPlaybackSourceResolver.resolve(request),
      },
      persistence,
    }),
  )
}
