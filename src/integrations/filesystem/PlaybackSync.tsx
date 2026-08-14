import { createEffect } from 'solid-js'
import { navigateSearchParams } from '@/src/browser-history'
import { usePlaybackSession, usePlaybackSnapshot } from '@/src/features/playback/PlaybackProvider'
import { useApplicationEventsStream } from '@/src/lib/use-application-events-stream'
import { applyFilesystemPlaybackPathMutation, filesystemPlaybackItemPath } from './playback'

export function FilesystemPlaybackSync() {
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()

  useApplicationEventsStream(true, (mutation) => {
    const previous = session.getSnapshot().currentItem
    const previousPath = previous ? filesystemPlaybackItemPath(previous) : null
    applyFilesystemPlaybackPathMutation(session, mutation)
    if (
      previousPath &&
      !session.getSnapshot().currentItem &&
      typeof window !== 'undefined' &&
      window.location.pathname === '/'
    ) {
      const params = new URLSearchParams(window.location.search)
      if (params.get('playing') === previousPath) {
        navigateSearchParams({ playing: null, audioOnly: null }, 'replace')
      }
    }
  })

  let observedItem = ''
  createEffect(() => {
    const state = snapshot()
    const item = state.currentItem
    if (!item || typeof window === 'undefined' || window.location.pathname !== '/') return
    const path = filesystemPlaybackItemPath(item)
    if (path === null) return
    const signature = `${item.resource.provider}\0${item.resource.id}\0${state.mode}`
    if (signature === observedItem) return
    observedItem = signature
    const params = new URLSearchParams(window.location.search)
    if (!params.has('playing')) return
    const audioOnly = item.media === 'video' && state.mode === 'audio'
    if (params.get('playing') !== path || (params.get('audioOnly') === 'true') !== audioOnly) {
      navigateSearchParams({ playing: path, audioOnly: audioOnly ? 'true' : null }, 'replace')
    }
  })

  return null
}
