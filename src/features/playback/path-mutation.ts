import { movePath, normalizePath, pathIsWithin, type PathMutation } from '@/lib/files/path-mutation'
import type { PlaybackItem, PlaybackSession } from './types'

function moveItem(item: PlaybackItem, oldPath: string, newPath: string): PlaybackItem {
  if (!pathIsWithin(item.locator, oldPath)) return item
  const locator = movePath(item.locator, oldPath, newPath)
  return {
    ...item,
    locator,
    name:
      normalizePath(item.locator) === normalizePath(oldPath)
        ? locator.split('/').at(-1) || item.name
        : item.name,
  }
}

export function applyPlaybackPathMutation(session: PlaybackSession, mutation: PathMutation): void {
  const snapshot = session.getSnapshot()
  const current = snapshot.currentItem
  if (!current) return

  if (mutation.type === 'path-removed') {
    const queue = snapshot.queue.filter((item) => !pathIsWithin(item.locator, mutation.path))
    if (queue.length === snapshot.queue.length) return
    if (pathIsWithin(current.locator, mutation.path)) {
      if (queue.length === 0) session.dispatch({ type: 'stop' })
      else session.dispatch({ type: 'setQueue', queue })
      return
    }
    session.dispatch({ type: 'setQueue', queue, current })
    return
  }

  const queue = snapshot.queue.map((item) => moveItem(item, mutation.oldPath, mutation.newPath))
  const movedCurrent = moveItem(current, mutation.oldPath, mutation.newPath)
  if (movedCurrent === current) {
    if (queue.some((item, index) => item !== snapshot.queue[index])) {
      session.dispatch({ type: 'setQueue', queue, current })
    }
    return
  }
  session.dispatch({
    type: 'load',
    item: movedCurrent,
    queue,
    autoplay: snapshot.desiredPlaying,
    position: snapshot.position,
    mode: snapshot.mode,
  })
}
