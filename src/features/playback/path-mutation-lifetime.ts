import { subscribeAdminEvents } from '@/lib/api/admin-events-stream'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import { getPlaybackSession } from './PlaybackProvider'
import { applyPlaybackPathMutation } from './path-mutation'
export function createPlaybackPathMutationLifetime() {
  const dispose = subscribeAdminEvents((mutation) => {
    const session = getPlaybackSession()
    const previous = session.getSnapshot().currentItem
    applyPlaybackPathMutation(session, mutation)
    if (previous && !session.getSnapshot().currentItem && window.location.pathname === '/') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('playing') === previous.locator)
        navigateSearchParams({ playing: null, audioOnly: null }, 'replace')
    }
  })
  return { dispose }
}
