import type { PlaybackSession } from '@/features/playback'
import { createMediaFocus } from '@/features/playback/media-focus'

export function createDesktopMediaFocus(session: PlaybackSession) {
  return createMediaFocus({
    isPlaying: () => session.getSnapshot().desiredPlaying,
    pause: () => session.dispatch({ type: 'pause' }),
    subscribe: (listener) => session.subscribe(listener),
  })
}
