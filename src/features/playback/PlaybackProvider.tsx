import { modelOwner } from 'effectweb'
import { restoreActivityQueue } from '@/features/media-ai/activity'
import {
  createMediaElementHost,
  type MediaElementHost,
  type PlaybackSession,
  type PlaybackSnapshot,
} from './index'

let session: PlaybackSession | undefined
let mediaHost: MediaElementHost | undefined
const owner = modelOwner<{ snapshot: PlaybackSnapshot | undefined }>({ snapshot: undefined })
export const playbackSource = {
  model: (): PlaybackSnapshot => {
    const snapshot = owner.read().snapshot
    if (!snapshot) throw new Error('Playback has not been initialized')
    return snapshot
  },
  subscribe: (listener: (snapshot: PlaybackSnapshot) => void) =>
    owner.source.subscribe(({ snapshot }) => {
      if (snapshot) listener(snapshot)
    }),
}
export function getPlaybackSession() {
  if (!session) throw new Error('Playback has not been initialized')
  return session
}
export function getPlaybackMediaHost() {
  if (!mediaHost) throw new Error('Playback has not been initialized')
  return mediaHost
}
export function initializePlayback(next: PlaybackSession) {
  session = next
  mediaHost = createMediaElementHost(next)
  const host = mediaHost
  owner.patch({ snapshot: next.getSnapshot() })
  const unsubscribe = next.subscribe(() => owner.patch({ snapshot: next.getSnapshot() }))
  const stopActivityQueue = restoreActivityQueue()
  const checkpoint = () => next.dispatch({ type: 'checkpoint' })
  window.addEventListener('pagehide', checkpoint)
  return {
    source: playbackSource,
    session: next,
    mediaHost: host,
    dispose() {
      stopActivityQueue()
      window.removeEventListener('pagehide', checkpoint)
      unsubscribe()
      host.dispose()
      next.dispatch({ type: 'destroy' })
      if (session === next) {
        session = undefined
        mediaHost = undefined
      }
    },
  }
}
