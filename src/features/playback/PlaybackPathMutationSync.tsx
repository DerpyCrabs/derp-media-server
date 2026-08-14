import { useAdminEventsStream } from '@/src/lib/use-admin-events-stream'
import { navigateSearchParams } from '@/src/browser-history'
import { usePlaybackSession } from './PlaybackProvider'
import { applyPlaybackPathMutation } from './path-mutation'

export function PlaybackPathMutationSync() {
  const session = usePlaybackSession()
  useAdminEventsStream(true, (mutation) => {
    const previous = session.getSnapshot().currentItem
    applyPlaybackPathMutation(session, mutation)
    if (
      previous &&
      !session.getSnapshot().currentItem &&
      typeof window !== 'undefined' &&
      window.location.pathname === '/'
    ) {
      const params = new URLSearchParams(window.location.search)
      if (params.get('playing') === previous.locator) {
        navigateSearchParams({ playing: null, audioOnly: null }, 'replace')
      }
    }
  })
  return null
}
