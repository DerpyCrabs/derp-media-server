import type { ParentProps } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { PlaybackMediaHost } from './features/playback/PlaybackMediaHost'
import { PlaybackPathMutationSync } from './features/playback/PlaybackPathMutationSync'
import { PlaybackProvider } from './features/playback/PlaybackProvider'
import { createOwnerBrowserPlaybackSession } from './features/playback/browser-session'

export function AppProviders(props: ParentProps) {
  const session = createOwnerBrowserPlaybackSession(useQueryClient())

  return (
    <PlaybackProvider session={session}>
      <PlaybackMediaHost />
      <PlaybackPathMutationSync />
      {props.children}
    </PlaybackProvider>
  )
}
