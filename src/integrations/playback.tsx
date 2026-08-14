import {
  createBrowserPlaybackPersistence,
  createPlaybackSession,
  type BrowserPlaybackPersistenceOptions,
  type PlaybackSession,
  type PlaybackSourceRequest,
  type PlaybackSourceResolver,
} from '@/src/features/playback'
import { For } from 'solid-js'
import { applicationContentRegistry } from './registry'

export const applicationPlaybackSourceResolver: PlaybackSourceResolver = Object.freeze({
  resolve: (request: PlaybackSourceRequest) =>
    applicationContentRegistry.resolvePlaybackSource(request),
})

export function createApplicationBrowserPlaybackSession(
  persistenceOptions: BrowserPlaybackPersistenceOptions = {},
): PlaybackSession {
  return createPlaybackSession({
    sourceResolver: applicationPlaybackSourceResolver,
    persistence: createBrowserPlaybackPersistence(persistenceOptions),
  })
}

export function ApplicationPlaybackLifecycles() {
  return (
    <For each={applicationContentRegistry.playbackLifecycles()}>{(Lifecycle) => <Lifecycle />}</For>
  )
}
