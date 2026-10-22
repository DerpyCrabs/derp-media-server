import { selection } from '@/features/media-ai/selection'
import { modelOwner } from 'effectweb'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
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

function playbackItemForPath(files: readonly FileItem[], path: string): PlaybackItem | null {
  const normalizedPath = playbackPathKey(path)
  const listed = [...selection(), ...files].find(
    (file) => playbackPathKey(file.path) === normalizedPath,
  )
  return listed ? playbackItemFromFileItem(listed) : playbackItemFromPath(path)
}

export function mediaCenterPlaybackQueue(
  files: readonly FileItem[],
  item: PlaybackItem,
): PlaybackItem[] {
  const selected = selection()
  if (selected.some((f) => f.path === item.locator))
    return selected
      .filter((f) => f.type === item.media)
      .flatMap((f) => {
        const next = playbackItemFromFileItem(f)
        return next ? [next] : []
      })
  if (item.media === 'video') return [item]
  const queue = audioPlaybackQueueFromFiles(files, item)
  return queue.some((candidate) => playbackPathMatches(candidate, item.locator))
    ? queue
    : [...queue, item]
}

export type MediaCenterPlaybackSyncProps = {
  playingPath: string | null
  audioOnly: boolean
  session?: PlaybackSession
  files: readonly FileItem[]
  displayedFiles: readonly FileItem[]
}
export function createMediaCenterPlaybackSync(initial: MediaCenterPlaybackSyncProps) {
  const owner = modelOwner({})
  let props = initial
  const session = initial.session ?? getPlaybackSession()
  let previousPath: string | null = null
  let previousMode: string | undefined

  const calculate = () => {
    const path = props.playingPath
    if (window.location.pathname !== '/') return { path: null, onRoot: false as const }
    if (!path) return { path: null, onRoot: true as const }
    const item = playbackItemForPath(props.files, path)
    return {
      path,
      onRoot: true as const,
      item,
      mode: item?.media === 'video' && props.audioOnly ? 'audio' : item?.media,
      includesPlaying: props.displayedFiles.some(
        (file) => playbackPathKey(file.path) === playbackPathKey(path),
      ),
      queue: item ? mediaCenterPlaybackQueue(props.displayedFiles, item) : [],
    }
  }
  const sync = () => {
    const next = calculate()
    if (!next.onRoot) return
    if (!next.path) {
      if (previousPath) session.dispatch({ type: 'stop' })
      previousPath = null
      return
    }
    const pathChanged = previousPath !== next.path
    const modeChanged = previousMode !== next.mode
    previousPath = next.path
    previousMode = next.mode
    if (!next.item || !next.mode) return
    const state = session.getSnapshot()
    const sameCurrent =
      state.currentItem !== null && playbackPathMatches(state.currentItem, next.item.locator)
    if (!sameCurrent) {
      if (!pathChanged) return
      session.dispatch({
        type: 'load',
        item: next.item,
        queue: next.queue,
        mode: next.mode,
        autoplay: true,
      })
      return
    }
    if (modeChanged && state.mode !== next.mode)
      session.dispatch({ type: 'setMode', mode: next.mode })
    if (
      !state.queueContext &&
      next.includesPlaying &&
      next.item.media === 'audio' &&
      !playbackQueuesEqual(state.queue, next.queue)
    ) {
      session.dispatch({ type: 'setQueue', queue: next.queue, current: state.currentItem })
    }
  }
  sync()
  return {
    receive: (next: MediaCenterPlaybackSyncProps) => {
      if (owner.disposed) return
      props = next
      sync()
    },
    dispose: owner.dispose,
    close: owner.close,
  }
}
