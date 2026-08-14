import {
  QueryClient,
  QueryClientProvider,
  hydrate,
  type DehydratedState,
} from '@tanstack/solid-query'
import type { ParentProps } from 'solid-js'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'
import { SolidThemeSync } from './SolidThemeSync'
import { PlaybackMediaHost } from './features/playback/PlaybackMediaHost'
import { PlaybackPathMutationSync } from './features/playback/PlaybackPathMutationSync'
import { PlaybackProvider } from './features/playback/PlaybackProvider'
import { createOwnerBrowserPlaybackSession } from './features/playback/browser-session'

export function createAppQueryClient(dehydratedState?: DehydratedState): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        refetchOnWindowFocus: true,
      },
    },
  })

  if (dehydratedState) hydrate(queryClient, dehydratedState)
  return queryClient
}

export function AppProviders(props: ParentProps<{ queryClient: QueryClient }>) {
  const playbackSession = createOwnerBrowserPlaybackSession()

  return (
    <QueryClientProvider client={props.queryClient}>
      <PlaybackProvider session={playbackSession}>
        <SolidThemeSync />
        <GlobalForbiddenToast />
        <PlaybackMediaHost />
        <PlaybackPathMutationSync />
        {props.children}
      </PlaybackProvider>
    </QueryClientProvider>
  )
}
