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
import { PlaybackProvider } from './features/playback/PlaybackProvider'
import { FilesystemPlaybackSync } from './integrations/filesystem/PlaybackSync'
import { createFilesystemBrowserPlaybackSession } from './integrations/filesystem/playback'

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
  const playbackSession = createFilesystemBrowserPlaybackSession()

  return (
    <QueryClientProvider client={props.queryClient}>
      <PlaybackProvider session={playbackSession}>
        <SolidThemeSync />
        <GlobalForbiddenToast />
        <PlaybackMediaHost />
        <FilesystemPlaybackSync />
        {props.children}
      </PlaybackProvider>
    </QueryClientProvider>
  )
}
