import { createEffect } from 'solid-js'
import {
  audioPlaybackQueueFromFiles,
  playbackItemFromFileItem,
  playbackItemFromPath,
  playbackPathKey,
  playbackPathMatches,
  playbackQueuesEqual,
  type PlaybackItem,
  type PlaybackSession,
} from '@/features/playback'
import type { FileItem } from '@/lib/files/types'

function playbackItemForPath(files: FileItem[], path: string): PlaybackItem | null {
  const normalizedPath = playbackPathKey(path)
  const listed = files.find((file) => playbackPathKey(file.path) === normalizedPath)
  return listed ? playbackItemFromFileItem(listed) : playbackItemFromPath(path)
}

export function mediaCenterPlaybackQueue(files: FileItem[], item: PlaybackItem): PlaybackItem[] {
  if (item.media === 'video') return [item]
  const queue = audioPlaybackQueueFromFiles(files, item)
  return queue.some((candidate) => playbackPathMatches(candidate, item.locator))
    ? queue
    : [...queue, item]
}

export function MediaCenterPlaybackSync(props: {
  playingPath: () => string | null
  audioOnly: () => boolean
  session: PlaybackSession
  files: () => FileItem[]
  displayedFiles: () => FileItem[]
}) {
  let previousPath: string | null = null

  createEffect(
    () => {
      const path = props.playingPath()
      if (window.location.pathname !== '/') return { path: null, onRoot: false as const }
      if (!path) return { path: null, onRoot: true as const }
      const item = playbackItemForPath(props.files(), path)
      return {
        path,
        onRoot: true as const,
        item,
        mode: item?.media === 'video' && props.audioOnly() ? 'audio' : item?.media,
        queue: item ? mediaCenterPlaybackQueue(props.displayedFiles(), item) : [],
      }
    },
    (next) => {
      if (!next.onRoot) return
      if (!next.path) {
        if (previousPath) props.session.dispatch({ type: 'stop' })
        previousPath = null
        return
      }
      previousPath = next.path
      if (!next.item || !next.mode) return
      const state = props.session.getSnapshot()
      const sameCurrent =
        state.currentItem !== null && playbackPathMatches(state.currentItem, next.item.locator)
      if (!sameCurrent) {
        props.session.dispatch({
          type: 'load',
          item: next.item,
          queue: next.queue,
          mode: next.mode,
          autoplay: true,
        })
        return
      }
      if (state.mode !== next.mode) props.session.dispatch({ type: 'setMode', mode: next.mode })
      if (next.item.media === 'audio' && !playbackQueuesEqual(state.queue, next.queue)) {
        props.session.dispatch({
          type: 'setQueue',
          queue: next.queue,
          current: state.currentItem,
        })
      }
    },
  )
  return null
}
